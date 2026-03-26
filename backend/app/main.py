from fastapi import FastAPI, APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import select, func
from pydantic import BaseModel
from typing import Optional, List
from uuid import UUID
from datetime import date
import tempfile, os

from app.core.config import settings
from app.core.security import verify_password, create_access_token, create_refresh_token, decode_token
from app.models.models import Base, Usuario, PapelUsuario, Cliente, Contrato, Visita, StatusVisita

# ─────────────────────────────────────────────
# DB
# ─────────────────────────────────────────────

engine = create_async_engine(settings.DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session

# ─────────────────────────────────────────────
# App
# ─────────────────────────────────────────────

app = FastAPI(title=settings.PROJECT_NAME, version=settings.VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

# ─────────────────────────────────────────────
# Auth
# ─────────────────────────────────────────────

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")
router = APIRouter(prefix="/api/v1")

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> Usuario:
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Token inválido.")
    user = await db.get(Usuario, UUID(payload["sub"]))
    if not user or not user.ativo:
        raise HTTPException(status_code=401, detail="Usuário não encontrado ou inativo.")
    return user

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    usuario: dict

@router.post("/auth/login", response_model=TokenResponse, tags=["auth"])
async def login(form: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    stmt = select(Usuario).where(Usuario.email == form.username.lower())
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user or not verify_password(form.password, user.senha_hash):
        raise HTTPException(status_code=401, detail="Credenciais inválidas.")
    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
        usuario={"id": str(user.id), "nome": user.nome, "papel": user.papel, "email": user.email},
    )

@router.get("/auth/me", tags=["auth"])
async def me(current_user: Usuario = Depends(get_current_user)):
    return {
        "id": str(current_user.id),
        "nome": current_user.nome,
        "email": current_user.email,
        "papel": current_user.papel,
        "codigo_externo": current_user.codigo_externo,
    }

# ─────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}

# ─────────────────────────────────────────────
# Usuarios
# ─────────────────────────────────────────────

@router.get("/usuarios", tags=["usuarios"])
async def listar_usuarios(
    papel: Optional[str] = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Usuario).where(Usuario.ativo == True).order_by(Usuario.nome)
    if papel:
        try:
            papel_enum = PapelUsuario(papel.upper())
            stmt = stmt.where(Usuario.papel == papel_enum)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Papel inválido: {papel}")
    result = await db.execute(stmt)
    usuarios = result.scalars().all()
    return [
        {
            "id": str(u.id),
            "codigo_externo": u.codigo_externo,
            "nome": u.nome,
            "email": u.email,
            "papel": u.papel,
            "telefone": u.telefone,
            "ativo": u.ativo,
        }
        for u in usuarios
    ]

@router.get("/usuarios/me", tags=["usuarios"])
async def meu_perfil(current_user: Usuario = Depends(get_current_user)):
    return {
        "id": str(current_user.id),
        "codigo_externo": current_user.codigo_externo,
        "nome": current_user.nome,
        "email": current_user.email,
        "papel": current_user.papel,
        "telefone": current_user.telefone,
        "ativo": current_user.ativo,
    }

# ─────────────────────────────────────────────
# Clientes
# ─────────────────────────────────────────────

@router.get("/clientes", tags=["clientes"])
async def listar_clientes(
    busca: Optional[str] = None,
    filtro: Optional[str] = None,
    uf: Optional[str] = None,
    apenas_ativos: bool = True,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Cliente)
    if current_user.papel == PapelUsuario.ESN:
        stmt = stmt.where(Cliente.vendedor_responsavel_id == current_user.id)
    if apenas_ativos:
        stmt = stmt.where(Cliente.ativo == True)
    if filtro == "pendentes":
        from app.models.models import StatusAtribuicao
        stmt = stmt.where(Cliente.status_atribuicao == StatusAtribuicao.PENDENTE)
    elif filtro == "atribuidos":
        from app.models.models import StatusAtribuicao
        stmt = stmt.where(Cliente.status_atribuicao == StatusAtribuicao.ATRIBUIDO)
    if busca:
        like = f"%{busca}%"
        stmt = stmt.where(
            Cliente.razao_social.ilike(like) |
            Cliente.codigo_externo.ilike(like) |
            Cliente.municipio.ilike(like) |
            Cliente.cnpj.ilike(like)
        )
    if uf:
        stmt = stmt.where(Cliente.uf == uf.upper())
    stmt = stmt.order_by(Cliente.razao_social)
    result = await db.execute(stmt)
    clientes = result.scalars().all()
    return [
        {
            "id": str(c.id),
            "codigo_externo": c.codigo_externo,
            "razao_social": c.razao_social,
            "cnpj": c.cnpj,
            "segmento": c.segmento,
            "sub_segmento": c.sub_segmento,
            "municipio": c.municipio,
            "uf": c.uf,
            "lat": c.lat,
            "lng": c.lng,
            "setor_publico": c.setor_publico,
            "status_atribuicao": c.status_atribuicao,
            "status_cliente": c.status_cliente,
            "classificacao_abc": c.classificacao_abc,
            "vendedor_responsavel_id": str(c.vendedor_responsavel_id) if c.vendedor_responsavel_id else None,
            "ativo": c.ativo,
            "dormente": getattr(c, "dormente", False) or False,
        }
        for c in clientes
    ]

@router.get("/clientes/estatisticas", tags=["clientes"])
async def estatisticas_clientes(
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Cliente).where(Cliente.ativo == True)
    if current_user.papel == PapelUsuario.ESN:
        stmt = stmt.where(Cliente.vendedor_responsavel_id == current_user.id)
    result = await db.execute(stmt)
    todos = result.scalars().all()
    from app.models.models import StatusAtribuicao
    return {
        "total": len(todos),
        "atribuidos": sum(1 for c in todos if c.status_atribuicao == StatusAtribuicao.ATRIBUIDO),
        "pendentes": sum(1 for c in todos if c.status_atribuicao == StatusAtribuicao.PENDENTE),
    }

@router.get("/clientes/{cliente_id}", tags=["clientes"])
async def detalhe_cliente(
    cliente_id: UUID,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cliente = await db.get(Cliente, cliente_id)
    if not cliente or not cliente.ativo:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    if current_user.papel == PapelUsuario.ESN:
        if str(cliente.vendedor_responsavel_id) != str(current_user.id):
            raise HTTPException(status_code=403, detail="Acesso negado.")

    # Buscar contratos
    stmt_c = select(Contrato).where(Contrato.cliente_id == cliente_id).order_by(Contrato.criado_em.desc())
    res_c = await db.execute(stmt_c)
    contratos = res_c.scalars().all()

    # Dados histórico de vendas + cancelamentos
    from sqlalchemy import text as sqlt
    res_hv = await db.execute(sqlt("""
        SELECT
            COUNT(DISTINCT p.id)            as total_vendas,
            MIN(p.data_assinatura)          as primeira_compra,
            MAX(p.data_assinatura)          as ultima_compra,
            MAX(p.valor_total)              as maior_compra,
            0 as em_cancelamento
        FROM propostas_contrato p
        JOIN contratos c ON c.id = p.contrato_id
        WHERE c.cliente_id = :cid
    """), {"cid": str(cliente_id)})
    row_hv = res_hv.fetchone()

    from datetime import date as dt_date
    hoje = dt_date.today()
    primeira = row_hv[1]
    cliente_ha = None
    if primeira:
        anos = (hoje - primeira).days // 365
        meses = ((hoje - primeira).days % 365) // 30
        partes = []
        if anos > 0: partes.append(f"{anos} ano{'s' if anos > 1 else ''}")
        if meses > 0: partes.append(f"{meses} {'meses' if meses > 1 else 'mês'}")
        cliente_ha = " e ".join(partes) if partes else "menos de 1 mês"

    historico_vendas = {
        "total_vendas": row_hv[0] or 0,
        "primeira_compra": str(row_hv[1]) if row_hv[1] else None,
        "ultima_compra": str(row_hv[2]) if row_hv[2] else None,
        "maior_compra": float(row_hv[3]) if row_hv[3] else None,
        "cliente_ha": cliente_ha,
        "em_cancelamento": row_hv[4] or 0,
    }

    return {
        "id": str(cliente.id),
        "codigo_externo": cliente.codigo_externo,
        "razao_social": cliente.razao_social,
        "cnpj": cliente.cnpj,
        "segmento": cliente.segmento,
        "sub_segmento": cliente.sub_segmento,
        "municipio": cliente.municipio,
        "uf": cliente.uf,
        "lat": cliente.lat,
        "lng": cliente.lng,
        "setor_publico": cliente.setor_publico,
        "status_atribuicao": cliente.status_atribuicao,
        "status_cliente": cliente.status_cliente,
        "classificacao_abc": cliente.classificacao_abc,
        "frequencia_visita_dias": cliente.frequencia_visita_dias,
        "ultima_visita_em": cliente.ultima_visita_em,
        "proxima_visita_prevista": cliente.proxima_visita_prevista,
        "observacoes": cliente.observacoes,
        "vendedor_responsavel_id": str(cliente.vendedor_responsavel_id) if cliente.vendedor_responsavel_id else None,
        "ativo": cliente.ativo,
        "historico_vendas": historico_vendas,
        "contratos": [
            {
                "id": str(ct.id),
                "numero_contrato": ct.numero_contrato,
                "status": ct.status,
                "recorrente": ct.recorrente,
                "modalidade": ct.modalidade,
                "produto_principal": ct.produto_principal,
                "valor_mensal": float(ct.valor_mensal) if ct.valor_mensal else None,
                "data_assinatura": str(ct.data_assinatura) if ct.data_assinatura else None,
                "data_vigencia_fim": str(ct.data_vigencia_fim) if ct.data_vigencia_fim else None,
                "data_renovacao": str(ct.data_renovacao) if ct.data_renovacao else None,
            }
            for ct in contratos
        ],
    }

@router.patch("/clientes/{cliente_id}/atribuir", tags=["clientes"])
async def atribuir_vendedor(
    cliente_id: UUID,
    body: dict,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.papel not in (PapelUsuario.GESTOR_EMPRESA, PapelUsuario.DSN, PapelUsuario.GSN):
        raise HTTPException(status_code=403, detail="Sem permissão.")
    cliente = await db.get(Cliente, cliente_id)
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    vendedor = await db.get(Usuario, UUID(body["vendedor_id"]))
    if not vendedor or vendedor.papel != PapelUsuario.ESN:
        raise HTTPException(status_code=400, detail="Vendedor inválido.")
    from app.models.models import StatusAtribuicao
    cliente.vendedor_responsavel_id = vendedor.id
    cliente.status_atribuicao = StatusAtribuicao.ATRIBUIDO
    await db.commit()
    return {"ok": True, "vendedor_nome": vendedor.nome}

# ─────────────────────────────────────────────
# Visitas
# ─────────────────────────────────────────────

class CheckinRequest(BaseModel):
    cliente_id: UUID
    lat: float
    lng: float
    agenda_item_id: Optional[UUID] = None

class CheckoutRequest(BaseModel):
    lat: float
    lng: float
    observacoes: Optional[str] = None

@router.post("/visitas/checkin", tags=["visitas"])
async def checkin(
    body: CheckinRequest,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        from app.services.visita_service import VisitaService
        visita = await VisitaService.checkin(
            db, current_user.id, body.cliente_id,
            body.lat, body.lng, body.agenda_item_id
        )
        return {"visita_id": str(visita.id), "checkin_em": visita.checkin_em}
    except (ValueError, PermissionError) as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/visitas/{visita_id}/checkout", tags=["visitas"])
async def checkout(
    visita_id: UUID,
    body: CheckoutRequest,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        from app.services.visita_service import VisitaService
        visita = await VisitaService.checkout(
            db, visita_id, current_user.id,
            body.lat, body.lng, body.observacoes
        )
        return {
            "visita_id": str(visita.id),
            "checkout_em": visita.checkout_em,
            "duracao_minutos": int((visita.checkout_em - visita.checkin_em).total_seconds() / 60),
        }
    except (ValueError, PermissionError) as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/visitas/em-andamento", tags=["visitas"])
async def visita_em_andamento(
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Visita).where(
        Visita.vendedor_id == current_user.id,
        Visita.status == StatusVisita.EM_ANDAMENTO,
    )
    result = await db.execute(stmt)
    visita = result.scalar_one_or_none()
    if not visita:
        return {"em_andamento": False}
    return {
        "em_andamento": True,
        "visita_id": str(visita.id),
        "cliente_id": str(visita.cliente_id),
        "checkin_em": visita.checkin_em,
    }

# ─────────────────────────────────────────────
# Agenda
# ─────────────────────────────────────────────

class AgendaManualRequest(BaseModel):
    data: date
    cliente_ids: List[UUID]
    horario_inicio: str = "08:00"
    duracao_padrao_min: int = 45

class AgendaOtimizadaRequest(BaseModel):
    data: date
    cliente_ids: List[UUID]
    lat_inicio: float
    lng_inicio: float
    horario_inicio: str = "08:00"
    duracao_padrao_min: int = 45

@router.post("/agenda/manual", tags=["agenda"])
async def criar_agenda_manual(
    body: AgendaManualRequest,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.agenda_service import AgendaService
    agenda = await AgendaService.criar_agenda_manual(
        db, current_user.id, body.data, body.cliente_ids,
        body.horario_inicio, body.duracao_padrao_min,
    )
    return {"agenda_id": str(agenda.id), "data": agenda.data, "total_visitas": len(agenda.itens)}

@router.post("/agenda/otimizada", tags=["agenda"])
async def criar_agenda_otimizada(
    body: AgendaOtimizadaRequest,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.agenda_service import AgendaService
    agenda = await AgendaService.gerar_roteiro_otimizado(
        db, current_user.id, body.data, body.cliente_ids,
        body.lat_inicio, body.lng_inicio, body.horario_inicio, body.duracao_padrao_min,
    )
    return {"agenda_id": str(agenda.id), "data": agenda.data, "total_visitas": len(agenda.itens)}

@router.get("/agenda/hoje", tags=["agenda"])
async def agenda_hoje(
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.agenda_service import AgendaService
    agenda = await AgendaService.buscar_agenda_do_dia(db, current_user.id, date.today())
    if not agenda:
        return {"agenda": None}
    return {
        "agenda_id": str(agenda.id),
        "data": agenda.data,
        "itens": [
            {
                "id": str(i.id),
                "cliente_id": str(i.cliente_id),
                "ordem": i.ordem,
                "horario_previsto": i.horario_previsto,
                "status": i.status,
            }
            for i in agenda.itens
        ],
    }

# ─────────────────────────────────────────────
# Importação CSV
# ─────────────────────────────────────────────

@router.post("/importacao/csv", tags=["importacao"])
async def importar_csv(
    file: UploadFile = File(...),
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.papel not in (PapelUsuario.GESTOR_EMPRESA, PapelUsuario.DSN):
        raise HTTPException(status_code=403, detail="Apenas gestores e diretores podem importar.")
    with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        from app.services.importador_csv import ImportadorCSV
        importador = ImportadorCSV(tmp_path)
        objetos, resultado = importador.executar()
        for obj in objetos:
            db.add(obj)
        await db.commit()
        return {
            "sucesso": True,
            "organizacoes_criadas": resultado.organizacoes_criadas,
            "usuarios_criados": resultado.usuarios_criados,
            "vinculos_criados": resultado.vinculos_criados,
            "clientes_criados": resultado.clientes_criados,
            "contratos_criados": resultado.contratos_criados,
            "avisos": resultado.avisos,
            "erros": resultado.erros,
        }
    finally:
        os.unlink(tmp_path)


@router.get("/contratos/{contrato_id}/propostas", tags=["contratos"])
async def propostas_contrato(
    contrato_id: UUID,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text
    # Buscar propostas com seus itens
    res_p = await db.execute(text("""
        SELECT id, numero_proposta, planilha_financeira,
               data_assinatura, modalidade, valor_total, valor_recorrente
        FROM propostas_contrato
        WHERE contrato_id = :cid
        ORDER BY valor_recorrente DESC, valor_total DESC
    """), {"cid": str(contrato_id)})
    propostas = res_p.fetchall()

    resultado = []
    for p in propostas:
        res_i = await db.execute(text("""
            SELECT id, codigo_produto, descricao_produto, agrupador,
                   quantidade, valor_unitario, valor_total, recorrente,
                   modalidade, data_vencimento
            FROM itens_contrato
            WHERE proposta_id = :pid
            ORDER BY recorrente DESC, valor_total DESC
        """), {"pid": str(p[0])})
        itens = res_i.fetchall()

        resultado.append({
            "id": str(p[0]),
            "numero_proposta": p[1],
            "planilha_financeira": p[2],
            "data_assinatura": str(p[3]) if p[3] else None,
            "modalidade": p[4],
            "valor_total": float(p[5]) if p[5] else 0,
            "valor_recorrente": float(p[6]) if p[6] else 0,
            "itens": [
                {
                    "id": str(i[0]),
                    "codigo_produto": i[1],
                    "descricao_produto": i[2],
                    "agrupador": i[3],
                    "quantidade": float(i[4]) if i[4] else 1,
                    "valor_unitario": float(i[5]) if i[5] else 0,
                    "valor_total": float(i[6]) if i[6] else 0,
                    "recorrente": i[7],
                    "modalidade": i[8],
                    "data_vencimento": str(i[9]) if i[9] else None,
                }
                for i in itens
            ]
        })
    return resultado

@router.get("/contratos/{contrato_id}/itens", tags=["contratos"])
async def itens_contrato(
    contrato_id: UUID,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text
    result = await db.execute(text("""
        SELECT id, codigo_produto, descricao_produto, agrupador, grupo,
               quantidade, valor_unitario, valor_total, recorrente,
               modalidade, data_vencimento
        FROM itens_contrato
        WHERE contrato_id = :cid
        ORDER BY recorrente DESC, valor_total DESC
    """), {"cid": str(contrato_id)})
    rows = result.fetchall()
    return [
        {
            "id": str(r[0]),
            "codigo_produto": r[1],
            "descricao_produto": r[2],
            "agrupador": r[3],
            "grupo": r[4],
            "quantidade": float(r[5]) if r[5] else 1,
            "valor_unitario": float(r[6]) if r[6] else 0,
            "valor_total": float(r[7]) if r[7] else 0,
            "recorrente": r[8],
            "modalidade": r[9],
            "data_vencimento": str(r[10]) if r[10] else None,
        }
        for r in rows
    ]


@router.get("/clientes/{cliente_id}/licenciamento", tags=["clientes"])
async def licenciamento_cliente(
    cliente_id: UUID,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text as sqlt

    cliente = await db.get(Cliente, cliente_id)
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")

    # Produtos agrupados por código — apenas contratos ATIVOS
    res = await db.execute(sqlt("""
        SELECT
            i.codigo_produto,
            i.descricao_produto,
            i.recorrente,
            SUM(i.quantidade)   as total_qtd,
            SUM(i.valor_total)  as total_valor
        FROM itens_contrato i
        JOIN contratos ct ON ct.id = i.contrato_id
        WHERE ct.cliente_id = :cid
          AND ct.status = 'ATIVO'
        GROUP BY i.codigo_produto, i.descricao_produto, i.recorrente
        ORDER BY i.recorrente DESC, i.descricao_produto ASC
    """), {"cid": str(cliente_id)})
    rows = res.fetchall()

    recorrentes  = [{"codigo": r[0], "descricao": r[1], "quantidade": float(r[3]), "valor_total": float(r[4])} for r in rows if r[2]]
    nao_recorrentes = [{"codigo": r[0], "descricao": r[1], "quantidade": float(r[3]), "valor_total": float(r[4])} for r in rows if not r[2]]

    mrr = sum(r["valor_total"] for r in recorrentes)
    total_licencas = sum(r["quantidade"] for r in recorrentes)
    total_nao_rec = sum(r["valor_total"] for r in nao_recorrentes)

    return {
        "cliente_id": str(cliente_id),
        "razao_social": cliente.razao_social,
        "cnpj": cliente.cnpj,
        "mrr": mrr,
        "total_licencas": int(total_licencas),
        "total_produtos": len(rows),
        "total_nao_recorrente": total_nao_rec,
        "recorrentes": recorrentes,
        "nao_recorrentes": nao_recorrentes,
    }


# ─────────────────────────────────────────────
# Parâmetros da Organização
# ─────────────────────────────────────────────

@router.get("/parametros", tags=["parametros"])
async def get_parametros(
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text as sqlt
    res = await db.execute(sqlt("""
        SELECT
            COALESCE(mrr_cliente_a, 5000)       as mrr_cliente_a,
            COALESCE(mrr_cliente_b, 1000)       as mrr_cliente_b,
            COALESCE(mrr_cliente_c, 100)        as mrr_cliente_c,
            COALESCE(meses_dormente, 18)        as meses_dormente,
            COALESCE(visitas_por_dia_max, 8)    as visitas_por_dia_max,
            COALESCE(raio_checkin_metros, 300)  as raio_checkin_metros,
            COALESCE(frequencia_padrao_dias, 30) as frequencia_padrao_dias
        FROM parametros_organizacao
        JOIN organizacoes o ON o.id = organizacao_id
        LIMIT 1
    """))
    row = res.fetchone()
    if not row:
        return {
            "mrr_cliente_a": 5000.0, "mrr_cliente_b": 1000.0,
            "mrr_cliente_c": 100.0, "meses_dormente": 18,
            "visitas_por_dia_max": 8, "raio_checkin_metros": 300,
            "frequencia_padrao_dias": 30,
        }
    return {
        "mrr_cliente_a": float(row[0]),
        "mrr_cliente_b": float(row[1]),
        "mrr_cliente_c": float(row[2]),
        "meses_dormente": int(row[3]),
        "visitas_por_dia_max": int(row[4]),
        "raio_checkin_metros": int(row[5]),
        "frequencia_padrao_dias": int(row[6]),
    }

@router.put("/parametros", tags=["parametros"])
async def salvar_parametros(
    body: dict,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.papel != PapelUsuario.GESTOR_EMPRESA:
        raise HTTPException(status_code=403, detail="Apenas o gestor pode alterar parâmetros.")

    from sqlalchemy import text as sqlt

    # Atualizar parâmetros
    await db.execute(sqlt("""
        UPDATE parametros_organizacao SET
            mrr_cliente_a       = :a,
            mrr_cliente_b       = :b,
            mrr_cliente_c       = :c,
            meses_dormente      = :md,
            visitas_por_dia_max = :vd,
            raio_checkin_metros = :rc,
            frequencia_padrao_dias = :fp,
            atualizado_em       = now()
        WHERE organizacao_id = (SELECT id FROM organizacoes LIMIT 1)
    """), {
        "a":  body.get("mrr_cliente_a", 5000),
        "b":  body.get("mrr_cliente_b", 1000),
        "c":  body.get("mrr_cliente_c", 100),
        "md": body.get("meses_dormente", 18),
        "vd": body.get("visitas_por_dia_max", 8),
        "rc": body.get("raio_checkin_metros", 300),
        "fp": body.get("frequencia_padrao_dias", 30),
    })

    # Recalcular classificação ABC e dormentes
    await db.execute(sqlt("""
        UPDATE clientes c SET classificacao_abc =
          CASE
            WHEN COALESCE(ct.mrr, 0) >= :a THEN 'A'
            WHEN COALESCE(ct.mrr, 0) >= :b THEN 'B'
            WHEN COALESCE(ct.mrr, 0) >= :c THEN 'C'
            ELSE 'C'
          END
        FROM (
            SELECT ct2.cliente_id, COALESCE(SUM(ct2.valor_mensal), 0) as mrr
            FROM contratos ct2 WHERE ct2.status = 'ATIVO'
            GROUP BY ct2.cliente_id
        ) ct
        WHERE c.id = ct.cliente_id
    """), {
        "a": body.get("mrr_cliente_a", 5000),
        "b": body.get("mrr_cliente_b", 1000),
        "c": body.get("mrr_cliente_c", 100),
    })

    await db.execute(sqlt("""
        UPDATE clientes c SET dormente =
          CASE
            WHEN ult.ultima_compra < CURRENT_DATE - (:md || ' months')::interval THEN true
            ELSE false
          END
        FROM (
            SELECT ct2.cliente_id, MAX(p.data_assinatura) as ultima_compra
            FROM propostas_contrato p
            JOIN contratos ct2 ON ct2.id = p.contrato_id
            WHERE p.data_assinatura IS NOT NULL
            GROUP BY ct2.cliente_id
        ) ult
        WHERE c.id = ult.cliente_id
    """), {"md": body.get("meses_dormente", 18)})

    await db.commit()
    return {"ok": True, "mensagem": "Parâmetros salvos e clientes reclassificados."}

app.include_router(router)
