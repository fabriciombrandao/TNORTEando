from fastapi import FastAPI, APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
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
async def login(form: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db), request: Request = None):
    stmt = select(Usuario).where(Usuario.email == form.username.lower())
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    ip = request.client.host if request else None
    ua = request.headers.get("user-agent") if request else None
    if not user or not verify_password(form.password, user.senha_hash):
        # Registrar tentativa falha
        await registrar_audit(db, "LOGIN_FALHA",
            usuario_email=form.username.lower(),
            descricao="Tentativa de login com credenciais inválidas.",
            ip=ip, user_agent=ua, sucesso=False)
        raise HTTPException(status_code=401, detail="Credenciais inválidas.")
    # Registrar login bem-sucedido
    await registrar_audit(db, "LOGIN",
        usuario_id=str(user.id), usuario_nome=user.nome, usuario_email=user.email,
        descricao=f"Login realizado com sucesso.",
        ip=ip, user_agent=ua, sucesso=True)
    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
        usuario={"id": str(user.id), "nome": user.nome, "papel": user.papel, "email": user.email, "codigo_externo": user.codigo_externo, "primeiro_acesso": bool(user.primeiro_acesso), "tipo_esn": user.tipo_esn if hasattr(user, "tipo_esn") else None},
    )

@router.post("/auth/logout", tags=["auth"])
async def logout(
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    ip = request.client.host if request else None
    ua = request.headers.get("user-agent") if request else None
    await registrar_audit(db, "LOGOUT",
        usuario_id=str(current_user.id),
        usuario_nome=current_user.nome,
        usuario_email=current_user.email,
        descricao="Logout realizado.",
        ip=ip, user_agent=ua, sucesso=True)
    return {"ok": True}


@router.get("/auth/me", tags=["auth"])
async def me(current_user: Usuario = Depends(get_current_user)):
    return {
        "id": str(current_user.id),
        "nome": current_user.nome,
        "email": current_user.email,
        "papel": current_user.papel,
        "codigo_externo": current_user.codigo_externo,
        "tipo_esn": current_user.tipo_esn if hasattr(current_user, "tipo_esn") else None,
    }

# ─────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


# ─────────────────────────────────────────────
# Auditoria
# ─────────────────────────────────────────────

async def registrar_audit(
    db: AsyncSession,
    acao: str,
    usuario_id: str = None,
    usuario_nome: str = None,
    usuario_email: str = None,
    entidade: str = None,
    entidade_id: str = None,
    descricao: str = None,
    valor_anterior: dict = None,
    valor_novo: dict = None,
    ip: str = None,
    user_agent: str = None,
    sucesso: bool = True,
):
    import json as _json
    from sqlalchemy import text as sqlt
    try:
        await db.execute(sqlt("""
            INSERT INTO audit_log (
                usuario_id, usuario_nome, usuario_email, acao,
                entidade, entidade_id, descricao,
                valor_anterior, valor_novo, ip, user_agent, sucesso
            ) VALUES (
                :uid, :unome, :uemail, :acao,
                :entidade, :eid, :desc,
                :vant, :vnov, :ip, :ua, :sucesso
            )
        """), {
            "uid": usuario_id,
            "unome": usuario_nome,
            "uemail": usuario_email,
            "acao": acao,
            "entidade": entidade,
            "eid": entidade_id,
            "desc": descricao,
            "vant": _json.dumps(valor_anterior) if valor_anterior else None,
            "vnov": _json.dumps(valor_novo) if valor_novo else None,
            "ip": ip,
            "ua": user_agent,
            "sucesso": sucesso,
        })
        await db.commit()
    except Exception:
        pass  # Auditoria nunca deve quebrar o fluxo principal


# ─────────────────────────────────────────────
# Consulta de auditoria (apenas ADMIN)
# ─────────────────────────────────────────────

@router.get("/auditoria", tags=["auditoria"])
async def listar_auditoria(
    acao: Optional[str] = None,
    usuario_email: Optional[str] = None,
    entidade: Optional[str] = None,
    data_inicio: Optional[str] = None,
    data_fim: Optional[str] = None,
    limit: int = 100,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    if papel != "ADMIN":
        raise HTTPException(status_code=403, detail="Acesso restrito ao Administrador.")
    from sqlalchemy import text as sqlt
    where = []
    params = {"limit": limit}
    if acao:
        where.append("acao = :acao"); params["acao"] = acao
    if usuario_email:
        where.append("usuario_email ILIKE :uemail"); params["uemail"] = f"%{usuario_email}%"
    if entidade:
        where.append("entidade = :entidade"); params["entidade"] = entidade
    if data_inicio:
        where.append("criado_em >= :di"); params["di"] = data_inicio
    if data_fim:
        where.append("criado_em <= :df"); params["df"] = data_fim
    where_sql = "WHERE " + " AND ".join(where) if where else ""
    res = await db.execute(sqlt(f"""
        SELECT id, usuario_id, usuario_nome, usuario_email, acao,
               entidade, entidade_id, descricao, sucesso, ip, criado_em,
               valor_anterior, valor_novo
        FROM audit_log
        {where_sql}
        ORDER BY criado_em DESC
        LIMIT :limit
    """), params)
    rows = res.fetchall()
    return [
        {
            "id": str(r[0]),
            "usuario_id": str(r[1]) if r[1] else None,
            "usuario_nome": r[2],
            "usuario_email": r[3],
            "acao": r[4],
            "entidade": r[5],
            "entidade_id": r[6],
            "descricao": r[7],
            "sucesso": bool(r[8]),
            "ip": r[9],
            "criado_em": str(r[10]),
            "valor_anterior": r[11] if r[11] else None,
            "valor_novo": r[12] if r[12] else None,
        }
        for r in rows
    ]


# ─────────────────────────────────────────────
# E-mail
# ─────────────────────────────────────────────

async def enviar_email(para: str, assunto: str, corpo_html: str):
    import smtplib, os
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    host  = os.getenv("SMTP_HOST", "smtp.gmail.com")
    port  = int(os.getenv("SMTP_PORT", "587"))
    user  = os.getenv("SMTP_USER", "")
    pwd   = os.getenv("SMTP_PASS", "")
    from_ = os.getenv("SMTP_FROM", user)
    if not user or not pwd:
        raise ValueError("SMTP não configurado.")
    msg = MIMEMultipart("alternative")
    msg["Subject"] = assunto
    msg["From"]    = from_
    msg["To"]      = para
    msg.attach(MIMEText(corpo_html, "html"))
    with smtplib.SMTP(host, port) as s:
        s.starttls()
        s.login(user, pwd)
        s.send_message(msg)


# ─────────────────────────────────────────────
# Ativação e recuperação de senha
# ─────────────────────────────────────────────

@router.post("/auth/enviar-ativacao", tags=["auth"])
async def enviar_ativacao(
    body: dict,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text as sqlt
    import secrets, os
    from datetime import datetime, timedelta, timezone
    usuario_id = body.get("usuario_id")
    if not usuario_id:
        raise HTTPException(status_code=400, detail="usuario_id obrigatório.")
    res = await db.execute(sqlt("SELECT id, nome, email FROM usuarios WHERE id = :id AND ativo = true"), {"id": usuario_id})
    u = res.fetchone()
    if not u:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    token = secrets.token_urlsafe(32)
    expira = datetime.now(timezone.utc) + timedelta(hours=48)
    await db.execute(sqlt("UPDATE tokens_usuario SET usado = true WHERE usuario_id = :uid AND tipo = 'ATIVACAO' AND usado = false"), {"uid": usuario_id})
    await db.execute(sqlt("INSERT INTO tokens_usuario (usuario_id, token, tipo, expira_em) VALUES (:uid, :tok, 'ATIVACAO', :exp)"), {"uid": usuario_id, "tok": token, "exp": expira})
    await db.commit()
    base_url = os.getenv("APP_URL", "https://tnorteando.cloud")
    link = f"{base_url}/ativar?token={token}"
    corpo = f"""<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
      <h2 style="color:#4f46e5">Bem-vindo ao TNORTEando!</h2>
      <p>Olá, <strong>{u[1]}</strong>!</p>
      <p>Sua conta foi criada. Clique no botão abaixo para definir sua senha:</p>
      <a href="{link}" style="display:inline-block;margin:24px 0;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Ativar minha conta</a>
      <p style="color:#888;font-size:12px">Link expira em 48 horas.</p>
    </div>"""
    await enviar_email(u[2], "Ative sua conta no TNORTEando", corpo)
    return {"ok": True, "mensagem": f"E-mail enviado para {u[2]}"}


@router.post("/auth/ativar", tags=["auth"])
async def ativar_conta(body: dict, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import text as sqlt
    from app.core.security import get_password_hash
    from datetime import datetime, timezone
    token = body.get("token", "")
    senha = body.get("senha", "")
    if len(senha) < 6:
        raise HTTPException(status_code=400, detail="Senha deve ter ao menos 6 caracteres.")
    res = await db.execute(sqlt("SELECT t.id, t.usuario_id, t.expira_em, t.usado FROM tokens_usuario t WHERE t.token = :tok AND t.tipo = 'ATIVACAO'"), {"tok": token})
    row = res.fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="Link inválido.")
    if row[3]:
        raise HTTPException(status_code=400, detail="Link já utilizado.")
    if row[2] < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Link expirado. Solicite um novo ao administrador.")
    hashed = get_password_hash(senha)
    await db.execute(sqlt("UPDATE usuarios SET senha_hash = :h, primeiro_acesso = false WHERE id = :id"), {"h": hashed, "id": str(row[1])})
    await db.execute(sqlt("UPDATE tokens_usuario SET usado = true WHERE id = :id"), {"id": str(row[0])})
    await db.commit()
    return {"ok": True, "mensagem": "Conta ativada! Faça login para continuar."}


@router.post("/auth/esqueci-senha", tags=["auth"])
async def esqueci_senha(body: dict, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import text as sqlt
    import secrets, os
    from datetime import datetime, timedelta, timezone
    email = body.get("email", "").lower().strip()
    if not email:
        raise HTTPException(status_code=400, detail="E-mail obrigatório.")
    res = await db.execute(sqlt("SELECT id, nome, email FROM usuarios WHERE email = :e AND ativo = true"), {"e": email})
    u = res.fetchone()
    if u:
        token = secrets.token_urlsafe(32)
        expira = datetime.now(timezone.utc) + timedelta(hours=2)
        await db.execute(sqlt("UPDATE tokens_usuario SET usado = true WHERE usuario_id = :uid AND tipo = 'RECUPERACAO' AND usado = false"), {"uid": str(u[0])})
        await db.execute(sqlt("INSERT INTO tokens_usuario (usuario_id, token, tipo, expira_em) VALUES (:uid, :tok, 'RECUPERACAO', :exp)"), {"uid": str(u[0]), "tok": token, "exp": expira})
        await db.commit()
        base_url = os.getenv("APP_URL", "https://tnorteando.cloud")
        link = f"{base_url}/redefinir-senha?token={token}"
        corpo = f"""<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
          <h2 style="color:#4f46e5">Recuperação de senha</h2>
          <p>Olá, <strong>{u[1]}</strong>!</p>
          <p>Clique abaixo para redefinir sua senha:</p>
          <a href="{link}" style="display:inline-block;margin:24px 0;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Redefinir minha senha</a>
          <p style="color:#888;font-size:12px">Link expira em 2 horas.</p>
        </div>"""
        await enviar_email(u[2], "Recuperação de senha — TNORTEando", corpo)
    return {"ok": True, "mensagem": "Se o e-mail existir, você receberá as instruções em breve."}


@router.post("/auth/redefinir-senha", tags=["auth"])
async def redefinir_senha_token(body: dict, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import text as sqlt
    from app.core.security import get_password_hash
    from datetime import datetime, timezone
    token = body.get("token", "")
    senha = body.get("senha", "")
    if len(senha) < 6:
        raise HTTPException(status_code=400, detail="Senha deve ter ao menos 6 caracteres.")
    res = await db.execute(sqlt("SELECT t.id, t.usuario_id, t.expira_em, t.usado FROM tokens_usuario t WHERE t.token = :tok AND t.tipo = 'RECUPERACAO'"), {"tok": token})
    row = res.fetchone()
    if not row or row[3]:
        raise HTTPException(status_code=400, detail="Link inválido ou já utilizado.")
    if row[2] < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Link expirado. Solicite um novo.")
    hashed = get_password_hash(senha)
    await db.execute(sqlt("UPDATE usuarios SET senha_hash = :h WHERE id = :id"), {"h": hashed, "id": str(row[1])})
    await db.execute(sqlt("UPDATE tokens_usuario SET usado = true WHERE id = :id"), {"id": str(row[0])})
    await db.commit()
    return {"ok": True, "mensagem": "Senha redefinida com sucesso!"}


# ─────────────────────────────────────────────
# Usuarios
# ─────────────────────────────────────────────

@router.get("/usuarios", tags=["usuarios"])
async def listar_usuarios(
    papel: Optional[str] = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text as sqlt
    where = []
    params = {}
    if papel:
        where.append("papel = :papel")
        params["papel"] = papel.upper()
    where_sql = "WHERE " + " AND ".join(where) if where else ""
    res = await db.execute(sqlt(f"""
        SELECT id, codigo_externo, nome, email, papel, telefone, ativo, primeiro_acesso, tipo_esn
        FROM usuarios
        {where_sql}
        ORDER BY nome
    """), params)
    rows = res.fetchall()
    return [
        {
            "id": str(r[0]),
            "codigo_externo": r[1],
            "nome": r[2],
            "email": r[3],
            "papel": r[4],
            "telefone": r[5],
            "ativo": bool(r[6]),
            "primeiro_acesso": bool(r[7]) if r[7] is not None else False,
            "tipo_esn": r[8] or "BASE",
        }
        for r in rows
    ]

@router.put("/usuarios/{usuario_id}", tags=["usuarios"])
async def editar_usuario(
    usuario_id: UUID,
    body: dict,
    request: Request = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.papel not in ("ADMIN", "GESTOR_CONSOLIDADORA", "GESTOR_EMPRESA"):
        raise HTTPException(status_code=403, detail="Sem permissão.")
    from sqlalchemy import text as sqlt
    updates = []
    params = {"id": str(usuario_id)}
    if "nome" in body:
        updates.append("nome = :nome"); params["nome"] = body["nome"]
    if "email" in body:
        updates.append("email = :email"); params["email"] = body["email"]
    if "codigo_externo" in body:
        updates.append("codigo_externo = :codigo_externo"); params["codigo_externo"] = body["codigo_externo"]
    if "telefone" in body:
        updates.append("telefone = :telefone"); params["telefone"] = body["telefone"]
    if "papel" in body:
        updates.append("papel = :papel"); params["papel"] = body["papel"]
    # tipo_esn — editável por ADMIN/GESTOR/DSN/GSN
    papel_atual = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    if "tipo_esn" in body and papel_atual in ("ADMIN","GESTOR_CONSOLIDADORA","GESTOR_EMPRESA","DSN","GSN"):
        if body["tipo_esn"] in ("BASE","NOVOS","BASE_NOVOS"):
            updates.append("tipo_esn = :tipo_esn"); params["tipo_esn"] = body["tipo_esn"]
    if not updates:
        raise HTTPException(status_code=400, detail="Nenhum campo para atualizar.")
    res_antes = await db.execute(sqlt("SELECT nome, email, papel, telefone FROM usuarios WHERE id = :id"), {"id": str(usuario_id)})
    row_antes = res_antes.fetchone()
    antes = {"nome": row_antes[0], "email": row_antes[1], "papel": str(row_antes[2]), "telefone": row_antes[3]} if row_antes else {}
    await db.execute(sqlt(f"UPDATE usuarios SET {', '.join(updates)} WHERE id = :id"), params)
    await db.commit()
    depois = {k: body[k] for k in ["nome","email","papel","telefone","codigo_externo"] if k in body}
    await registrar_audit(db, "UPDATE",
        usuario_id=str(current_user.id), usuario_nome=current_user.nome, usuario_email=current_user.email,
        entidade="usuarios", entidade_id=str(usuario_id),
        descricao=f"Usuário atualizado: {antes.get('nome','')}",
        valor_anterior=antes, valor_novo=depois,
        ip=request.client.host if request else None,
    )
    return {"ok": True}


@router.post("/auth/trocar-senha", tags=["auth"])
async def trocar_senha_primeiro_acesso(
    body: dict,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Troca senha no primeiro acesso e marca primeiro_acesso = false."""
    from sqlalchemy import text as sqlt
    from app.core.security import get_password_hash
    nova_senha = body.get("senha", "")
    if len(nova_senha) < 6:
        raise HTTPException(status_code=400, detail="Senha deve ter ao menos 6 caracteres.")
    hashed = get_password_hash(nova_senha)
    await db.execute(sqlt(
        "UPDATE usuarios SET senha_hash = :h, primeiro_acesso = false WHERE id = :id"
    ), {"h": hashed, "id": str(current_user.id)})
    await db.commit()
    return {"ok": True}


@router.post("/usuarios/{usuario_id}/redefinir-senha", tags=["usuarios"])
async def redefinir_senha(
    usuario_id: UUID,
    body: dict,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.papel not in ("ADMIN", "GESTOR_CONSOLIDADORA", "GESTOR_EMPRESA"):
        raise HTTPException(status_code=403, detail="Sem permissão.")
    from sqlalchemy import text as sqlt
    from app.core.security import get_password_hash
    nova_senha = body.get("senha", "")
    if len(nova_senha) < 6:
        raise HTTPException(status_code=400, detail="Senha deve ter ao menos 6 caracteres.")
    hashed = get_password_hash(nova_senha)
    res_u = await db.execute(sqlt("SELECT nome FROM usuarios WHERE id = :id"), {"id": str(usuario_id)})
    row_u = res_u.fetchone()
    await db.execute(sqlt("UPDATE usuarios SET senha_hash = :h WHERE id = :id"),
        {"h": hashed, "id": str(usuario_id)})
    await db.commit()
    await registrar_audit(db, "UPDATE",
        usuario_id=str(current_user.id), usuario_nome=current_user.nome, usuario_email=current_user.email,
        entidade="usuarios", entidade_id=str(usuario_id),
        descricao=f"Senha redefinida para: {row_u[0] if row_u else str(usuario_id)}",
    )
    return {"ok": True}


@router.patch("/usuarios/{usuario_id}/ativo", tags=["usuarios"])
async def toggle_usuario_ativo(
    usuario_id: UUID,
    body: dict,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.papel not in ("ADMIN", "GESTOR_CONSOLIDADORA", "GESTOR_EMPRESA"):
        raise HTTPException(status_code=403, detail="Sem permissão.")
    from sqlalchemy import text as sqlt
    ativo = bool(body.get("ativo", True))
    res_u = await db.execute(sqlt("SELECT nome FROM usuarios WHERE id = :id"), {"id": str(usuario_id)})
    row_u = res_u.fetchone()
    await db.execute(sqlt("UPDATE usuarios SET ativo = :a WHERE id = :id"),
        {"a": ativo, "id": str(usuario_id)})
    await db.commit()
    await registrar_audit(db, "UPDATE",
        usuario_id=str(current_user.id), usuario_nome=current_user.nome, usuario_email=current_user.email,
        entidade="usuarios", entidade_id=str(usuario_id),
        descricao=f"Usuário {'ativado' if ativo else 'desativado'}: {row_u[0] if row_u else str(usuario_id)}",
        valor_anterior={"ativo": not ativo}, valor_novo={"ativo": ativo},
    )
    return {"ok": True, "ativo": ativo}


@router.get("/usuarios/me", tags=["usuarios"])
async def meu_perfil(
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text as sqlt
    org = None
    if current_user.organizacao_id:
        res = await db.execute(sqlt(
            "SELECT codigo_externo, nome FROM organizacoes WHERE id = :id"),
            {"id": str(current_user.organizacao_id)})
        row = res.fetchone()
        if row:
            org = {"codigo": row[0], "nome": row[1]}
    return {
        "id": str(current_user.id),
        "codigo_externo": current_user.codigo_externo,
        "tipo_esn": current_user.tipo_esn if hasattr(current_user, "tipo_esn") else None,
        "nome": current_user.nome,
        "email": current_user.email,
        "papel": current_user.papel,
        "telefone": current_user.telefone,
        "ativo": current_user.ativo,
        "organizacao": org,
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

    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    if papel == "ESN":
        # ESN vê apenas seus próprios clientes
        where.append("c.vendedor_responsavel_id = :esn_id")
        params["esn_id"] = str(current_user.id)
    elif papel == "GSN":
        # GSN vê clientes dos ESNs sob ele
        where.append("""c.vendedor_responsavel_id IN (
            SELECT hv.subordinado_id FROM hierarquia_vendas hv
            WHERE hv.superior_id = :gsn_id
        )""")
        params["gsn_id"] = str(current_user.id)
    elif papel == "DSN":
        # DSN vê clientes dos ESNs sob seus GSNs
        where.append("""c.vendedor_responsavel_id IN (
            SELECT hv2.subordinado_id FROM hierarquia_vendas hv2
            WHERE hv2.superior_id IN (
                SELECT hv1.subordinado_id FROM hierarquia_vendas hv1
                WHERE hv1.superior_id = :dsn_id
            )
        )""")
        params["dsn_id"] = str(current_user.id)
    # ADMIN, GESTOR_EMPRESA, GESTOR_CONSOLIDADORA veem todos
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
            COALESCE(c.dormente, false) as dormente,
            -- Cancelamento total: todos itens recorrentes ativos em PROGRAMADO
            EXISTS (
                SELECT 1 FROM contratos ct
                JOIN propostas_contrato p ON p.contrato_id = ct.id
                JOIN itens_contrato i ON i.proposta_id = p.id
                WHERE ct.cliente_id = c.id
                AND ct.status = 'ATIVO'
                AND i.recorrente = true
                AND COALESCE(i.status_item,'ATIVO') NOT IN ('CANCELADO','TROCADO')
            ) AND NOT EXISTS (
                SELECT 1 FROM contratos ct
                JOIN propostas_contrato p ON p.contrato_id = ct.id
                JOIN itens_contrato i ON i.proposta_id = p.id
                WHERE ct.cliente_id = c.id
                AND ct.status = 'ATIVO'
                AND i.recorrente = true
                AND COALESCE(i.status_item,'ATIVO') NOT IN ('CANCELADO','TROCADO')
                AND COALESCE(i.status_cancelamento,'') != 'PROGRAMADO'
            ) as em_cancelamento_total,
            -- Data de vencimento do cancelamento
            (
                SELECT MAX(i.fim_aviso_previo)
                FROM contratos ct
                JOIN propostas_contrato p ON p.contrato_id = ct.id
                JOIN itens_contrato i ON i.proposta_id = p.id
                WHERE ct.cliente_id = c.id
                AND i.status_cancelamento = 'PROGRAMADO'
            ) as fim_cancelamento
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
            "em_cancelamento_total": bool(r[17]) if r[17] is not None else False,
            "fim_cancelamento": r[18] if r[18] else None,
        }
        for r in rows
    ]

@router.get("/clientes/estatisticas", tags=["clientes"])
async def estatisticas_clientes(
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text as sqlt
    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    uid = str(current_user.id)

    if papel == "ESN":
        where = "WHERE c.ativo = true AND c.vendedor_responsavel_id = :uid"
        params = {"uid": uid}
    elif papel == "GSN":
        where = """WHERE c.ativo = true AND c.vendedor_responsavel_id IN (
            SELECT hv.subordinado_id FROM hierarquia_vendas hv WHERE hv.superior_id = :uid)"""
        params = {"uid": uid}
    elif papel == "DSN":
        where = """WHERE c.ativo = true AND c.vendedor_responsavel_id IN (
            SELECT hv2.subordinado_id FROM hierarquia_vendas hv2
            WHERE hv2.superior_id IN (
                SELECT hv1.subordinado_id FROM hierarquia_vendas hv1 WHERE hv1.superior_id = :uid
            ))"""
        params = {"uid": uid}
    else:
        where = "WHERE c.ativo = true"
        params = {}

    res = await db.execute(sqlt(f"""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN c.status_atribuicao = 'ATRIBUIDO' THEN 1 ELSE 0 END) as atribuidos,
            SUM(CASE WHEN c.status_atribuicao = 'PENDENTE' THEN 1 ELSE 0 END) as pendentes
        FROM clientes c {where}
    """), params)
    row = res.fetchone()
    return {
        "total": int(row[0] or 0),
        "atribuidos": int(row[1] or 0),
        "pendentes": int(row[2] or 0),
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
               COALESCE(dormente, false) as dormente,
               EXISTS (
                   SELECT 1 FROM contratos ct
                   JOIN propostas_contrato p ON p.contrato_id = ct.id
                   JOIN itens_contrato i ON i.proposta_id = p.id
                   WHERE ct.cliente_id = :cid
                   AND ct.status = 'ATIVO'
                   AND i.recorrente = true
                   AND COALESCE(i.status_item,'ATIVO') NOT IN ('CANCELADO','TROCADO')
               ) AND NOT EXISTS (
                   SELECT 1 FROM contratos ct
                   JOIN propostas_contrato p ON p.contrato_id = ct.id
                   JOIN itens_contrato i ON i.proposta_id = p.id
                   WHERE ct.cliente_id = :cid
                   AND ct.status = 'ATIVO'
                   AND i.recorrente = true
                   AND COALESCE(i.status_item,'ATIVO') NOT IN ('CANCELADO','TROCADO')
                   AND COALESCE(i.status_cancelamento,'') != 'PROGRAMADO'
               ) as em_cancelamento_total,
               (
                   SELECT MAX(i.fim_aviso_previo)
                   FROM contratos ct
                   JOIN propostas_contrato p ON p.contrato_id = ct.id
                   JOIN itens_contrato i ON i.proposta_id = p.id
                   WHERE ct.cliente_id = :cid
                   AND i.status_cancelamento = 'PROGRAMADO'
               ) as fim_cancelamento
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
        "em_cancelamento_total": bool(cl_row[21]) if cl_row[21] is not None else False,
        "fim_cancelamento": cl_row[22] if cl_row[22] else None,
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
        "em_cancelamento_total": cliente.em_cancelamento_total,
        "fim_cancelamento": cliente.fim_cancelamento,
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
    relatorio_tipo: Optional[str] = None
    relatorio_resumo: Optional[str] = None
    relatorio_problema: bool = False
    relatorio_problema_desc: Optional[str] = None
    relatorio_oportunidade: bool = False
    relatorio_oport_desc: Optional[str] = None
    relatorio_proximo_passo: Optional[str] = None

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
    # Validar campos obrigatórios do relatório
    if not body.relatorio_tipo:
        raise HTTPException(status_code=400, detail="Tipo do relatório é obrigatório.")
    if not body.relatorio_resumo or len(body.relatorio_resumo.strip()) < 10:
        raise HTTPException(status_code=400, detail="Resumo da visita é obrigatório (mínimo 10 caracteres).")
    if body.relatorio_problema and not body.relatorio_problema_desc:
        raise HTTPException(status_code=400, detail="Descreva o problema identificado.")
    if body.relatorio_oportunidade and not body.relatorio_oport_desc:
        raise HTTPException(status_code=400, detail="Descreva a oportunidade identificada.")
    try:
        from app.services.visita_service import VisitaService
        from sqlalchemy import text as sqlt
        visita = await VisitaService.checkout(
            db, visita_id, current_user.id,
            body.lat, body.lng, body.observacoes
        )
        # Salvar relatório
        await db.execute(sqlt("""
            UPDATE visitas SET
                relatorio_tipo           = :tipo,
                relatorio_resumo         = :resumo,
                relatorio_problema       = :prob,
                relatorio_problema_desc  = :prob_desc,
                relatorio_oportunidade   = :oport,
                relatorio_oport_desc     = :oport_desc,
                relatorio_proximo_passo  = :proximo,
                proxima_visita_prevista  = :proxima_data
            WHERE id = :id
        """), {
            "tipo": body.relatorio_tipo,
            "resumo": body.relatorio_resumo,
            "prob": body.relatorio_problema,
            "prob_desc": body.relatorio_problema_desc,
            "oport": body.relatorio_oportunidade,
            "oport_desc": body.relatorio_oport_desc,
            "proximo": body.relatorio_proximo_passo,
            "proxima_data": None,
            "id": str(visita_id),
        })
        await db.commit()
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
    vendedor_id: Optional[str] = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.agenda_service import AgendaService
    from sqlalchemy import text as sqlt
    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)

    # CS pode ver agenda de qualquer ESN sob seu GSN
    if papel == "CS" and vendedor_id:
        uid = UUID(vendedor_id)
    else:
        uid = current_user.id

    agenda = await AgendaService.buscar_agenda_do_dia(db, uid, date.today())
    if not agenda:
        return {"agenda": None}

    # Buscar nome dos clientes
    cliente_ids = [str(i.cliente_id) for i in agenda.itens]
    clientes = {}
    if cliente_ids:
        res = await db.execute(sqlt(
            f"SELECT id, razao_social, municipio FROM clientes WHERE id IN ({','.join([chr(39)+c+chr(39) for c in cliente_ids])})"
        ))
        for row in res.fetchall():
            clientes[str(row[0])] = {"razao_social": row[1], "municipio": row[2]}

    return {
        "agenda_id": str(agenda.id),
        "data": agenda.data,
        "agenda": {
            "itens": [
                {
                    "id": str(i.id),
                    "cliente_id": str(i.cliente_id),
                    "razao_social": clientes.get(str(i.cliente_id), {}).get("razao_social", ""),
                    "municipio": clientes.get(str(i.cliente_id), {}).get("municipio", ""),
                    "ordem": i.ordem,
                    "horario_previsto": i.horario_previsto,
                    "status": i.status,
                }
                for i in agenda.itens
            ]
        }
    }


@router.get("/agenda/esns", tags=["agenda"])
async def listar_esns_do_cs(
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """CS lista os ESNs sob seu GSN para gerenciar agendas."""
    from sqlalchemy import text as sqlt
    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    if papel not in ("CS", "GSN", "GESTOR_EMPRESA", "ADMIN"):
        raise HTTPException(status_code=403, detail="Sem permissão.")

    # Se GSN ou ADMIN/GESTOR — usa o próprio ID como GSN
    # Se CS — busca o GSN superior
    if papel == "CS":
        res_gsn = await db.execute(sqlt(
            "SELECT superior_id FROM hierarquia_vendas WHERE subordinado_id = :id LIMIT 1"
        ), {"id": str(current_user.id)})
        gsn_row = res_gsn.fetchone()
        gsn_id = str(gsn_row[0]) if gsn_row else str(current_user.id)
    else:
        gsn_id = str(current_user.id)

    # Buscar ESNs sob o GSN
    res = await db.execute(sqlt("""
        SELECT u.id, u.nome, u.codigo_externo, u.email, u.tipo_esn
        FROM usuarios u
        JOIN hierarquia_vendas hv ON hv.subordinado_id = u.id
        WHERE hv.superior_id = :gsn_id AND u.papel = 'ESN' AND u.ativo = true
        ORDER BY u.nome
    """), {"gsn_id": gsn_id})
    return [{"id": str(r[0]), "nome": r[1], "codigo_externo": r[2], "email": r[3], "tipo_esn": r[4] or "BASE"} for r in res.fetchall()]


@router.get("/visitas/historico", tags=["visitas"])
async def historico_visitas(
    vendedor_id: Optional[str] = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Histórico de visitas — ESN vê as suas, CS/GSN veem de seus ESNs."""
    from sqlalchemy import text as sqlt
    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)

    if papel == "ESN":
        where = "WHERE v.vendedor_id = :uid AND v.status != 'EM_ANDAMENTO'"
        params = {"uid": str(current_user.id)}
    elif vendedor_id:
        where = "WHERE v.vendedor_id = :uid AND v.status != 'EM_ANDAMENTO'"
        params = {"uid": vendedor_id}
    else:
        where = "WHERE v.status != 'EM_ANDAMENTO'"
        params = {}

    res = await db.execute(sqlt(f"""
        SELECT v.id, v.checkin_em, v.checkout_em, v.status,
               c.razao_social, c.municipio,
               u.nome as vendedor_nome,
               v.relatorio_tipo, v.relatorio_resumo,
               v.relatorio_problema, v.relatorio_problema_desc,
               v.relatorio_oportunidade, v.relatorio_oport_desc,
               v.relatorio_proximo_passo, v.proxima_visita_prevista,
               v.distancia_checkin_metros
        FROM visitas v
        JOIN clientes c ON c.id = v.cliente_id
        JOIN usuarios u ON u.id = v.vendedor_id
        {where}
        ORDER BY v.checkin_em DESC
        LIMIT 100
    """), params)

    rows = res.fetchall()
    return [
        {
            "id": str(r[0]),
            "checkin_em": str(r[1]) if r[1] else None,
            "checkout_em": str(r[2]) if r[2] else None,
            "status": r[3],
            "cliente": r[4],
            "municipio": r[5],
            "vendedor": r[6],
            "relatorio_tipo": r[7],
            "relatorio_resumo": r[8],
            "relatorio_problema": bool(r[9]),
            "relatorio_problema_desc": r[10],
            "relatorio_oportunidade": bool(r[11]),
            "relatorio_oport_desc": r[12],
            "relatorio_proximo_passo": r[13],
            "proxima_visita_prevista": str(r[14]) if r[14] else None,
            "distancia_metros": r[15],
            "duracao_minutos": int((r[2]-r[1]).total_seconds()/60) if r[1] and r[2] else None,
        }
        for r in rows
    ]

# ─────────────────────────────────────────────
# Ciclo de visitas / Agenda automática
# ─────────────────────────────────────────────

@router.get("/agenda/parametros", tags=["agenda"])
async def get_parametros_visita(
    esn_id: Optional[str] = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retorna parâmetros de visita efetivos para um ESN."""
    from app.services.ciclo_service import get_parametros
    from sqlalchemy import text as sqlt

    uid = esn_id or str(current_user.id)

    # Buscar GSN e org do ESN
    res = await db.execute(sqlt("""
        SELECT hv.superior_id, u.organizacao_id
        FROM hierarquia_vendas hv
        JOIN usuarios u ON u.id = hv.subordinado_id
        WHERE hv.subordinado_id = :uid LIMIT 1
    """), {"uid": uid})
    row = res.fetchone()
    gsn_id = str(row[0]) if row else uid
    org_id = str(row[1]) if row else uid

    params = await get_parametros(db, uid, gsn_id, org_id)
    return params


@router.post("/agenda/parametros", tags=["agenda"])
async def salvar_parametros_visita(
    body: dict,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Salva parâmetros de visita para um escopo específico."""
    from sqlalchemy import text as sqlt
    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    if papel not in ("ADMIN", "GESTOR_EMPRESA", "GSN", "CS"):
        raise HTTPException(status_code=403, detail="Sem permissão.")

    escopo = {}
    if body.get("esn_id"):    escopo["esn_id"] = body["esn_id"]
    elif body.get("gsn_id"):  escopo["gsn_id"] = body["gsn_id"]
    elif body.get("org_id"):  escopo["organizacao_id"] = body["org_id"]

    await db.execute(sqlt("""
        INSERT INTO parametros_visita
            (freq_a_dias, freq_b_dias, freq_c_dias, ciclo_dias, visitas_dia_max, horizonte_dias,
             organizacao_id, gsn_id, esn_id)
        VALUES (:a, :b, :c, :ciclo, :max_dia, :horizonte, :org, :gsn, :esn)
    """), {
        "a": body.get("freq_a_dias", 15),
        "b": body.get("freq_b_dias", 30),
        "c": body.get("freq_c_dias", 45),
        "ciclo": body.get("ciclo_dias", 45),
        "max_dia": body.get("visitas_dia_max", 4),
        "horizonte": body.get("horizonte_dias", 30),
        "org": escopo.get("organizacao_id"),
        "gsn": escopo.get("gsn_id"),
        "esn": escopo.get("esn_id"),
    })
    await db.commit()
    return {"ok": True}


@router.post("/agenda/gerar-ciclo", tags=["agenda"])
async def gerar_agenda_ciclo(
    body: dict,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Gera agenda automática para um ESN baseada no ciclo ABC.
    CS/GSN pode gerar para qualquer ESN sob sua hierarquia.
    """
    import uuid
    from app.services.ciclo_service import gerar_agenda_ciclo as _gerar
    from sqlalchemy import text as sqlt
    from datetime import date as _date

    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    esn_id = body.get("esn_id") or str(current_user.id)

    # Buscar GSN e org do ESN
    res = await db.execute(sqlt("""
        SELECT hv.superior_id, u.organizacao_id
        FROM hierarquia_vendas hv
        JOIN usuarios u ON u.id = hv.subordinado_id
        WHERE hv.subordinado_id = :uid LIMIT 1
    """), {"uid": esn_id})
    row = res.fetchone()
    gsn_id = str(row[0]) if row else esn_id
    org_id = str(row[1]) if row else esn_id

    data_inicio = _date.fromisoformat(body["data_inicio"]) if body.get("data_inicio") else _date.today()

    agenda_items = await _gerar(db, esn_id, gsn_id, org_id, "TO", data_inicio)

    if not agenda_items:
        return {"ok": True, "total": 0, "mensagem": "Nenhuma visita necessária no período."}

    # Criar agendas por dia
    criados = 0
    from app.services.agenda_service import AgendaService
    from collections import defaultdict

    # Converter datas para string nas keys
    por_dia = defaultdict(list)
    for item in agenda_items:
        item["data"] = str(item["data"])
        por_dia[item["data"]].append(item)

    for dia, itens in por_dia.items():
        # Verificar se já existe agenda para este ESN neste dia
        from datetime import date as _date2
        dia_obj = _date2.fromisoformat(str(dia)) if not isinstance(dia, _date2) else dia
        res_ag = await db.execute(sqlt(
            "SELECT id FROM agendas WHERE vendedor_id=:v AND data=:d"
        ), {"v": esn_id, "d": dia_obj})
        ag_row = res_ag.fetchone()

        if not ag_row:
            ag_id = str(uuid.uuid4())
            await db.execute(sqlt("""
                INSERT INTO agendas (id, vendedor_id, data, gerada_por, publicada, status)
                VALUES (:id, :v, :d, 'CICLO', false, 'PRE_AGENDA')
                ON CONFLICT (vendedor_id, data) DO NOTHING
            """), {"id": ag_id, "v": esn_id, "d": dia_obj})
            res_ag2 = await db.execute(sqlt(
                "SELECT id FROM agendas WHERE vendedor_id=:v AND data=:d"
            ), {"v": esn_id, "d": dia_obj})
            ag_row = res_ag2.fetchone()

        ag_id = str(ag_row[0])

        for item in itens:
            await db.execute(sqlt("""
                INSERT INTO agenda_itens (id, agenda_id, cliente_id, ordem, status, horario_previsto)
                VALUES (:id, :ag, :cli, :ord, 'PENDENTE', :h)
                ON CONFLICT (agenda_id, cliente_id) DO NOTHING
            """), {
                "id": str(uuid.uuid4()),
                "ag": ag_id,
                "cli": item["cliente_id"],
                "ord": item["ordem"],
                "h": item.get("horario"),
            })
            criados += 1

    await db.commit()
    return {"ok": True, "total": criados, "dias": len(por_dia)}


@router.get("/agenda/ciclo/preview", tags=["agenda"])
async def preview_agenda_ciclo(
    request: Request,
    esn_id: Optional[str] = None,
    data_inicio: Optional[str] = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Preview da agenda gerada sem salvar."""
    from app.services.ciclo_service import gerar_agenda_ciclo as _gerar
    from sqlalchemy import text as sqlt
    from datetime import date as _date

    uid = esn_id or str(current_user.id)
    res = await db.execute(sqlt("""
        SELECT hv.superior_id, u.organizacao_id
        FROM hierarquia_vendas hv
        JOIN usuarios u ON u.id = hv.subordinado_id
        WHERE hv.subordinado_id = :uid LIMIT 1
    """), {"uid": uid})
    row = res.fetchone()
    gsn_id = str(row[0]) if row else uid
    org_id = str(row[1]) if row else uid

    data_inicio = _date.fromisoformat(request.query_params.get("data_inicio", str(_date.today()))) if hasattr(request, "query_params") else _date.today()

    items = await _gerar(db, uid, gsn_id, org_id, "TO", data_inicio)

    # Converter datas para string
    for item in items:
        item["data"] = str(item["data"])

    return {"total": len(items), "items": items}


@router.get("/agenda/justificativas", tags=["agenda"])
async def listar_justificativas(
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text as sqlt
    res = await db.execute(sqlt("SELECT id, texto FROM justificativas_agenda WHERE ativo=true ORDER BY texto"))
    return [{"id": str(r[0]), "texto": r[1]} for r in res.fetchall()]


@router.get("/feriados", tags=["agenda"])
async def listar_feriados(
    uf: Optional[str] = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text as sqlt
    where = "WHERE data >= CURRENT_DATE"
    params = {}
    if uf:
        where += " AND (uf IS NULL OR uf = :uf)"
        params["uf"] = uf.upper()
    res = await db.execute(sqlt(f"SELECT data, nome, uf FROM feriados {where} ORDER BY data"), params)
    return [{"data": str(r[0]), "nome": r[1], "uf": r[2]} for r in res.fetchall()]


# ─────────────────────────────────────────────
# Gestão de Agendas (CS/GSN)
# ─────────────────────────────────────────────

@router.delete("/agenda/pre-agenda", tags=["agenda"])
async def excluir_pre_agenda(
    esn_id: str,
    mes: int,
    ano: int,
    request: Request = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Exclui todas as pré-agendas (rascunhos) de um ESN em um mês/ano."""
    from sqlalchemy import text as sqlt
    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    if papel not in ("ADMIN", "GESTOR_EMPRESA", "CS", "GSN"):
        raise HTTPException(status_code=403, detail="Sem permissão.")

    # Buscar agendas rascunho do ESN no período
    res = await db.execute(sqlt("""
        SELECT id FROM agendas
        WHERE vendedor_id = :esn_id
          AND EXTRACT(MONTH FROM data) = :mes
          AND EXTRACT(YEAR FROM data) = :ano
          AND (publicada = false OR publicada IS NULL)
          AND (status IN ('RASCUNHO', 'PRE_AGENDA') OR status IS NULL)
    """), {"esn_id": esn_id, "mes": mes, "ano": ano})
    ids = [str(r[0]) for r in res.fetchall()]

    if not ids:
        return {"ok": True, "deletados": 0, "mensagem": "Nenhuma pré-agenda encontrada."}

    # Deletar itens e agendas
    placeholders = ",".join([f"'{i}'" for i in ids])
    await db.execute(sqlt(f"DELETE FROM agenda_itens WHERE agenda_id IN ({placeholders})"))
    await db.execute(sqlt(f"DELETE FROM agendas WHERE id IN ({placeholders})"))
    await db.commit()

    await registrar_audit(db, "DELETE",
        usuario_id=str(current_user.id), usuario_nome=current_user.nome, usuario_email=current_user.email,
        entidade="agendas", entidade_id=esn_id,
        descricao=f"Pré-agendas excluídas: {len(ids)} dias em {mes}/{ano} do ESN {esn_id}",
        ip=request.client.host if request else None,
    )
    return {"ok": True, "deletados": len(ids)}


@router.get("/agenda/lista", tags=["agenda"])
async def listar_agendas(
    esn_id: Optional[str] = None,
    mes: Optional[int] = None,
    ano: Optional[int] = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista agendas por ESN com contagem de itens."""
    from sqlalchemy import text as sqlt
    from datetime import date as _date

    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    hoje = _date.today()
    mes_filtro = mes or hoje.month
    ano_filtro = ano or hoje.year

    where = ["EXTRACT(MONTH FROM a.data) = :mes", "EXTRACT(YEAR FROM a.data) = :ano"]
    params = {"mes": mes_filtro, "ano": ano_filtro}

    if esn_id:
        where.append("a.vendedor_id = :esn_id")
        params["esn_id"] = esn_id
    elif papel == "ESN":
        where.append("a.vendedor_id = :esn_id")
        params["esn_id"] = str(current_user.id)
    elif papel in ("CS", "GSN"):
        # Ver agendas dos ESNs da hierarquia
        where.append("""a.vendedor_id IN (
            SELECT hv.subordinado_id FROM hierarquia_vendas hv
            WHERE hv.superior_id = :sup_id
        )""")
        params["sup_id"] = str(current_user.id)

    where_sql = "WHERE " + " AND ".join(where)

    res = await db.execute(sqlt(f"""
        SELECT a.id, a.vendedor_id, a.data, a.status, a.publicada,
               a.gerada_por, a.publicada_em,
               u.nome as vendedor_nome, u.codigo_externo,
               COUNT(ai.id) as total_itens,
               SUM(CASE WHEN ai.status = 'CONCLUIDO' THEN 1 ELSE 0 END) as concluidos,
               MIN(ai.horario_previsto) as primeiro_horario
        FROM agendas a
        JOIN usuarios u ON u.id = a.vendedor_id
        LEFT JOIN agenda_itens ai ON ai.agenda_id = a.id AND ai.status != 'CANCELADO'
        {where_sql}
        GROUP BY a.id, a.vendedor_id, a.data, a.status, a.publicada,
                 a.gerada_por, a.publicada_em, u.nome, u.codigo_externo
        ORDER BY a.data
    """), params)

    rows = res.fetchall()
    agenda_ids = [str(r[0]) for r in rows]

    # Buscar resumo dos itens (horario + cliente) para exibir na grade
    itens_resumo: dict = {}
    if agenda_ids:
        placeholders = ",".join([f"'{i}'" for i in agenda_ids])
        res_itens = await db.execute(sqlt(f"""
            SELECT ai.agenda_id, ai.horario_previsto, c.razao_social
            FROM agenda_itens ai
            JOIN clientes c ON c.id = ai.cliente_id
            WHERE ai.agenda_id IN ({placeholders})
              AND ai.status != 'CANCELADO'
            ORDER BY ai.agenda_id, ai.horario_previsto
        """))
        for ri in res_itens.fetchall():
            aid = str(ri[0])
            if aid not in itens_resumo:
                itens_resumo[aid] = []
            itens_resumo[aid].append({
                "horario": ri[1] or "",
                "razao_social": ri[2] or "",
            })

    return [
        {
            "id": str(r[0]), "vendedor_id": str(r[1]), "data": str(r[2]),
            "status": r[3] or "RASCUNHO", "publicada": bool(r[4]),
            "gerada_por": r[5], "publicada_em": str(r[6]) if r[6] else None,
            "vendedor_nome": r[7], "codigo_externo": r[8],
            "total_itens": int(r[9] or 0), "concluidos": int(r[10] or 0),
            "primeiro_horario": r[11] or None,
            "itens_resumo": itens_resumo.get(str(r[0]), []),
        }
        for r in rows
    ]


@router.get("/agenda/{agenda_id}/itens", tags=["agenda"])
async def listar_itens_agenda(
    agenda_id: UUID,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista itens de uma agenda específica com dados do cliente."""
    from sqlalchemy import text as sqlt
    res = await db.execute(sqlt("""
        SELECT ai.id, ai.cliente_id, ai.ordem, ai.status,
               ai.horario_previsto, ai.observacoes,
               c.razao_social, c.municipio, c.uf,
               c.classificacao_abc, c.lat, c.lng,
               COALESCE(ai.publicado, false) as publicado
        FROM agenda_itens ai
        JOIN clientes c ON c.id = ai.cliente_id
        WHERE ai.agenda_id = :ag_id
        ORDER BY ai.ordem
    """), {"ag_id": str(agenda_id)})
    rows = res.fetchall()
    return [
        {
            "id": str(r[0]), "cliente_id": str(r[1]), "ordem": r[2],
            "status": r[3], "horario_previsto": r[4], "observacoes": r[5],
            "razao_social": r[6], "municipio": r[7], "uf": r[8],
            "classificacao_abc": r[9], "lat": r[10], "lng": r[11],
            "publicado": bool(r[12]),
        }
        for r in rows
    ]


@router.post("/agenda/publicar-tudo", tags=["agenda"])
async def publicar_todas_agendas(
    body: dict,
    request: Request = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Publica todas as pré-agendas de um ESN em um mês/ano, sugerindo horários automaticamente."""
    from sqlalchemy import text as sqlt
    from datetime import datetime, time, timedelta as tdelta
    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    if papel not in ("ADMIN", "GESTOR_EMPRESA", "CS", "GSN"):
        raise HTTPException(status_code=403, detail="Sem permissão para publicar.")

    esn_id = body.get("esn_id")
    mes = body.get("mes")
    ano = body.get("ano")
    if not esn_id or not mes or not ano:
        raise HTTPException(status_code=400, detail="esn_id, mes e ano são obrigatórios.")

    # Buscar parâmetros da organização
    res_org = await db.execute(sqlt("""
        SELECT u.organizacao_id FROM usuarios u WHERE u.id = :id
    """), {"id": esn_id})
    org_row = res_org.fetchone()
    org_id = str(org_row[0]) if org_row else None

    from app.services.ciclo_service import get_expediente as _get_exp
    duracao_min = 45
    intervalo_min = 15
    expediente_org = {}
    if org_id:
        res_p = await db.execute(sqlt("""
            SELECT duracao_padrao_min, intervalo_entre_visitas_min
            FROM parametros_organizacao WHERE organizacao_id = :org LIMIT 1
        """), {"org": org_id})
        p_row = res_p.fetchone()
        if p_row:
            duracao_min = int(p_row[0]) if p_row[0] else 45
            intervalo_min = int(p_row[1]) if p_row[1] else 15
        expediente_org = await _get_exp(db, org_id)

    # Buscar pré-agendas do ESN no mês
    res = await db.execute(sqlt("""
        SELECT id FROM agendas
        WHERE vendedor_id = :esn_id
          AND EXTRACT(MONTH FROM data) = :mes
          AND EXTRACT(YEAR FROM data) = :ano
          AND (publicada = false OR publicada IS NULL)
          AND (status IN ('PRE_AGENDA', 'RASCUNHO') OR status IS NULL)
        ORDER BY data
    """), {"esn_id": esn_id, "mes": mes, "ano": ano})
    agenda_ids = [str(r[0]) for r in res.fetchall()]

    if not agenda_ids:
        return {"ok": True, "publicadas": 0, "mensagem": "Nenhuma pré-agenda encontrada."}

    from app.services.ciclo_service import _slots_disponiveis

    for ag_id in agenda_ids:
        # Buscar dia da agenda para saber o expediente
        res_dia = await db.execute(sqlt("SELECT data FROM agendas WHERE id = :id"), {"id": ag_id})
        dia_row = res_dia.fetchone()
        slots = []
        if dia_row and expediente_org:
            from datetime import date as _date2
            dia_data = dia_row[0] if isinstance(dia_row[0], _date2) else _date2.fromisoformat(str(dia_row[0]))
            dia_semana = dia_data.isoweekday() % 7
            exp_dia = expediente_org.get(dia_semana, {})
            slots = _slots_disponiveis(exp_dia, duracao_min, intervalo_min)

        res_itens = await db.execute(sqlt("""
            SELECT id, ordem FROM agenda_itens
            WHERE agenda_id = :ag_id AND status != 'CANCELADO'
            ORDER BY ordem
        """), {"ag_id": ag_id})
        itens = res_itens.fetchall()

        for i, item in enumerate(itens):
            horario = slots[i] if i < len(slots) else None
            if horario:
                await db.execute(sqlt("""
                    UPDATE agenda_itens SET horario_previsto = :h
                    WHERE id = :id AND (horario_previsto IS NULL OR horario_previsto = '')
                """), {"h": horario, "id": str(item[0])})

        # Publicar a agenda
        await db.execute(sqlt("""
            UPDATE agendas SET
                publicada = true,
                status = 'PUBLICADA',
                publicada_em = NOW(),
                publicada_por = :pub_por
            WHERE id = :id
        """), {"id": ag_id, "pub_por": str(current_user.id)})

    await db.commit()
    await registrar_audit(db, "UPDATE",
        usuario_id=str(current_user.id), usuario_nome=current_user.nome, usuario_email=current_user.email,
        entidade="agendas", entidade_id=esn_id,
        descricao=f"Todas pré-agendas publicadas: {len(agenda_ids)} dias em {mes}/{ano}",
        ip=request.client.host if request else None,
    )
    return {"ok": True, "publicadas": len(agenda_ids)}


# 2. Endpoint para atualizar horário de um item
@router.put("/agenda/{agenda_id}/itens/{item_id}/horario", tags=["agenda"])
async def atualizar_horario_item(
    agenda_id: UUID,
    item_id: UUID,
    body: dict,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text as sqlt
    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    if papel not in ("ADMIN", "GESTOR_EMPRESA", "CS", "GSN"):
        raise HTTPException(status_code=403, detail="Sem permissão.")
    await db.execute(sqlt("""
        UPDATE agenda_itens SET horario_previsto = :h
        WHERE id = :id AND agenda_id = :ag_id
    """), {"h": body.get("horario"), "id": str(item_id), "ag_id": str(agenda_id)})
    await db.commit()
    return {"ok": True}


@router.post("/agenda/{agenda_id}/publicar-itens", tags=["agenda"])
async def publicar_itens_seletivos(
    agenda_id: UUID,
    body: dict,
    request: Request = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """CS/GSN publica itens específicos de uma agenda com horários definidos."""
    from sqlalchemy import text as sqlt
    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    if papel not in ("ADMIN", "GESTOR_EMPRESA", "CS", "GSN"):
        raise HTTPException(status_code=403, detail="Sem permissão para publicar.")

    item_ids = body.get("item_ids", [])
    horarios = body.get("horarios", {})  # {item_id: "HH:MM"}

    if not item_ids:
        raise HTTPException(status_code=400, detail="Nenhum item selecionado.")

    # Atualizar cada item selecionado
    for item_id in item_ids:
        params = {"id": item_id, "ag_id": str(agenda_id), "pub_por": str(current_user.id)}
        h = horarios.get(item_id)
        if h:
            await db.execute(sqlt("""
                UPDATE agenda_itens SET publicado = true, horario_previsto = :h
                WHERE id = :id AND agenda_id = :ag_id
            """), {**params, "h": h})
        else:
            await db.execute(sqlt("""
                UPDATE agenda_itens SET publicado = true
                WHERE id = :id AND agenda_id = :ag_id
            """), params)

    # Se todos os itens ativos estão publicados, publicar a agenda também
    res = await db.execute(sqlt("""
        SELECT COUNT(*) FILTER (WHERE status != 'CANCELADO' AND publicado = false) as pendentes
        FROM agenda_itens WHERE agenda_id = :ag_id
    """), {"ag_id": str(agenda_id)})
    pendentes = res.fetchone()[0]

    if pendentes == 0:
        await db.execute(sqlt("""
            UPDATE agendas SET publicada = true, status = 'PUBLICADA',
                publicada_em = NOW(), publicada_por = :pub_por
            WHERE id = :id
        """), {"id": str(agenda_id), "pub_por": str(current_user.id)})
    else:
        # Publicação parcial — manter como PRE_AGENDA mas sinalizar
        await db.execute(sqlt("""
            UPDATE agendas SET status = 'PUBLICADA', publicada = true,
                publicada_em = NOW(), publicada_por = :pub_por
            WHERE id = :id
        """), {"id": str(agenda_id), "pub_por": str(current_user.id)})

    await db.commit()
    await registrar_audit(db, "UPDATE",
        usuario_id=str(current_user.id), usuario_nome=current_user.nome, usuario_email=current_user.email,
        entidade="agendas", entidade_id=str(agenda_id),
        descricao=f"Publicação seletiva: {len(item_ids)} itens publicados",
        ip=request.client.host if request else None,
    )
    return {"ok": True, "publicados": len(item_ids)}


@router.get("/agenda/{agenda_id}/parametros-horario", tags=["agenda"])
async def get_parametros_horario(
    agenda_id: UUID,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retorna parâmetros de horário para sugestão automática."""
    from sqlalchemy import text as sqlt
    res = await db.execute(sqlt("""
        SELECT p.horario_inicio::text, p.duracao_padrao_min, p.intervalo_entre_visitas_min
        FROM agendas a
        JOIN usuarios u ON u.id = a.vendedor_id
        JOIN parametros_organizacao p ON p.organizacao_id = u.organizacao_id
        WHERE a.id = :ag_id LIMIT 1
    """), {"ag_id": str(agenda_id)})
    row = res.fetchone()
    if row:
        return {
            "horario_inicio": str(row[0])[:5] if row[0] else "08:00",
            "duracao_min": int(row[1]) if row[1] else 45,
            "intervalo_min": int(row[2]) if row[2] else 15,
        }
    return {"horario_inicio": "08:00", "duracao_min": 45, "intervalo_min": 15}


@router.post("/agenda/{agenda_id}/publicar", tags=["agenda"])
async def publicar_agenda(
    agenda_id: UUID,
    request: Request = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """CS/GSN publica uma agenda — ESN passa a visualizar."""
    from sqlalchemy import text as sqlt
    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    if papel not in ("ADMIN", "GESTOR_EMPRESA", "CS", "GSN"):
        raise HTTPException(status_code=403, detail="Sem permissão para publicar.")

    await db.execute(sqlt("""
        UPDATE agendas SET
            publicada = true,
            status = 'PUBLICADA',
            publicada_em = NOW(),
            publicada_por = :pub_por
        WHERE id = :id
    """), {"id": str(agenda_id), "pub_por": str(current_user.id)})
    await db.commit()

    await registrar_audit(db, "UPDATE",
        usuario_id=str(current_user.id), usuario_nome=current_user.nome, usuario_email=current_user.email,
        entidade="agendas", entidade_id=str(agenda_id),
        descricao=f"Agenda publicada pelo {papel}",
        ip=request.client.host if request else None,
    )
    return {"ok": True, "mensagem": "Agenda publicada com sucesso."}


@router.delete("/agenda/{agenda_id}/itens/{item_id}", tags=["agenda"])
async def remover_item_agenda(
    agenda_id: UUID,
    item_id: UUID,
    body: dict = {},
    request: Request = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """CS/GSN remove um item da agenda (com justificativa)."""
    from sqlalchemy import text as sqlt
    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    if papel not in ("ADMIN", "GESTOR_EMPRESA", "CS", "GSN"):
        raise HTTPException(status_code=403, detail="Sem permissão.")

    await db.execute(sqlt("""
        UPDATE agenda_itens SET
            status = 'CANCELADO',
            justificativa_ajuste = :just,
            ajustado_por = :por
        WHERE id = :id AND agenda_id = :ag_id
    """), {
        "id": str(item_id), "ag_id": str(agenda_id),
        "just": body.get("justificativa"), "por": str(current_user.id),
    })
    await db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────
# Expediente Semanal
# ─────────────────────────────────────────────

DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"]

@router.get("/expediente", tags=["parametros"])
async def get_expediente(
    org_id: Optional[str] = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text as sqlt
    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    oid = org_id if papel == "ADMIN" and org_id else str(current_user.organizacao_id) if current_user.organizacao_id else None
    if not oid:
        raise HTTPException(status_code=400, detail="Organização não encontrada.")

    res = await db.execute(sqlt("""
        SELECT dia_semana, ativo, 
               manha_inicio::text, manha_fim::text,
               tarde_inicio::text, tarde_fim::text
        FROM expediente_semanal
        WHERE organizacao_id = :org
        ORDER BY dia_semana
    """), {"org": oid})
    rows = res.fetchall()
    return [
        {
            "dia_semana": r[0],
            "dia_nome": DIAS_SEMANA[r[0]],
            "ativo": bool(r[1]),
            "manha_inicio": str(r[2])[:5] if r[2] else "08:00",
            "manha_fim": str(r[3])[:5] if r[3] else "12:00",
            "tarde_inicio": str(r[4])[:5] if r[4] else "14:00",
            "tarde_fim": str(r[5])[:5] if r[5] else "18:00",
        }
        for r in rows
    ]


@router.put("/expediente", tags=["parametros"])
async def salvar_expediente(
    body: dict,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text as sqlt
    from datetime import time as time_type
    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    if papel not in ("ADMIN", "GESTOR_EMPRESA"):
        raise HTTPException(status_code=403, detail="Sem permissão.")

    org_id = str(current_user.organizacao_id) if current_user.organizacao_id else None
    if not org_id:
        raise HTTPException(status_code=400, detail="Organização não encontrada.")

    dias = body.get("dias", [])
    for dia in dias:
        def to_time(s: str):
            h, m = map(int, (s or "08:00").split(":"))
            return time_type(h, m)

        await db.execute(sqlt("""
            INSERT INTO expediente_semanal 
                (organizacao_id, dia_semana, ativo, manha_inicio, manha_fim, tarde_inicio, tarde_fim)
            VALUES (:org, :dia, :ativo, :mi, :mf, :ti, :tf)
            ON CONFLICT (organizacao_id, dia_semana) DO UPDATE SET
                ativo = EXCLUDED.ativo,
                manha_inicio = EXCLUDED.manha_inicio,
                manha_fim = EXCLUDED.manha_fim,
                tarde_inicio = EXCLUDED.tarde_inicio,
                tarde_fim = EXCLUDED.tarde_fim
        """), {
            "org": org_id,
            "dia": int(dia["dia_semana"]),
            "ativo": bool(dia.get("ativo", True)),
            "mi": to_time(dia.get("manha_inicio", "08:00")),
            "mf": to_time(dia.get("manha_fim", "12:00")),
            "ti": to_time(dia.get("tarde_inicio", "14:00")),
            "tf": to_time(dia.get("tarde_fim", "18:00")),
        })

    await db.commit()
    return {"ok": True, "mensagem": "Expediente salvo com sucesso."}


# ─────────────────────────────────────────────
# Cadastros Auxiliares
# ─────────────────────────────────────────────

CADASTROS_CONFIG = {
    "objetivos_visita":          {"tabela": "objetivos_visita",          "nome": "Objetivo de visita"},
    "tipos_resultado_visita":    {"tabela": "tipos_resultado_visita",     "nome": "Tipo de resultado"},
    "acoes_proximo_passo":       {"tabela": "acoes_proximo_passo",        "nome": "Ação de próximo passo"},
    "departamentos":             {"tabela": "departamentos",              "nome": "Departamento"},
    "tipos_contato":             {"tabela": "tipos_contato",              "nome": "Tipo de contato"},
    "justificativas_agenda":     {"tabela": "justificativas_agenda",      "nome": "Justificativa de agenda"},
    "motivos_cancelamento":      {"tabela": "motivos_cancelamento",       "nome": "Motivo de cancelamento"},
    "feriados":                  {"tabela": "feriados",                   "nome": "Feriado"},
}

PAPEIS_CADASTROS = ("ADMIN", "GESTOR_EMPRESA", "CS")


@router.get("/cadastros/{entidade}", tags=["cadastros"])
async def listar_cadastro(
    entidade: str,
    apenas_ativos: bool = True,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if entidade not in CADASTROS_CONFIG:
        raise HTTPException(status_code=404, detail="Cadastro não encontrado.")
    from sqlalchemy import text as sqlt
    tabela = CADASTROS_CONFIG[entidade]["tabela"]
    where = "WHERE ativo = true" if apenas_ativos else ""
    
    if entidade == "feriados":
        res = await db.execute(sqlt(f"""
            SELECT id, nome, dia, mes, ano, uf, municipio, tipo, ativo
            FROM {tabela} {where} ORDER BY mes, dia
        """))
        rows = res.fetchall()
        return [{"id": str(r[0]), "nome": r[1], "dia": r[2], "mes": r[3], "ano": r[4],
                 "uf": r[5], "municipio": r[6], "tipo": r[7], "ativo": bool(r[8])} for r in rows]
    
    cols = "id, nome, ativo, ordem"
    if entidade == "tipos_resultado_visita":
        cols = "id, nome, icone, ativo, ordem"
    
    res = await db.execute(sqlt(f"SELECT {cols} FROM {tabela} {where} ORDER BY ordem, nome"))
    rows = res.fetchall()
    
    if entidade == "tipos_resultado_visita":
        return [{"id": str(r[0]), "nome": r[1], "icone": r[2], "ativo": bool(r[3]), "ordem": r[4]} for r in rows]
    return [{"id": str(r[0]), "nome": r[1], "ativo": bool(r[2]), "ordem": r[3]} for r in rows]


@router.post("/cadastros/{entidade}", tags=["cadastros"])
async def criar_cadastro(
    entidade: str,
    body: dict,
    request: Request = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    if papel not in PAPEIS_CADASTROS:
        raise HTTPException(status_code=403, detail="Sem permissão.")
    if entidade not in CADASTROS_CONFIG:
        raise HTTPException(status_code=404, detail="Cadastro não encontrado.")
    from sqlalchemy import text as sqlt
    import uuid as uuid_mod
    tabela = CADASTROS_CONFIG[entidade]["tabela"]
    nome_entidade = CADASTROS_CONFIG[entidade]["nome"]
    uid = str(uuid_mod.uuid4())
    nome = body.get("nome", "").strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Nome é obrigatório.")
    
    if entidade == "feriados":
        dia = body.get("dia")
        mes = body.get("mes")
        if not dia or not mes:
            raise HTTPException(status_code=400, detail="Dia e mês são obrigatórios.")
        await db.execute(sqlt(f"""
            INSERT INTO {tabela} (id, nome, descricao, dia, mes, ano, uf, municipio, tipo)
            VALUES (:id, :nome, :descricao, :dia, :mes, :ano, :uf, :municipio, :tipo)
        """), {"id": uid, "nome": nome, "descricao": nome,
               "dia": int(dia), "mes": int(mes), "ano": body.get("ano") or None,
               "uf": body.get("uf") or None, "municipio": body.get("municipio") or None,
               "tipo": body.get("tipo", "MUNICIPAL")})
    else:
        icone_col = ", icone" if entidade == "tipos_resultado_visita" else ""
        icone_val = ", :icone" if entidade == "tipos_resultado_visita" else ""
        params = {"id": uid, "nome": nome, "ordem": body.get("ordem", 0)}
        if entidade == "tipos_resultado_visita":
            params["icone"] = body.get("icone", "📋")
        await db.execute(sqlt(f"""
            INSERT INTO {tabela} (id, nome{icone_col}, ordem)
            VALUES (:id, :nome{icone_val}, :ordem)
        """), params)
    
    await db.commit()
    await registrar_audit(db, "CREATE",
        usuario_id=str(current_user.id), usuario_nome=current_user.nome, usuario_email=current_user.email,
        entidade=entidade, entidade_id=uid,
        descricao=f"{nome_entidade} criado: {nome}",
        valor_novo=body,
        ip=request.client.host if request else None,
    )
    return {"id": uid, "mensagem": f"{nome_entidade} criado com sucesso."}


@router.put("/cadastros/{entidade}/{item_id}", tags=["cadastros"])
async def editar_cadastro(
    entidade: str,
    item_id: UUID,
    body: dict,
    request: Request = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    if papel not in PAPEIS_CADASTROS:
        raise HTTPException(status_code=403, detail="Sem permissão.")
    if entidade not in CADASTROS_CONFIG:
        raise HTTPException(status_code=404, detail="Cadastro não encontrado.")
    from sqlalchemy import text as sqlt
    tabela = CADASTROS_CONFIG[entidade]["tabela"]
    nome_entidade = CADASTROS_CONFIG[entidade]["nome"]

    # Capturar antes
    res = await db.execute(sqlt(f"SELECT nome FROM {tabela} WHERE id = :id"), {"id": str(item_id)})
    row = res.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Registro não encontrado.")
    antes = {"nome": row[0]}

    updates = []
    params = {"id": str(item_id)}
    if "nome" in body: updates.append("nome = :nome"); params["nome"] = body["nome"]
    if "ordem" in body: updates.append("ordem = :ordem"); params["ordem"] = body["ordem"]
    if "ativo" in body: updates.append("ativo = :ativo"); params["ativo"] = body["ativo"]
    if "icone" in body and entidade == "tipos_resultado_visita":
        updates.append("icone = :icone"); params["icone"] = body["icone"]
    if entidade == "feriados":
        if "dia" in body: updates.append("dia = :dia"); params["dia"] = int(body["dia"])
        if "mes" in body: updates.append("mes = :mes"); params["mes"] = int(body["mes"])
        if "ano" in body: updates.append("ano = :ano"); params["ano"] = body["ano"] or None
        if "uf" in body: updates.append("uf = :uf"); params["uf"] = body["uf"] or None
        if "municipio" in body: updates.append("municipio = :municipio"); params["municipio"] = body["municipio"] or None
        if "tipo" in body: updates.append("tipo = :tipo"); params["tipo"] = body["tipo"]
    if not updates:
        raise HTTPException(status_code=400, detail="Nenhum campo para atualizar.")
    
    await db.execute(sqlt(f"UPDATE {tabela} SET {', '.join(updates)} WHERE id = :id"), params)
    await db.commit()
    await registrar_audit(db, "UPDATE",
        usuario_id=str(current_user.id), usuario_nome=current_user.nome, usuario_email=current_user.email,
        entidade=entidade, entidade_id=str(item_id),
        descricao=f"{nome_entidade} atualizado: {antes['nome']}",
        valor_anterior=antes, valor_novo=body,
        ip=request.client.host if request else None,
    )
    return {"ok": True}


@router.delete("/cadastros/{entidade}/{item_id}", tags=["cadastros"])
async def excluir_cadastro(
    entidade: str,
    item_id: UUID,
    request: Request = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    if papel not in ("ADMIN", "GESTOR_EMPRESA"):
        raise HTTPException(status_code=403, detail="Sem permissão.")
    if entidade not in CADASTROS_CONFIG:
        raise HTTPException(status_code=404, detail="Cadastro não encontrado.")
    from sqlalchemy import text as sqlt
    tabela = CADASTROS_CONFIG[entidade]["tabela"]
    nome_entidade = CADASTROS_CONFIG[entidade]["nome"]

    res = await db.execute(sqlt(f"SELECT nome FROM {tabela} WHERE id = :id"), {"id": str(item_id)})
    row = res.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Registro não encontrado.")
    
    # Soft delete — apenas desativa
    await db.execute(sqlt(f"UPDATE {tabela} SET ativo = false WHERE id = :id"), {"id": str(item_id)})
    await db.commit()
    await registrar_audit(db, "DELETE",
        usuario_id=str(current_user.id), usuario_nome=current_user.nome, usuario_email=current_user.email,
        entidade=entidade, entidade_id=str(item_id),
        descricao=f"{nome_entidade} desativado: {row[0]}",
        valor_anterior={"nome": row[0], "ativo": True}, valor_novo={"ativo": False},
        ip=request.client.host if request else None,
    )
    return {"ok": True}


# ─────────────────────────────────────────────
# Contatos de Clientes
# ─────────────────────────────────────────────

@router.get("/clientes/{cliente_id}/contatos", tags=["contatos"])
async def listar_contatos_cliente(
    cliente_id: UUID,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text as sqlt
    res = await db.execute(sqlt("""
        SELECT c.id, c.nome, c.cargo, c.telefone, c.email, c.observacoes,
               cc.departamento, cc.tipo, cc.principal, cc.ativo, cc.id as vinculo_id
        FROM contatos c
        JOIN contatos_clientes cc ON cc.contato_id = c.id
        WHERE cc.cliente_id = :cid AND cc.ativo = true
        ORDER BY cc.principal DESC, c.nome
    """), {"cid": str(cliente_id)})
    rows = res.fetchall()
    return [
        {
            "id": str(r[0]), "nome": r[1], "cargo": r[2],
            "telefone": r[3], "email": r[4], "observacoes": r[5],
            "departamento": r[6], "tipo": r[7],
            "principal": bool(r[8]), "ativo": bool(r[9]),
            "vinculo_id": str(r[10]),
        }
        for r in rows
    ]


@router.post("/clientes/{cliente_id}/contatos", tags=["contatos"])
async def criar_contato_cliente(
    cliente_id: UUID,
    body: dict,
    request: Request = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text as sqlt
    import uuid as uuid_mod
    nome = body.get("nome", "").strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Nome é obrigatório.")

    # Verificar se é vínculo de contato existente
    contato_id = body.get("contato_id")
    if not contato_id:
        # Criar novo contato
        contato_id = str(uuid_mod.uuid4())
        await db.execute(sqlt("""
            INSERT INTO contatos (id, nome, cargo, telefone, email, observacoes)
            VALUES (:id, :nome, :cargo, :tel, :email, :obs)
        """), {
            "id": contato_id, "nome": nome,
            "cargo": body.get("cargo", ""),
            "tel": body.get("telefone", "") or None,
            "email": body.get("email", "") or None,
            "obs": body.get("observacoes", "") or None,
        })

    # Criar vínculo
    vinculo_id = str(uuid_mod.uuid4())
    await db.execute(sqlt("""
        INSERT INTO contatos_clientes (id, contato_id, cliente_id, departamento, tipo, principal)
        VALUES (:id, :cid, :clid, :dept, :tipo, :principal)
        ON CONFLICT (contato_id, cliente_id) DO UPDATE SET
            departamento = EXCLUDED.departamento,
            tipo = EXCLUDED.tipo,
            principal = EXCLUDED.principal,
            ativo = true
    """), {
        "id": vinculo_id, "cid": contato_id, "clid": str(cliente_id),
        "dept": body.get("departamento") or None,
        "tipo": body.get("tipo", "OUTRO"),
        "principal": bool(body.get("principal", False)),
    })

    # Se marcado como principal, desmarcar outros
    if body.get("principal"):
        await db.execute(sqlt("""
            UPDATE contatos_clientes SET principal = false
            WHERE cliente_id = :clid AND contato_id != :cid
        """), {"clid": str(cliente_id), "cid": contato_id})

    await db.commit()
    await registrar_audit(db, "CREATE",
        usuario_id=str(current_user.id), usuario_nome=current_user.nome, usuario_email=current_user.email,
        entidade="contatos", entidade_id=contato_id,
        descricao=f"Contato criado/vinculado: {nome} ao cliente {cliente_id}",
        valor_novo={"nome": nome, "departamento": body.get("departamento"), "tipo": body.get("tipo")},
        ip=request.client.host if request else None,
    )
    return {"id": contato_id, "vinculo_id": vinculo_id, "mensagem": "Contato criado com sucesso."}


@router.put("/clientes/{cliente_id}/contatos/{contato_id}", tags=["contatos"])
async def editar_contato_cliente(
    cliente_id: UUID,
    contato_id: UUID,
    body: dict,
    request: Request = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text as sqlt
    # Atualizar dados do contato
    updates_c = []
    params_c = {"id": str(contato_id)}
    if "nome" in body:        updates_c.append("nome = :nome");        params_c["nome"]  = body["nome"]
    if "cargo" in body:       updates_c.append("cargo = :cargo");      params_c["cargo"] = body["cargo"]
    if "telefone" in body:    updates_c.append("telefone = :tel");     params_c["tel"]   = body["telefone"] or None
    if "email" in body:       updates_c.append("email = :email");      params_c["email"] = body["email"] or None
    if "observacoes" in body: updates_c.append("observacoes = :obs");  params_c["obs"]   = body["observacoes"] or None
    if updates_c:
        await db.execute(sqlt(f"UPDATE contatos SET {', '.join(updates_c)} WHERE id = :id"), params_c)

    # Atualizar vínculo
    updates_v = []
    params_v = {"cid": str(contato_id), "clid": str(cliente_id)}
    if "departamento" in body: updates_v.append("departamento = :dept");      params_v["dept"]      = body["departamento"] or None
    if "tipo" in body:         updates_v.append("tipo = :tipo");              params_v["tipo"]      = body["tipo"]
    if "principal" in body:    updates_v.append("principal = :principal");    params_v["principal"] = bool(body["principal"])
    if updates_v:
        await db.execute(sqlt(f"UPDATE contatos_clientes SET {', '.join(updates_v)} WHERE contato_id = :cid AND cliente_id = :clid"), params_v)
        if body.get("principal"):
            await db.execute(sqlt("UPDATE contatos_clientes SET principal = false WHERE cliente_id = :clid AND contato_id != :cid"), params_v)

    await db.commit()
    await registrar_audit(db, "UPDATE",
        usuario_id=str(current_user.id), usuario_nome=current_user.nome, usuario_email=current_user.email,
        entidade="contatos", entidade_id=str(contato_id),
        descricao=f"Contato atualizado: {body.get('nome', str(contato_id))}",
        valor_novo=body,
        ip=request.client.host if request else None,
    )
    return {"ok": True}


@router.delete("/clientes/{cliente_id}/contatos/{contato_id}", tags=["contatos"])
async def remover_contato_cliente(
    cliente_id: UUID,
    contato_id: UUID,
    request: Request = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text as sqlt
    await db.execute(sqlt("""
        UPDATE contatos_clientes SET ativo = false
        WHERE contato_id = :cid AND cliente_id = :clid
    """), {"cid": str(contato_id), "clid": str(cliente_id)})
    await db.commit()
    await registrar_audit(db, "DELETE",
        usuario_id=str(current_user.id), usuario_nome=current_user.nome, usuario_email=current_user.email,
        entidade="contatos", entidade_id=str(contato_id),
        descricao=f"Contato desvinculado do cliente {cliente_id}",
        ip=request.client.host if request else None,
    )
    return {"ok": True}


@router.get("/contatos/buscar", tags=["contatos"])
async def buscar_contatos(
    q: str = "",
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Busca contatos globais para vincular a um cliente."""
    from sqlalchemy import text as sqlt
    if len(q) < 2:
        return []
    res = await db.execute(sqlt("""
        SELECT id, nome, cargo, email, telefone FROM contatos
        WHERE nome ILIKE :q OR email ILIKE :q
        ORDER BY nome LIMIT 10
    """), {"q": f"%{q}%"})
    rows = res.fetchall()
    return [{"id": str(r[0]), "nome": r[1], "cargo": r[2], "email": r[3], "telefone": r[4]} for r in rows]


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
                ON CONFLICT (email) DO UPDATE SET
                    telefone = COALESCE(EXCLUDED.telefone, usuarios.telefone),
                    nome = COALESCE(EXCLUDED.nome, usuarios.nome)
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
                new_prop_id = str(uuid_mod.uuid4())
                await db.execute(sqlt("""
                    INSERT INTO propostas_contrato (id,contrato_id,numero_proposta,planilha_financeira,data_assinatura,modalidade,valor_total,valor_recorrente)
                    VALUES (:i,:c,:n,:p,:d,:m,0,0)
                    ON CONFLICT DO NOTHING
                """), {"i":new_prop_id,"c":ct_id_real,"n":num_prop,"p":plan_fin,"d":data_ass_cont,"m":_nulo(row.get("Modalidade de Vendas",""))})
                await db.flush()

            res_prop = await db.execute(sqlt("SELECT id FROM propostas_contrato WHERE contrato_id=:c AND numero_proposta=:n"), {"c":ct_id_real,"n":num_prop})
            prop_row = res_prop.fetchone()
            if not prop_row: continue
            prop_id_real = str(prop_row[0])
            propostas_ids[(ct_id_real, num_prop)] = prop_id_real

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
            """), {"i":str(uuid_mod.uuid4()),"p":prop_id_real,"c":ct_id_real,"cp":cod_prod,"dp":desc_prod,"q":qtd,"vu":val_unit,"vt":val_tot,"r":rec_item,"sc":st_cancel,"si":st_item,"di":data_item})

        # Recalcular data das propostas baseado no item mais antigo
        await db.execute(sqlt("""
            UPDATE propostas_contrato p SET data_assinatura = sub.data_min
            FROM (
                SELECT proposta_id, MIN(data_assinatura_item) as data_min
                FROM itens_contrato
                WHERE data_assinatura_item IS NOT NULL
                GROUP BY proposta_id
            ) sub
            WHERE p.id = sub.proposta_id
        """))

        # Recalcular valor_recorrente das propostas
        # MRR exclui apenas: CANCELADO e GRATUITO e TROCADO
        # PROGRAMADO (aviso prévio) ainda é cobrado — inclui no MRR
        await db.execute(sqlt("""
            UPDATE propostas_contrato p SET valor_recorrente = COALESCE(sub.mrr, 0)
            FROM (
                SELECT proposta_id,
                       SUM(valor_total) FILTER (
                           WHERE recorrente = true
                           AND COALESCE(status_cancelamento, '') NOT IN ('CANCELADO')
                           AND COALESCE(status_item, 'ATIVO') NOT IN ('CANCELADO', 'GRATUITO', 'TROCADO')
                       ) as mrr
                FROM itens_contrato
                GROUP BY proposta_id
            ) sub
            WHERE p.id = sub.proposta_id
        """))

        # Recalcular valor_mensal dos contratos ATIVOS
        await db.execute(sqlt("""
            UPDATE contratos c SET valor_mensal = COALESCE(sub.mrr, 0)
            FROM (
                SELECT p.contrato_id, SUM(p.valor_recorrente) as mrr
                FROM propostas_contrato p
                GROUP BY p.contrato_id
            ) sub
            WHERE c.id = sub.contrato_id
            AND c.status = 'ATIVO'
        """))

        # Recalcular classificação ABC dos clientes
        await db.execute(sqlt("""
            UPDATE clientes c SET classificacao_abc =
                CASE
                    WHEN COALESCE(ct.mrr,0) >= COALESCE((SELECT mrr_cliente_a FROM parametros_organizacao LIMIT 1),5000) THEN 'A'
                    WHEN COALESCE(ct.mrr,0) >= COALESCE((SELECT mrr_cliente_b FROM parametros_organizacao LIMIT 1),1000) THEN 'B'
                    ELSE 'C'
                END
            FROM (
                SELECT cliente_id, SUM(valor_mensal) as mrr
                FROM contratos WHERE status='ATIVO'
                GROUP BY cliente_id
            ) ct
            WHERE c.id = ct.cliente_id
        """))

        # Recalcular clientes dormentes
        await db.execute(sqlt(f"""
            UPDATE clientes c SET dormente =
                CASE
                    WHEN ult.ultima_compra < CURRENT_DATE - INTERVAL '18 months' THEN true
                    ELSE false
                END
            FROM (
                SELECT ct.cliente_id, MAX(p.data_assinatura) as ultima_compra
                FROM propostas_contrato p
                JOIN contratos ct ON ct.id = p.contrato_id
                WHERE p.data_assinatura IS NOT NULL
                GROUP BY ct.cliente_id
            ) ult
            WHERE c.id = ult.cliente_id
        """))

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
        import traceback; open("/app/logs/import_error.txt","w").write(traceback.format_exc())
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
    res_p = await db.execute(text("""
        SELECT id, numero_proposta, planilha_financeira,
               data_assinatura, modalidade, valor_total, valor_recorrente
        FROM propostas_contrato
        WHERE contrato_id = :cid
        ORDER BY data_assinatura DESC NULLS LAST, valor_recorrente DESC
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
                   COALESCE(status_item, 'ATIVO') as status_item,
                   COALESCE(periodo_aviso_previo, 0) as periodo_aviso_previo,
                   inicio_aviso_previo,
                   fim_aviso_previo
            FROM itens_contrato
            WHERE proposta_id = :pid
            ORDER BY
                CASE COALESCE(status_item,'ATIVO')
                    WHEN 'CANCELADO' THEN 3
                    WHEN 'TROCADO'   THEN 2
                    ELSE 0
                END,
                CASE COALESCE(status_cancelamento,'')
                    WHEN 'CANCELADO'  THEN 3
                    WHEN 'PROGRAMADO' THEN 2
                    ELSE 0
                END,
                recorrente DESC,
                valor_total DESC
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
                    "quantidade": float(i[4]) if i[4] else 1,
                    "valor_unitario": float(i[5]) if i[5] else 0,
                    "valor_total": float(i[6]) if i[6] else 0,
                    "recorrente": bool(i[7]),
                    "cancelado":  i[10] == "CANCELADO",
                    "programado": i[10] == "PROGRAMADO",
                    "trocado":    i[12] == "TROCADO",
                    "gratuito":   i[12] == "GRATUITO",
                    "data_assinatura_item": str(i[11]) if i[11] else None,
                    "status_item": i[12] if i[12] else "ATIVO",
                    "status_cancelamento": i[10],
                    "periodo_aviso_previo": float(i[13]) if i[13] else 0,
                    "inicio_aviso_previo": i[14] if i[14] else None,
                    "fim_aviso_previo": i[15] if i[15] else None,
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
    org_id: Optional[str] = None,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text as sqlt
    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)

    # ADMIN pode consultar qualquer organização
    if papel == "ADMIN" and org_id:
        filtro_org = ":org_id"
        params = {"org_id": org_id}
    else:
        filtro_org = ":org_id"
        params = {"org_id": str(current_user.organizacao_id) if current_user.organizacao_id else None}

    if not params["org_id"]:
        return {
            "mrr_cliente_a": 5000.0, "mrr_cliente_b": 1000.0,
            "mrr_cliente_c": 100.0, "meses_dormente": 18,
            "visitas_por_dia_max": 8, "raio_checkin_metros": 300,
            "frequencia_padrao_dias": 30,
            "freq_a_dias": 15, "freq_b_dias": 30, "freq_c_dias": 45,
            "ciclo_dias": 45, "horizonte_dias": 30,
            "duracao_padrao_min": 45, "intervalo_min": 15,
        }

    res = await db.execute(sqlt("""
        SELECT
            COALESCE(mrr_cliente_a, 5000)        as mrr_cliente_a,
            COALESCE(mrr_cliente_b, 1000)        as mrr_cliente_b,
            COALESCE(mrr_cliente_c, 100)         as mrr_cliente_c,
            COALESCE(meses_dormente, 18)         as meses_dormente,
            COALESCE(visitas_por_dia_max, 4)     as visitas_por_dia_max,
            COALESCE(raio_checkin_metros, 300)   as raio_checkin_metros,
            COALESCE(frequencia_padrao_dias, 30) as frequencia_padrao_dias,
            COALESCE(freq_a_dias, 15)            as freq_a_dias,
            COALESCE(freq_b_dias, 30)            as freq_b_dias,
            COALESCE(freq_c_dias, 45)            as freq_c_dias,
            COALESCE(ciclo_dias, 45)             as ciclo_dias,
            COALESCE(horizonte_dias, 30)         as horizonte_dias,
            COALESCE(duracao_padrao_min, 45)     as duracao_padrao_min,
            COALESCE(intervalo_entre_visitas_min, 15) as intervalo_min,
            organizacao_id
        FROM parametros_organizacao
        WHERE organizacao_id = :org_id
        LIMIT 1
    """), params)
    row = res.fetchone()
    if not row:
        return {
            "mrr_cliente_a": 5000.0, "mrr_cliente_b": 1000.0,
            "mrr_cliente_c": 100.0, "meses_dormente": 18,
            "visitas_por_dia_max": 4, "raio_checkin_metros": 300,
            "frequencia_padrao_dias": 30,
            "freq_a_dias": 15, "freq_b_dias": 30, "freq_c_dias": 45,
            "ciclo_dias": 45, "horizonte_dias": 30,
            "duracao_padrao_min": 45, "intervalo_min": 15,
        }
    return {
        "mrr_cliente_a": float(row[0]),
        "mrr_cliente_b": float(row[1]),
        "mrr_cliente_c": float(row[2]),
        "meses_dormente": int(row[3]),
        "visitas_por_dia_max": int(row[4]),
        "raio_checkin_metros": int(row[5]),
        "frequencia_padrao_dias": int(row[6]),
        "freq_a_dias": int(row[7]),
        "freq_b_dias": int(row[8]),
        "freq_c_dias": int(row[9]),
        "ciclo_dias": int(row[10]),
        "horizonte_dias": int(row[11]),
        "duracao_padrao_min": int(row[12]) if row[12] else 45,
        "intervalo_min": int(row[13]) if row[13] else 15,
        "organizacao_id": str(row[14]) if row[14] else None,
    }

@router.put("/parametros", tags=["parametros"])
async def salvar_parametros(
    body: dict,
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    papel = current_user.papel.value if hasattr(current_user.papel, "value") else str(current_user.papel)
    if papel not in ("ADMIN", "GESTOR_EMPRESA"):
        raise HTTPException(status_code=403, detail="Sem permissão para alterar parâmetros.")

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
            duracao_padrao_min   = :dp,
            intervalo_entre_visitas_min = :iv,
            atualizado_em       = now()
        WHERE organizacao_id = :org_current
    """), {
        "a":  body.get("mrr_cliente_a", 5000),
        "b":  body.get("mrr_cliente_b", 1000),
        "c":  body.get("mrr_cliente_c", 100),
        "md": body.get("meses_dormente", 18),
        "vd": body.get("visitas_por_dia_max", 8),
        "rc": body.get("raio_checkin_metros", 300),
        "fp": body.get("frequencia_padrao_dias", 30),
        "dp": body.get("duracao_padrao_min", 45),
        "iv": body.get("intervalo_min", 15),
        "org_current": str(current_user.organizacao_id) if current_user.organizacao_id else None,
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
    selecao: str = Form(""),
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
            try:
                s = v.strip()
                # Remover qualquer caractere que nao seja digito, ponto ou virgula
                s = _re.sub(r"[^0-9.,]","",s)
                if not s: return 0.0
                if "," in s and "." in s:
                    # Formato: 1.000,00 ou 1,000.00
                    if s.index(",") > s.index("."):
                        # Virgula e decimal: 1.000,00
                        s = s.replace(".","").replace(",",".")
                    else:
                        # Ponto e decimal: 1,000.00
                        s = s.replace(",","")
                elif "," in s:
                    # So virgula: pode ser decimal BR (1,5) ou milhar (1,000)
                    parts = s.split(",")
                    if len(parts[-1]) == 3 and len(parts) == 2:
                        s = s.replace(",","")  # milhar
                    else:
                        s = s.replace(",",".")  # decimal
                elif s.count(".") > 1:
                    # Multiplos pontos: 1.000.00
                    parts = s.split(".")
                    s = "".join(parts[:-1]) + "." + parts[-1]
                return float(s or 0)
            except:
                import sys; print(f"_val ERRO: {repr(v)}", file=sys.stderr); return 0.0
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
                VALUES (:i,:o,:c,:n,:e,:h,:p,:t,true,true) ON CONFLICT (email) DO UPDATE SET telefone = COALESCE(EXCLUDED.telefone, usuarios.telefone), nome = COALESCE(EXCLUDED.nome, usuarios.nome)
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
        propostas_set = set(); propostas_ids = {}; contratos_ids = {}
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
            if not num_ct: continue
            if contratos_sel and num_ct not in contratos_sel: continue
            if clientes_sel and cod_cli not in clientes_sel: continue

            # Criar contrato uma única vez por número
            if num_ct not in contratos_set:
                contratos_set.add(num_ct)
                res_cli2 = await db.execute(sqlt("SELECT id FROM clientes WHERE codigo_externo=:c"), {"c":cod_cli})
                row_cli2 = res_cli2.fetchone()
                if not row_cli2: continue
                st = ct_status_final.get(num_ct, "PENDENTE")
                await db.execute(sqlt("""
                    INSERT INTO contratos (id,cliente_id,numero_contrato,status,recorrente,modalidade,unidade_venda)
                    VALUES (:i,:c,:n,:s,:r,:m,:u)
                    ON CONFLICT (numero_contrato) DO UPDATE SET status=EXCLUDED.status
                """), {"i":str(uuid_mod.uuid4()),"c":str(row_cli2[0]),"n":num_ct,"s":st,
                       "r":_bool(row["Recorrente"]),"m":_nulo(row["Modalidade de Vendas"]),
                       "u":_nulo(row.get("Nome Unidade de Venda",""))})
                contratos_criados+=1

            # Cache do ID real do contrato
            if num_ct not in contratos_ids:
                res_ct2 = await db.execute(sqlt("SELECT id FROM contratos WHERE numero_contrato=:n"), {"n":num_ct})
                ct_row2 = res_ct2.fetchone()
                if not ct_row2: continue
                contratos_ids[num_ct] = str(ct_row2[0])
            ct_id_real = contratos_ids[num_ct]

            # Criar proposta se não existir
            num_prop = _nulo(row.get("Número da Proposta","")) or num_ct
            prop_key = (ct_id_real, num_prop)
            if prop_key not in propostas_set:
                propostas_set.add(prop_key)
                await db.execute(sqlt("""
                    INSERT INTO propostas_contrato (id,contrato_id,numero_proposta,planilha_financeira,data_assinatura,modalidade,valor_total,valor_recorrente)
                    VALUES (:i,:c,:n,:p,:d,:m,0,0)
                    ON CONFLICT ON CONSTRAINT propostas_contrato_contrato_id_numero_proposta_key DO NOTHING
                """), {"i":str(uuid_mod.uuid4()),"c":ct_id_real,"n":num_prop,
                       "p":_nulo(row.get("Planilha Financeira no Contrato","")),
                       "d":_data(row.get("Data de Assinatura","")),
                       "m":_nulo(row.get("Modalidade de Vendas",""))})

            # Cache do ID real da proposta
            if prop_key not in propostas_ids:
                res_p2 = await db.execute(sqlt(
                    "SELECT id FROM propostas_contrato WHERE contrato_id=:c AND numero_proposta=:n"),
                    {"c":ct_id_real,"n":num_prop})
                p_row2 = res_p2.fetchone()
                if not p_row2: continue
                propostas_ids[prop_key] = str(p_row2[0])
            prop_id_real = propostas_ids[prop_key]

            # Inserir item — cada linha do CSV é um item
            data_ass_cont = _data(row.get("Data de Assinatura",""))
            # Parse aviso prévio
            def _mes_ano(v):
                if not v or v.strip() in ("-",""): return None
                v = v.strip()
                if len(v.split("/")) == 2: return v  # já é MM/YYYY, retornar como string
                return None

            await db.execute(sqlt("""
                INSERT INTO itens_contrato (id,proposta_id,contrato_id,codigo_produto,descricao_produto,
                    quantidade,valor_unitario,valor_total,recorrente,status_cancelamento,status_item,
                    data_assinatura_item,periodo_aviso_previo,inicio_aviso_previo,fim_aviso_previo)
                VALUES (:i,:p,:c,:cp,:dp,:q,:vu,:vt,:r,:sc,:si,:di,:apm,:iap,:fap)
            """), {"i":str(uuid_mod.uuid4()),"p":prop_id_real,"c":ct_id_real,
                   "cp":_nulo(row.get("Código do Produto","")),"dp":_nulo(row.get("Descrição do Produto","")),
                   "q":int(float(row.get("Quantidade do Item","1").replace(",",".") or 1)),
                   "vu":_val(row.get("Valor Unitário","")),"vt":_val(row.get("Valor Total do Contrato","")),
                   "r":_bool(row.get("Recorrente","NAO")),
                   "sc":_nulo(row.get("Status Cancelamento","")),
                   "si":row.get("Status do Contrato","").strip().upper(),
                   "di":_data(row.get("Data de Assinatura do Item","")) or data_ass_cont,
                   "apm": int(_val(row.get("Período do Aviso Prévio","0"))),
                   "iap": _mes_ano(row.get("Início Aviso Prévio","")),
                   "fap": _mes_ano(row.get("Final do Aviso Prévio (Cancelamento)",""))})

        # ── Recálculos pós-importação ─────────────────────────────────────

        # 1. Data da proposta = menor data_assinatura_item de seus itens
        await db.execute(sqlt("""
            UPDATE propostas_contrato p SET data_assinatura = sub.data_min
            FROM (
                SELECT proposta_id, MIN(data_assinatura_item) as data_min
                FROM itens_contrato
                WHERE data_assinatura_item IS NOT NULL
                GROUP BY proposta_id
            ) sub
            WHERE p.id = sub.proposta_id
        """))

        # 2. MRR por proposta — exclui CANCELADO e TROCADO, inclui GRATUITO e PROGRAMADO
        await db.execute(sqlt("""
            UPDATE propostas_contrato p SET valor_recorrente = COALESCE(sub.mrr, 0)
            FROM (
                SELECT proposta_id,
                       SUM(valor_total) FILTER (
                           WHERE recorrente = true
                           AND COALESCE(status_cancelamento,'') NOT IN ('CANCELADO')
                           AND COALESCE(status_item,'ATIVO') NOT IN ('CANCELADO','TROCADO')
                       ) as mrr
                FROM itens_contrato
                GROUP BY proposta_id
            ) sub
            WHERE p.id = sub.proposta_id
        """))

        # 3. valor_mensal dos contratos ATIVOS
        await db.execute(sqlt("""
            UPDATE contratos c SET valor_mensal = COALESCE(sub.mrr, 0)
            FROM (
                SELECT contrato_id, SUM(valor_recorrente) as mrr
                FROM propostas_contrato
                GROUP BY contrato_id
            ) sub
            WHERE c.id = sub.contrato_id
            AND c.status = 'ATIVO'
        """))

        # 4. Classificação ABC dos clientes
        await db.execute(sqlt("""
            UPDATE clientes c SET classificacao_abc =
                CASE
                    WHEN COALESCE(ct.mrr,0) >= COALESCE((SELECT mrr_cliente_a FROM parametros_organizacao LIMIT 1),5000) THEN 'A'
                    WHEN COALESCE(ct.mrr,0) >= COALESCE((SELECT mrr_cliente_b FROM parametros_organizacao LIMIT 1),1000) THEN 'B'
                    ELSE 'C'
                END
            FROM (
                SELECT cliente_id, SUM(valor_mensal) as mrr
                FROM contratos WHERE status='ATIVO'
                GROUP BY cliente_id
            ) ct
            WHERE c.id = ct.cliente_id
        """))

        # 5. Clientes dormentes — baseado na data da última proposta
        await db.execute(sqlt(f"""
            UPDATE clientes c SET dormente =
                CASE
                    WHEN ult.ultima_compra < CURRENT_DATE - INTERVAL '18 months' THEN true
                    ELSE false
                END
            FROM (
                SELECT ct.cliente_id, MAX(p.data_assinatura) as ultima_compra
                FROM propostas_contrato p
                JOIN contratos ct ON ct.id = p.contrato_id
                WHERE p.data_assinatura IS NOT NULL
                GROUP BY ct.cliente_id
            ) ult
            WHERE c.id = ult.cliente_id
        """))

        await db.commit()
        return {"sucesso":True,"organizacoes_criadas":org_criada,"usuarios_criados":usuarios_criados,"vinculos_criados":vinculos_criados,"clientes_criados":clientes_criados,"contratos_criados":contratos_criados,"avisos":avisos,"erros":erros}

    except HTTPException: raise
    except Exception as e:
        await db.rollback()
        import traceback; open("/app/logs/import_error.txt","w").write(traceback.format_exc())
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

    if current_user.papel not in ("ADMIN", PapelUsuario.GESTOR_EMPRESA):
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
    await registrar_audit(db, "CREATE",
        usuario_id=str(current_user.id), usuario_nome=current_user.nome, usuario_email=current_user.email,
        entidade="usuarios", entidade_id=uid,
        descricao=f"Usuário criado: {body.get('nome','')} ({body.get('papel','ESN')})",
        valor_novo={"nome": body.get("nome",""), "email": email, "papel": body.get("papel","ESN")},
    )
    return {"id": uid, "mensagem": "Usuário criado com sucesso."}


@router.post("/importacao/limpar", tags=["importacao"])
async def limpar_dados(
    current_user: Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.papel not in (PapelUsuario.GESTOR_EMPRESA, "ADMIN"):
        raise HTTPException(status_code=403, detail="Sem permissão.")
    from sqlalchemy import text as sqlt
    await db.execute(sqlt("""
        TRUNCATE TABLE itens_contrato, propostas_contrato, contratos, clientes
        RESTART IDENTITY CASCADE
    """))
    await db.commit()
    return {"ok": True, "mensagem": "Dados limpos com sucesso."}

app.include_router(router)
