"""
Seed Inicial — cria o usuário gestor da organização.

Executar UMA VEZ após a primeira importação do CSV:

    python -m app.scripts.seed_inicial

O gestor recebe papel GESTOR_EMPRESA e acesso a tudo no sistema.
"""

import asyncio
import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import select

from app.models.models import Base, Usuario, Organizacao, PapelUsuario
from app.core.security import get_password_hash
from app.core.config import settings


async def seed():
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with Session() as db:
        # Buscar organização importada
        result = await db.execute(select(Organizacao).limit(1))
        org = result.scalar_one_or_none()

        if not org:
            print("✘  Nenhuma organização encontrada. Execute a importação do CSV primeiro.")
            return

        # Verificar se gestor já existe
        result = await db.execute(
            select(Usuario).where(Usuario.papel == PapelUsuario.GESTOR_EMPRESA)
        )
        gestor_existente = result.scalar_one_or_none()

        if gestor_existente:
            print(f"✔  Gestor já existe: {gestor_existente.email}")
            return

        # Criar gestor
        gestor = Usuario(
            organizacao_id=org.id,
            codigo_externo="GESTOR001",
            nome="Administrador",
            email=os.getenv("GESTOR_EMAIL", "admin@totvs.com.br"),
            senha_hash=get_password_hash(os.getenv("GESTOR_SENHA", "Admin@123")),
            papel=PapelUsuario.GESTOR_EMPRESA,
            ativo=True,
        )
        db.add(gestor)
        await db.commit()
        await db.refresh(gestor)

        print("╔══════════════════════════════════════════╗")
        print("║   SEED INICIAL CONCLUÍDO                 ║")
        print("╚══════════════════════════════════════════╝")
        print(f"  Organização : {org.nome} ({org.codigo_externo})")
        print(f"  Gestor      : {gestor.email}")
        print(f"  Senha       : {os.getenv('GESTOR_SENHA', 'Admin@123')}")
        print(f"  ID          : {gestor.id}")
        print()
        print("  ⚠  Altere a senha no primeiro acesso!")
        print()


if __name__ == "__main__":
    asyncio.run(seed())
