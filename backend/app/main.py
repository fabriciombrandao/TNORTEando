from fastapi import FastAPI, APIRouter, Depends, HTTPException, UploadFile, File, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import select
from pydantic import BaseModel, EmailStr
from typing import Optional, List
from uuid import UUID
from datetime import date
import tempfile, os

from app.core.config import settings
from app.core.security import verify_password, create_access_token, create_refresh_token, decode_token
from app.models.models import Base, Usuario, PapelUsuario
from app.services.visita_service import VisitaService
from app.services.agenda_service import AgendaService
from app.services.importador_csv import ImportadorCSV

# ─────────────────────────────────────────────
# DB Setup
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
        visita = await VisitaService.checkout(
            db, visita_id, current_user.id,
            body.lat, body.lng, body.observacoes
        )
        return {
            "visita_id": str(visita.id),
            "checkout_em": visita.checkout_em,
            "duracao_minutos": int(
                (visita.checkout_em - visita.checkin_em).total_seconds() / 60
            ),
        }
    except (ValueError, PermissionError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/visitas/em-andamento", tags=["visitas"])
async def visita_em_andamento(
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.models import Visita, StatusVisita
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
            "clientes_orfaos": resultado.clientes_orfaos,
            "clientes_sem_municipio": resultado.clientes_sem_municipio,
            "avisos": resultado.avisos,
            "erros": resultado.erros,
        }
    finally:
        os.unlink(tmp_path)


# ─────────────────────────────────────────────
# Clientes
# ─────────────────────────────────────────────

@router.get("/clientes", tags=["clientes"])
async def listar_clientes(
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    apenas_ativos: bool = True,
):
    from app.models.models import Cliente
    stmt = select(Cliente)
    if current_user.papel == PapelUsuario.ESN:
        stmt = stmt.where(Cliente.vendedor_responsavel_id == current_user.id)
    if apenas_ativos:
        stmt = stmt.where(Cliente.ativo == True)
    result = await db.execute(stmt)
    clientes = result.scalars().all()
    return [
        {
            "id": str(c.id),
            "codigo_externo": c.codigo_externo,
            "razao_social": c.razao_social,
            "municipio": c.municipio,
            "uf": c.uf,
            "lat": c.lat,
            "lng": c.lng,
            "status_atribuicao": c.status_atribuicao,
        }
        for c in clientes
    ]


app.include_router(router)
