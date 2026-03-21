from datetime import datetime, timezone
from typing import Optional
from uuid import UUID
from geopy.distance import geodesic
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.models import Visita, Cliente, StatusVisita, AgendaItem, StatusAgendaItem
from app.core.config import settings


class VisitaService:

    @staticmethod
    async def checkin(
        db: AsyncSession,
        vendedor_id: UUID,
        cliente_id: UUID,
        lat: float,
        lng: float,
        agenda_item_id: Optional[UUID] = None,
    ) -> Visita:
        # Busca cliente
        cliente = await db.get(Cliente, cliente_id)
        if not cliente:
            raise ValueError("Cliente não encontrado.")

        # Verifica se já há visita em andamento para este vendedor
        stmt = select(Visita).where(
            Visita.vendedor_id == vendedor_id,
            Visita.status == StatusVisita.EM_ANDAMENTO,
        )
        result = await db.execute(stmt)
        visita_aberta = result.scalar_one_or_none()
        if visita_aberta:
            raise ValueError(
                f"Você já possui uma visita em andamento para o cliente "
                f"{visita_aberta.cliente_id}. Faça o checkout antes."
            )

        # Valida distância se cliente tiver coordenadas
        distancia = None
        if cliente.lat and cliente.lng:
            distancia = geodesic((lat, lng), (cliente.lat, cliente.lng)).meters
            if distancia > settings.CHECKIN_RADIUS_METROS:
                raise ValueError(
                    f"Você está a {distancia:.0f}m do cliente. "
                    f"O limite para check-in é {settings.CHECKIN_RADIUS_METROS:.0f}m."
                )

        visita = Visita(
            vendedor_id=vendedor_id,
            cliente_id=cliente_id,
            agenda_item_id=agenda_item_id,
            status=StatusVisita.EM_ANDAMENTO,
            checkin_em=datetime.now(timezone.utc),
            checkin_lat=lat,
            checkin_lng=lng,
            distancia_checkin_metros=distancia,
        )
        db.add(visita)

        # Atualiza item de agenda
        if agenda_item_id:
            item = await db.get(AgendaItem, agenda_item_id)
            if item:
                item.status = StatusAgendaItem.CONCLUIDO

        await db.commit()
        await db.refresh(visita)
        return visita

    @staticmethod
    async def checkout(
        db: AsyncSession,
        visita_id: UUID,
        vendedor_id: UUID,
        lat: float,
        lng: float,
        observacoes: Optional[str] = None,
    ) -> Visita:
        visita = await db.get(Visita, visita_id)
        if not visita:
            raise ValueError("Visita não encontrada.")
        if str(visita.vendedor_id) != str(vendedor_id):
            raise PermissionError("Você não pode fazer checkout desta visita.")
        if visita.status != StatusVisita.EM_ANDAMENTO:
            raise ValueError("Esta visita não está em andamento.")

        visita.checkout_em = datetime.now(timezone.utc)
        visita.checkout_lat = lat
        visita.checkout_lng = lng
        visita.status = StatusVisita.CONCLUIDA
        if observacoes:
            visita.observacoes = observacoes

        await db.commit()
        await db.refresh(visita)
        return visita
