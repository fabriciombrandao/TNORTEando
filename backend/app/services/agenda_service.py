"""
Serviço de agenda: geração automática de roteiro diário
usando algoritmo do vizinho mais próximo (greedy TSP).
"""
from datetime import date, time
from typing import Optional
from uuid import UUID
from math import radians, cos, sin, asin, sqrt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.models import Agenda, AgendaItem, Cliente, StatusAgendaItem


def _haversine(lat1, lng1, lat2, lng2) -> float:
    """Distância em km entre dois pontos."""
    R = 6371
    lat1, lng1, lat2, lng2 = map(radians, [lat1, lng1, lat2, lng2])
    dlat, dlng = lat2 - lat1, lng2 - lng1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlng / 2) ** 2
    return 2 * R * asin(sqrt(a))


def _roteiro_otimizado(clientes: list[Cliente], lat_inicio: float, lng_inicio: float) -> list[Cliente]:
    """Vizinho mais próximo: minimiza deslocamento total."""
    restantes = [c for c in clientes if c.lat and c.lng]
    sem_coords = [c for c in clientes if not c.lat or not c.lng]

    rota = []
    lat_atual, lng_atual = lat_inicio, lng_inicio

    while restantes:
        mais_proximo = min(
            restantes,
            key=lambda c: _haversine(lat_atual, lng_atual, c.lat, c.lng)
        )
        rota.append(mais_proximo)
        lat_atual, lng_atual = mais_proximo.lat, mais_proximo.lng
        restantes.remove(mais_proximo)

    return rota + sem_coords  # clientes sem coordenadas vão ao final


class AgendaService:

    @staticmethod
    async def criar_agenda_manual(
        db: AsyncSession,
        vendedor_id: UUID,
        data_agenda: date,
        cliente_ids: list[UUID],
        horario_inicio: str = "08:00",
        duracao_padrao_min: int = 45,
    ) -> Agenda:
        agenda = Agenda(vendedor_id=vendedor_id, data=data_agenda)
        db.add(agenda)
        await db.flush()

        for i, cliente_id in enumerate(cliente_ids):
            item = AgendaItem(
                agenda_id=agenda.id,
                cliente_id=cliente_id,
                ordem=i + 1,
                duracao_minutos=duracao_padrao_min,
                status=StatusAgendaItem.PENDENTE,
            )
            db.add(item)

        await db.commit()
        await db.refresh(agenda)
        return agenda

    @staticmethod
    async def gerar_roteiro_otimizado(
        db: AsyncSession,
        vendedor_id: UUID,
        data_agenda: date,
        cliente_ids: list[UUID],
        lat_inicio: float,
        lng_inicio: float,
        horario_inicio: str = "08:00",
        duracao_padrao_min: int = 45,
        intervalo_deslocamento_min: int = 15,
    ) -> Agenda:
        """Gera agenda com clientes ordenados por proximidade geográfica."""

        # Carrega clientes com coordenadas
        stmt = select(Cliente).where(Cliente.id.in_(cliente_ids))
        result = await db.execute(stmt)
        clientes = result.scalars().all()

        clientes_ordenados = _roteiro_otimizado(list(clientes), lat_inicio, lng_inicio)

        agenda = Agenda(
            vendedor_id=vendedor_id,
            data=data_agenda,
            notas=f"Roteiro otimizado gerado automaticamente — {len(clientes_ordenados)} visitas",
        )
        db.add(agenda)
        await db.flush()

        # Calcular horários
        h, m = map(int, horario_inicio.split(":"))
        minutos_acumulados = h * 60 + m

        for i, cliente in enumerate(clientes_ordenados):
            horario_str = f"{minutos_acumulados // 60:02d}:{minutos_acumulados % 60:02d}"
            item = AgendaItem(
                agenda_id=agenda.id,
                cliente_id=cliente.id,
                ordem=i + 1,
                horario_previsto=horario_str,
                duracao_minutos=duracao_padrao_min,
                status=StatusAgendaItem.PENDENTE,
            )
            db.add(item)
            minutos_acumulados += duracao_padrao_min + intervalo_deslocamento_min

        await db.commit()
        await db.refresh(agenda)
        return agenda

    @staticmethod
    async def buscar_agenda_do_dia(
        db: AsyncSession, vendedor_id: UUID, data_agenda: date
    ) -> Optional[Agenda]:
        stmt = (
            select(Agenda)
            .where(Agenda.vendedor_id == vendedor_id, Agenda.data == data_agenda)
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()
