import uuid
from datetime import datetime, date
from enum import Enum as PyEnum
from sqlalchemy import (
    Column, String, Boolean, Float, Integer, Text,
    DateTime, Date, ForeignKey, Enum, UniqueConstraint, func
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, DeclarativeBase


class Base(DeclarativeBase):
    pass


# ─────────────────────────────────────────────
# Enums
# ─────────────────────────────────────────────

class PapelUsuario(str, PyEnum):
    GESTOR_EMPRESA = "GESTOR_EMPRESA"   # vê toda a empresa/franquia
    DSN = "DSN"                         # Diretor
    GSN = "GSN"                         # Gerente
    ESN = "ESN"                         # Executivo (faz visitas)

class StatusVisita(str, PyEnum):
    EM_ANDAMENTO = "EM_ANDAMENTO"
    CONCLUIDA = "CONCLUIDA"
    CANCELADA = "CANCELADA"

class StatusAgendaItem(str, PyEnum):
    PENDENTE = "PENDENTE"
    CONCLUIDO = "CONCLUIDO"
    CANCELADO = "CANCELADO"
    REAGENDADO = "REAGENDADO"

class StatusContrato(str, PyEnum):
    ATIVO = "ATIVO"
    CANCELADO = "CANCELADO"
    GRATUITO = "GRATUITO"
    TROCADO = "TROCADO"
    PENDENTE = "PENDENTE"
    MANUAL = "MANUAL"

class StatusAtribuicao(str, PyEnum):
    ATRIBUIDO = "ATRIBUIDO"
    PENDENTE = "PENDENTE"   # clientes órfãos do CSV


# ─────────────────────────────────────────────
# Organização (Empresa / Franquia)
# ─────────────────────────────────────────────

class Organizacao(Base):
    __tablename__ = "organizacoes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    codigo_externo = Column(String(50), unique=True, nullable=False)   # ex: TNT108
    nome = Column(String(255), nullable=False)
    ativo = Column(Boolean, default=True)
    criado_em = Column(DateTime(timezone=True), server_default=func.now())

    usuarios = relationship("Usuario", back_populates="organizacao")
    clientes = relationship("Cliente", back_populates="organizacao")


# ─────────────────────────────────────────────
# Usuário (DSN / GSN / ESN / Gestor)
# ─────────────────────────────────────────────

class Usuario(Base):
    __tablename__ = "usuarios"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organizacao_id = Column(UUID(as_uuid=True), ForeignKey("organizacoes.id"), nullable=False)
    codigo_externo = Column(String(50), nullable=True)   # código do sistema legado (ex: T30869)
    nome = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, nullable=False)
    senha_hash = Column(String(255), nullable=False)
    papel = Column(Enum(PapelUsuario), nullable=False)
    telefone = Column(String(20), nullable=True)
    ativo = Column(Boolean, default=True)
    criado_em = Column(DateTime(timezone=True), server_default=func.now())
    atualizado_em = Column(DateTime(timezone=True), onupdate=func.now())

    organizacao = relationship("Organizacao", back_populates="usuarios")

    # Vínculos hierárquicos: um ESN pode ter múltiplos GSNs (via tabela de junção)
    superiores = relationship(
        "HierarquiaVendas",
        foreign_keys="HierarquiaVendas.subordinado_id",
        back_populates="subordinado"
    )
    subordinados = relationship(
        "HierarquiaVendas",
        foreign_keys="HierarquiaVendas.superior_id",
        back_populates="superior"
    )

    clientes_responsavel = relationship("Cliente", back_populates="vendedor_responsavel")
    visitas = relationship("Visita", back_populates="vendedor")
    agendas = relationship("Agenda", back_populates="vendedor")


# ─────────────────────────────────────────────
# Hierarquia de Vendas (tabela de junção)
# Suporta Stela com dois códigos/GSNs
# ─────────────────────────────────────────────

class HierarquiaVendas(Base):
    __tablename__ = "hierarquia_vendas"
    __table_args__ = (
        UniqueConstraint("superior_id", "subordinado_id", name="uq_hierarquia"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    superior_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    subordinado_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    codigo_externo_subordinado = Column(String(50), nullable=True)  # ex: T10387 ou T26875
    ativo = Column(Boolean, default=True)
    criado_em = Column(DateTime(timezone=True), server_default=func.now())

    superior = relationship("Usuario", foreign_keys=[superior_id], back_populates="subordinados")
    subordinado = relationship("Usuario", foreign_keys=[subordinado_id], back_populates="superiores")


# ─────────────────────────────────────────────
# Cliente
# ─────────────────────────────────────────────

class Cliente(Base):
    __tablename__ = "clientes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organizacao_id = Column(UUID(as_uuid=True), ForeignKey("organizacoes.id"), nullable=False)
    vendedor_responsavel_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)

    codigo_externo = Column(String(50), unique=True, nullable=False)
    razao_social = Column(String(255), nullable=False)
    cnpj = Column(String(18), nullable=True)
    segmento = Column(String(100), nullable=True)
    sub_segmento = Column(String(100), nullable=True)
    municipio = Column(String(100), nullable=True)
    uf = Column(String(2), nullable=True)
    endereco = Column(String(255), nullable=True)
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    setor_publico = Column(Boolean, default=False)
    status_atribuicao = Column(Enum(StatusAtribuicao), default=StatusAtribuicao.ATRIBUIDO)
    ativo = Column(Boolean, default=True)
    criado_em = Column(DateTime(timezone=True), server_default=func.now())
    atualizado_em = Column(DateTime(timezone=True), onupdate=func.now())

    organizacao = relationship("Organizacao", back_populates="clientes")
    vendedor_responsavel = relationship("Usuario", back_populates="clientes_responsavel")
    contratos = relationship("Contrato", back_populates="cliente")
    visitas = relationship("Visita", back_populates="cliente")
    agenda_itens = relationship("AgendaItem", back_populates="cliente")


# ─────────────────────────────────────────────
# Contrato
# ─────────────────────────────────────────────

class Contrato(Base):
    __tablename__ = "contratos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cliente_id = Column(UUID(as_uuid=True), ForeignKey("clientes.id"), nullable=False)
    numero_contrato = Column(String(50), unique=True, nullable=False)
    status = Column(Enum(StatusContrato), nullable=False)
    data_assinatura = Column(Date, nullable=True)
    data_vigencia_fim = Column(Date, nullable=True)
    unidade_venda = Column(String(255), nullable=True)
    modalidade = Column(String(50), nullable=True)
    recorrente = Column(Boolean, default=False)
    criado_em = Column(DateTime(timezone=True), server_default=func.now())

    cliente = relationship("Cliente", back_populates="contratos")


# ─────────────────────────────────────────────
# Visita
# ─────────────────────────────────────────────

class Visita(Base):
    __tablename__ = "visitas"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendedor_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    cliente_id = Column(UUID(as_uuid=True), ForeignKey("clientes.id"), nullable=False)
    agenda_item_id = Column(UUID(as_uuid=True), ForeignKey("agenda_itens.id"), nullable=True)

    status = Column(Enum(StatusVisita), default=StatusVisita.EM_ANDAMENTO)
    checkin_em = Column(DateTime(timezone=True), nullable=False)
    checkout_em = Column(DateTime(timezone=True), nullable=True)
    checkin_lat = Column(Float, nullable=False)
    checkin_lng = Column(Float, nullable=False)
    checkout_lat = Column(Float, nullable=True)
    checkout_lng = Column(Float, nullable=True)
    distancia_checkin_metros = Column(Float, nullable=True)  # distância calculada do endereço do cliente
    observacoes = Column(Text, nullable=True)
    criado_em = Column(DateTime(timezone=True), server_default=func.now())

    vendedor = relationship("Usuario", back_populates="visitas")
    cliente = relationship("Cliente", back_populates="visitas")
    agenda_item = relationship("AgendaItem", back_populates="visita")
    fotos = relationship("FotoVisita", back_populates="visita")


class FotoVisita(Base):
    __tablename__ = "fotos_visita"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    visita_id = Column(UUID(as_uuid=True), ForeignKey("visitas.id"), nullable=False)
    url = Column(String(500), nullable=False)
    criado_em = Column(DateTime(timezone=True), server_default=func.now())

    visita = relationship("Visita", back_populates="fotos")


# ─────────────────────────────────────────────
# Agenda
# ─────────────────────────────────────────────

class Agenda(Base):
    __tablename__ = "agendas"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendedor_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    data = Column(Date, nullable=False)
    notas = Column(Text, nullable=True)
    criado_em = Column(DateTime(timezone=True), server_default=func.now())

    vendedor = relationship("Usuario", back_populates="agendas")
    itens = relationship("AgendaItem", back_populates="agenda", order_by="AgendaItem.ordem")


class AgendaItem(Base):
    __tablename__ = "agenda_itens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agenda_id = Column(UUID(as_uuid=True), ForeignKey("agendas.id"), nullable=False)
    cliente_id = Column(UUID(as_uuid=True), ForeignKey("clientes.id"), nullable=False)
    ordem = Column(Integer, nullable=False)
    horario_previsto = Column(String(5), nullable=True)   # "09:30"
    duracao_minutos = Column(Integer, default=30)
    status = Column(Enum(StatusAgendaItem), default=StatusAgendaItem.PENDENTE)
    observacoes = Column(Text, nullable=True)

    agenda = relationship("Agenda", back_populates="itens")
    cliente = relationship("Cliente", back_populates="agenda_itens")
    visita = relationship("Visita", back_populates="agenda_item", uselist=False)
