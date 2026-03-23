"""
Modelos SQLAlchemy — TNORTEando / Visitas
"""

import uuid
from datetime import datetime, date
from enum import Enum as PyEnum
from sqlalchemy import (
    Column, String, Boolean, Float, Integer, Text, Numeric,
    DateTime, Date, ForeignKey, Enum, UniqueConstraint, Index, func
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, DeclarativeBase


class Base(DeclarativeBase):
    pass


class PapelUsuario(str, PyEnum):
    GESTOR_EMPRESA = "GESTOR_EMPRESA"
    DSN            = "DSN"
    GSN            = "GSN"
    ESN            = "ESN"

class StatusCliente(str, PyEnum):
    ATIVO    = "ATIVO"
    INATIVO  = "INATIVO"
    SUSPENSO = "SUSPENSO"

class ClassificacaoABC(str, PyEnum):
    A = "A"
    B = "B"
    C = "C"

class TipoContato(str, PyEnum):
    DECISOR     = "DECISOR"
    TECNICO     = "TECNICO"
    FINANCEIRO  = "FINANCEIRO"
    OPERACIONAL = "OPERACIONAL"
    OUTRO       = "OUTRO"

class StatusContrato(str, PyEnum):
    ATIVO     = "ATIVO"
    CANCELADO = "CANCELADO"
    GRATUITO  = "GRATUITO"
    TROCADO   = "TROCADO"
    PENDENTE  = "PENDENTE"
    MANUAL    = "MANUAL"

class StatusAtribuicao(str, PyEnum):
    ATRIBUIDO = "ATRIBUIDO"
    PENDENTE  = "PENDENTE"

class StatusVisita(str, PyEnum):
    EM_ANDAMENTO = "EM_ANDAMENTO"
    CONCLUIDA    = "CONCLUIDA"
    CANCELADA    = "CANCELADA"

class TipoVisita(str, PyEnum):
    PRESENCIAL = "PRESENCIAL"
    REMOTA     = "REMOTA"

class StatusAgendaItem(str, PyEnum):
    PENDENTE   = "PENDENTE"
    CONCLUIDO  = "CONCLUIDO"
    CANCELADO  = "CANCELADO"
    REAGENDADO = "REAGENDADO"


class Organizacao(Base):
    __tablename__ = "organizacoes"
    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    codigo_externo = Column(String(50), unique=True, nullable=False)
    nome           = Column(String(255), nullable=False)
    ativo          = Column(Boolean, default=True)
    criado_em      = Column(DateTime(timezone=True), server_default=func.now())
    atualizado_em  = Column(DateTime(timezone=True), onupdate=func.now())
    usuarios = relationship("Usuario", back_populates="organizacao")
    clientes = relationship("Cliente", back_populates="organizacao")


class Usuario(Base):
    __tablename__ = "usuarios"
    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organizacao_id   = Column(UUID(as_uuid=True), ForeignKey("organizacoes.id"), nullable=False)
    codigo_externo   = Column(String(50), nullable=True)
    nome             = Column(String(255), nullable=False)
    email            = Column(String(255), unique=True, nullable=False)
    senha_hash       = Column(String(255), nullable=False)
    papel            = Column(Enum(PapelUsuario), nullable=False)
    telefone         = Column(String(20), nullable=True)
    ativo            = Column(Boolean, default=True)
    primeiro_acesso  = Column(Boolean, default=True)
    ultimo_acesso_em = Column(DateTime(timezone=True), nullable=True)
    criado_em        = Column(DateTime(timezone=True), server_default=func.now())
    atualizado_em    = Column(DateTime(timezone=True), onupdate=func.now())
    organizacao          = relationship("Organizacao", back_populates="usuarios")
    superiores           = relationship("HierarquiaVendas", foreign_keys="HierarquiaVendas.subordinado_id", back_populates="subordinado")
    subordinados         = relationship("HierarquiaVendas", foreign_keys="HierarquiaVendas.superior_id", back_populates="superior")
    clientes_responsavel = relationship("Cliente", back_populates="vendedor_responsavel")
    visitas              = relationship("Visita",  back_populates="vendedor")
    agendas              = relationship("Agenda",  back_populates="vendedor")


class HierarquiaVendas(Base):
    __tablename__ = "hierarquia_vendas"
    __table_args__ = (
        UniqueConstraint("superior_id", "subordinado_id", "codigo_externo_subordinado", name="uq_hierarquia_vinculo"),
    )
    id                         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    superior_id                = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    subordinado_id             = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    codigo_externo_subordinado = Column(String(50), nullable=True)
    ativo                      = Column(Boolean, default=True)
    criado_em                  = Column(DateTime(timezone=True), server_default=func.now())
    superior    = relationship("Usuario", foreign_keys=[superior_id],    back_populates="subordinados")
    subordinado = relationship("Usuario", foreign_keys=[subordinado_id], back_populates="superiores")


class Cliente(Base):
    __tablename__ = "clientes"
    __table_args__ = (
        Index("ix_clientes_uf_municipio", "uf", "municipio"),
        Index("ix_clientes_classificacao", "classificacao_abc"),
        Index("ix_clientes_vendedor", "vendedor_responsavel_id"),
    )
    id                      = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organizacao_id          = Column(UUID(as_uuid=True), ForeignKey("organizacoes.id"), nullable=False)
    vendedor_responsavel_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
    codigo_externo          = Column(String(50), unique=True, nullable=False)
    razao_social            = Column(String(255), nullable=False)
    nome_fantasia           = Column(String(255), nullable=True)
    cnpj                    = Column(String(14), nullable=True)
    cep                     = Column(String(8),   nullable=True)
    logradouro              = Column(String(255), nullable=True)
    municipio               = Column(String(100), nullable=True)
    uf                      = Column(String(2),   nullable=True)
    lat                     = Column(Float, nullable=True)
    lng                     = Column(Float, nullable=True)
    telefone_principal      = Column(String(20),  nullable=True)
    email_principal         = Column(String(255), nullable=True)
    segmento                = Column(String(100), nullable=True)
    sub_segmento            = Column(String(100), nullable=True)
    setor_publico           = Column(Boolean, default=False)
    classificacao_abc       = Column(Enum(ClassificacaoABC), default=ClassificacaoABC.C)
    frequencia_visita_dias  = Column(Integer, default=30)
    ultima_visita_em        = Column(DateTime(timezone=True), nullable=True)
    proxima_visita_prevista = Column(Date, nullable=True)
    status_cliente          = Column(Enum(StatusCliente),    default=StatusCliente.ATIVO)
    status_atribuicao       = Column(Enum(StatusAtribuicao), default=StatusAtribuicao.ATRIBUIDO)
    observacoes             = Column(Text, nullable=True)
    ativo                   = Column(Boolean, default=True)
    criado_em               = Column(DateTime(timezone=True), server_default=func.now())
    atualizado_em           = Column(DateTime(timezone=True), onupdate=func.now())
    organizacao          = relationship("Organizacao",    back_populates="clientes")
    vendedor_responsavel = relationship("Usuario",        back_populates="clientes_responsavel")
    contratos            = relationship("Contrato",       back_populates="cliente", order_by="desc(Contrato.criado_em)")
    contatos             = relationship("ContatoCliente", back_populates="cliente", cascade="all, delete-orphan")
    visitas              = relationship("Visita",         back_populates="cliente")
    agenda_itens         = relationship("AgendaItem",     back_populates="cliente")


class ContatoCliente(Base):
    __tablename__ = "contatos_cliente"
    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cliente_id  = Column(UUID(as_uuid=True), ForeignKey("clientes.id"), nullable=False)
    nome        = Column(String(255), nullable=False)
    cargo       = Column(String(100), nullable=True)
    tipo        = Column(Enum(TipoContato), default=TipoContato.OUTRO)
    telefone    = Column(String(20),  nullable=True)
    email       = Column(String(255), nullable=True)
    principal   = Column(Boolean, default=False)
    observacoes = Column(Text, nullable=True)
    ativo       = Column(Boolean, default=True)
    criado_em   = Column(DateTime(timezone=True), server_default=func.now())
    cliente = relationship("Cliente", back_populates="contatos")


class Contrato(Base):
    __tablename__ = "contratos"
    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cliente_id        = Column(UUID(as_uuid=True), ForeignKey("clientes.id"), nullable=False)
    numero_contrato   = Column(String(50), unique=True, nullable=False)
    status            = Column(Enum(StatusContrato), nullable=False)
    data_assinatura   = Column(Date, nullable=True)
    data_vigencia_fim = Column(Date, nullable=True)
    data_renovacao    = Column(Date, nullable=True)
    produto_principal = Column(String(255), nullable=True)
    modalidade        = Column(String(50),  nullable=True)
    unidade_venda     = Column(String(255), nullable=True)
    recorrente        = Column(Boolean, default=False)
    valor_mensal      = Column(Numeric(12, 2), nullable=True)
    criado_em         = Column(DateTime(timezone=True), server_default=func.now())
    atualizado_em     = Column(DateTime(timezone=True), onupdate=func.now())
    cliente   = relationship("Cliente",          back_populates="contratos")
    historico = relationship("HistoricoContrato", back_populates="contrato", cascade="all, delete-orphan", order_by="desc(HistoricoContrato.criado_em)")


class HistoricoContrato(Base):
    __tablename__ = "historico_contratos"
    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contrato_id = Column(UUID(as_uuid=True), ForeignKey("contratos.id"), nullable=False)
    usuario_id  = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
    status_de   = Column(Enum(StatusContrato), nullable=True)
    status_para = Column(Enum(StatusContrato), nullable=False)
    observacao  = Column(Text, nullable=True)
    criado_em   = Column(DateTime(timezone=True), server_default=func.now())
    contrato = relationship("Contrato", back_populates="historico")
    usuario  = relationship("Usuario")


class Visita(Base):
    __tablename__ = "visitas"
    __table_args__ = (
        Index("ix_visitas_vendedor_data", "vendedor_id", "checkin_em"),
        Index("ix_visitas_cliente", "cliente_id"),
    )
    id                       = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendedor_id              = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    cliente_id               = Column(UUID(as_uuid=True), ForeignKey("clientes.id"), nullable=False)
    agenda_item_id           = Column(UUID(as_uuid=True), ForeignKey("agenda_itens.id"), nullable=True)
    tipo                     = Column(Enum(TipoVisita),   default=TipoVisita.PRESENCIAL)
    status                   = Column(Enum(StatusVisita), default=StatusVisita.EM_ANDAMENTO)
    checkin_em               = Column(DateTime(timezone=True), nullable=False)
    checkout_em              = Column(DateTime(timezone=True), nullable=True)
    checkin_lat              = Column(Float, nullable=True)
    checkin_lng              = Column(Float, nullable=True)
    checkout_lat             = Column(Float, nullable=True)
    checkout_lng             = Column(Float, nullable=True)
    distancia_checkin_metros = Column(Float, nullable=True)
    observacoes              = Column(Text, nullable=True)
    motivo_cancelamento      = Column(Text, nullable=True)
    proxima_visita_prevista  = Column(Date, nullable=True)
    criado_em                = Column(DateTime(timezone=True), server_default=func.now())
    vendedor    = relationship("Usuario",    back_populates="visitas")
    cliente     = relationship("Cliente",    back_populates="visitas")
    agenda_item = relationship("AgendaItem", back_populates="visita", uselist=False)
    fotos       = relationship("FotoVisita", back_populates="visita", cascade="all, delete-orphan")


class FotoVisita(Base):
    __tablename__ = "fotos_visita"
    id        = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    visita_id = Column(UUID(as_uuid=True), ForeignKey("visitas.id"), nullable=False)
    url       = Column(String(500), nullable=False)
    criado_em = Column(DateTime(timezone=True), server_default=func.now())
    visita = relationship("Visita", back_populates="fotos")


class Agenda(Base):
    __tablename__ = "agendas"
    __table_args__ = (
        UniqueConstraint("vendedor_id", "data", name="uq_agenda_vendedor_dia"),
        Index("ix_agendas_data", "data"),
    )
    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendedor_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    data        = Column(Date, nullable=False)
    notas       = Column(Text, nullable=True)
    criado_em   = Column(DateTime(timezone=True), server_default=func.now())
    vendedor = relationship("Usuario",    back_populates="agendas")
    itens    = relationship("AgendaItem", back_populates="agenda", order_by="AgendaItem.ordem", cascade="all, delete-orphan")


class AgendaItem(Base):
    __tablename__ = "agenda_itens"
    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agenda_id        = Column(UUID(as_uuid=True), ForeignKey("agendas.id"), nullable=False)
    cliente_id       = Column(UUID(as_uuid=True), ForeignKey("clientes.id"), nullable=False)
    ordem            = Column(Integer, nullable=False)
    horario_previsto = Column(String(5), nullable=True)
    duracao_minutos  = Column(Integer, default=30)
    status           = Column(Enum(StatusAgendaItem), default=StatusAgendaItem.PENDENTE)
    observacoes      = Column(Text, nullable=True)
    agenda  = relationship("Agenda",  back_populates="itens")
    cliente = relationship("Cliente", back_populates="agenda_itens")
    visita  = relationship("Visita",  back_populates="agenda_item", uselist=False)
