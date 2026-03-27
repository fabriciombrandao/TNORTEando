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
    from sqlalchemy import text as sqlt

    # Filtros
    where = ["c.ativo = true"] if apenas_ativos else []
    params = {}

    if current_user.papel == PapelUsuario.ESN:
        where.append("c.vendedor_responsavel_id = :esn_id")
        params["esn_id"] = str(current_user.id)
    if filtro == "pendentes":
        where.append("c.status_atribuicao = 'PENDENTE'")
    elif filtro == "atribuidos":
        where.append("c.status_atribuicao = 'ATRIBUIDO'")
    if busca:
        where.append("(c.razao_social ILIKE :busca OR c.codigo_externo ILIKE :busca OR c.municipio ILIKE :busca OR c.cnpj ILIKE :busca)")
        params["busca"] = f"%{busca}%"
    if uf:
        where.append("c.uf = :uf")
        params["uf"] = uf.upper()

    where_sql = "WHERE " + " AND ".join(where) if where else ""

    result = await db.execute(sqlt(f"""
        SELECT
            c.id, c.codigo_externo, c.razao_social, c.cnpj,
            c.segmento, c.sub_segmento, c.municipio, c.uf,
            c.lat, c.lng, c.setor_publico,
            c.status_atribuicao, c.status_cliente, c.classificacao_abc,
            c.vendedor_responsavel_id, c.ativo,
            COALESCE(c.dormente, false) as dormente
        FROM clientes c
        {where_sql}
        ORDER BY c.razao_social
    """), params)

    rows = result.fetchall()
    return [
        {
            "id": str(r[0]),
            "codigo_externo": r[1],
            "razao_social": r[2],
            "cnpj": r[3],
            "segmento": r[4],
            "sub_segmento": r[5],
            "municipio": r[6],
            "uf": r[7],
            "lat": r[8],
            "lng": r[9],
            "setor_publico": r[10],
            "status_atribuicao": r[11],
            "status_cliente": r[12],
            "classificacao_abc": r[13],
            "vendedor_responsavel_id": str(r[14]) if r[14] else None,
            "ativo": r[15],
            "dormente": bool(r[16]),
        }
        for r in rows
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
    from sqlalchemy import text as sqlt_c
    res_cl = await db.execute(sqlt_c("""
        SELECT id, codigo_externo, razao_social, cnpj, segmento, sub_segmento,
               municipio, uf, lat, lng, setor_publico, status_atribuicao,
               status_cliente, classificacao_abc, frequencia_visita_dias,
               ultima_visita_em, proxima_visita_prevista, observacoes,
               vendedor_responsavel_id, ativo,
               COALESCE(dormente, false) as dormente
        FROM clientes WHERE id = :cid AND ativo = true
    """), {"cid": str(cliente_id)})
    cl_row = res_cl.fetchone()
    if not cl_row:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    if current_user.papel == PapelUsuario.ESN:
        if str(cl_row[18]) != str(current_user.id):
            raise HTTPException(status_code=403, detail="Acesso negado.")
    cliente = type("C", (), {
        "id": cl_row[0], "codigo_externo": cl_row[1], "razao_social": cl_row[2],
        "cnpj": cl_row[3], "segmento": cl_row[4], "sub_segmento": cl_row[5],
        "municipio": cl_row[6], "uf": cl_row[7], "lat": cl_row[8], "lng": cl_row[9],
        "setor_publico": cl_row[10], "status_atribuicao": cl_row[11],
        "status_cliente": cl_row[12], "classificacao_abc": cl_row[13],
        "frequencia_visita_dias": cl_row[14], "ultima_visita_em": cl_row[15],
        "proxima_visita_prevista": cl_row[16], "observacoes": cl_row[17],
        "vendedor_responsavel_id": cl_row[18], "ativo": cl_row[19],
        "dormente": bool(cl_row[20]),
    })()

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
        "dormente": cliente.dormente,
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


@router.post("/importacao/analisar", tags=["importacao"])
async def analisar_csv(
    file: UploadFile = File(...),
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.papel not in (PapelUsuario.GESTOR_EMPRESA, PapelUsuario.DSN):
        raise HTTPException(status_code=403, detail="Sem permissão.")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        import csv as csv_mod, re
        from collections import defaultdict
        from sqlalchemy import text as sqlt

        with open(tmp_path, encoding="ISO-8859-1", newline="") as f:
            rows = list(csv_mod.DictReader(f, delimiter=";"))

        if not rows:
            raise HTTPException(status_code=400, detail="Arquivo CSV vazio.")

        cols_req = ["Código do Cliente","Número do Contrato","Codigo Unidade Responsável pelo Atendimento"]
        for col in cols_req:
            if col not in rows[0]:
                raise HTTPException(status_code=400, detail=f"Coluna não encontrada: {col}")

        # Extrair dados do CSV
        cod_org  = rows[0]["Codigo Unidade Responsável pelo Atendimento"].strip()
        nom_org  = rows[0]["Nome Unidade de Atendimento"].strip()
        dsns_csv = {r["Código do DSN"].strip(): r["Nome do DSN"].strip() for r in rows if r["Código do DSN"].strip() not in ("-","")}
        gsns_csv = {r["Código do GSN"].strip(): r["Nome do GSN"].strip() for r in rows if r["Código do GSN"].strip() not in ("-","")}
        esns_csv = {r["Código do ESN"].strip(): r["Nome do ESN"].strip() for r in rows if r["Código do ESN"].strip() not in ("-","")}
        clientes_csv  = set(r["Código do Cliente"].strip() for r in rows if r["Código do Cliente"].strip())
        contratos_csv = set(r["Número do Contrato"].strip() for r in rows if r["Número do Contrato"].strip())

        # Municípios
        municipios = defaultdict(int)
        for r in rows:
            m = r.get("Município do Cliente","").strip()
            u = r.get("UF","").strip()
            if m and m != "-":
                municipios[f"{m}/{u}"] += 1

        # Clientes sem ESN — só marca se NENHUMA linha do cliente tem ESN
        clientes_com_esn = set()
        for r in rows:
            if r["Código do ESN"].strip() not in ("-", ""):
                clientes_com_esn.add(r["Código do Cliente"].strip())
        sem_esn = clientes_csv - clientes_com_esn

        # Comparar com banco
        res_org = await db.execute(sqlt("SELECT id FROM organizacoes WHERE codigo_externo=:c"), {"c": cod_org})
        org_existe = res_org.fetchone() is not None

        res_users = await db.execute(sqlt("SELECT codigo_externo FROM usuarios"))
        usuarios_banco = set(r[0] for r in res_users.fetchall())

        res_cli = await db.execute(sqlt("SELECT codigo_externo FROM clientes"))
        clientes_banco = set(r[0] for r in res_cli.fetchall())

        res_ct = await db.execute(sqlt("SELECT numero_contrato FROM contratos"))
        contratos_banco = set(r[0] for r in res_ct.fetchall())

        # Calcular novos vs existentes
        todos_usuarios_csv = set(dsns_csv) | set(gsns_csv) | set(esns_csv)
        usuarios_novos     = todos_usuarios_csv - usuarios_banco
        clientes_novos     = clientes_csv - clientes_banco
        contratos_novos    = contratos_csv - contratos_banco

        # Alertas
        alertas = []
        if sem_esn:
            alertas.append(f"{len(sem_esn)} cliente(s) sem ESN atribuído")
        if not org_existe:
            alertas.append(f"Nova organização será criada: {nom_org}")

        # Top municípios
        top_municipios = sorted(municipios.items(), key=lambda x: -x[1])[:5]

        # Mapas para detalhe de clientes
        esn_nome_map = {r["Código do ESN"].strip(): r["Nome do ESN"].strip() for r in rows if r["Código do ESN"].strip() not in ("-","")}
        esn_map = {}
        cli_esn_map = {}
        # Primeira passagem: mapear ESN real por cliente
        for r in rows:
            cli = r["Código do Cliente"].strip()
            esn = r["Código do ESN"].strip()
            if esn and esn != "-" and cli not in cli_esn_map:
                cli_esn_map[cli] = esn
        # Segunda passagem: clientes sem ESN herdam de outras linhas do mesmo cliente
        for r in rows:
            cli = r["Código do Cliente"].strip()
            esn = r["Código do ESN"].strip()
            if (not esn or esn == "-") and cli in cli_esn_map:
                pass  # já tem ESN herdado

        # Lista detalhada de clientes únicos
        clientes_vistos = {}
        for r in rows:
            cod = r["Código do Cliente"].strip()
            if cod in clientes_vistos: continue
            esn_cod = cli_esn_map.get(cod, "")
            clientes_vistos[cod] = {
                "codigo": cod,
                "nome": r["Razão Social do Cliente"].strip(),
                "cnpj": re.sub(r"[^0-9]", "", r.get("CPF ou CNPJ do Cliente","")) or "",
                "municipio": r.get("Município do Cliente","").strip(),
                "uf": r.get("UF","").strip(),
                "esn": esn_cod,
                "esn_nome": esn_nome_map.get(esn_cod, ""),
                "novo": cod in clientes_novos,
                "sem_esn": cod not in clientes_com_esn,
            }

        # Lista detalhada de contratos únicos
        contratos_vistos = {}
        cli_nome_map = {r["Código do Cliente"].strip(): r["Razão Social do Cliente"].strip() for r in rows}
        for r in rows:
            num = r["Número do Contrato"].strip()
            if num in contratos_vistos: continue
            contratos_vistos[num] = {
                "numero": num,
                "cliente_cod": r["Código do Cliente"].strip(),
                "cliente_nome": cli_nome_map.get(r["Código do Cliente"].strip(), ""),
                "status": r["Status do Contrato"].strip(),
                "modalidade": r.get("Modalidade de Vendas","").strip(),
                "mrr": 0,
                "novo": num in contratos_novos,
            }

        return {
            "valido": True,
            "arquivo": {
                "total_linhas": len(rows),
                "organizacao": {"codigo": cod_org, "nome": nom_org, "existente": org_existe},
            },
            "hierarquia": {
                "dsns": [{"codigo": k, "nome": v, "email": next((r["E-mail do DSN"] for r in rows if r["Código do DSN"].strip()==k),""), "novo": k not in usuarios_banco} for k,v in dsns_csv.items()],
                "gsns": [{"codigo": k, "nome": v, "email": next((r["E-mail do GSN"] for r in rows if r["Código do GSN"].strip()==k),""), "novo": k not in usuarios_banco} for k,v in gsns_csv.items()],
                "esns": [{"codigo": k, "nome": v, "email": next((r["E-mail do ESN"] for r in rows if r["Código do ESN"].strip()==k),""), "novo": k not in usuarios_banco} for k,v in esns_csv.items()],
            },
            "clientes": list(clientes_vistos.values()),
            "contratos": list(contratos_vistos.values()),
            "municipios": [{"nome": m, "clientes": n} for m,n in top_municipios],
            "alertas": alertas,
        }
    finally:
        os.unlink(tmp_path)

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
        import csv as csv_mod, re, uuid as uuid_mod, hashlib
        from datetime import date as dt_date
        from app.core.security import get_password_hash
        from sqlalchemy import text as sqlt

        def _h(p): return "pbkdf2:" + hashlib.pbkdf2_hmac("sha256", p.encode(), b"salt", 100000).hex()
        def _cnpj(r):
            if not r or r.strip() in ("-",""): return None
            return re.sub(r"[^0-9]","",r) or None
        def _nulo(v):
            v=v.strip() if v else ""
            return v if v and v!="-" else None
        def _norm(t):
            if not t or t.strip() in ("-",""): return ""
            return " ".join(t.strip().title().split())
        def _bool(v): return v.strip().upper() in ("SIM","S","YES","Y","1")
        def _fone(ddd, tel):
            d = (ddd or "").strip().strip("()").strip()
            t = (tel or "").strip()
            if not t: return None
            return f"({d}) {t}" if d else t
        def _data(s):
            if not s or s.strip() in ("-",""): return None
            try:
                d,m,y = s.strip().split("/")
                return dt_date(int(y),int(m),int(d))
            except: return None

        with open(tmp_path, encoding="ISO-8859-1", newline="") as f:
            rows = list(csv_mod.DictReader(f, delimiter=";"))

        if not rows:
            raise HTTPException(status_code=400, detail="Arquivo CSV vazio.")

        # Verificar colunas obrigatórias
        cols_req = ["Código do Cliente","Número do Contrato","Codigo Unidade Responsável pelo Atendimento"]
        for col in cols_req:
            if col not in rows[0]:
                raise HTTPException(status_code=400, detail=f"Coluna não encontrada: {col}")

        # Buscar ou criar organização no banco
        cod_org = rows[0]["Codigo Unidade Responsável pelo Atendimento"].strip()
        nom_org = rows[0]["Nome Unidade de Atendimento"].strip()

        res_org = await db.execute(sqlt(
            "SELECT id FROM organizacoes WHERE codigo_externo=:c"
        ), {"c": cod_org})
        org_row = res_org.fetchone()

        if org_row:
            org_id = str(org_row[0])
            org_criada = 0
        else:
            org_id = str(uuid_mod.uuid4())
            await db.execute(sqlt(
                "INSERT INTO organizacoes (id,codigo_externo,nome,ativo) VALUES (:i,:c,:n,true)"
            ), {"i": org_id, "c": cod_org, "n": nom_org})
            await db.commit()
            org_criada = 1

        # Mapas em memória
        usuarios_map = {}  # codigo -> id
        emails_map   = {}  # email  -> id
        res_u = await db.execute(sqlt(
            "SELECT id, codigo_externo, email FROM usuarios WHERE organizacao_id=:o"
        ), {"o": org_id})
        for r in res_u.fetchall():
            usuarios_map[r[1]] = str(r[0])
            emails_map[r[2]] = str(r[0])

        usuarios_criados = 0
        vinculos_criados = 0

        async def get_or_create_usuario(cod, nome, email, papel, ddd="", tel=""):
            nonlocal usuarios_criados
            cod = cod.strip()
            if not cod or cod == "-": return None
            if cod in usuarios_map: return usuarios_map[cod]
            email_n = email.strip().lower() if email.strip() not in ("-","") else f"{cod.lower()}@importado.local"
            if email_n in emails_map:
                usuarios_map[cod] = emails_map[email_n]
                return emails_map[email_n]
            uid = str(uuid_mod.uuid4())
            await db.execute(sqlt("""
                INSERT INTO usuarios (id,organizacao_id,codigo_externo,nome,email,senha_hash,papel,telefone,ativo,primeiro_acesso)
                VALUES (:i,:o,:c,:n,:e,:h,:p,:t,true,true)
                ON CONFLICT (email) DO NOTHING
            """), {
                "i": uid, "o": org_id, "c": cod,
                "n": _norm(nome) or cod,
                "e": email_n, "h": _h("Mudar@123"),
                "p": papel, "t": _fone(ddd, tel),
            })
            res_check = await db.execute(sqlt("SELECT id FROM usuarios WHERE email=:e"), {"e": email_n})
            row_check = res_check.fetchone()
            if row_check:
                uid_real = str(row_check[0])
                usuarios_map[cod] = uid_real
                emails_map[email_n] = uid_real
                usuarios_criados += 1
                return uid_real
            return None

        vinculos_set = set()
        async def get_or_create_vinculo(sup_id, sub_id, cod_sub):
            nonlocal vinculos_criados
            if not sup_id or not sub_id: return
            chave = (sup_id, sub_id, cod_sub)
            if chave in vinculos_set: return
            vinculos_set.add(chave)
            await db.execute(sqlt("""
                INSERT INTO hierarquia_vendas (id,superior_id,subordinado_id,codigo_externo_subordinado,ativo)
                VALUES (:i,:s,:b,:c,true)
                ON CONFLICT ON CONSTRAINT uq_hierarquia_vinculo DO NOTHING
            """), {"i": str(uuid_mod.uuid4()), "s": sup_id, "b": sub_id, "c": cod_sub})
            vinculos_criados += 1

        clientes_set = set()
        contratos_set = set()
        clientes_criados = 0
        contratos_criados = 0

        # Pré-processar: mapear ESN real por cliente (para herança)
        cli_esn_real = {}
        for r in rows:
            cli = r["Código do Cliente"].strip()
            esn = r["Código do ESN"].strip()
            if esn and esn not in ("-","") and cli not in cli_esn_real:
                cli_esn_real[cli] = {"cod": esn, "nome": r["Nome do ESN"].strip(), "email": r["E-mail do ESN"].strip(), "ddd": r.get("Código de Área do ESN",""), "tel": r.get("Telefone ESN","")}

        # Pré-processar status dos contratos — ATIVO tem prioridade sobre CANCELADO/TROCADO
        # Regra: se qualquer linha do contrato for ATIVO, o contrato é ATIVO
        PRIORIDADE_STATUS = ["ATIVO","GRATUITO","PENDENTE","MANUAL","TROCADO","CANCELADO"]
        ct_status_final = {}
        for r in rows:
            num = r["Número do Contrato"].strip()
            st  = r["Status do Contrato"].strip().upper()
            if st not in PRIORIDADE_STATUS: st = "PENDENTE"
            if num not in ct_status_final:
                ct_status_final[num] = st
            else:
                # Manter o status de maior prioridade (menor índice)
                if PRIORIDADE_STATUS.index(st) < PRIORIDADE_STATUS.index(ct_status_final[num]):
                    ct_status_final[num] = st

        for row in rows:
            dsn_id = await get_or_create_usuario(
                row["Código do DSN"], row["Nome do DSN"], row["E-mail do DSN"], "DSN",
                row.get("Código de Área do DSN",""), row.get("Telefone DSN",""))
            gsn_id = await get_or_create_usuario(
                row["Código do GSN"], row["Nome do GSN"], row["E-mail do GSN"], "GSN",
                row.get("Código de Área do GSN",""), row.get("Telefone GSN",""))
            # ESN: herdar de outra linha do mesmo cliente se não tiver
            cod_cli_atual = row["Código do Cliente"].strip()
            esn_row = row["Código do ESN"].strip()
            if not esn_row or esn_row == "-":
                esn_info = cli_esn_real.get(cod_cli_atual, {})
                esn_id = await get_or_create_usuario(esn_info.get("cod",""), esn_info.get("nome",""), esn_info.get("email",""), "ESN", esn_info.get("ddd",""), esn_info.get("tel","")) if esn_info else None
            else:
                esn_id = await get_or_create_usuario(
                    row["Código do ESN"], row["Nome do ESN"], row["E-mail do ESN"], "ESN",
                    row.get("Código de Área do ESN",""), row.get("Telefone ESN",""))

            if dsn_id and gsn_id:
                await get_or_create_vinculo(dsn_id, gsn_id, row["Código do GSN"].strip())
            if gsn_id and esn_id:
                await get_or_create_vinculo(gsn_id, esn_id, row["Código do ESN"].strip())

            cod_cli = row["Código do Cliente"].strip()
            if cod_cli and cod_cli not in clientes_set:
                clientes_set.add(cod_cli)
                await db.execute(sqlt("""
                    INSERT INTO clientes (
                        id,organizacao_id,vendedor_responsavel_id,codigo_externo,
                        razao_social,cnpj,municipio,uf,segmento,sub_segmento,
                        setor_publico,status_atribuicao,status_cliente,
                        classificacao_abc,frequencia_visita_dias,ativo
                    ) VALUES (
                        :i,:o,:v,:c,:r,:cn,:m,:u,:seg,:sub,:sp,:sa,:sc,:abc,30,true
                    ) ON CONFLICT (codigo_externo) DO UPDATE SET
                        vendedor_responsavel_id=COALESCE(EXCLUDED.vendedor_responsavel_id, clientes.vendedor_responsavel_id),
                        segmento=COALESCE(EXCLUDED.segmento, clientes.segmento),
                        sub_segmento=COALESCE(EXCLUDED.sub_segmento, clientes.sub_segmento)
                """), {
                    "i": str(uuid_mod.uuid4()), "o": org_id,
                    "v": esn_id, "c": cod_cli,
                    "r": _norm(row["Razão Social do Cliente"]),
                    "cn": _cnpj(row["CPF ou CNPJ do Cliente"]),
                    "m": _norm(_nulo(row["Município do Cliente"])),
                    "u": _nulo(row["UF"]),
                    "seg": _norm(_nulo(row.get("Segmento do Cliente",""))),
                    "sub": _norm(_nulo(row.get("Sub Segmento do Cliente",""))),
                    "sp": _bool(row["Setor Público"]),
                    "sa": "ATRIBUIDO" if esn_id else "PENDENTE",
                    "sc": "ATIVO",
                    "abc": "C",
                })
                clientes_criados += 1

            num_ct = row["Número do Contrato"].strip()
            if not num_ct: continue
            if contratos_sel and num_ct not in contratos_sel: continue
            if clientes_sel and cod_cli not in clientes_sel: continue

            res_cli = await db.execute(sqlt("SELECT id FROM clientes WHERE codigo_externo=:c"), {"c": cod_cli})
            row_cli = res_cli.fetchone()
            if not row_cli: continue
            ct_cliente_id = str(row_cli[0])

            # Criar contrato (uma vez por número)
            if num_ct not in contratos_set:
                contratos_set.add(num_ct)
                st = ct_status_final.get(num_ct, "PENDENTE")
                await db.execute(sqlt("""
                    INSERT INTO contratos (id,cliente_id,numero_contrato,status,recorrente,modalidade,unidade_venda)
                    VALUES (:i,:c,:n,:s,:r,:m,:u)
                    ON CONFLICT (numero_contrato) DO UPDATE SET status=EXCLUDED.status
                """), {
                    "i": str(uuid_mod.uuid4()), "c": ct_cliente_id,
                    "n": num_ct, "s": st,
                    "r": _bool(row["Recorrente"]),
                    "m": _nulo(row["Modalidade de Vendas"]),
                    "u": _nulo(row.get("Nome Unidade de Venda","")),
                })
                contratos_criados += 1

            # Buscar ID real do contrato
            res_ct = await db.execute(sqlt("SELECT id FROM contratos WHERE numero_contrato=:n"), {"n": num_ct})
            ct_row = res_ct.fetchone()
            if not ct_row: continue
            ct_id_real = str(ct_row[0])

            # Criar proposta (uma vez por contrato+número_proposta)
            num_prop = _nulo(row.get("Número da Proposta","")) or num_ct
            plan_fin = _nulo(row.get("Planilha Financeira no Contrato",""))
            data_ass_cont = _data(row.get("Data de Assinatura",""))
            prop_key = (ct_id_real, num_prop)

            if prop_key not in propostas_set:
                propostas_set.add(prop_key)
                await db.execute(sqlt("""
                    INSERT INTO propostas_contrato (id,contrato_id,numero_proposta,planilha_financeira,data_assinatura,modalidade,valor_total,valor_recorrente)
                    VALUES (:i,:c,:n,:p,:d,:m,0,0)
                    ON CONFLICT (contrato_id, numero_proposta) DO NOTHING
                """), {"i":str(uuid_mod.uuid4()),"c":ct_id_real,"n":num_prop,"p":plan_fin,"d":data_ass_cont,"m":_nulo(row.get("Modalidade de Vendas",""))})

            res_prop = await db.execute(sqlt("SELECT id FROM propostas_contrato WHERE contrato_id=:c AND numero_proposta=:n"), {"c":ct_id_real,"n":num_prop})
            prop_row = res_prop.fetchone()
            if not prop_row: continue
            prop_id_real = str(prop_row[0])

            # Inserir item
            st_cancel = _nulo(row.get("Status Cancelamento",""))
            st_item   = row.get("Status do Contrato","").strip().upper()
            data_item = _data(row.get("Data de Assinatura do Item","")) or data_ass_cont
            val_unit  = _val(row.get("Valor Unitário",""))
            val_tot   = _val(row.get("Valor Total do Contrato",""))
            try: qtd = int(float(row.get("Quantidade do Item","1").replace(",",".") or 1))
            except: qtd = 1
            cod_prod  = _nulo(row.get("Código do Produto",""))
            desc_prod = _nulo(row.get("Descrição do Produto",""))
            rec_item  = _bool(row.get("Recorrente","NAO"))

            await db.execute(sqlt("""
                INSERT INTO itens_contrato (id,proposta_id,contrato_id,codigo_produto,descricao_produto,quantidade,valor_unitario,valor_total,recorrente,status_cancelamento,status_item,data_assinatura_item)
                VALUES (:i,:p,:c,:cp,:dp,:q,:vu,:vt,:r,:sc,:si,:di)
                ON CONFLICT DO NOTHING
            """), {"i":str(uuid_mod.uuid4()),"p":prop_id_real,"c":ct_id_real,"cp":cod_prod,"dp":desc_prod,"q":qtd,"vu":val_unit,"vt":val_tot,"r":rec_item,"sc":st_cancel,"si":st_item,"di":data_item})

        await db.commit()

        return {
            "sucesso": True,
            "organizacoes_criadas": org_criada,
            "usuarios_criados": usuarios_criados,
            "vinculos_criados": vinculos_criados,
            "clientes_criados": clientes_criados,
            "contratos_criados": contratos_criados,
            "avisos": [],
            "erros": [],
        }

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro na importação: {str(e)}")
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
                   modalidade, data_vencimento,
                   COALESCE(status_cancelamento, '') as status_cancelamento,
                   data_assinatura_item,
                   COALESCE(status_item, 'ATIVO') as status_item
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

    meses = int(body.get("meses_dormente", 18))
    await db.execute(sqlt(f"""
        UPDATE clientes c SET dormente =
          CASE
            WHEN ult.ultima_compra < CURRENT_DATE - INTERVAL '{meses} months' THEN true
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
    """))

    await db.commit()
    return {"ok": True, "mensagem": "Parâmetros salvos e clientes reclassificados."}


@router.post("/importacao/csv-selecionado", tags=["importacao"])
async def importar_csv_selecionado(
    file: UploadFile = File(...),
    selecao: str = "",
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Importa apenas os registros selecionados pelo usuário."""
    import json
    if current_user.papel not in (PapelUsuario.GESTOR_EMPRESA, PapelUsuario.DSN):
        raise HTTPException(status_code=403, detail="Sem permissão.")

    try:
        sel = json.loads(selecao) if selecao else {}
    except:
        sel = {}

    dsns_sel      = set(sel.get("dsns", []))
    gsns_sel      = set(sel.get("gsns", []))
    esns_sel      = set(sel.get("esns", []))
    clientes_sel  = set(sel.get("clientes", []))
    contratos_sel = set(sel.get("contratos", []))

    with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    # Reusar o endpoint existente mas filtrar os dados
    # Injetar seleção no contexto do importador
    request_data = {
        "dsns": list(dsns_sel), "gsns": list(gsns_sel), "esns": list(esns_sel),
        "clientes": list(clientes_sel), "contratos": list(contratos_sel),
    }

    try:
        import csv as csv_mod, re, uuid as uuid_mod, hashlib
        from datetime import date as dt_date
        from sqlalchemy import text as sqlt

        def _h(p): return "pbkdf2:" + hashlib.pbkdf2_hmac("sha256", p.encode(), b"salt", 100000).hex()
        def _cnpj(r):
            if not r or r.strip() in ("-",""): return None
            return re.sub(r"[^0-9]","",r) or None
        def _nulo(v):
            v=v.strip() if v else ""
            return v if v and v!="-" else None
        def _norm(t):
            if not t or t.strip() in ("-",""): return ""
            return " ".join(t.strip().title().split())
        def _bool(v): return v.strip().upper() in ("SIM","S","YES","Y","1")
        def _fone(ddd, tel):
            d=(ddd or "").strip().strip("()").strip(); t=(tel or "").strip()
            if not t: return None
            return f"({d}) {t}" if d else t

        def _val(v):
            import re as _re
            if not v or v.strip() in ("","-"): return 0.0
            try: return float(_re.sub(r"[^0-9,]","",v.strip()).replace(",",".") or 0)
            except: return 0.0
        def _data(s):
            if not s or s.strip() in ("-",""): return None
            try:
                parts = s.strip().split("/")
                if len(parts)==3: return dt_date(int(parts[2]),int(parts[1]),int(parts[0]))
            except: pass
            return None

        with open(tmp_path, encoding="ISO-8859-1", newline="") as f:
            rows = list(csv_mod.DictReader(f, delimiter=";"))

        if not rows:
            raise HTTPException(status_code=400, detail="Arquivo CSV vazio.")

        cod_org = rows[0]["Codigo Unidade Responsável pelo Atendimento"].strip()
        nom_org = rows[0]["Nome Unidade de Atendimento"].strip()

        res_org = await db.execute(sqlt("SELECT id FROM organizacoes WHERE codigo_externo=:c"), {"c": cod_org})
        org_row = res_org.fetchone()
        if org_row:
            org_id = str(org_row[0]); org_criada = 0
        else:
            org_id = str(uuid_mod.uuid4())
            await db.execute(sqlt("INSERT INTO organizacoes (id,codigo_externo,nome,ativo) VALUES (:i,:c,:n,true)"), {"i":org_id,"c":cod_org,"n":nom_org})
            await db.commit(); org_criada = 1

        res_u = await db.execute(sqlt("SELECT id, codigo_externo, email FROM usuarios WHERE organizacao_id=:o"), {"o": org_id})
        usuarios_map = {}; emails_map = {}
        for r in res_u.fetchall():
            usuarios_map[r[1]] = str(r[0]); emails_map[r[2]] = str(r[0])

        usuarios_criados = vinculos_criados = clientes_criados = contratos_criados = 0

        async def get_or_create_usuario(cod, nome, email, papel, ddd="", tel=""):
            nonlocal usuarios_criados
            cod = cod.strip()
            if not cod or cod == "-": return None
            # Verificar se está na seleção por papel
            papel_map = {"DSN": dsns_sel, "GSN": gsns_sel, "ESN": esns_sel}
            if papel in papel_map and dsns_sel and cod not in papel_map.get(papel, set()) and papel_map.get(papel):
                return None
            if cod in usuarios_map: return usuarios_map[cod]
            email_n = email.strip().lower() if email.strip() not in ("-","") else f"{cod.lower()}@importado.local"
            if email_n in emails_map: usuarios_map[cod]=emails_map[email_n]; return emails_map[email_n]
            uid = str(uuid_mod.uuid4())
            await db.execute(sqlt("""
                INSERT INTO usuarios (id,organizacao_id,codigo_externo,nome,email,senha_hash,papel,telefone,ativo,primeiro_acesso)
                VALUES (:i,:o,:c,:n,:e,:h,:p,:t,true,true) ON CONFLICT (email) DO NOTHING
            """), {"i":uid,"o":org_id,"c":cod,"n":_norm(nome) or cod,"e":email_n,"h":_h("Mudar@123"),"p":papel,"t":_fone(ddd,tel)})
            res_check = await db.execute(sqlt("SELECT id FROM usuarios WHERE email=:e"), {"e": email_n})
            row_check = res_check.fetchone()
            if row_check:
                uid_real = str(row_check[0]); usuarios_map[cod]=uid_real; emails_map[email_n]=uid_real; usuarios_criados+=1; return uid_real
            return None

        vinculos_set = set()
        async def get_or_create_vinculo(sup_id, sub_id, cod_sub):
            nonlocal vinculos_criados
            if not sup_id or not sub_id: return
            chave=(sup_id,sub_id,cod_sub)
            if chave in vinculos_set: return
            vinculos_set.add(chave)
            await db.execute(sqlt("""
                INSERT INTO hierarquia_vendas (id,superior_id,subordinado_id,codigo_externo_subordinado,ativo)
                VALUES (:i,:s,:b,:c,true) ON CONFLICT ON CONSTRAINT uq_hierarquia_vinculo DO NOTHING
            """), {"i":str(uuid_mod.uuid4()),"s":sup_id,"b":sub_id,"c":cod_sub})
            vinculos_criados+=1

        clientes_set = set(); contratos_set = set()
        propostas_set = set(); propostas_ids = {}
        avisos = []; erros = []

        # Pré-processar: mapear ESN real por cliente (para herança)
        cli_esn_real = {}
        for r in rows:
            cli = r["Código do Cliente"].strip()
            esn = r["Código do ESN"].strip()
            esn_n = r["Nome do ESN"].strip()
            esn_e = r["E-mail do ESN"].strip()
            esn_ddd = r.get("Código de Área do ESN","")
            esn_tel = r.get("Telefone ESN","")
            if esn and esn not in ("-","") and cli not in cli_esn_real:
                cli_esn_real[cli] = {"cod": esn, "nome": esn_n, "email": esn_e, "ddd": esn_ddd, "tel": esn_tel}

        # Pré-processar status dos contratos — ATIVO tem prioridade sobre CANCELADO/TROCADO
        # Regra: se qualquer linha do contrato for ATIVO, o contrato é ATIVO
        PRIORIDADE_STATUS = ["ATIVO","GRATUITO","PENDENTE","MANUAL","TROCADO","CANCELADO"]
        ct_status_final = {}
        for r in rows:
            num = r["Número do Contrato"].strip()
            st  = r["Status do Contrato"].strip().upper()
            if st not in PRIORIDADE_STATUS: st = "PENDENTE"
            if num not in ct_status_final:
                ct_status_final[num] = st
            else:
                # Manter o status de maior prioridade (menor índice)
                if PRIORIDADE_STATUS.index(st) < PRIORIDADE_STATUS.index(ct_status_final[num]):
                    ct_status_final[num] = st

        for row in rows:
            dsn_id = await get_or_create_usuario(row["Código do DSN"],row["Nome do DSN"],row["E-mail do DSN"],"DSN",row.get("Código de Área do DSN",""),row.get("Telefone DSN",""))
            gsn_id = await get_or_create_usuario(row["Código do GSN"],row["Nome do GSN"],row["E-mail do GSN"],"GSN",row.get("Código de Área do GSN",""),row.get("Telefone GSN",""))
            # ESN: usar o da linha ou herdar do cliente
            cod_cli_atual = row["Código do Cliente"].strip()
            esn_row = row["Código do ESN"].strip()
            if not esn_row or esn_row == "-":
                esn_info = cli_esn_real.get(cod_cli_atual, {})
                esn_id = await get_or_create_usuario(esn_info.get("cod",""), esn_info.get("nome",""), esn_info.get("email",""), "ESN", esn_info.get("ddd",""), esn_info.get("tel","")) if esn_info else None
            else:
                esn_id = await get_or_create_usuario(row["Código do ESN"],row["Nome do ESN"],row["E-mail do ESN"],"ESN",row.get("Código de Área do ESN",""),row.get("Telefone ESN",""))
            if dsn_id and gsn_id: await get_or_create_vinculo(dsn_id,gsn_id,row["Código do GSN"].strip())
            if gsn_id and esn_id: await get_or_create_vinculo(gsn_id,esn_id,row["Código do ESN"].strip())

            cod_cli = row["Código do Cliente"].strip()
            if cod_cli and cod_cli not in clientes_set:
                # Verificar seleção
                if clientes_sel and cod_cli not in clientes_sel:
                    continue
                clientes_set.add(cod_cli)
                await db.execute(sqlt("""
                    INSERT INTO clientes (id,organizacao_id,vendedor_responsavel_id,codigo_externo,razao_social,cnpj,municipio,uf,segmento,sub_segmento,setor_publico,status_atribuicao,status_cliente,classificacao_abc,frequencia_visita_dias,ativo)
                    VALUES (:i,:o,:v,:c,:r,:cn,:m,:u,:seg,:sub,:sp,:sa,:sc,:abc,30,true)
                    ON CONFLICT (codigo_externo) DO UPDATE SET
                        vendedor_responsavel_id=COALESCE(EXCLUDED.vendedor_responsavel_id, clientes.vendedor_responsavel_id),
                        segmento=COALESCE(EXCLUDED.segmento, clientes.segmento),
                        sub_segmento=COALESCE(EXCLUDED.sub_segmento, clientes.sub_segmento)
                """), {
                    "i":str(uuid_mod.uuid4()),"o":org_id,"v":esn_id,"c":cod_cli,
                    "r":_norm(row["Razão Social do Cliente"]),"cn":_cnpj(row["CPF ou CNPJ do Cliente"]),
                    "m":_norm(_nulo(row["Município do Cliente"])),"u":_nulo(row["UF"]),
                    "seg":_norm(_nulo(row.get("Segmento do Cliente",""))),"sub":_norm(_nulo(row.get("Sub Segmento do Cliente",""))),
                    "sp":_bool(row["Setor Público"]),"sa":"ATRIBUIDO" if esn_id else "PENDENTE","sc":"ATIVO","abc":"C",
                })
                if not any(r["Código do Cliente"].strip()==cod_cli and r["Código do ESN"].strip() not in ("-","") for r in rows):
                    avisos.append(f"Cliente {cod_cli} importado sem ESN")
                clientes_criados+=1

            num_ct = row["Número do Contrato"].strip()
            if num_ct and num_ct not in contratos_set:
                if contratos_sel and num_ct not in contratos_sel: continue
                if clientes_sel and cod_cli not in clientes_sel: continue
                contratos_set.add(num_ct)
                res_cli = await db.execute(sqlt("SELECT id FROM clientes WHERE codigo_externo=:c"), {"c":cod_cli})
                row_cli = res_cli.fetchone()
                if row_cli:
                    st = ct_status_final.get(num_ct, "PENDENTE")
                    ct_id = str(uuid_mod.uuid4())
                    await db.execute(sqlt("""
                        INSERT INTO contratos (id,cliente_id,numero_contrato,status,recorrente,modalidade,unidade_venda)
                        VALUES (:i,:c,:n,:s,:r,:m,:u) ON CONFLICT (numero_contrato) DO UPDATE SET status=EXCLUDED.status
                        RETURNING id
                    """), {"i":ct_id,"c":str(row_cli[0]),"n":num_ct,"s":st,"r":_bool(row["Recorrente"]),"m":_nulo(row["Modalidade de Vendas"]),"u":_nulo(row.get("Nome Unidade de Venda",""))})
                    res_ct_id = await db.execute(sqlt("SELECT id FROM contratos WHERE numero_contrato=:n"), {"n":num_ct})
                    ct_id_real = str(res_ct_id.fetchone()[0])
                    contratos_criados+=1
                    # Registrar proposta + itens
                    num_prop = _nulo(row.get("Número da Proposta","")) or num_ct
                    plan_fin = _nulo(row.get("Planilha Financeira no Contrato",""))
                    data_ass_cont = _data(row.get("Data de Assinatura",""))
                    prop_key = (ct_id_real, num_prop)
                    if prop_key not in propostas_set:
                        propostas_set.add(prop_key)
                        prop_id = str(uuid_mod.uuid4())
                        await db.execute(sqlt("""
                            INSERT INTO propostas_contrato (id,contrato_id,numero_proposta,planilha_financeira,data_assinatura,modalidade,valor_total,valor_recorrente)
                            VALUES (:i,:c,:n,:p,:d,:m,0,0)
                            ON CONFLICT (contrato_id, numero_proposta) DO NOTHING
                        """), {"i":prop_id,"c":ct_id_real,"n":num_prop,"p":plan_fin,"d":data_ass_cont,"m":_nulo(row.get("Modalidade de Vendas",""))})
                        res_prop = await db.execute(sqlt("SELECT id FROM propostas_contrato WHERE contrato_id=:c AND numero_proposta=:n"), {"c":ct_id_real,"n":num_prop})
                        prop_id_real = str(res_prop.fetchone()[0])
                        propostas_ids[(ct_id_real, num_prop)] = prop_id_real
                    prop_id_real = propostas_ids.get((ct_id_real, num_prop), prop_id if "prop_id" in dir() else None)
                    if prop_id_real:
                        st_cancel = _nulo(row.get("Status Cancelamento",""))
                        data_item = _data(row.get("Data de Assinatura do Item","")) or data_ass_cont
                        val_unit  = _val(row.get("Valor Unitário",""))
                        val_tot   = _val(row.get("Valor Total do Contrato",""))
                        qtd       = int(float(row.get("Quantidade do Item","1").replace(",",".") or 1))
                        cod_prod  = _nulo(row.get("Código do Produto",""))
                        desc_prod = _nulo(row.get("Descrição do Produto",""))
                        rec_item  = _bool(row.get("Recorrente","NAO"))
                        st_item = row.get("Status do Contrato","").strip().upper()
                        await db.execute(sqlt("""
                            INSERT INTO itens_contrato (id,proposta_id,contrato_id,codigo_produto,descricao_produto,quantidade,valor_unitario,valor_total,recorrente,status_cancelamento,status_item,data_assinatura_item)
                            VALUES (:i,:p,:c,:cp,:dp,:q,:vu,:vt,:r,:sc,:si,:di)
                            ON CONFLICT DO NOTHING
                        """), {"i":str(uuid_mod.uuid4()),"p":prop_id_real,"c":ct_id_real,"cp":cod_prod,"dp":desc_prod,"q":qtd,"vu":val_unit,"vt":val_tot,"r":rec_item,"sc":st_cancel,"si":st_item,"di":data_item})

        await db.commit()
        return {"sucesso":True,"organizacoes_criadas":org_criada,"usuarios_criados":usuarios_criados,"vinculos_criados":vinculos_criados,"clientes_criados":clientes_criados,"contratos_criados":contratos_criados,"avisos":avisos,"erros":erros}

    except HTTPException: raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro na importação: {str(e)}")
    finally:
        os.unlink(tmp_path)


@router.post("/usuarios", tags=["usuarios"])
async def criar_usuario(
    body: dict,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text as sqlt
    from app.core.security import get_password_hash

    if current_user.papel not in (PapelUsuario.ADMIN, PapelUsuario.GESTOR_EMPRESA):
        raise HTTPException(status_code=403, detail="Apenas administradores podem criar usuários.")

    email = body.get("email","").strip().lower()
    if not email or not body.get("nome","").strip():
        raise HTTPException(status_code=400, detail="Nome e e-mail são obrigatórios.")

    # Verificar e-mail duplicado
    res = await db.execute(sqlt("SELECT id FROM usuarios WHERE email=:e"), {"e": email})
    if res.fetchone():
        raise HTTPException(status_code=400, detail="E-mail já cadastrado.")

    # Organização do criador
    org_id = str(current_user.organizacao_id) if current_user.organizacao_id else None

    import uuid as uuid_mod
    uid = str(uuid_mod.uuid4())
    await db.execute(sqlt("""
        INSERT INTO usuarios (id, organizacao_id, codigo_externo, nome, email,
                              senha_hash, papel, telefone, ativo, primeiro_acesso)
        VALUES (:i, :o, :c, :n, :e, :h, :p, :t, true, true)
    """), {
        "i": uid,
        "o": org_id,
        "c": body.get("codigo_externo","").strip() or None,
        "n": body.get("nome","").strip(),
        "e": email,
        "h": get_password_hash(body.get("senha","Mudar@123")),
        "p": body.get("papel","ESN"),
        "t": body.get("telefone","").strip() or None,
    })
    await db.commit()
    return {"id": uid, "mensagem": "Usuário criado com sucesso."}

app.include_router(router)
