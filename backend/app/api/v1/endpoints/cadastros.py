"""
Endpoints de cadastro — Clientes e Usuários
"""
from uuid import UUID
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel

from app.db.session import get_db
from app.models.models import (
    Cliente, Usuario, Contrato,
    PapelUsuario, StatusAtribuicao, StatusContrato,
)
from app.api.v1.deps import get_current_user

router = APIRouter()


# ══════════════════════════════════════════════════════════════════════════════
# SCHEMAS
# ══════════════════════════════════════════════════════════════════════════════

class ClienteOut(BaseModel):
    id: str
    codigo_externo: str
    razao_social: str
    cnpj: Optional[str]
    segmento: Optional[str]
    sub_segmento: Optional[str]
    municipio: Optional[str]
    uf: Optional[str]
    lat: Optional[float]
    lng: Optional[float]
    setor_publico: bool
    status_atribuicao: str
    ativo: bool
    vendedor_responsavel_id: Optional[str]

    class Config:
        from_attributes = True


class UsuarioOut(BaseModel):
    id: str
    codigo_externo: Optional[str]
    nome: str
    email: str
    papel: str
    telefone: Optional[str]
    ativo: bool

    class Config:
        from_attributes = True


class AtribuirVendedorRequest(BaseModel):
    vendedor_id: str


class EstatisticasOut(BaseModel):
    total: int
    atribuidos: int
    pendentes: int
    por_municipio: dict
    por_segmento: dict
    por_uf: dict


# ══════════════════════════════════════════════════════════════════════════════
# CLIENTES
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/clientes", response_model=List[ClienteOut], tags=["clientes"])
async def listar_clientes(
    filtro: Optional[str] = Query(None, description="pendentes | atribuidos"),
    busca: Optional[str] = Query(None),
    uf: Optional[str] = Query(None),
    segmento: Optional[str] = Query(None),
    apenas_ativos: bool = True,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Cliente)

    # ESN só vê seus próprios clientes
    if current_user.papel == PapelUsuario.ESN:
        stmt = stmt.where(Cliente.vendedor_responsavel_id == current_user.id)

    if apenas_ativos:
        stmt = stmt.where(Cliente.ativo == True)

    if filtro == "pendentes":
        stmt = stmt.where(Cliente.status_atribuicao == StatusAtribuicao.PENDENTE)
    elif filtro == "atribuidos":
        stmt = stmt.where(Cliente.status_atribuicao == StatusAtribuicao.ATRIBUIDO)

    if busca:
        like = f"%{busca}%"
        stmt = stmt.where(
            (Cliente.razao_social.ilike(like)) |
            (Cliente.codigo_externo.ilike(like)) |
            (Cliente.cnpj.ilike(like)) |
            (Cliente.municipio.ilike(like))
        )

    if uf:
        stmt = stmt.where(Cliente.uf == uf.upper())

    if segmento:
        stmt = stmt.where(Cliente.segmento.ilike(f"%{segmento}%"))

    stmt = stmt.order_by(Cliente.razao_social)
    result = await db.execute(stmt)
    clientes = result.scalars().all()

    return [
        ClienteOut(
            id=str(c.id),
            codigo_externo=c.codigo_externo,
            razao_social=c.razao_social,
            cnpj=c.cnpj,
            segmento=c.segmento,
            sub_segmento=c.sub_segmento,
            municipio=c.municipio,
            uf=c.uf,
            lat=c.lat,
            lng=c.lng,
            setor_publico=c.setor_publico,
            status_atribuicao=c.status_atribuicao.value if hasattr(c.status_atribuicao, 'value') else c.status_atribuicao,
            ativo=c.ativo,
            vendedor_responsavel_id=str(c.vendedor_responsavel_id) if c.vendedor_responsavel_id else None,
        )
        for c in clientes
    ]


@router.get("/clientes/estatisticas", response_model=EstatisticasOut, tags=["clientes"])
async def estatisticas_clientes(
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt_base = select(Cliente).where(Cliente.ativo == True)
    if current_user.papel == PapelUsuario.ESN:
        stmt_base = stmt_base.where(Cliente.vendedor_responsavel_id == current_user.id)

    result = await db.execute(stmt_base)
    todos = result.scalars().all()

    por_municipio: dict[str, int] = {}
    por_segmento:  dict[str, int] = {}
    por_uf:        dict[str, int] = {}

    for c in todos:
        if c.municipio:
            por_municipio[c.municipio] = por_municipio.get(c.municipio, 0) + 1
        if c.segmento:
            por_segmento[c.segmento] = por_segmento.get(c.segmento, 0) + 1
        if c.uf:
            por_uf[c.uf] = por_uf.get(c.uf, 0) + 1

    atribuidos = sum(1 for c in todos if c.status_atribuicao == StatusAtribuicao.ATRIBUIDO)
    pendentes  = sum(1 for c in todos if c.status_atribuicao == StatusAtribuicao.PENDENTE)

    return EstatisticasOut(
        total=len(todos),
        atribuidos=atribuidos,
        pendentes=pendentes,
        por_municipio=dict(sorted(por_municipio.items(), key=lambda x: -x[1])[:10]),
        por_segmento=dict(sorted(por_segmento.items(), key=lambda x: -x[1])),
        por_uf=dict(sorted(por_uf.items(), key=lambda x: -x[1])),
    )


@router.get("/clientes/{cliente_id}", response_model=ClienteOut, tags=["clientes"])
async def detalhe_cliente(
    cliente_id: UUID,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cliente = await db.get(Cliente, cliente_id)
    if not cliente or not cliente.ativo:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")

    # ESN só acessa seus próprios
    if current_user.papel == PapelUsuario.ESN:
        if str(cliente.vendedor_responsavel_id) != str(current_user.id):
            raise HTTPException(status_code=403, detail="Acesso negado.")

    return ClienteOut(
        id=str(cliente.id),
        codigo_externo=cliente.codigo_externo,
        razao_social=cliente.razao_social,
        cnpj=cliente.cnpj,
        segmento=cliente.segmento,
        sub_segmento=cliente.sub_segmento,
        municipio=cliente.municipio,
        uf=cliente.uf,
        lat=cliente.lat,
        lng=cliente.lng,
        setor_publico=cliente.setor_publico,
        status_atribuicao=cliente.status_atribuicao.value if hasattr(cliente.status_atribuicao, 'value') else cliente.status_atribuicao,
        ativo=cliente.ativo,
        vendedor_responsavel_id=str(cliente.vendedor_responsavel_id) if cliente.vendedor_responsavel_id else None,
    )


@router.patch("/clientes/{cliente_id}/atribuir", tags=["clientes"])
async def atribuir_vendedor(
    cliente_id: UUID,
    body: AtribuirVendedorRequest,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Atribui um ESN responsável a um cliente pendente."""
    if current_user.papel not in (
        PapelUsuario.GESTOR_EMPRESA, PapelUsuario.DSN, PapelUsuario.GSN
    ):
        raise HTTPException(status_code=403, detail="Sem permissão para atribuir clientes.")

    cliente = await db.get(Cliente, cliente_id)
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")

    vendedor = await db.get(Usuario, UUID(body.vendedor_id))
    if not vendedor or vendedor.papel != PapelUsuario.ESN:
        raise HTTPException(status_code=400, detail="Vendedor inválido ou sem papel ESN.")

    cliente.vendedor_responsavel_id = vendedor.id
    cliente.status_atribuicao = StatusAtribuicao.ATRIBUIDO

    await db.commit()
    await db.refresh(cliente)

    return {
        "ok": True,
        "cliente_id": str(cliente.id),
        "vendedor_id": str(vendedor.id),
        "vendedor_nome": vendedor.nome,
    }


# ══════════════════════════════════════════════════════════════════════════════
# USUÁRIOS
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/usuarios", response_model=List[UsuarioOut], tags=["usuarios"])
async def listar_usuarios(
    papel: Optional[str] = Query(None, description="DSN | GSN | ESN | GESTOR_EMPRESA"),
    ativo: bool = True,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Usuario).where(Usuario.ativo == ativo)

    if papel:
        try:
            papel_enum = PapelUsuario(papel.upper())
            stmt = stmt.where(Usuario.papel == papel_enum)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Papel inválido: {papel}")

    stmt = stmt.order_by(Usuario.nome)
    result = await db.execute(stmt)
    usuarios = result.scalars().all()

    return [
        UsuarioOut(
            id=str(u.id),
            codigo_externo=u.codigo_externo,
            nome=u.nome,
            email=u.email,
            papel=u.papel.value if hasattr(u.papel, 'value') else u.papel,
            telefone=u.telefone,
            ativo=u.ativo,
        )
        for u in usuarios
    ]


@router.get("/usuarios/me", response_model=UsuarioOut, tags=["usuarios"])
async def meu_perfil(current_user: Usuario = Depends(get_current_user)):
    return UsuarioOut(
        id=str(current_user.id),
        codigo_externo=current_user.codigo_externo,
        nome=current_user.nome,
        email=current_user.email,
        papel=current_user.papel.value if hasattr(current_user.papel, 'value') else current_user.papel,
        telefone=current_user.telefone,
        ativo=current_user.ativo,
    )
