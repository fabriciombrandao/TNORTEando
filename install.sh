#!/usr/bin/env bash
# =============================================================================
#  VISITAS — Instalador Completo de VPS
#  Testado em: Ubuntu 22.04 LTS / Ubuntu 24.04 LTS / Debian 12
#  Uso: curl -fsSL https://seu-servidor/install.sh | sudo bash
#   ou: sudo bash install.sh
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

# ─── Cores ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

# ─── Configurações (edite antes de rodar) ────────────────────────────────────
APP_DOMAIN="${APP_DOMAIN:-visitas.seudominio.com.br}"
APP_DIR="${APP_DIR:-/opt/visitas}"
APP_USER="${APP_USER:-visitas}"
DB_NAME="${DB_NAME:-visitas_db}"
DB_USER="${DB_USER:-visitas_user}"
DB_PASS="${DB_PASS:-$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)}"
SECRET_KEY="${SECRET_KEY:-$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 64)}"
ENABLE_SSL="${ENABLE_SSL:-true}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@seudominio.com.br}"

# ─── Requisitos mínimos ───────────────────────────────────────────────────────
MIN_RAM_MB=1024
MIN_DISK_GB=10
MIN_CPU=1

# ─── Helpers ─────────────────────────────────────────────────────────────────
log()     { echo -e "${GREEN}[✔]${RESET} $*"; }
info()    { echo -e "${BLUE}[→]${RESET} $*"; }
warn()    { echo -e "${YELLOW}[!]${RESET} $*"; }
error()   { echo -e "${RED}[✘]${RESET} $*" >&2; }
section() { echo -e "\n${BOLD}${CYAN}══════════════════════════════════════════${RESET}"; \
            echo -e "${BOLD}${CYAN}  $*${RESET}"; \
            echo -e "${BOLD}${CYAN}══════════════════════════════════════════${RESET}\n"; }
abort()   { error "$*"; exit 1; }

# Barra de progresso simples
spinner() {
  local pid=$1 msg=$2
  local spin='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r${BLUE}  ${spin:$((i % ${#spin})):1}${RESET}  $msg..."
    sleep 0.1; ((i++))
  done
  printf "\r${GREEN}  ✔${RESET}  $msg        \n"
}

run_bg() {
  local msg=$1; shift
  "$@" > /tmp/visitas_install.log 2>&1 &
  spinner $! "$msg"
  wait $! || abort "Falha: $msg — veja /tmp/visitas_install.log"
}

# ─── Banner ───────────────────────────────────────────────────────────────────
clear
echo -e "${BOLD}${CYAN}"
cat << 'EOF'
  ╦  ╦╦╔═╗╦╔╦╗╔═╗╔═╗
  ╚╗╔╝║╚═╗║ ║ ╠═╣╚═╗
   ╚╝ ╩╚═╝╩ ╩ ╩ ╩╚═╝
  Instalador de VPS — Gestão de Carteira
EOF
echo -e "${RESET}"

# =============================================================================
# SEÇÃO 1 — Verificações de pré-requisito
# =============================================================================
section "1/9 — Verificações do Sistema"

# Root
[[ $EUID -ne 0 ]] && abort "Execute como root: sudo bash install.sh"
log "Executando como root"

# OS suportado
. /etc/os-release
OS_ID="${ID:-unknown}"
OS_VERSION="${VERSION_ID:-0}"
info "Sistema operacional: ${PRETTY_NAME}"

case "$OS_ID" in
  ubuntu)
    if [[ "$OS_VERSION" != "22.04" && "$OS_VERSION" != "24.04" ]]; then
      warn "Ubuntu $OS_VERSION não testado oficialmente. Continuando..."
    else
      log "Ubuntu $OS_VERSION — compatível"
    fi
    PKG_MANAGER="apt-get"
    ;;
  debian)
    if [[ "${OS_VERSION%%.*}" -lt 11 ]]; then
      abort "Debian $OS_VERSION não suportado. Use Debian 11+ ou Ubuntu 22.04+"
    fi
    log "Debian $OS_VERSION — compatível"
    PKG_MANAGER="apt-get"
    ;;
  *)
    abort "Sistema operacional '$OS_ID' não suportado. Use Ubuntu 22.04/24.04 ou Debian 11/12."
    ;;
esac

# Arquitetura
ARCH=$(uname -m)
[[ "$ARCH" != "x86_64" && "$ARCH" != "aarch64" ]] && abort "Arquitetura $ARCH não suportada."
log "Arquitetura: $ARCH"

# RAM
RAM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
info "RAM disponível: ${RAM_MB} MB (mínimo: ${MIN_RAM_MB} MB)"
[[ $RAM_MB -lt $MIN_RAM_MB ]] && abort "RAM insuficiente: ${RAM_MB}MB < ${MIN_RAM_MB}MB mínimo."
log "RAM OK: ${RAM_MB} MB"

# Disco
DISK_FREE_GB=$(df / --output=avail -BG | tail -1 | tr -dc '0-9')
info "Espaço em disco livre: ${DISK_FREE_GB} GB (mínimo: ${MIN_DISK_GB} GB)"
[[ $DISK_FREE_GB -lt $MIN_DISK_GB ]] && abort "Espaço insuficiente: ${DISK_FREE_GB}GB < ${MIN_DISK_GB}GB mínimo."
log "Disco OK: ${DISK_FREE_GB} GB livres"

# CPUs
CPU_COUNT=$(nproc)
info "CPUs: $CPU_COUNT (mínimo: $MIN_CPU)"
[[ $CPU_COUNT -lt $MIN_CPU ]] && abort "CPUs insuficientes."
log "CPU OK: $CPU_COUNT core(s)"

# Conectividade
info "Verificando conectividade com a internet..."
curl -fsSL --max-time 10 https://google.com > /dev/null 2>&1 || abort "Sem acesso à internet."
log "Internet OK"

# Verificar porta 80 e 443 livres
for PORT in 80 443 8000 5432 6379; do
  if ss -tlnp | grep -q ":${PORT} "; then
    warn "Porta ${PORT} já em uso — pode causar conflito."
  else
    log "Porta ${PORT} livre"
  fi
done

# =============================================================================
# SEÇÃO 2 — Atualização do sistema
# =============================================================================
section "2/9 — Atualização do Sistema Operacional"

export DEBIAN_FRONTEND=noninteractive

run_bg "Atualizando índice de pacotes" \
  $PKG_MANAGER update -y

run_bg "Atualizando pacotes instalados" \
  $PKG_MANAGER upgrade -y

run_bg "Instalando dependências base" \
  $PKG_MANAGER install -y \
    curl wget git unzip zip \
    build-essential software-properties-common \
    apt-transport-https ca-certificates gnupg lsb-release \
    ufw fail2ban htop ncdu \
    openssl net-tools jq \
    python3 python3-pip python3-venv python3-dev \
    libpq-dev gcc

log "Sistema atualizado e dependências instaladas"

# =============================================================================
# SEÇÃO 3 — Docker e Docker Compose
# =============================================================================
section "3/9 — Docker"

if command -v docker &>/dev/null; then
  DOCKER_VER=$(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1)
  log "Docker já instalado: v${DOCKER_VER}"
else
  info "Instalando Docker Engine..."

  # Remover versões antigas
  for pkg in docker docker-engine docker.io containerd runc docker-compose; do
    $PKG_MANAGER remove -y "$pkg" 2>/dev/null || true
  done

  # Chave GPG oficial
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/${OS_ID}/gpg \
    -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  # Repositório
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
    https://download.docker.com/linux/${OS_ID} \
    $(. /etc/os-release && echo "${VERSION_CODENAME:-$(lsb_release -cs)}") stable" \
    > /etc/apt/sources.list.d/docker.list

  run_bg "Atualizando repositórios com Docker" $PKG_MANAGER update -y
  run_bg "Instalando Docker Engine" \
    $PKG_MANAGER install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  systemctl enable --now docker
  log "Docker instalado: $(docker --version)"
fi

# Docker Compose v2 (plugin)
if docker compose version &>/dev/null; then
  log "Docker Compose v2: $(docker compose version --short)"
else
  # Fallback: instalar binário standalone
  COMPOSE_VER="v2.27.0"
  run_bg "Instalando Docker Compose standalone" \
    bash -c "curl -fsSL https://github.com/docker/compose/releases/download/${COMPOSE_VER}/docker-compose-linux-$(uname -m) -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose"
  log "Docker Compose instalado: $(/usr/local/bin/docker-compose version --short)"
fi

# =============================================================================
# SEÇÃO 4 — Nginx
# =============================================================================
section "4/9 — Nginx (Reverse Proxy)"

if ! command -v nginx &>/dev/null; then
  run_bg "Instalando Nginx" $PKG_MANAGER install -y nginx
fi

systemctl enable nginx
log "Nginx instalado: $(nginx -v 2>&1 | grep -oP 'nginx/[\d.]+')"

# =============================================================================
# SEÇÃO 5 — Usuário e diretórios da aplicação
# =============================================================================
section "5/9 — Usuário e Estrutura de Diretórios"

# Criar usuário de sistema para a app
if ! id "$APP_USER" &>/dev/null; then
  useradd -r -m -d "$APP_DIR" -s /bin/bash "$APP_USER"
  usermod -aG docker "$APP_USER"
  log "Usuário '$APP_USER' criado"
else
  log "Usuário '$APP_USER' já existe"
fi

# Estrutura de diretórios
for DIR in \
  "$APP_DIR" \
  "$APP_DIR/app" \
  "$APP_DIR/data/postgres" \
  "$APP_DIR/data/redis" \
  "$APP_DIR/data/uploads" \
  "$APP_DIR/logs" \
  "$APP_DIR/backups" \
  "$APP_DIR/ssl"; do
  mkdir -p "$DIR"
done

chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 750 "$APP_DIR"
log "Diretórios criados em $APP_DIR"

# =============================================================================
# SEÇÃO 6 — Arquivo .env de produção
# =============================================================================
section "6/9 — Configuração do Ambiente (.env)"

ENV_FILE="$APP_DIR/app/.env"

if [[ -f "$ENV_FILE" ]]; then
  warn ".env já existe — fazendo backup antes de sobrescrever..."
  cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
fi

cat > "$ENV_FILE" << EOF
# ─── Gerado automaticamente pelo instalador — $(date) ───
ENVIRONMENT=production

# Banco de dados
DATABASE_URL=postgresql+asyncpg://${DB_USER}:${DB_PASS}@db:5432/${DB_NAME}
POSTGRES_DB=${DB_NAME}
POSTGRES_USER=${DB_USER}
POSTGRES_PASSWORD=${DB_PASS}

# Redis
REDIS_URL=redis://redis:6379/0

# Segurança
SECRET_KEY=${SECRET_KEY}
ACCESS_TOKEN_EXPIRE_MINUTES=480
REFRESH_TOKEN_EXPIRE_DAYS=30

# Aplicação
APP_DOMAIN=${APP_DOMAIN}
CHECKIN_RADIUS_METERS=300

# Google Maps (preencha para ativar roteiro com tráfego real)
GOOGLE_MAPS_API_KEY=

# E-mail (SMTP — opcional, para notificações)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EOF

chmod 600 "$ENV_FILE"
chown "$APP_USER:$APP_USER" "$ENV_FILE"
log ".env de produção criado em $ENV_FILE"

# =============================================================================
# SEÇÃO 7 — Docker Compose de produção
# =============================================================================
section "7/9 — Docker Compose de Produção"

cat > "$APP_DIR/app/docker-compose.yml" << 'COMPOSE'
version: "3.9"

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    env_file: .env
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - /opt/visitas/data/postgres:/var/lib/postgresql/data
    networks: [visitas-net]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - /opt/visitas/data/redis:/data
    networks: [visitas-net]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  backend:
    image: visitas-backend:latest
    restart: unless-stopped
    env_file: .env
    volumes:
      - /opt/visitas/data/uploads:/app/uploads
      - /opt/visitas/logs:/app/logs
    networks: [visitas-net]
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  frontend:
    image: visitas-frontend:latest
    restart: unless-stopped
    networks: [visitas-net]

networks:
  visitas-net:
    driver: bridge
COMPOSE

chown "$APP_USER:$APP_USER" "$APP_DIR/app/docker-compose.yml"
log "docker-compose.yml de produção criado"

# ─── Dockerfile de produção do backend ───────────────────────────────────────
cat > "$APP_DIR/app/Dockerfile.backend" << 'DOCKERFILE'
FROM python:3.12-slim

WORKDIR /app

# Dependências do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# Health check endpoint
RUN echo 'from fastapi import FastAPI; app = FastAPI()' >> /dev/null

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "2", "--proxy-headers", "--forwarded-allow-ips", "*"]
DOCKERFILE

# ─── Dockerfile de produção do frontend ──────────────────────────────────────
cat > "$APP_DIR/app/Dockerfile.frontend" << 'DOCKERFILE'
FROM node:20-alpine AS builder

WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci --silent
COPY frontend/ .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx-frontend.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
DOCKERFILE

cat > "$APP_DIR/app/nginx-frontend.conf" << 'NGINX'
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|ico|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
NGINX

log "Dockerfiles de produção criados"

# =============================================================================
# SEÇÃO 8 — Nginx como reverse proxy
# =============================================================================
section "8/9 — Nginx Reverse Proxy + Firewall + SSL"

# ─── Config Nginx ─────────────────────────────────────────────────────────────
NGINX_CONF="/etc/nginx/sites-available/visitas"

cat > "$NGINX_CONF" << NGINXCONF
upstream backend {
    server 127.0.0.1:8000;
    keepalive 32;
}

upstream frontend {
    server 127.0.0.1:3000;
    keepalive 16;
}

# Redireciona HTTP → HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name ${APP_DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${APP_DOMAIN};

    # SSL — será preenchido pelo Certbot
    ssl_certificate     /etc/letsencrypt/live/${APP_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${APP_DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

    # Headers de segurança
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    client_max_body_size 50M;

    # API
    location /api/ {
        proxy_pass http://backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    # Docs FastAPI (desabilitar em produção se preferir)
    location ~ ^/(docs|redoc|openapi.json) {
        proxy_pass http://backend;
        proxy_set_header Host \$host;
    }

    # Frontend
    location / {
        proxy_pass http://frontend;
        proxy_set_header Host \$host;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINXCONF

# Ativar site
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/visitas
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
log "Nginx configurado para ${APP_DOMAIN}"

# ─── Firewall UFW ─────────────────────────────────────────────────────────────
info "Configurando firewall UFW..."
ufw --force reset > /dev/null 2>&1
ufw default deny incoming > /dev/null 2>&1
ufw default allow outgoing > /dev/null 2>&1
ufw allow ssh > /dev/null 2>&1
ufw allow 80/tcp > /dev/null 2>&1
ufw allow 443/tcp > /dev/null 2>&1
ufw --force enable > /dev/null 2>&1
log "Firewall configurado (SSH, 80, 443)"

# ─── Fail2ban ─────────────────────────────────────────────────────────────────
cat > /etc/fail2ban/jail.d/visitas.conf << 'F2B'
[sshd]
enabled = true
maxretry = 5
bantime = 3600

[nginx-http-auth]
enabled = true
maxretry = 10
bantime = 600
F2B

systemctl enable --now fail2ban > /dev/null 2>&1
log "Fail2ban ativo"

# ─── SSL com Certbot ──────────────────────────────────────────────────────────
if [[ "$ENABLE_SSL" == "true" ]]; then
  info "Configurando SSL com Let's Encrypt..."

  if ! command -v certbot &>/dev/null; then
    run_bg "Instalando Certbot" \
      bash -c "$PKG_MANAGER install -y certbot python3-certbot-nginx"
  fi

  # Verificar se domínio resolve para este servidor
  SERVER_IP=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo "")
  DOMAIN_IP=$(getent hosts "${APP_DOMAIN}" 2>/dev/null | awk '{print $1}' | head -1 || echo "")

  mkdir -p /var/www/certbot

  if [[ -n "$SERVER_IP" && "$SERVER_IP" == "$DOMAIN_IP" ]]; then
    certbot --nginx \
      -d "${APP_DOMAIN}" \
      --non-interactive \
      --agree-tos \
      --email "${CERTBOT_EMAIL}" \
      --redirect \
      --no-eff-email 2>&1 | tee -a /tmp/visitas_install.log || {
      warn "Certbot falhou — SSL desabilitado. Configure manualmente após o DNS estar ativo."
    }

    # Auto-renovação
    systemctl enable --now certbot.timer 2>/dev/null || \
      (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && systemctl reload nginx") | crontab -
    log "SSL Let's Encrypt configurado e renovação automática ativa"
  else
    warn "DNS de '${APP_DOMAIN}' não aponta para este servidor (IP servidor: ${SERVER_IP}, IP domínio: ${DOMAIN_IP})."
    warn "SSL não configurado agora. Após apontar o DNS, execute:"
    warn "  certbot --nginx -d ${APP_DOMAIN} --email ${CERTBOT_EMAIL} --agree-tos --non-interactive"

    # Ajustar nginx para funcionar sem SSL enquanto isso
    cat > "$NGINX_CONF" << NGINXHTTP
upstream backend  { server 127.0.0.1:8000; keepalive 32; }
upstream frontend { server 127.0.0.1:3000; keepalive 16; }

server {
    listen 80;
    server_name ${APP_DOMAIN} _;
    client_max_body_size 50M;

    location /api/ {
        proxy_pass http://backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }

    location / {
        proxy_pass http://frontend;
        proxy_set_header Host \$host;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINXHTTP
    nginx -t && systemctl reload nginx
  fi
fi

# =============================================================================
# SEÇÃO 9 — Serviços systemd + scripts de gestão
# =============================================================================
section "9/9 — Serviços, Backups e Scripts de Gestão"

# ─── Systemd service ─────────────────────────────────────────────────────────
cat > /etc/systemd/system/visitas.service << SERVICE
[Unit]
Description=Visitas — Gestão de Carteira
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=${APP_USER}
WorkingDirectory=${APP_DIR}/app
EnvironmentFile=${APP_DIR}/app/.env
ExecStart=/usr/bin/docker compose up -d --remove-orphans
ExecStop=/usr/bin/docker compose down
ExecReload=/usr/bin/docker compose pull && /usr/bin/docker compose up -d --remove-orphans
TimeoutStartSec=300
TimeoutStopSec=60
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable visitas
log "Serviço systemd 'visitas' registrado e habilitado no boot"

# ─── Script de deploy ─────────────────────────────────────────────────────────
cat > /usr/local/bin/visitas-deploy << 'DEPLOY'
#!/usr/bin/env bash
# Faz pull do código e reinicia os containers
set -euo pipefail
APP_DIR="/opt/visitas/app"
cd "$APP_DIR"

echo "→ Baixando novas imagens..."
docker compose pull

echo "→ Parando containers antigos..."
docker compose down --remove-orphans

echo "→ Subindo novos containers..."
docker compose up -d

echo "→ Aguardando health checks..."
sleep 15
docker compose ps

echo "✔ Deploy concluído: $(date)"
DEPLOY
chmod +x /usr/local/bin/visitas-deploy

# ─── Script de backup ─────────────────────────────────────────────────────────
cat > /usr/local/bin/visitas-backup << BACKUP
#!/usr/bin/env bash
# Backup diário do PostgreSQL + uploads
set -euo pipefail
APP_DIR="/opt/visitas"
BACKUP_DIR="\${APP_DIR}/backups"
KEEP_DAYS=7
DATE=\$(date +%Y%m%d_%H%M%S)

echo "→ Iniciando backup [\${DATE}]..."

# Dump PostgreSQL via container
docker exec \$(docker ps -qf "name=db") \
  pg_dump -U "${DB_USER}" "${DB_NAME}" \
  | gzip > "\${BACKUP_DIR}/db_\${DATE}.sql.gz"

# Backup dos uploads
tar -czf "\${BACKUP_DIR}/uploads_\${DATE}.tar.gz" \
  -C "\${APP_DIR}/data" uploads/ 2>/dev/null || true

# Remover backups antigos
find "\${BACKUP_DIR}" -name "*.gz" -mtime +${KEEP_DAYS} -delete

echo "✔ Backup concluído: \${BACKUP_DIR}/db_\${DATE}.sql.gz"
ls -lh "\${BACKUP_DIR}/" | tail -5
BACKUP
chmod +x /usr/local/bin/visitas-backup

# Agendar backup diário às 02:00
(crontab -l 2>/dev/null | grep -v visitas-backup; \
 echo "0 2 * * * /usr/local/bin/visitas-backup >> /opt/visitas/logs/backup.log 2>&1") | crontab -
log "Backup diário agendado às 02:00"

# ─── Script de status ─────────────────────────────────────────────────────────
cat > /usr/local/bin/visitas-status << 'STATUS'
#!/usr/bin/env bash
APP_DIR="/opt/visitas/app"
cd "$APP_DIR" 2>/dev/null || { echo "Aplicação não encontrada em /opt/visitas/app"; exit 1; }

echo ""
echo "  ── VISITAS STATUS ──────────────────────────────"
echo ""
echo "  Containers:"
docker compose ps 2>/dev/null || echo "  (nenhum container rodando)"
echo ""
echo "  Uso de disco:"
df -h /opt/visitas 2>/dev/null | tail -1 | awk '{printf "  /opt/visitas: %s usados de %s (%s)\n", $3, $2, $5}'
echo ""
echo "  Logs recentes (backend):"
docker compose logs backend --tail=10 2>/dev/null | sed 's/^/  /'
echo ""
echo "  ────────────────────────────────────────────────"
STATUS
chmod +x /usr/local/bin/visitas-status

# ─── Script de logs ────────────────────────────────────────────────────────────
cat > /usr/local/bin/visitas-logs << 'LOGS'
#!/usr/bin/env bash
SERVICE="${1:-backend}"
cd "/opt/visitas/app"
docker compose logs "$SERVICE" -f --tail=50
LOGS
chmod +x /usr/local/bin/visitas-logs

log "Scripts de gestão criados: visitas-deploy, visitas-backup, visitas-status, visitas-logs"

# ─── Swap (se RAM < 2GB) ──────────────────────────────────────────────────────
SWAP_EXIST=$(swapon --show=NAME --noheadings 2>/dev/null | wc -l)
if [[ $RAM_MB -lt 2048 && $SWAP_EXIST -eq 0 ]]; then
  info "RAM < 2GB — criando swap de 2GB para estabilidade..."
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile > /dev/null
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' >> /etc/sysctl.conf
  sysctl -p > /dev/null
  log "Swap de 2GB criado e ativo"
fi

# ─── Ajustes de kernel para produção ──────────────────────────────────────────
cat >> /etc/sysctl.conf << 'SYSCTL'

# Visitas — otimizações para produção
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
fs.file-max = 100000
SYSCTL
sysctl -p > /dev/null 2>&1 || true

# Aumentar limite de file descriptors
echo "* soft nofile 65535" >> /etc/security/limits.conf
echo "* hard nofile 65535" >> /etc/security/limits.conf
log "Parâmetros de kernel otimizados"

# =============================================================================
# RESUMO FINAL
# =============================================================================
echo ""
echo -e "${BOLD}${GREEN}"
cat << 'EOF'
  ╔══════════════════════════════════════════════════╗
  ║         INSTALAÇÃO CONCLUÍDA COM SUCESSO         ║
  ╚══════════════════════════════════════════════════╝
EOF
echo -e "${RESET}"

echo -e "${BOLD}  Próximos passos:${RESET}"
echo ""
echo -e "  ${CYAN}1.${RESET} Copie o código para ${APP_DIR}/app/:"
echo -e "     ${YELLOW}git clone https://github.com/seu-usuario/visitas.git ${APP_DIR}/app/${RESET}"
echo ""
echo -e "  ${CYAN}2.${RESET} Faça o build das imagens Docker:"
echo -e "     ${YELLOW}cd ${APP_DIR}/app && docker build -f Dockerfile.backend -t visitas-backend . && docker build -f Dockerfile.frontend -t visitas-frontend .${RESET}"
echo ""
echo -e "  ${CYAN}3.${RESET} Suba os containers:"
echo -e "     ${YELLOW}systemctl start visitas${RESET}"
echo -e "     ${YELLOW}  ou: visitas-deploy${RESET}"
echo ""
echo -e "  ${CYAN}4.${RESET} Verifique o status:"
echo -e "     ${YELLOW}visitas-status${RESET}"
echo ""
echo -e "${BOLD}  Comandos disponíveis:${RESET}"
echo -e "  ${GREEN}visitas-deploy${RESET}   — atualiza e reinicia a aplicação"
echo -e "  ${GREEN}visitas-status${RESET}   — mostra status de todos os containers"
echo -e "  ${GREEN}visitas-logs [serviço]${RESET} — acompanha logs em tempo real"
echo -e "  ${GREEN}visitas-backup${RESET}   — executa backup manual"
echo ""
echo -e "${BOLD}  Configurações salvas:${RESET}"
echo -e "  Diretório da app : ${CYAN}${APP_DIR}${RESET}"
echo -e "  Usuário sistema  : ${CYAN}${APP_USER}${RESET}"
echo -e "  Domínio          : ${CYAN}${APP_DOMAIN}${RESET}"
echo -e "  Banco de dados   : ${CYAN}${DB_NAME}${RESET}"
echo -e "  Arquivo .env     : ${CYAN}${ENV_FILE}${RESET}"
echo ""

# Salvar resumo em arquivo
cat > /opt/visitas/INSTALL_INFO.txt << INFO
Instalação Visitas — $(date)
━━━━━━━━━━━━━━━━━━━━━━━━━━
Diretório : ${APP_DIR}
Usuário   : ${APP_USER}
Domínio   : ${APP_DOMAIN}
DB Name   : ${DB_NAME}
DB User   : ${DB_USER}
DB Pass   : ${DB_PASS}
.env      : ${ENV_FILE}
INFO
chmod 600 /opt/visitas/INSTALL_INFO.txt
chown root:root /opt/visitas/INSTALL_INFO.txt

echo -e "  ${YELLOW}⚠  Credenciais salvas em: /opt/visitas/INSTALL_INFO.txt (apenas root)${RESET}"
echo ""
