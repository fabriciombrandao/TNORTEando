#!/usr/bin/env bash
# =============================================================================
#  TNORTEando — Wizard de Instalação e Gestão v3.0
#
#  Arquivo único. Zero configuração manual. Zero comandos extras.
#
#  Uso:
#    scp wizard.sh root@IP:/tmp/ && ssh root@IP "bash /tmp/wizard.sh"
#
#  Testado em: Ubuntu 22.04 / 24.04 LTS · Debian 11 / 12
# =============================================================================

set -uo pipefail

# ══════════════════════════════════════════════════════════════════════════════
# CORES
# ══════════════════════════════════════════════════════════════════════════════
R='\033[0;31m' G='\033[0;32m' Y='\033[1;33m' B='\033[0;34m'
C='\033[0;36m' W='\033[1;37m' D='\033[2m' BOLD='\033[1m' RESET='\033[0m'

COLS=$(tput cols 2>/dev/null || echo 80)

_cls()  { clear; }
_gap()  { echo ""; }
_line() { printf "${D}"; printf '%*s' "$COLS" '' | tr ' ' '-'; printf "${RESET}\n"; }
_ok()   { echo -e "  ${G}[OK]${RESET}  $*"; }
_info() { echo -e "  ${B}[->]${RESET}  $*"; }
_warn() { echo -e "  ${Y}[!]${RESET}   $*"; }
_err()  { echo -e "  ${R}[X]${RESET}   $*" >&2; }
_step() { echo -e "\n  ${BOLD}${C}=== $* ===${RESET}\n"; }

_spinner() {
  local pid=$1 msg=$2 i=0
  local sp='|/-\'
  tput civis 2>/dev/null || true
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  [${sp:$((i%4)):1}]  %-55s" "$msg"
    sleep 0.1; ((i++)) || true
  done
  tput cnorm 2>/dev/null || true
  wait "$pid"
  local rc=$?
  [[ $rc -eq 0 ]] && printf "\r  ${G}[OK]${RESET}  %-55s\n" "$msg" \
                  || printf "\r  ${R}[X]${RESET}   %-55s\n" "$msg (ver /opt/visitas/logs/wizard.log)"
  return $rc
}

_run() {
  local msg=$1; shift
  mkdir -p /opt/visitas/logs
  "$@" >> /opt/visitas/logs/wizard.log 2>&1 &
  _spinner $! "$msg"
}

_ask() {
  local var=$1 prompt=$2 default=${3:-}
  local hint=""
  [[ -n "$default" ]] && hint=" [${default}]"
  printf "  >> %s%s: " "$prompt" "$hint"
  read -r input
  [[ -z "$input" && -n "$default" ]] && input="$default"
  printf -v "$var" '%s' "$input"
}

_ask_secret() {
  local var=$1 prompt=$2
  printf "  >> %s: " "$prompt"
  read -rs input; echo ""
  printf -v "$var" '%s' "$input"
}

_ask_yn() {
  local prompt=$1 default=${2:-s}
  printf "  >> %s [S/n]: " "$prompt"
  read -r resp
  [[ -z "$resp" ]] && resp="$default"
  [[ "${resp,,}" == "s" || "${resp,,}" == "sim" || "${resp,,}" == "y" ]]
}

_press_enter() {
  printf "\n  Pressione ENTER para continuar..."
  read -r
}

# ══════════════════════════════════════════════════════════════════════════════
# ESTADO
# ══════════════════════════════════════════════════════════════════════════════
STATE_FILE="/opt/visitas/.wizard_state"
CFG_DOMAIN_PROD="" CFG_DOMAIN_TEST="" CFG_EMAIL=""
CFG_GIT_REPO="" CFG_GIT_BRANCH="main"
CFG_ENABLE_TEST="n"
CFG_GESTOR_EMAIL="admin@tnorte.com.br"
CFG_GESTOR_SENHA="Admin@123"

_save_state() {
  mkdir -p /opt/visitas
  cat > "$STATE_FILE" << EOF
CFG_DOMAIN_PROD="${CFG_DOMAIN_PROD}"
CFG_DOMAIN_TEST="${CFG_DOMAIN_TEST}"
CFG_EMAIL="${CFG_EMAIL}"
CFG_GIT_REPO="${CFG_GIT_REPO}"
CFG_GIT_BRANCH="${CFG_GIT_BRANCH}"
CFG_ENABLE_TEST="${CFG_ENABLE_TEST}"
CFG_GESTOR_EMAIL="${CFG_GESTOR_EMAIL}"
EOF
  chmod 600 "$STATE_FILE"
}

_load_state() {
  [[ -f "$STATE_FILE" ]] && source "$STATE_FILE" || true
}

# ══════════════════════════════════════════════════════════════════════════════
# BANNER
# ══════════════════════════════════════════════════════════════════════════════
_banner() {
  _cls
  echo -e "${BOLD}${C}"
  echo "  =================================================="
  echo "   TNORTEando - Gestao de Carteira  |  Wizard v3.0"
  echo "  =================================================="
  echo -e "${RESET}"
}

# ══════════════════════════════════════════════════════════════════════════════
# PASSO 1 — VERIFICAR SISTEMA
# ══════════════════════════════════════════════════════════════════════════════
_check_system() {
  _banner
  _step "Passo 1/6 — Verificando o servidor"

  [[ $EUID -ne 0 ]] && { _err "Execute como root: sudo bash wizard.sh"; exit 1; }
  _ok "Executando como root"

  . /etc/os-release
  [[ "$ID" != "ubuntu" && "$ID" != "debian" ]] && { _err "OS nao suportado: $ID"; exit 1; }
  _ok "Sistema: ${PRETTY_NAME}"

  local ram; ram=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
  [[ $ram -lt 512 ]] && { _err "RAM insuficiente: ${ram}MB"; exit 1; }
  _ok "RAM: ${ram}MB"

  local disk; disk=$(df / --output=avail -BG | tail -1 | tr -dc '0-9')
  [[ $disk -lt 5 ]] && { _err "Disco insuficiente: ${disk}GB"; exit 1; }
  _ok "Disco: ${disk}GB livres"

  # Testar internet em múltiplos hosts
  local inet=false
  for h in github.com cloudflare.com 1.1.1.1; do
    curl -fsSL --max-time 5 "https://${h}" > /dev/null 2>&1 && inet=true && break
    ping -c1 -W3 "$h" > /dev/null 2>&1 && inet=true && break
  done
  $inet && _ok "Internet OK" || { _err "Sem acesso a internet"; exit 1; }

  local pub_ip; pub_ip=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo "?")
  _info "IP publico: ${W}${pub_ip}${RESET}"

  _press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# PASSO 2 — CONFIGURAR
# ══════════════════════════════════════════════════════════════════════════════
_configure() {
  _banner
  _step "Passo 2/6 — Configuracoes do projeto"

  _info "Preencha os dados abaixo (ENTER = valor padrao)"
  _gap

  echo -e "  ${W}Dominio / IP de Producao${RESET}"
  _info "Use seu dominio (visitas.empresa.com.br) ou IP da VPS"
  _ask CFG_DOMAIN_PROD "Dominio ou IP de producao" "92.113.33.251"
  _gap

  echo -e "  ${W}Ambiente de Testes (opcional)${RESET}"
  if _ask_yn "Instalar ambiente de testes?"; then
    CFG_ENABLE_TEST="s"
    _ask CFG_DOMAIN_TEST "Dominio de testes" "test.${CFG_DOMAIN_PROD}"
  else
    CFG_ENABLE_TEST="n"
  fi
  _gap

  echo -e "  ${W}SSL / Let's Encrypt${RESET}"
  _ask CFG_EMAIL "E-mail para SSL" "admin@tnorte.com.br"
  _gap

  echo -e "  ${W}Repositorio Git${RESET}"
  _info "Use SSH: git@github.com:usuario/repo.git"
  _ask CFG_GIT_REPO "URL do repositorio (SSH)" "git@github.com:fabriciombrandao/TNORTEando.git"
  _ask CFG_GIT_BRANCH "Branch de producao" "main"
  _gap

  echo -e "  ${W}Usuario Gestor (administrador do sistema)${RESET}"
  _ask CFG_GESTOR_EMAIL "E-mail do gestor" "admin@tnorte.com.br"
  _ask_secret CFG_GESTOR_SENHA "Senha do gestor"
  _gap

  # Confirmar
  _line
  echo -e "  ${BOLD}Confirme as configuracoes:${RESET}"
  _line
  printf "  %-30s %s\n" "Dominio producao:"  "$CFG_DOMAIN_PROD"
  printf "  %-30s %s\n" "Ambiente testes:"   "$( [[ "$CFG_ENABLE_TEST" == "s" ]] && echo "$CFG_DOMAIN_TEST" || echo "nao ativado")"
  printf "  %-30s %s\n" "E-mail SSL:"        "$CFG_EMAIL"
  printf "  %-30s %s\n" "Repositorio Git:"   "$CFG_GIT_REPO ($CFG_GIT_BRANCH)"
  printf "  %-30s %s\n" "Gestor:"            "$CFG_GESTOR_EMAIL"
  _line
  _gap

  _ask_yn "Tudo certo, pode prosseguir?" || { _configure; return; }
  _save_state
}

# ══════════════════════════════════════════════════════════════════════════════
# PASSO 3 — INSTALAR DEPENDENCIAS
# ══════════════════════════════════════════════════════════════════════════════
_install_deps() {
  _banner
  _step "Passo 3/6 — Instalando dependencias do sistema"

  export DEBIAN_FRONTEND=noninteractive

  _run "Atualizando lista de pacotes"   apt-get update -y
  _run "Atualizando pacotes instalados" apt-get upgrade -y
  _run "Instalando ferramentas base"    apt-get install -y \
    curl wget git unzip openssl net-tools \
    ufw fail2ban python3 python3-pip gcc \
    apt-transport-https ca-certificates gnupg lsb-release

  # Docker
  if ! command -v docker &>/dev/null; then
    . /etc/os-release
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/${ID}/gpg" \
      -o /etc/apt/keyrings/docker.asc 2>/dev/null
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
      https://download.docker.com/linux/${ID} \
      $(. /etc/os-release && echo "${VERSION_CODENAME:-$(lsb_release -cs)}") stable" \
      > /etc/apt/sources.list.d/docker.list
    _run "Instalando Docker Engine" \
      bash -c "apt-get update -y && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
    systemctl enable --now docker >> /opt/visitas/logs/wizard.log 2>&1
    _ok "Docker instalado"
  else
    _ok "Docker ja instalado: $(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1)"
  fi

  # Nginx
  if ! command -v nginx &>/dev/null; then
    _run "Instalando Nginx" apt-get install -y nginx
    systemctl enable nginx >> /opt/visitas/logs/wizard.log 2>&1
  else
    _ok "Nginx ja instalado"
  fi

  # Certbot
  if ! command -v certbot &>/dev/null; then
    _run "Instalando Certbot" apt-get install -y certbot python3-certbot-nginx
  else
    _ok "Certbot ja instalado"
  fi

  # Usuário do sistema
  if ! id "visitas" &>/dev/null; then
    useradd -r -m -d /opt/visitas -s /bin/bash visitas
    usermod -aG docker visitas
    _ok "Usuario 'visitas' criado"
  fi

  # Diretórios
  mkdir -p /opt/visitas/{prod,test,backups,logs}
  mkdir -p /opt/visitas/prod/data/{postgres,redis,uploads}
  mkdir -p /opt/visitas/test/data/{postgres,redis,uploads}
  chown -R visitas:visitas /opt/visitas 2>/dev/null || true

  # Swap se RAM < 2GB
  local ram; ram=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
  if [[ $ram -lt 2048 ]] && ! swapon --show=NAME --noheadings 2>/dev/null | grep -q .; then
    fallocate -l 2G /swapfile && chmod 600 /swapfile
    mkswap /swapfile > /dev/null && swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    _ok "Swap 2GB criado"
  fi

  # Firewall
  ufw --force reset > /dev/null 2>&1
  ufw default deny incoming > /dev/null 2>&1
  ufw default allow outgoing > /dev/null 2>&1
  ufw allow ssh > /dev/null 2>&1
  ufw allow 80/tcp > /dev/null 2>&1
  ufw allow 443/tcp > /dev/null 2>&1
  ufw --force enable > /dev/null 2>&1
  _ok "Firewall configurado (SSH, 80, 443)"

  # Fail2ban
  cat > /etc/fail2ban/jail.d/visitas.conf << 'F2B'
[sshd]
enabled = true
maxretry = 5
bantime = 3600
F2B
  systemctl enable --now fail2ban >> /opt/visitas/logs/wizard.log 2>&1 || true
  _ok "Fail2ban ativo"

  _press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# PASSO 4 — CONFIGURAR AMBIENTES
# ══════════════════════════════════════════════════════════════════════════════

_gen_env() {
  local dir=$1 env_type=$2 domain=$3
  local db_pass secret_key db_name port_back port_front

  [[ "$env_type" == "prod" ]] && { db_name="visitas_prod"; port_back=8000; port_front=3000; }
  [[ "$env_type" == "test" ]] && { db_name="visitas_test"; port_back=8001; port_front=3001; }

  # Reusar senhas existentes
  if [[ -f "$dir/.env" ]]; then
    db_pass=$(grep "^POSTGRES_PASSWORD=" "$dir/.env" | cut -d= -f2)
    secret_key=$(grep "^SECRET_KEY=" "$dir/.env" | cut -d= -f2)
    cp "$dir/.env" "$dir/.env.bak.$(date +%Y%m%d%H%M%S)"
  fi
  db_pass="${db_pass:-$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)}"
  secret_key="${secret_key:-$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 64)}"

  cat > "$dir/.env" << EOF
ENVIRONMENT=${env_type}
APP_ENV=${env_type}
DATABASE_URL=postgresql+asyncpg://visitas_user:${db_pass}@db:5432/${db_name}
POSTGRES_DB=${db_name}
POSTGRES_USER=visitas_user
POSTGRES_PASSWORD=${db_pass}
REDIS_URL=redis://redis:6379/0
SECRET_KEY=${secret_key}
ACCESS_TOKEN_EXPIRE_MINUTES=480
REFRESH_TOKEN_EXPIRE_DAYS=30
APP_DOMAIN=${domain}
BACKEND_PORT=${port_back}
FRONTEND_PORT=${port_front}
CHECKIN_RADIUS_METERS=300
GOOGLE_MAPS_API_KEY=
WEBHOOK_SECRET=$(openssl rand -hex 32)
EOF
  chmod 600 "$dir/.env"
  chown visitas:visitas "$dir/.env" 2>/dev/null || true
}

_gen_compose() {
  local dir=$1 env_type=$2
  local port_back port_front vol_prefix

  [[ "$env_type" == "prod" ]] && { port_back=8000; port_front=3000; vol_prefix="/opt/visitas/prod/data"; }
  [[ "$env_type" == "test" ]] && { port_back=8001; port_front=3001; vol_prefix="/opt/visitas/test/data"; }

  cat > "$dir/docker-compose.yml" << COMPOSE
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    env_file: .env
    volumes:
      - ${vol_prefix}/postgres:/var/lib/postgresql/data
    networks: [net-${env_type}]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER} -d \${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes --maxmemory 128mb --maxmemory-policy allkeys-lru
    volumes:
      - ${vol_prefix}/redis:/data
    networks: [net-${env_type}]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      retries: 5

  backend:
    image: visitas-backend:${env_type}
    restart: unless-stopped
    env_file: .env
    ports: ["127.0.0.1:${port_back}:8000"]
    volumes:
      - ${vol_prefix}/uploads:/app/uploads
      - /opt/visitas/logs:/app/logs
    networks: [net-${env_type}]
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy

  frontend:
    image: visitas-frontend:${env_type}
    restart: unless-stopped
    ports: ["127.0.0.1:${port_front}:80"]
    networks: [net-${env_type}]

networks:
  net-${env_type}:
    driver: bridge
COMPOSE
  chown visitas:visitas "$dir/docker-compose.yml" 2>/dev/null || true
}

_gen_nginx() {
  local env_type=$1 domain=$2
  local port_back port_front conf
  [[ "$env_type" == "prod" ]] && { port_back=8000; port_front=3000; }
  [[ "$env_type" == "test" ]] && { port_back=8001; port_front=3001; }
  conf="/etc/nginx/sites-available/visitas-${env_type}"

  cat > "$conf" << NGINX
upstream ${env_type}_back  { server 127.0.0.1:${port_back};  keepalive 16; }
upstream ${env_type}_front { server 127.0.0.1:${port_front}; keepalive 8;  }

server {
    listen 80;
    server_name ${domain} _;
    client_max_body_size 50M;

    location /api/ {
        proxy_pass http://${env_type}_back;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }

    location ~ ^/(docs|redoc|openapi.json) {
        proxy_pass http://${env_type}_back;
        proxy_set_header Host \$host;
    }

    location / {
        proxy_pass http://${env_type}_front;
        proxy_set_header Host \$host;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX
  ln -sf "$conf" "/etc/nginx/sites-enabled/visitas-${env_type}"
}

_configure_envs() {
  _banner
  _step "Passo 4/6 — Configurando ambientes"

  rm -f /etc/nginx/sites-enabled/default

  local envs=("prod")
  [[ "$CFG_ENABLE_TEST" == "s" ]] && envs+=("test")

  for env_type in "${envs[@]}"; do
    local dir="/opt/visitas/${env_type}"
    local domain
    [[ "$env_type" == "prod" ]] && domain="$CFG_DOMAIN_PROD" || domain="$CFG_DOMAIN_TEST"
    local label; [[ "$env_type" == "prod" ]] && label="PRODUCAO" || label="TESTES"

    _info "Configurando ${label}..."
    _gen_env "$dir" "$env_type" "$domain"
    _ok ".env gerado"
    _gen_compose "$dir" "$env_type"
    _ok "docker-compose.yml gerado"
    _gen_nginx "$env_type" "$domain"
    _ok "Nginx configurado"

    # Systemd
    cat > "/etc/systemd/system/visitas-${env_type}.service" << SVC
[Unit]
Description=Visitas ${label}
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=visitas
WorkingDirectory=${dir}
EnvironmentFile=${dir}/.env
ExecStart=docker compose up -d --remove-orphans
ExecStop=docker compose down
TimeoutStartSec=300
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
SVC
    systemctl daemon-reload
    systemctl enable "visitas-${env_type}" >> /opt/visitas/logs/wizard.log 2>&1
    _ok "Servico systemd registrado"

    # SSL (apenas se domínio real)
    local srv_ip; srv_ip=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo "")
    local dom_ip; dom_ip=$(getent hosts "$domain" 2>/dev/null | awk '{print $1}' | head -1 || echo "")
    if [[ -n "$srv_ip" && "$srv_ip" == "$dom_ip" ]]; then
      mkdir -p /var/www/certbot
      certbot --nginx -d "$domain" --non-interactive --agree-tos \
        --email "$CFG_EMAIL" --redirect --no-eff-email \
        >> /opt/visitas/logs/wizard.log 2>&1 && \
        _ok "SSL configurado para $domain" || \
        _warn "Certbot falhou — sistema funcionara em HTTP"
    else
      _warn "DNS de '$domain' nao aponta para este servidor."
      _warn "Apos configurar o DNS execute: certbot --nginx -d $domain --email $CFG_EMAIL --agree-tos --non-interactive"
    fi
  done

  nginx -t >> /opt/visitas/logs/wizard.log 2>&1 && systemctl reload nginx
  _ok "Nginx recarregado"

  # Backup automático
  (crontab -l 2>/dev/null | grep -v "visitas.*backup";
   echo "0 2 * * * bash $0 --backup-auto >> /opt/visitas/logs/backup.log 2>&1") | crontab -
  _ok "Backup diario agendado (02:00)"

  _press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# PASSO 5 — CLONAR, BUILD E DEPLOY
# ══════════════════════════════════════════════════════════════════════════════

_clone_repo() {
  local dir=$1 branch=$2
  local src="$dir/src"

  # Verificar se já tem código
  if [[ -d "$src/.git" ]]; then
    _info "Repositorio ja existe — atualizando..."
    git config --global --add safe.directory "$src" 2>/dev/null || true
    git -C "$src" fetch --all >> /opt/visitas/logs/wizard.log 2>&1
    git -C "$src" reset --hard "origin/$branch" >> /opt/visitas/logs/wizard.log 2>&1
    _ok "Codigo atualizado: $(git -C "$src" rev-parse --short HEAD)"
    return 0
  fi

  # Converter URL HTTPS para SSH se necessário
  local repo="$CFG_GIT_REPO"
  if echo "$repo" | grep -q "https://github.com"; then
    repo=$(echo "$repo" | sed 's|https://github.com/|git@github.com:|')
    _info "URL convertida para SSH: $repo"
  fi

  _info "Clonando $repo ($branch)..."
  if git clone --branch "$branch" --depth 1 "$repo" "$src" \
      >> /opt/visitas/logs/wizard.log 2>&1; then
    git config --global --add safe.directory "$src" 2>/dev/null || true
    _ok "Codigo clonado"
    return 0
  fi

  # Fallback: aguardar upload manual
  _warn "Clone falhou. Abra outro terminal no seu Mac e execute:"
  _gap
  local pub_ip; pub_ip=$(curl -fsSL --max-time 3 https://api.ipify.org 2>/dev/null || echo "IP_DA_VPS")
  echo "  scp -r ~/caminho/TNORTEando/ root@${pub_ip}:${src}"
  _gap
  _info "Pressione ENTER quando o upload terminar..."
  read -r

  if [[ -d "$src/backend" && -d "$src/frontend" ]]; then
    _ok "Codigo encontrado em $src"
    return 0
  fi

  _err "Codigo nao encontrado. Execute o build manualmente depois."
  return 1
}

_build_backend() {
  local dir=$1 env_type=$2
  local src="$dir/src"

  [[ ! -f "$src/backend/Dockerfile" ]] && {
    _warn "Dockerfile do backend nao encontrado — criando..."
    cat > "$src/backend/Dockerfile" << 'DFILE'
FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc curl && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "2", "--proxy-headers", "--forwarded-allow-ips", "*"]
DFILE
  }

  # Garantir security.py com pbkdf2 (sem dependência de bcrypt)
  cat > "$src/backend/app/core/security.py" << 'SECPY'
import hashlib, hmac
from datetime import datetime, timedelta, timezone
from typing import Optional, Union
from jose import JWTError, jwt
from app.core.config import settings

def _h(p): return "pbkdf2:" + hashlib.pbkdf2_hmac("sha256", p.encode(), b"salt", 100000).hex()

def verify_password(plain, hashed):
    if hashed.startswith("pbkdf2:"): return hmac.compare_digest(_h(plain), hashed)
    try:
        from passlib.context import CryptContext
        return CryptContext(schemes=["bcrypt"], deprecated="auto").verify(plain, hashed)
    except Exception: return False

def get_password_hash(p): return _h(p)

def create_access_token(subject, expires_delta=None):
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    return jwt.encode({"sub": str(subject), "exp": expire, "type": "access"}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def create_refresh_token(subject):
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": str(subject), "exp": expire, "type": "refresh"}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def decode_token(token):
    try: return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError: return None
SECPY
  _ok "security.py (pbkdf2) garantido"

  docker build \
    --no-cache \
    -f "$src/backend/Dockerfile" \
    -t "visitas-backend:${env_type}" \
    "$src/backend" \
    >> /opt/visitas/logs/wizard.log 2>&1 &
  _spinner $! "Build backend"
}

_build_frontend() {
  local dir=$1 env_type=$2 domain=$3
  local src="$dir/src"

  # Garantir arquivos de configuração necessários
  [[ ! -f "$src/frontend/vite.config.ts" ]] && cat > "$src/frontend/vite.config.ts" << 'VCF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()], server: { host: true, port: 5173 } })
VCF

  [[ ! -f "$src/frontend/tailwind.config.js" ]] && cat > "$src/frontend/tailwind.config.js" << 'TCF'
export default { content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"], theme: { extend: {} }, plugins: [] }
TCF

  [[ ! -f "$src/frontend/postcss.config.js" ]] && cat > "$src/frontend/postcss.config.js" << 'PCF'
export default { plugins: { tailwindcss: {}, autoprefixer: {} } }
PCF

  [[ ! -f "$src/frontend/tsconfig.json" ]] && cat > "$src/frontend/tsconfig.json" << 'TSCF'
{
  "compilerOptions": {
    "target": "ES2020", "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext", "skipLibCheck": true,
    "moduleResolution": "bundler", "allowImportingTsExtensions": true,
    "resolveJsonModule": true, "isolatedModules": true,
    "noEmit": true, "jsx": "react-jsx", "strict": true,
    "noUnusedLocals": false, "noUnusedParameters": false
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
TSCF

  [[ ! -f "$src/frontend/tsconfig.node.json" ]] && cat > "$src/frontend/tsconfig.node.json" << 'TSNF'
{
  "compilerOptions": {
    "composite": true, "skipLibCheck": true,
    "module": "ESNext", "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
TSNF

  [[ ! -f "$src/frontend/src/vite-env.d.ts" ]] && cat > "$src/frontend/src/vite-env.d.ts" << 'VEDF'
/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_API_URL: string }
interface ImportMeta { readonly env: ImportMetaEnv }
VEDF

  [[ ! -f "$src/frontend/Dockerfile" ]] && cat > "$src/frontend/Dockerfile" << 'FDFILE'
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
FDFILE

  [[ ! -f "$src/frontend/nginx.conf" ]] && cat > "$src/frontend/nginx.conf" << 'NGXF'
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
    location / { try_files $uri $uri/ /index.html; }
    location ~* \.(js|css|png|jpg|ico|woff2)$ { expires 1y; add_header Cache-Control "public, immutable"; }
}
NGXF

  # Corrigir Dockerfile se tiver npm ci --silent
  sed -i 's/npm ci --silent/npm install/' "$src/frontend/Dockerfile" 2>/dev/null || true

  local vite_url
  if echo "$domain" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
    vite_url="http://${domain}"
  else
    vite_url="https://${domain}"
  fi

  docker build \
    --no-cache \
    -f "$src/frontend/Dockerfile" \
    --build-arg "VITE_API_URL=${vite_url}" \
    -t "visitas-frontend:${env_type}" \
    "$src/frontend" \
    >> /opt/visitas/logs/wizard.log 2>&1 &
  _spinner $! "Build frontend"
}

_deploy() {
  _banner
  _step "Passo 5/6 — Clone, Build e Deploy"

  local envs=("prod")
  [[ "$CFG_ENABLE_TEST" == "s" ]] && envs+=("test")

  for env_type in "${envs[@]}"; do
    local dir="/opt/visitas/${env_type}"
    local label; [[ "$env_type" == "prod" ]] && label="PRODUCAO" || label="TESTES"
    local domain; [[ "$env_type" == "prod" ]] && domain="$CFG_DOMAIN_PROD" || domain="$CFG_DOMAIN_TEST"

    _info "--- ${label} ---"

    # Clone
    _clone_repo "$dir" "$CFG_GIT_BRANCH" || continue

    # Build
    _build_backend "$dir" "$env_type"
    _build_frontend "$dir" "$env_type" "$domain"

    # Verificar se as imagens foram criadas
    if ! docker image inspect "visitas-backend:${env_type}" &>/dev/null || \
       ! docker image inspect "visitas-frontend:${env_type}" &>/dev/null; then
      _err "Build falhou — verifique /opt/visitas/logs/wizard.log"
      continue
    fi

    # Subir containers
    cd "$dir"
    docker compose up -d >> /opt/visitas/logs/wizard.log 2>&1 &
    _spinner $! "Subindo containers"

    # Aguardar banco
    _info "Aguardando banco de dados..."
    local db_ready=false
    for i in $(seq 1 30); do
      sleep 2
      docker compose exec -T db pg_isready -U visitas_user >> /opt/visitas/logs/wizard.log 2>&1 && { db_ready=true; break; }
    done

    $db_ready && _ok "Banco pronto" || { _err "Banco nao respondeu"; continue; }

    _ok "${label} online"
  done

  _press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# PASSO 6 — SEED E IMPORTAÇÃO
# ══════════════════════════════════════════════════════════════════════════════

_seed_and_import() {
  _banner
  _step "Passo 6/6 — Configuracao inicial do sistema"

  local dir="/opt/visitas/prod"
  local db_user; db_user=$(grep "^POSTGRES_USER=" "$dir/.env" | cut -d= -f2)
  local db_pass; db_pass=$(grep "^POSTGRES_PASSWORD=" "$dir/.env" | cut -d= -f2)
  local db_name; db_name=$(grep "^POSTGRES_DB=" "$dir/.env" | cut -d= -f2)

  # Gerar hash da senha do gestor
  local senha_hash
  senha_hash=$(python3 -c "
import hashlib
p = '${CFG_GESTOR_SENHA}'
print('pbkdf2:' + hashlib.pbkdf2_hmac('sha256', p.encode(), b'salt', 100000).hex())
" 2>/dev/null || echo "pbkdf2:fallback")

  # Criar gestor no banco
  _info "Criando usuario gestor..."
  docker compose exec -T db psql -U "$db_user" -d "$db_name" << SQLEOF >> /opt/visitas/logs/wizard.log 2>&1
INSERT INTO usuarios (id, organizacao_id, codigo_externo, nome, email, senha_hash, papel, ativo, primeiro_acesso)
SELECT gen_random_uuid(), id, 'GESTOR001', 'Administrador', '${CFG_GESTOR_EMAIL}',
       '${senha_hash}', 'GESTOR_EMPRESA', true, true
FROM organizacoes LIMIT 1
ON CONFLICT (email) DO UPDATE SET senha_hash='${senha_hash}';
SQLEOF
  _ok "Gestor criado: ${CFG_GESTOR_EMAIL}"

  # Verificar se há CSV para importar
  _gap
  echo -e "  ${W}Importacao do CSV de contratos${RESET}"
  _info "Se voce tem o arquivo contractsReport.csv, copie para a VPS agora:"
  local pub_ip; pub_ip=$(curl -fsSL --max-time 3 https://api.ipify.org 2>/dev/null || echo "IP_DA_VPS")
  echo ""
  echo "  scp contractsReport.csv root@${pub_ip}:/tmp/"
  echo ""
  _info "Pressione ENTER para importar (ou ENTER sem arquivo para pular)..."
  read -r

  if [[ -f /tmp/contractsReport*.csv ]]; then
    local csv_file; csv_file=$(ls /tmp/contractsReport*.csv | head -1)
    _info "Importando $csv_file..."
    docker compose cp "$csv_file" backend:/tmp/import.csv >> /opt/visitas/logs/wizard.log 2>&1

    docker compose exec -T backend python3 -c "
import asyncio, csv, re, uuid, os, hashlib
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import text

def _h(p): return 'pbkdf2:' + hashlib.pbkdf2_hmac('sha256',p.encode(),b'salt',100000).hex()
def cnpj(r):
    if not r or r.strip() in ('-',''): return None
    return re.sub(r'[^0-9]','',r) or None
def nulo(v):
    v=v.strip() if v else ''
    return v if v and v!='-' else None
def norm(t):
    if not t or t.strip() in ('-',''): return ''
    return ' '.join(t.strip().title().split())

DB=f'postgresql+asyncpg://{os.environ[\"POSTGRES_USER\"]}:{os.environ[\"POSTGRES_PASSWORD\"]}@db:5432/{os.environ[\"POSTGRES_DB\"]}'

async def main():
    eng=create_async_engine(DB,echo=False)
    Sess=async_sessionmaker(eng,expire_on_commit=False)
    with open('/tmp/import.csv',encoding='ISO-8859-1',newline='') as f:
        rows=list(csv.DictReader(f,delimiter=';'))
    async with Sess() as db:
        ce={}
        for r in rows:
            c=r['Código do Cliente'].strip(); e=r['Código do ESN'].strip()
            if c not in ce: ce[c]=set()
            if e and e!='-': ce[c].add(e)
        er={c:sorted(s)[0] if s else None for c,s in ce.items()}
        res=await db.execute(text('INSERT INTO organizacoes (id,codigo_externo,nome,ativo) VALUES (:i,:c,:n,true) ON CONFLICT (codigo_externo) DO UPDATE SET nome=EXCLUDED.nome RETURNING id'),{'i':str(uuid.uuid4()),'c':rows[0]['Codigo Unidade Responsável pelo Atendimento'].strip(),'n':rows[0]['Nome Unidade de Atendimento'].strip()})
        oid=str(res.fetchone()[0])
        await db.commit()
        us={};em={}
        async def iu(cod,nome,email,papel):
            cod=cod.strip()
            if not cod or cod=='-' or cod in us: return
            en=email.strip().lower() if email.strip() not in ('-','') else f'{cod.lower()}@importado.local'
            if en in em: us[cod]=em[en]; return
            uid=str(uuid.uuid4())
            await db.execute(text('INSERT INTO usuarios (id,organizacao_id,codigo_externo,nome,email,senha_hash,papel,ativo,primeiro_acesso) VALUES (:i,:o,:c,:n,:e,:h,:p,true,true) ON CONFLICT (email) DO NOTHING'),{'i':uid,'o':oid,'c':cod,'n':norm(nome) or cod,'e':en,'h':_h(\"Mudar@123\"),'p':papel})
            r2=await db.execute(text('SELECT id FROM usuarios WHERE email=:e'),{'e':en})
            rw=r2.fetchone()
            if rw: us[cod]=str(rw[0]); em[en]=str(rw[0])
        for r in rows:
            await iu(r['Código do DSN'],r['Nome do DSN'],r['E-mail do DSN'],'DSN')
            await iu(r['Código do GSN'],r['Nome do GSN'],r['E-mail do GSN'],'GSN')
            await iu(r['Código do ESN'],r['Nome do ESN'],r['E-mail do ESN'],'ESN')
        await db.commit()
        vs=set()
        for r in rows:
            d=r['Código do DSN'].strip(); g=r['Código do GSN'].strip(); e=r['Código do ESN'].strip()
            for sup,sub,cod in [(d,g,g),(g,e,e)]:
                if sup in us and sub in us:
                    k=(us[sup],us[sub],cod)
                    if k not in vs:
                        vs.add(k)
                        await db.execute(text('INSERT INTO hierarquia_vendas (id,superior_id,subordinado_id,codigo_externo_subordinado,ativo) VALUES (:i,:s,:b,:c,true) ON CONFLICT ON CONSTRAINT uq_hierarquia_vinculo DO NOTHING'),{'i':str(uuid.uuid4()),'s':us[sup],'b':us[sub],'c':cod})
        await db.commit()
        ci=set()
        for r in rows:
            c=r['Código do Cliente'].strip()
            if c in ci: continue
            ci.add(c)
            eid=us.get(er.get(c))
            await db.execute(text('INSERT INTO clientes (id,organizacao_id,vendedor_responsavel_id,codigo_externo,razao_social,cnpj,municipio,uf,setor_publico,status_atribuicao,status_cliente,classificacao_abc,frequencia_visita_dias,ativo) VALUES (:i,:o,:e,:c,:r,:cn,:m,:u,:p,:sa,chr(65)||chr(84)||chr(73)||chr(86)||chr(79),chr(67),30,true) ON CONFLICT (codigo_externo) DO NOTHING'),{'i':str(uuid.uuid4()),'o':oid,'e':eid,'c':c,'r':norm(r['Razão Social do Cliente']),'cn':cnpj(r['CPF ou CNPJ do Cliente']),'m':norm(nulo(r['Município do Cliente'])),'u':nulo(r['UF']),'p':r['Setor Público'].strip().upper()=='SIM','sa':'ATRIBUIDO' if eid else 'PENDENTE'})
        await db.commit()
        cti=set()
        for r in rows:
            n=r['Número do Contrato'].strip()
            if n in cti: continue
            cti.add(n)
            rc=await db.execute(text('SELECT id FROM clientes WHERE codigo_externo=:c'),{'c':r['Código do Cliente'].strip()})
            rw=rc.fetchone()
            if not rw: continue
            st=r['Status do Contrato'].strip().upper()
            if st not in ('ATIVO','CANCELADO','GRATUITO','TROCADO','PENDENTE','MANUAL'): st='PENDENTE'
            await db.execute(text('INSERT INTO contratos (id,cliente_id,numero_contrato,status,recorrente,modalidade,unidade_venda) VALUES (:i,:c,:n,:s,:r,:m,:u) ON CONFLICT (numero_contrato) DO NOTHING'),{'i':str(uuid.uuid4()),'c':str(rw[0]),'n':n,'s':st,'r':r['Recorrente'].strip().upper()=='SIM','m':nulo(r['Modalidade de Vendas']),'u':nulo(r['Nome Unidade de Venda'])})
        await db.commit()
        print(f'Importado: {len(us)} usuarios, {len(ci)} clientes, {len(cti)} contratos')

asyncio.run(main())
" 2>&1 | tee -a /opt/visitas/logs/wizard.log | grep -E "Importado|Error|erro" || true
    _ok "Importacao concluida"
  else
    _warn "CSV nao encontrado — importe depois pelo menu do sistema"
  fi

  # Atualizar hash do gestor após importação (org pode ter sido criada agora)
  docker compose exec -T db psql -U "$db_user" -d "$db_name" -c \
    "UPDATE usuarios SET senha_hash='${senha_hash}' WHERE email='${CFG_GESTOR_EMAIL}';" \
    >> /opt/visitas/logs/wizard.log 2>&1

  _press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# TELA FINAL
# ══════════════════════════════════════════════════════════════════════════════
_done() {
  _banner
  echo -e "${G}${BOLD}"
  echo "  =============================================="
  echo "   Instalacao concluida com sucesso!"
  echo "  =============================================="
  echo -e "${RESET}"

  local pub_ip; pub_ip=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo "?")

  _line
  printf "  %-25s %s\n" "URL de producao:"    "http://${CFG_DOMAIN_PROD}"
  printf "  %-25s %s\n" "IP do servidor:"     "$pub_ip"
  printf "  %-25s %s\n" "Login gestor:"       "$CFG_GESTOR_EMAIL"
  printf "  %-25s %s\n" "Senha gestor:"       "$CFG_GESTOR_SENHA"
  printf "  %-25s %s\n" "Senha vendedores:"   "Mudar@123"
  printf "  %-25s %s\n" "Logs:"               "/opt/visitas/logs/"
  _line

  # Salvar credenciais
  cat > /opt/visitas/CREDENTIALS.txt << CREDS
TNORTEando - Credenciais
Instalado em: $(date)
================================
URL: http://${CFG_DOMAIN_PROD}
Gestor: ${CFG_GESTOR_EMAIL}
Senha gestor: ${CFG_GESTOR_SENHA}
Senha vendedores: Mudar@123
================================
CREDS
  chmod 600 /opt/visitas/CREDENTIALS.txt

  _gap
  _ok "Credenciais salvas em /opt/visitas/CREDENTIALS.txt"
  _gap
  echo -e "  Para gerenciar o sistema: ${W}bash $0${RESET}"
  _gap
}

# ══════════════════════════════════════════════════════════════════════════════
# MENU DE GESTÃO (pós-instalação)
# ══════════════════════════════════════════════════════════════════════════════

_menu_status_line() {
  local compose="docker compose"
  local prod_st test_st
  if [[ -f "/opt/visitas/prod/docker-compose.yml" ]]; then
    local r; r=$(cd /opt/visitas/prod && $compose ps -q 2>/dev/null | wc -l)
    [[ $r -gt 0 ]] && prod_st="${G}[PROD online]${RESET}" || prod_st="${R}[PROD offline]${RESET}"
  else
    prod_st="${D}[PROD nao instalado]${RESET}"
  fi
  if [[ -f "/opt/visitas/test/docker-compose.yml" ]]; then
    local r; r=$(cd /opt/visitas/test && $compose ps -q 2>/dev/null | wc -l)
    [[ $r -gt 0 ]] && test_st="${Y}[TEST online]${RESET}" || test_st="${D}[TEST offline]${RESET}"
  else
    test_st="${D}[TEST nao instalado]${RESET}"
  fi
  echo -e "  ${prod_st}  ${test_st}  ${D}$(date '+%d/%m/%Y %H:%M')${RESET}"
}

_menu() {
  while true; do
    _banner
    _menu_status_line
    _gap
    _line
    echo -e "  ${BOLD}  Instalacao e Atualizacao${RESET}"
    echo -e "   ${G}1${RESET}  Instalar / Reinstalar"
    echo -e "   ${C}2${RESET}  Atualizar PRODUCAO"
    echo -e "   ${C}3${RESET}  Atualizar TESTES"
    _gap
    echo -e "  ${BOLD}  Dados${RESET}"
    echo -e "   ${B}4${RESET}  Backup agora"
    echo -e "   ${B}5${RESET}  Restaurar backup"
    echo -e "   ${M}6${RESET}  Replicar PROD para TESTES"
    _gap
    echo -e "  ${BOLD}  Operacoes${RESET}"
    echo -e "   ${Y}7${RESET}  Reiniciar servicos"
    echo -e "   ${W}8${RESET}  Status"
    echo -e "   ${W}9${RESET}  Monitor ao vivo"
    _gap
    echo -e "  ${BOLD}  Diagnostico${RESET}"
    echo -e "  ${W}10${RESET}  Ver logs"
    echo -e "  ${W}11${RESET}  Logs em tempo real"
    echo -e "  ${W}12${RESET}  Informacoes do servidor"
    _gap
    _line
    echo -e "   ${R}0${RESET}  Sair"
    _gap
    printf "  Opcao: "
    read -r opt

    case "$opt" in
      1) _run_wizard ;;
      2) _menu_atualizar prod ;;
      3) _menu_atualizar test ;;
      4) _menu_backup ;;
      5) _menu_restaurar ;;
      6) _menu_replicar ;;
      7) _menu_reiniciar ;;
      8) _menu_status ;;
      9) _menu_monitor ;;
      10) _menu_logs ;;
      11) _menu_logs_live ;;
      12) _menu_info ;;
      0) _gap; echo "  Saindo..."; _gap; exit 0 ;;
      *) _warn "Opcao invalida."; sleep 1 ;;
    esac
  done
}

_menu_atualizar() {
  local env_type=$1
  local dir="/opt/visitas/${env_type}"
  local label; [[ "$env_type" == "prod" ]] && label="PRODUCAO" || label="TESTES"
  _banner; _step "Atualizar ${label}"
  [[ ! -f "$dir/docker-compose.yml" ]] && { _err "${label} nao instalado."; _press_enter; return; }
  _ask_yn "Confirmar atualizacao de ${label}?" || return
  _load_state
  if [[ -d "$dir/src/.git" ]]; then
    local branch; [[ "$env_type" == "prod" ]] && branch="$CFG_GIT_BRANCH" || branch="develop"
    _run "Baixando codigo ($branch)" bash -c "git config --global --add safe.directory $dir/src 2>/dev/null; git -C $dir/src fetch --all && git -C $dir/src reset --hard origin/$branch"
    local domain; [[ "$env_type" == "prod" ]] && domain="$CFG_DOMAIN_PROD" || domain="$CFG_DOMAIN_TEST"
    _build_backend "$dir" "$env_type"
    _build_frontend "$dir" "$env_type" "$domain"
  fi
  _run "Reiniciando containers" bash -c "cd $dir && docker compose up -d --force-recreate --remove-orphans"
  _ok "Atualizacao concluida"; _press_enter
}

_menu_backup() {
  _banner; _step "Backup"
  local DATE; DATE=$(date +%Y%m%d_%H%M%S)
  mkdir -p /opt/visitas/backups
  for env_type in prod test; do
    local dir="/opt/visitas/${env_type}"
    [[ ! -f "$dir/docker-compose.yml" ]] && continue
    local label; [[ "$env_type" == "prod" ]] && label="PROD" || label="TEST"
    local db_c; db_c=$(cd "$dir" && docker compose ps -q db 2>/dev/null | head -1)
    [[ -z "$db_c" ]] && { _warn "DB $label nao esta rodando"; continue; }
    local db_n; db_n=$(grep "^POSTGRES_DB=" "$dir/.env" | cut -d= -f2)
    local db_u; db_u=$(grep "^POSTGRES_USER=" "$dir/.env" | cut -d= -f2)
    docker exec "$db_c" pg_dump -U "$db_u" "$db_n" 2>/dev/null \
      | gzip > "/opt/visitas/backups/db_${label}_${DATE}.sql.gz" && \
      _ok "Backup $label: $(du -sh /opt/visitas/backups/db_${label}_${DATE}.sql.gz | cut -f1)"
  done
  find /opt/visitas/backups -name "*.gz" -mtime +7 -delete 2>/dev/null || true
  _press_enter
}

_menu_restaurar() {
  _banner; _step "Restaurar Backup"
  local backups=(); mapfile -t backups < <(ls -t /opt/visitas/backups/db_*.sql.gz 2>/dev/null)
  [[ ${#backups[@]} -eq 0 ]] && { _warn "Nenhum backup encontrado."; _press_enter; return; }
  for i in "${!backups[@]}"; do
    echo -e "  ${G}$((i+1))${RESET}  $(basename "${backups[$i]}")  ${D}($(du -sh "${backups[$i]}" | cut -f1))${RESET}"
  done
  local idx; printf "\n  Escolha [1-${#backups[@]}]: "; read -r idx
  local sel="${backups[$((idx-1))]}"
  local env_type="prod"; echo "$sel" | grep -qi "_TEST_" && env_type="test"
  local label; [[ "$env_type" == "prod" ]] && label="PRODUCAO" || label="TESTES"
  _ask_yn "ATENCAO: sobrescrever banco de ${label}?" || return
  local dir="/opt/visitas/${env_type}"
  local db_c; db_c=$(cd "$dir" && docker compose ps -q db 2>/dev/null | head -1)
  [[ -z "$db_c" ]] && { _err "DB nao esta rodando."; _press_enter; return; }
  local db_n; db_n=$(grep "^POSTGRES_DB=" "$dir/.env" | cut -d= -f2)
  local db_u; db_u=$(grep "^POSTGRES_USER=" "$dir/.env" | cut -d= -f2)
  (cd "$dir" && docker compose stop backend 2>/dev/null) || true
  gunzip -c "$sel" | docker exec -i "$db_c" psql -U "$db_u" -d "$db_n" 2>/dev/null && \
    _ok "Banco restaurado" || _err "Falha na restauracao"
  (cd "$dir" && docker compose start backend 2>/dev/null) || true
  _press_enter
}

_menu_replicar() {
  _banner; _step "Replicar PROD para TESTES"
  _ask_yn "Isso sobrescreve todos os dados de TESTES. Confirmar?" || return
  local DATE; DATE=$(date +%Y%m%d_%H%M%S)
  local db_prod; db_prod=$(cd /opt/visitas/prod && docker compose ps -q db 2>/dev/null | head -1)
  local db_test; db_test=$(cd /opt/visitas/test && docker compose ps -q db 2>/dev/null | head -1)
  [[ -z "$db_prod" || -z "$db_test" ]] && { _err "Ambos os bancos precisam estar rodando."; _press_enter; return; }
  local dump="/opt/visitas/backups/replica_${DATE}.sql.gz"
  local db_n_prod; db_n_prod=$(grep "^POSTGRES_DB=" /opt/visitas/prod/.env | cut -d= -f2)
  local db_u_prod; db_u_prod=$(grep "^POSTGRES_USER=" /opt/visitas/prod/.env | cut -d= -f2)
  local db_n_test; db_n_test=$(grep "^POSTGRES_DB=" /opt/visitas/test/.env | cut -d= -f2)
  local db_u_test; db_u_test=$(grep "^POSTGRES_USER=" /opt/visitas/test/.env | cut -d= -f2)
  _run "Exportando PROD" bash -c "docker exec $db_prod pg_dump -U $db_u_prod $db_n_prod | gzip > $dump"
  (cd /opt/visitas/test && docker compose stop backend 2>/dev/null) || true
  _run "Restaurando em TESTES" bash -c "gunzip -c $dump | docker exec -i $db_test psql -U $db_u_test -d $db_n_test"
  (cd /opt/visitas/test && docker compose start backend 2>/dev/null) || true
  _ok "Replicacao concluida"; _press_enter
}

_menu_reiniciar() {
  _banner; _step "Reiniciar Servicos"
  echo -e "  ${G}1${RESET}  Todos containers PRODUCAO"
  echo -e "  ${Y}2${RESET}  Todos containers TESTES"
  echo -e "  ${W}3${RESET}  Apenas backend PRODUCAO"
  echo -e "  ${W}4${RESET}  Apenas backend TESTES"
  echo -e "  ${W}5${RESET}  Nginx"
  printf "\n  Opcao: "; read -r c
  case $c in
    1) (cd /opt/visitas/prod && docker compose restart 2>/dev/null) && _ok "PROD reiniciada" ;;
    2) (cd /opt/visitas/test && docker compose restart 2>/dev/null) && _ok "TEST reiniciado" ;;
    3) (cd /opt/visitas/prod && docker compose restart backend 2>/dev/null) && _ok "Backend PROD reiniciado" ;;
    4) (cd /opt/visitas/test && docker compose restart backend 2>/dev/null) && _ok "Backend TEST reiniciado" ;;
    5) nginx -t && systemctl reload nginx && _ok "Nginx recarregado" ;;
  esac
  _press_enter
}

_menu_status() {
  _banner; _step "Status"
  for env_type in prod test; do
    local dir="/opt/visitas/${env_type}"
    local label; [[ "$env_type" == "prod" ]] && label="PRODUCAO" || label="TESTES"
    echo -e "  ${BOLD}-- ${label} --${RESET}"
    [[ ! -f "$dir/docker-compose.yml" ]] && { echo -e "  ${D}Nao instalado${RESET}\n"; continue; }
    (cd "$dir" && docker compose ps 2>/dev/null) | sed 's/^/    /'
    echo ""
  done
  echo -e "  ${BOLD}-- Nginx --${RESET}"
  systemctl is-active nginx > /dev/null 2>&1 \
    && echo -e "    ${G}[ATIVO]${RESET}" || echo -e "    ${R}[INATIVO]${RESET}"
  _press_enter
}

_menu_monitor() {
  while true; do
    _banner
    echo -e "  ${D}Pressione Q para sair${RESET}\n"
    echo -e "  ${BOLD}CPU / RAM / Disco${RESET}"
    echo -e "  CPU:  $(top -bn1 | grep 'Cpu(s)' | awk '{print $2}')% uso"
    echo -e "  RAM:  $(free -m | awk '/^Mem:/ {printf "%dMB / %dMB (%.0f%%)", $3, $2, $3/$2*100}')"
    echo -e "  Disk: $(df -h / | tail -1 | awk '{print $3 "/" $2 " (" $5 ")"}')"
    _gap
    echo -e "  ${BOLD}Containers${RESET}"
    for env_type in prod test; do
      local dir="/opt/visitas/${env_type}"
      [[ ! -f "$dir/docker-compose.yml" ]] && continue
      local label; [[ "$env_type" == "prod" ]] && label="PROD" || label="TEST"
      (cd "$dir" && docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null) | \
        grep -v "^NAME" | while IFS= read -r line; do
          echo "$line" | grep -qi "running\|up" \
            && echo -e "    ${G}[UP]${RESET} [$label] $line" \
            || echo -e "    ${R}[DN]${RESET} [$label] $line"
        done
    done
    if read -r -t 3 -n1 key 2>/dev/null; then
      [[ "${key,,}" == "q" ]] && break
    fi
  done
  _press_enter
}

_menu_logs() {
  _banner; _step "Ver Logs"
  echo -e "  ${G}1${RESET}  Backend PRODUCAO"
  echo -e "  ${G}2${RESET}  Frontend PRODUCAO"
  echo -e "  ${Y}3${RESET}  Backend TESTES"
  echo -e "  ${W}4${RESET}  Nginx error"
  echo -e "  ${W}5${RESET}  Nginx access"
  echo -e "  ${C}6${RESET}  Wizard (instalacao)"
  printf "\n  Opcao: "; read -r c
  case $c in
    1) (cd /opt/visitas/prod && docker compose logs backend --tail=100 2>/dev/null) ;;
    2) (cd /opt/visitas/prod && docker compose logs frontend --tail=100 2>/dev/null) ;;
    3) (cd /opt/visitas/test && docker compose logs backend --tail=100 2>/dev/null) ;;
    4) tail -100 /var/log/nginx/error.log 2>/dev/null ;;
    5) tail -100 /var/log/nginx/access.log 2>/dev/null ;;
    6) tail -100 /opt/visitas/logs/wizard.log 2>/dev/null ;;
  esac
  _press_enter
}

_menu_logs_live() {
  _banner; _step "Logs em Tempo Real"
  echo -e "  ${G}1${RESET}  Backend PRODUCAO"
  echo -e "  ${G}2${RESET}  Todos PRODUCAO"
  echo -e "  ${Y}3${RESET}  Backend TESTES"
  echo -e "  ${W}4${RESET}  Nginx"
  printf "\n  Opcao: "; read -r c
  echo -e "\n  ${D}Ctrl+C para parar${RESET}\n"; sleep 1
  case $c in
    1) (cd /opt/visitas/prod && docker compose logs backend -f --tail=30 2>/dev/null) ;;
    2) (cd /opt/visitas/prod && docker compose logs -f --tail=20 2>/dev/null) ;;
    3) (cd /opt/visitas/test && docker compose logs backend -f --tail=30 2>/dev/null) ;;
    4) tail -f /var/log/nginx/access.log /var/log/nginx/error.log 2>/dev/null ;;
  esac
  _press_enter
}

_menu_info() {
  _banner; _step "Informacoes do Servidor"
  . /etc/os-release
  local pub_ip; pub_ip=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo "?")
  printf "  %-22s %s\n" "Sistema:"     "${PRETTY_NAME}"
  printf "  %-22s %s\n" "Kernel:"      "$(uname -r)"
  printf "  %-22s %s\n" "IP publico:"  "$pub_ip"
  printf "  %-22s %s\n" "Uptime:"      "$(uptime -p)"
  printf "  %-22s %s\n" "CPUs:"        "$(nproc) core(s)"
  printf "  %-22s %s\n" "RAM:"         "$(free -h | awk '/^Mem:/ {print $2" total / "$3" usados"}')"
  printf "  %-22s %s\n" "Disco:"       "$(df -h /opt 2>/dev/null | tail -1 | awk '{print $3" / "$2}')"
  _gap
  printf "  %-22s %s\n" "Docker:"      "$(docker --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || echo 'nao instalado')"
  printf "  %-22s %s\n" "Nginx:"       "$(nginx -v 2>&1 | grep -oP 'nginx/[\d.]+' || echo 'nao instalado')"
  _gap
  ufw status 2>/dev/null | grep -q "active" && _ok "Firewall UFW ativo" || _warn "Firewall inativo"
  systemctl is-active fail2ban > /dev/null 2>&1 && _ok "Fail2ban ativo" || _warn "Fail2ban inativo"
  _press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# FLUXO DO WIZARD
# ══════════════════════════════════════════════════════════════════════════════
_run_wizard() {
  _check_system
  _configure
  _install_deps
  _configure_envs
  _deploy
  _seed_and_import
  _done
  _save_state
}

# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════
main() {
  case "${1:-}" in
    --backup-auto)
      mkdir -p /opt/visitas/backups /opt/visitas/logs
      local DATE; DATE=$(date +%Y%m%d_%H%M%S)
      for env_type in prod test; do
        [[ ! -f "/opt/visitas/${env_type}/.env" ]] && continue
        local db_c; db_c=$(cd "/opt/visitas/${env_type}" && docker compose ps -q db 2>/dev/null | head -1)
        [[ -z "$db_c" ]] && continue
        local db_n; db_n=$(grep "^POSTGRES_DB=" "/opt/visitas/${env_type}/.env" | cut -d= -f2)
        local db_u; db_u=$(grep "^POSTGRES_USER=" "/opt/visitas/${env_type}/.env" | cut -d= -f2)
        docker exec "$db_c" pg_dump -U "$db_u" "$db_n" 2>/dev/null \
          | gzip > "/opt/visitas/backups/db_${env_type^^}_${DATE}.sql.gz"
        echo "$(date) - Backup ${env_type^^} concluido"
      done
      find /opt/visitas/backups -name "*.gz" -mtime +7 -delete 2>/dev/null || true
      exit 0
      ;;
  esac

  [[ $EUID -ne 0 ]] && { echo "Execute como root: sudo bash wizard.sh"; exit 1; }

  _load_state

  if [[ -f "$STATE_FILE" ]]; then
    _banner
    _ok "Instalacao anterior detectada."
    _gap
    if _ask_yn "Abrir menu de gestao?"; then
      _menu
    else
      _run_wizard
      _menu
    fi
  else
    _run_wizard
    _menu
  fi
}

main "$@"
