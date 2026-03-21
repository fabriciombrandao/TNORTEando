#!/usr/bin/env bash
# =============================================================================
#  VISITAS — Central de Gestão da VPS
#  Arquivo único: instala, atualiza, faz backup, monitora e muito mais.
#
#  Uso:
#    sudo bash manage.sh          → menu interativo
#    sudo bash manage.sh <opção>  → execução direta (ex: sudo bash manage.sh 1)
#
#  Testado em: Ubuntu 22.04 LTS / Ubuntu 24.04 LTS / Debian 12
# =============================================================================

set -uo pipefail

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURAÇÕES — edite esta seção antes de rodar na primeira vez
# ══════════════════════════════════════════════════════════════════════════════

APP_NAME="visitas"
APP_DIR_PROD="/opt/visitas/prod"
APP_DIR_TEST="/opt/visitas/test"
APP_USER="visitas"

DOMAIN_PROD="${DOMAIN_PROD:-visitas.seudominio.com.br}"
DOMAIN_TEST="${DOMAIN_TEST:-test.visitas.seudominio.com.br}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@seudominio.com.br}"

PORT_PROD_BACKEND=8000
PORT_PROD_FRONTEND=3000
PORT_TEST_BACKEND=8001
PORT_TEST_FRONTEND=3001

DB_NAME_PROD="visitas_prod"
DB_NAME_TEST="visitas_test"
DB_USER="visitas_user"

BACKUP_DIR="/opt/visitas/backups"
BACKUP_KEEP_DAYS=7
LOG_DIR="/opt/visitas/logs"

GIT_REPO="${GIT_REPO:-}"           # ex: https://github.com/usuario/visitas.git
GIT_BRANCH_PROD="main"
GIT_BRANCH_TEST="develop"

MIN_RAM_MB=1024
MIN_DISK_GB=10

# ══════════════════════════════════════════════════════════════════════════════
# CORES E HELPERS
# ══════════════════════════════════════════════════════════════════════════════

RED='\033[0;31m';    GREEN='\033[0;32m';  YELLOW='\033[1;33m'
BLUE='\033[0;34m';   CYAN='\033[0;36m';   MAGENTA='\033[0;35m'
WHITE='\033[1;37m';  BOLD='\033[1m';      DIM='\033[2m';  RESET='\033[0m'
BG_BLUE='\033[44m';  BG_GREEN='\033[42m'; BG_RED='\033[41m'

log()     { echo -e "${GREEN}  ✔${RESET}  $*"; }
info()    { echo -e "${BLUE}  →${RESET}  $*"; }
warn()    { echo -e "${YELLOW}  ⚠${RESET}  $*"; }
error()   { echo -e "${RED}  ✘${RESET}  $*" >&2; }
step()    { echo -e "\n${BOLD}${CYAN}  ──────────────────────────────────────${RESET}"; \
            echo -e "${BOLD}${CYAN}  $*${RESET}"; \
            echo -e "${BOLD}${CYAN}  ──────────────────────────────────────${RESET}\n"; }
abort()   { error "$*"; press_enter; return 1; }

press_enter() {
  echo -e "\n  ${DIM}Pressione ENTER para continuar...${RESET}"
  read -r
}

confirm() {
  local msg="${1:-Confirmar?}"
  echo -e "\n  ${YELLOW}${msg} [s/N]${RESET} "
  read -r resp
  [[ "${resp,,}" == "s" || "${resp,,}" == "sim" ]]
}

spinner() {
  local pid=$1 msg=$2
  local frames=('⠋' '⠙' '⠹' '⠸' '⼼' '⠴' '⠦' '⠧' '⠇' '⠏')
  local i=0
  tput civis 2>/dev/null || true
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  ${CYAN}%s${RESET}  %s..." "${frames[$((i % ${#frames[@]}))]}" "$msg"
    sleep 0.08; ((i++))
  done
  tput cnorm 2>/dev/null || true
  wait "$pid"
  local rc=$?
  if [[ $rc -eq 0 ]]; then
    printf "\r  ${GREEN}✔${RESET}  %-50s\n" "$msg"
  else
    printf "\r  ${RED}✘${RESET}  %-50s\n" "$msg (erro — veja $LOG_DIR/install.log)"
  fi
  return $rc
}

run_bg() {
  local msg=$1; shift
  mkdir -p "$LOG_DIR"
  "$@" >> "$LOG_DIR/install.log" 2>&1 &
  spinner $! "$msg"
}

require_root() {
  [[ $EUID -eq 0 ]] || { error "Execute como root: sudo bash manage.sh"; exit 1; }
}

get_compose_cmd() {
  if docker compose version &>/dev/null 2>&1; then
    echo "docker compose"
  elif command -v docker-compose &>/dev/null; then
    echo "docker-compose"
  else
    echo ""
  fi
}

env_file() {
  local env=$1   # prod | test
  [[ "$env" == "prod" ]] && echo "$APP_DIR_PROD/.env" || echo "$APP_DIR_TEST/.env"
}

app_dir() {
  local env=$1
  [[ "$env" == "prod" ]] && echo "$APP_DIR_PROD" || echo "$APP_DIR_TEST"
}

# ══════════════════════════════════════════════════════════════════════════════
# BANNER
# ══════════════════════════════════════════════════════════════════════════════

show_banner() {
  clear
  echo -e "${BOLD}${CYAN}"
  echo "  ╔══════════════════════════════════════════════════════╗"
  echo "  ║                                                      ║"
  echo "  ║   ██╗   ██╗██╗███████╗██╗████████╗ █████╗ ███████╗  ║"
  echo "  ║   ██║   ██║██║██╔════╝██║╚══██╔══╝██╔══██╗██╔════╝  ║"
  echo "  ║   ██║   ██║██║███████╗██║   ██║   ███████║███████╗  ║"
  echo "  ║   ╚██╗ ██╔╝██║╚════██║██║   ██║   ██╔══██║╚════██║  ║"
  echo "  ║    ╚████╔╝ ██║███████║██║   ██║   ██║  ██║███████║  ║"
  echo "  ║     ╚═══╝  ╚═╝╚══════╝╚═╝   ╚═╝   ╚═╝  ╚═╝╚══════╝  ║"
  echo "  ║                                                      ║"
  echo "  ║          Central de Gestão da VPS  v1.0              ║"
  echo "  ╚══════════════════════════════════════════════════════╝"
  echo -e "${RESET}"

  # Barra de status rápido
  local prod_status test_status
  local compose; compose=$(get_compose_cmd)

  if [[ -n "$compose" && -f "$APP_DIR_PROD/docker-compose.yml" ]]; then
    local running; running=$(cd "$APP_DIR_PROD" && $compose ps -q 2>/dev/null | wc -l)
    [[ $running -gt 0 ]] \
      && prod_status="${GREEN}● PROD online${RESET}" \
      || prod_status="${RED}○ PROD offline${RESET}"
  else
    prod_status="${DIM}○ PROD não instalado${RESET}"
  fi

  if [[ -n "$compose" && -f "$APP_DIR_TEST/docker-compose.yml" ]]; then
    local running; running=$(cd "$APP_DIR_TEST" && $compose ps -q 2>/dev/null | wc -l)
    [[ $running -gt 0 ]] \
      && test_status="${YELLOW}● TEST online${RESET}" \
      || test_status="${DIM}○ TEST offline${RESET}"
  else
    test_status="${DIM}○ TEST não instalado${RESET}"
  fi

  echo -e "  ${prod_status}    ${test_status}    ${DIM}$(date '+%d/%m/%Y %H:%M:%S')${RESET}"
  echo ""
}

# ══════════════════════════════════════════════════════════════════════════════
# MENU
# ══════════════════════════════════════════════════════════════════════════════

show_menu() {
  show_banner
  echo -e "  ${BOLD}${WHITE}  INSTALAÇÃO & ATUALIZAÇÃO${RESET}"
  echo -e "  ${GREEN} 1${RESET}  Instalar  ${BOLD}PRODUÇÃO${RESET}"
  echo -e "  ${GREEN} 2${RESET}  Instalar  ${YELLOW}TESTES${RESET}"
  echo -e "  ${CYAN} 3${RESET}  Atualizar ${BOLD}PRODUÇÃO${RESET}"
  echo -e "  ${CYAN} 4${RESET}  Atualizar ${YELLOW}TESTES${RESET}"
  echo ""
  echo -e "  ${BOLD}${WHITE}  DADOS${RESET}"
  echo -e "  ${BLUE} 5${RESET}  Backup"
  echo -e "  ${BLUE} 6${RESET}  Restaurar Backup"
  echo -e "  ${MAGENTA} 7${RESET}  Replicar PROD → TESTES"
  echo ""
  echo -e "  ${BOLD}${WHITE}  OPERAÇÕES${RESET}"
  echo -e "  ${YELLOW} 8${RESET}  Reiniciar serviços"
  echo -e "  ${WHITE} 9${RESET}  Status"
  echo -e "  ${WHITE}10${RESET}  Monitor servidor"
  echo ""
  echo -e "  ${BOLD}${WHITE}  DIAGNÓSTICO${RESET}"
  echo -e "  ${WHITE}11${RESET}  Ver logs"
  echo -e "  ${WHITE}12${RESET}  Logs em tempo real"
  echo -e "  ${WHITE}13${RESET}  Informações do servidor"
  echo -e "  ${WHITE}14${RESET}  Versão do sistema"
  echo ""
  echo -e "  ${RED} 0${RESET}  Sair"
  echo ""
  echo -ne "  ${BOLD}Escolha uma opção:${RESET} "
}

# ══════════════════════════════════════════════════════════════════════════════
# NÚCLEO DE INSTALAÇÃO (compartilhado entre PROD e TEST)
# ══════════════════════════════════════════════════════════════════════════════

_instalar_dependencias_sistema() {
  export DEBIAN_FRONTEND=noninteractive
  local PKG="apt-get"

  step "Verificando requisitos do sistema"

  # OS
  . /etc/os-release
  info "Sistema: ${PRETTY_NAME} | Arch: $(uname -m)"
  [[ "$ID" != "ubuntu" && "$ID" != "debian" ]] && \
    { error "OS não suportado: $ID"; return 1; }

  # RAM
  local ram; ram=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
  [[ $ram -lt $MIN_RAM_MB ]] && \
    { error "RAM insuficiente: ${ram}MB < ${MIN_RAM_MB}MB"; return 1; }
  log "RAM: ${ram} MB"

  # Disco
  local disk; disk=$(df / --output=avail -BG | tail -1 | tr -dc '0-9')
  [[ $disk -lt $MIN_DISK_GB ]] && \
    { error "Disco insuficiente: ${disk}GB < ${MIN_DISK_GB}GB"; return 1; }
  log "Disco: ${disk} GB livres"

  # Internet
  curl -fsSL --max-time 8 https://google.com > /dev/null 2>&1 || \
    { error "Sem acesso à internet"; return 1; }
  log "Internet OK"

  step "Atualizando sistema operacional"
  run_bg "Atualizando índice de pacotes"  $PKG update -y
  run_bg "Atualizando pacotes instalados" $PKG upgrade -y
  run_bg "Instalando dependências base"   $PKG install -y \
    curl wget git unzip zip build-essential software-properties-common \
    apt-transport-https ca-certificates gnupg lsb-release \
    ufw fail2ban openssl net-tools jq \
    python3 python3-pip python3-venv python3-dev libpq-dev gcc

  step "Instalando Docker"
  if ! command -v docker &>/dev/null; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/${ID}/gpg" \
      -o /etc/apt/keyrings/docker.asc 2>/dev/null
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
      https://download.docker.com/linux/${ID} \
      $(. /etc/os-release && echo "${VERSION_CODENAME:-$(lsb_release -cs)}") stable" \
      > /etc/apt/sources.list.d/docker.list
    run_bg "Instalando Docker Engine" \
      bash -c "$PKG update -y && $PKG install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
    systemctl enable --now docker
    log "Docker instalado: $(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1)"
  else
    log "Docker já instalado: $(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1)"
  fi

  # Nginx
  if ! command -v nginx &>/dev/null; then
    run_bg "Instalando Nginx" $PKG install -y nginx
  fi
  systemctl enable nginx
  log "Nginx: $(nginx -v 2>&1 | grep -oP 'nginx/[\d.]+')"

  # Usuário do sistema
  if ! id "$APP_USER" &>/dev/null; then
    useradd -r -m -d "/opt/$APP_NAME" -s /bin/bash "$APP_USER"
    usermod -aG docker "$APP_USER"
    log "Usuário '$APP_USER' criado"
  fi

  # Swap (se RAM < 2GB)
  if [[ $ram -lt 2048 ]] && ! swapon --show=NAME --noheadings 2>/dev/null | grep -q .; then
    info "Criando swap de 2GB (RAM < 2GB)..."
    fallocate -l 2G /swapfile && chmod 600 /swapfile
    mkswap /swapfile > /dev/null && swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    log "Swap de 2GB criado"
  fi

  # Kernel tweaks
  cat >> /etc/sysctl.conf << 'SYSCTL' 2>/dev/null || true

# Visitas — produção
net.core.somaxconn=65535
net.ipv4.tcp_max_syn_backlog=65535
fs.file-max=100000
SYSCTL
  sysctl -p > /dev/null 2>&1 || true

  # Firewall
  ufw --force reset > /dev/null 2>&1
  ufw default deny incoming > /dev/null 2>&1
  ufw default allow outgoing > /dev/null 2>&1
  ufw allow ssh > /dev/null 2>&1
  ufw allow 80/tcp > /dev/null 2>&1
  ufw allow 443/tcp > /dev/null 2>&1
  ufw --force enable > /dev/null 2>&1
  log "Firewall UFW configurado"

  # Fail2ban
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
}

_gerar_env() {
  local dir=$1 env_type=$2  # prod | test
  local db_name port_back port_front domain

  if [[ "$env_type" == "prod" ]]; then
    db_name="$DB_NAME_PROD"; port_back=$PORT_PROD_BACKEND
    port_front=$PORT_PROD_FRONTEND; domain="$DOMAIN_PROD"
  else
    db_name="$DB_NAME_TEST"; port_back=$PORT_TEST_BACKEND
    port_front=$PORT_TEST_FRONTEND; domain="$DOMAIN_TEST"
  fi

  local db_pass secret_key
  db_pass=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)
  secret_key=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 64)

  # Se já existe, manter senhas existentes
  if [[ -f "$dir/.env" ]]; then
    local existing_pass; existing_pass=$(grep "^POSTGRES_PASSWORD=" "$dir/.env" | cut -d= -f2)
    local existing_key; existing_key=$(grep "^SECRET_KEY=" "$dir/.env" | cut -d= -f2)
    [[ -n "$existing_pass" ]] && db_pass="$existing_pass"
    [[ -n "$existing_key" ]] && secret_key="$existing_key"
    cp "$dir/.env" "$dir/.env.bak.$(date +%Y%m%d%H%M%S)"
  fi

  cat > "$dir/.env" << EOF
# Gerado automaticamente — $(date) — ambiente: ${env_type^^}
ENVIRONMENT=${env_type}
APP_ENV=${env_type}

# Banco de dados
DATABASE_URL=postgresql+asyncpg://${DB_USER}:${db_pass}@db:5432/${db_name}
POSTGRES_DB=${db_name}
POSTGRES_USER=${DB_USER}
POSTGRES_PASSWORD=${db_pass}

# Redis
REDIS_URL=redis://redis:6379/0

# Segurança
SECRET_KEY=${secret_key}
ACCESS_TOKEN_EXPIRE_MINUTES=480
REFRESH_TOKEN_EXPIRE_DAYS=30

# Rede
APP_DOMAIN=${domain}
BACKEND_PORT=${port_back}
FRONTEND_PORT=${port_front}

# App
CHECKIN_RADIUS_METERS=300
GOOGLE_MAPS_API_KEY=

# SMTP (opcional)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EOF
  chmod 600 "$dir/.env"
  chown "$APP_USER:$APP_USER" "$dir/.env" 2>/dev/null || true
}

_gerar_compose() {
  local dir=$1 env_type=$2
  local port_back port_front vol_prefix

  if [[ "$env_type" == "prod" ]]; then
    port_back=$PORT_PROD_BACKEND; port_front=$PORT_PROD_FRONTEND
    vol_prefix="/opt/visitas/prod/data"
  else
    port_back=$PORT_TEST_BACKEND; port_front=$PORT_TEST_FRONTEND
    vol_prefix="/opt/visitas/test/data"
  fi

  mkdir -p "$vol_prefix/postgres" "$vol_prefix/redis" "$vol_prefix/uploads"

  cat > "$dir/docker-compose.yml" << COMPOSE
version: "3.9"

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
    ports:
      - "127.0.0.1:${port_back}:8000"
    volumes:
      - ${vol_prefix}/uploads:/app/uploads
      - /opt/visitas/logs:/app/logs
    networks: [net-${env_type}]
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
    image: visitas-frontend:${env_type}
    restart: unless-stopped
    ports:
      - "127.0.0.1:${port_front}:80"
    networks: [net-${env_type}]

networks:
  net-${env_type}:
    driver: bridge
COMPOSE
}

_configurar_nginx() {
  local env_type=$1
  local domain port_back port_front conf

  if [[ "$env_type" == "prod" ]]; then
    domain="$DOMAIN_PROD"; port_back=$PORT_PROD_BACKEND
    port_front=$PORT_PROD_FRONTEND; conf="/etc/nginx/sites-available/visitas-prod"
  else
    domain="$DOMAIN_TEST"; port_back=$PORT_TEST_BACKEND
    port_front=$PORT_TEST_FRONTEND; conf="/etc/nginx/sites-available/visitas-test"
  fi

  cat > "$conf" << NGINX
upstream ${env_type}_backend  { server 127.0.0.1:${port_back};  keepalive 16; }
upstream ${env_type}_frontend { server 127.0.0.1:${port_front}; keepalive 8; }

server {
    listen 80;
    server_name ${domain};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name ${domain};

    ssl_certificate     /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;
    client_max_body_size 50M;

    location /api/ {
        proxy_pass http://${env_type}_backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }

    location ~ ^/(docs|redoc|openapi.json) {
        proxy_pass http://${env_type}_backend;
        proxy_set_header Host \$host;
    }

    location / {
        proxy_pass http://${env_type}_frontend;
        proxy_set_header Host \$host;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX

  # Versão sem SSL (fallback enquanto DNS não aponta)
  local server_ip domain_ip
  server_ip=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo "")
  domain_ip=$(getent hosts "$domain" 2>/dev/null | awk '{print $1}' | head -1 || echo "")

  ln -sf "$conf" "/etc/nginx/sites-enabled/visitas-${env_type}"

  if [[ -n "$server_ip" && "$server_ip" == "$domain_ip" ]]; then
    if ! command -v certbot &>/dev/null; then
      apt-get install -y certbot python3-certbot-nginx > /dev/null 2>&1
    fi
    mkdir -p /var/www/certbot
    certbot --nginx -d "$domain" --non-interactive --agree-tos \
      --email "$CERTBOT_EMAIL" --redirect --no-eff-email 2>/dev/null && \
      log "SSL configurado para $domain" || \
      warn "Certbot falhou — configure manualmente após DNS estabilizar"

    # Renovação automática
    (crontab -l 2>/dev/null | grep -v "certbot renew"; \
     echo "0 3 * * * certbot renew --quiet && systemctl reload nginx") | crontab -
  else
    warn "DNS de '$domain' não aponta para este servidor."
    warn "Após apontar o DNS, execute: certbot --nginx -d $domain --email $CERTBOT_EMAIL --agree-tos --non-interactive"

    # Nginx só HTTP enquanto aguarda SSL
    cat > "$conf" << NGINX_HTTP
upstream ${env_type}_backend  { server 127.0.0.1:${port_back};  keepalive 16; }
upstream ${env_type}_frontend { server 127.0.0.1:${port_front}; keepalive 8; }

server {
    listen 80;
    server_name ${domain} _;
    client_max_body_size 50M;

    location /api/ {
        proxy_pass http://${env_type}_backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
    location / {
        proxy_pass http://${env_type}_frontend;
        proxy_set_header Host \$host;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX_HTTP
  fi

  nginx -t 2>/dev/null && systemctl reload nginx && log "Nginx recarregado"
}

_registrar_systemd() {
  local env_type=$1
  local dir; dir=$(app_dir "$env_type")
  local svc="visitas-${env_type}"

  cat > "/etc/systemd/system/${svc}.service" << SERVICE
[Unit]
Description=Visitas ${env_type^^}
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=${APP_USER}
WorkingDirectory=${dir}
EnvironmentFile=${dir}/.env
ExecStart=$(get_compose_cmd) up -d --remove-orphans
ExecStop=$(get_compose_cmd) down
TimeoutStartSec=300
TimeoutStopSec=60
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
SERVICE

  systemctl daemon-reload
  systemctl enable "$svc"
  log "Serviço systemd '${svc}' registrado e habilitado no boot"
}

_salvar_credenciais() {
  local env_type=$1
  local dir; dir=$(app_dir "$env_type")
  local info_file="/opt/visitas/INSTALL_${env_type^^}.txt"

  cat > "$info_file" << INFO
Instalação Visitas ${env_type^^} — $(date)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Diretório : ${dir}
Domínio   : $( [[ "$env_type" == "prod" ]] && echo "$DOMAIN_PROD" || echo "$DOMAIN_TEST" )
DB Name   : $( [[ "$env_type" == "prod" ]] && echo "$DB_NAME_PROD" || echo "$DB_NAME_TEST" )
DB User   : ${DB_USER}
DB Pass   : $(grep "^POSTGRES_PASSWORD=" "$dir/.env" | cut -d= -f2)
.env      : ${dir}/.env
INFO
  chmod 600 "$info_file"
  chown root:root "$info_file"
  log "Credenciais salvas em $info_file (apenas root)"
}

# ══════════════════════════════════════════════════════════════════════════════
# OPÇÃO 1 — INSTALAR PRODUÇÃO
# ══════════════════════════════════════════════════════════════════════════════

cmd_instalar() {
  local env_type=$1
  local dir; dir=$(app_dir "$env_type")
  local label; [[ "$env_type" == "prod" ]] && label="PRODUÇÃO" || label="TESTES"

  step "Instalando ambiente de ${label}"

  confirm "Iniciar instalação do ambiente ${label}?" || return 0

  require_root

  mkdir -p "$dir" "$BACKUP_DIR" "$LOG_DIR"
  chown -R "$APP_USER:$APP_USER" "/opt/visitas" 2>/dev/null || true

  # Instalar dependências do sistema (apenas uma vez)
  if ! command -v docker &>/dev/null; then
    _instalar_dependencias_sistema
  else
    log "Dependências do sistema já instaladas"
    # Atualizar SO de qualquer forma
    run_bg "Atualizando sistema" bash -c "apt-get update -y && apt-get upgrade -y"
  fi

  step "Configurando ambiente ${label}"

  _gerar_env "$dir" "$env_type"
  log ".env gerado em $dir/.env"

  _gerar_compose "$dir" "$env_type"
  log "docker-compose.yml gerado"

  _configurar_nginx "$env_type"

  _registrar_systemd "$env_type"

  # Backup automático (apenas prod)
  if [[ "$env_type" == "prod" ]]; then
    (crontab -l 2>/dev/null | grep -v "visitas-backup";
     echo "0 2 * * * bash $0 backup-auto >> $LOG_DIR/backup.log 2>&1") | crontab -
    log "Backup automático agendado (diário às 02:00)"
  fi

  _salvar_credenciais "$env_type"

  echo ""
  echo -e "${BOLD}${GREEN}  ╔══════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}${GREEN}  ║  ${label} instalado com sucesso!  ║${RESET}"
  echo -e "${BOLD}${GREEN}  ╚══════════════════════════════════════════╝${RESET}"
  echo ""

  if [[ -n "$GIT_REPO" ]]; then
    info "Clonando repositório..."
    local branch; [[ "$env_type" == "prod" ]] && branch="$GIT_BRANCH_PROD" || branch="$GIT_BRANCH_TEST"
    git clone --branch "$branch" "$GIT_REPO" "$dir/src" 2>/dev/null && \
      log "Código clonado de $GIT_REPO ($branch)" || \
      warn "Clone falhou — copie o código manualmente para $dir/"
  else
    warn "GIT_REPO não configurado. Copie o código para $dir/ e execute:"
    info "  cd $dir && docker build -f Dockerfile.backend -t visitas-backend:${env_type} ."
    info "  cd $dir && docker build -f Dockerfile.frontend -t visitas-frontend:${env_type} ."
    info "  systemctl start visitas-${env_type}"
  fi

  press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# OPÇÃO 3/4 — ATUALIZAR
# ══════════════════════════════════════════════════════════════════════════════

cmd_atualizar() {
  local env_type=$1
  local dir; dir=$(app_dir "$env_type")
  local label; [[ "$env_type" == "prod" ]] && label="PRODUÇÃO" || label="TESTES"
  local compose; compose=$(get_compose_cmd)

  step "Atualizando ${label}"
  [[ -z "$compose" ]] && { abort "Docker Compose não encontrado."; return 1; }
  [[ ! -f "$dir/docker-compose.yml" ]] && { abort "${label} não instalado."; return 1; }

  confirm "Atualizar ${label}? (haverá breve indisponibilidade)" || return 0

  cd "$dir"

  if [[ -n "$GIT_REPO" ]]; then
    local branch; [[ "$env_type" == "prod" ]] && branch="$GIT_BRANCH_PROD" || branch="$GIT_BRANCH_TEST"
    run_bg "Baixando código ($branch)" git -C "$dir/src" pull origin "$branch"
  fi

  run_bg "Baixando novas imagens Docker" $compose pull
  run_bg "Reiniciando containers"        $compose up -d --remove-orphans --force-recreate

  sleep 8

  # Verificar health
  local healthy=0
  for i in {1..12}; do
    local status; status=$($compose ps --format json 2>/dev/null | grep -c '"running"' || echo 0)
    [[ $status -gt 0 ]] && { healthy=1; break; }
    sleep 5
  done

  [[ $healthy -eq 1 ]] && log "Atualização concluída — containers rodando" \
    || warn "Alguns containers podem não estar saudáveis — verifique com opção 9"

  $compose ps
  press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# OPÇÃO 5 — BACKUP
# ══════════════════════════════════════════════════════════════════════════════

cmd_backup() {
  step "Backup"

  echo -e "  ${BOLD}Qual ambiente fazer backup?${RESET}"
  echo -e "  ${GREEN}1${RESET} Produção"
  echo -e "  ${YELLOW}2${RESET} Testes"
  echo -e "  ${CYAN}3${RESET} Ambos"
  echo -ne "\n  Opção: "
  read -r choice

  local envs=()
  case "$choice" in
    1) envs=("prod") ;;
    2) envs=("test") ;;
    3) envs=("prod" "test") ;;
    *) warn "Opção inválida."; press_enter; return ;;
  esac

  mkdir -p "$BACKUP_DIR"
  local DATE; DATE=$(date +%Y%m%d_%H%M%S)
  local compose; compose=$(get_compose_cmd)

  for env_type in "${envs[@]}"; do
    local dir; dir=$(app_dir "$env_type")
    local label; [[ "$env_type" == "prod" ]] && label="PROD" || label="TEST"

    info "Fazendo backup de $label..."

    # Banco de dados
    local db_container; db_container=$(cd "$dir" && $compose ps -q db 2>/dev/null | head -1)
    if [[ -n "$db_container" ]]; then
      local db_name; db_name=$(grep "^POSTGRES_DB=" "$dir/.env" | cut -d= -f2)
      local db_user; db_user=$(grep "^POSTGRES_USER=" "$dir/.env" | cut -d= -f2)

      docker exec "$db_container" \
        pg_dump -U "$db_user" "$db_name" 2>/dev/null \
        | gzip > "$BACKUP_DIR/db_${label}_${DATE}.sql.gz" && \
        log "DB backup: $BACKUP_DIR/db_${label}_${DATE}.sql.gz ($(du -sh "$BACKUP_DIR/db_${label}_${DATE}.sql.gz" | cut -f1))" || \
        warn "Falha no backup do banco $label"
    else
      warn "Container DB de $label não encontrado — pulando backup do banco"
    fi

    # Uploads
    if [[ -d "/opt/visitas/${env_type}/data/uploads" ]]; then
      tar -czf "$BACKUP_DIR/uploads_${label}_${DATE}.tar.gz" \
        -C "/opt/visitas/${env_type}/data" uploads/ 2>/dev/null && \
        log "Uploads backup: uploads_${label}_${DATE}.tar.gz" || \
        warn "Falha no backup dos uploads $label"
    fi
  done

  # Limpar backups antigos
  local removed; removed=$(find "$BACKUP_DIR" -name "*.gz" -mtime +"$BACKUP_KEEP_DAYS" -print -delete 2>/dev/null | wc -l)
  [[ $removed -gt 0 ]] && info "Removidos $removed backup(s) com mais de $BACKUP_KEEP_DAYS dias"

  echo ""
  echo -e "  ${BOLD}Backups disponíveis:${RESET}"
  ls -lh "$BACKUP_DIR"/*.gz 2>/dev/null | awk '{printf "  %s  %s\n", $5, $9}' || info "Nenhum backup encontrado."

  press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# OPÇÃO 6 — RESTAURAR BACKUP
# ══════════════════════════════════════════════════════════════════════════════

cmd_restaurar() {
  step "Restaurar Backup"

  local compose; compose=$(get_compose_cmd)
  [[ -z "$compose" ]] && { abort "Docker Compose não encontrado."; return; }

  # Listar backups disponíveis
  local backups=()
  mapfile -t backups < <(ls -t "$BACKUP_DIR"/db_*.sql.gz 2>/dev/null)

  if [[ ${#backups[@]} -eq 0 ]]; then
    warn "Nenhum backup de banco encontrado em $BACKUP_DIR."
    press_enter
    return
  fi

  echo -e "  ${BOLD}Backups disponíveis:${RESET}\n"
  for i in "${!backups[@]}"; do
    local size; size=$(du -sh "${backups[$i]}" | cut -f1)
    local mtime; mtime=$(stat -c '%y' "${backups[$i]}" | cut -d. -f1)
    echo -e "  ${GREEN}$((i+1))${RESET}  $(basename "${backups[$i]}")  ${DIM}(${size} — ${mtime})${RESET}"
  done

  echo -ne "\n  Escolha o backup [1-${#backups[@]}]: "
  read -r idx
  [[ ! "$idx" =~ ^[0-9]+$ || $idx -lt 1 || $idx -gt ${#backups[@]} ]] && \
    { warn "Seleção inválida."; press_enter; return; }

  local selected="${backups[$((idx-1))]}"
  local basename; basename=$(basename "$selected")

  # Detectar ambiente pelo nome do arquivo
  local env_type="prod"
  echo "$basename" | grep -qi "_TEST_" && env_type="test"

  echo -e "\n  ${YELLOW}⚠  ATENÇÃO: o banco de dados do ambiente ${env_type^^} será sobrescrito!${RESET}"
  confirm "Confirmar restauração de '$basename' no ambiente ${env_type^^}?" || return 0

  local dir; dir=$(app_dir "$env_type")
  local db_container; db_container=$(cd "$dir" && $compose ps -q db 2>/dev/null | head -1)
  [[ -z "$db_container" ]] && { abort "Container DB de ${env_type^^} não está rodando."; return; }

  local db_name; db_name=$(grep "^POSTGRES_DB=" "$dir/.env" | cut -d= -f2)
  local db_user; db_user=$(grep "^POSTGRES_USER=" "$dir/.env" | cut -d= -f2)

  info "Parando backend para evitar conexões ativas..."
  (cd "$dir" && $compose stop backend 2>/dev/null) || true

  info "Restaurando banco..."
  gunzip -c "$selected" | docker exec -i "$db_container" \
    psql -U "$db_user" -d "$db_name" 2>/dev/null && \
    log "Banco restaurado com sucesso!" || \
    error "Falha na restauração — verifique os logs"

  info "Reiniciando backend..."
  (cd "$dir" && $compose start backend 2>/dev/null) || true

  press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# OPÇÃO 7 — REPLICAR PROD → TEST
# ══════════════════════════════════════════════════════════════════════════════

cmd_replicar() {
  step "Replicar PRODUÇÃO → TESTES"

  local compose; compose=$(get_compose_cmd)
  [[ -z "$compose" ]] && { abort "Docker Compose não encontrado."; return; }
  [[ ! -f "$APP_DIR_PROD/docker-compose.yml" ]] && { abort "PRODUÇÃO não instalada."; return; }
  [[ ! -f "$APP_DIR_TEST/docker-compose.yml" ]] && { abort "TESTES não instalado."; return; }

  echo -e "  Esta operação irá:"
  echo -e "  ${CYAN}•${RESET} Fazer backup do banco de PRODUÇÃO"
  echo -e "  ${CYAN}•${RESET} Restaurar esse backup no banco de TESTES"
  echo -e "  ${CYAN}•${RESET} Copiar os uploads de PROD para TEST"
  echo -e "  ${RED}•${RESET} Sobrescrever todos os dados de TESTES"
  echo ""

  confirm "Confirmar replicação PROD → TEST?" || return 0

  local DATE; DATE=$(date +%Y%m%d_%H%M%S)
  local db_prod; db_prod=$(cd "$APP_DIR_PROD" && $compose ps -q db 2>/dev/null | head -1)
  local db_test; db_test=$(cd "$APP_DIR_TEST" && $compose ps -q db 2>/dev/null | head -1)

  [[ -z "$db_prod" ]] && { abort "DB de PROD não está rodando."; return; }
  [[ -z "$db_test" ]] && { abort "DB de TEST não está rodando."; return; }

  local db_prod_name; db_prod_name=$(grep "^POSTGRES_DB=" "$APP_DIR_PROD/.env" | cut -d= -f2)
  local db_prod_user; db_prod_user=$(grep "^POSTGRES_USER=" "$APP_DIR_PROD/.env" | cut -d= -f2)
  local db_test_name; db_test_name=$(grep "^POSTGRES_DB=" "$APP_DIR_TEST/.env" | cut -d= -f2)
  local db_test_user; db_test_user=$(grep "^POSTGRES_USER=" "$APP_DIR_TEST/.env" | cut -d= -f2)

  local dump_file="$BACKUP_DIR/replica_prod_${DATE}.sql.gz"

  info "Exportando banco de PRODUÇÃO..."
  docker exec "$db_prod" pg_dump -U "$db_prod_user" "$db_prod_name" 2>/dev/null \
    | gzip > "$dump_file" && log "Dump criado: $(du -sh "$dump_file" | cut -f1)" || \
    { abort "Falha no dump de PRODUÇÃO."; return; }

  info "Parando backend de TESTES..."
  (cd "$APP_DIR_TEST" && $compose stop backend 2>/dev/null) || true

  info "Restaurando no banco de TESTES..."
  gunzip -c "$dump_file" | docker exec -i "$db_test" \
    psql -U "$db_test_user" -d "$db_test_name" 2>/dev/null && \
    log "Banco de TESTES atualizado!" || \
    { error "Falha na restauração em TESTES."; }

  info "Sincronizando uploads..."
  rsync -a "/opt/visitas/prod/data/uploads/" "/opt/visitas/test/data/uploads/" 2>/dev/null && \
    log "Uploads sincronizados" || warn "rsync não disponível — uploads não sincronizados"

  info "Reiniciando TESTES..."
  (cd "$APP_DIR_TEST" && $compose start backend 2>/dev/null) || true

  log "Replicação concluída"
  press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# OPÇÃO 8 — REINICIAR SERVIÇOS
# ══════════════════════════════════════════════════════════════════════════════

cmd_reiniciar() {
  step "Reiniciar Serviços"

  local compose; compose=$(get_compose_cmd)
  [[ -z "$compose" ]] && { abort "Docker Compose não encontrado."; return; }

  echo -e "  ${BOLD}O que deseja reiniciar?${RESET}\n"
  echo -e "  ${GREEN}1${RESET}  Todos os containers de PRODUÇÃO"
  echo -e "  ${YELLOW}2${RESET}  Todos os containers de TESTES"
  echo -e "  ${CYAN}3${RESET}  Ambos os ambientes"
  echo -e "  ${WHITE}4${RESET}  Apenas backend (PROD)"
  echo -e "  ${WHITE}5${RESET}  Apenas backend (TEST)"
  echo -e "  ${WHITE}6${RESET}  Nginx"
  echo -ne "\n  Opção: "
  read -r choice

  case "$choice" in
    1)
      confirm "Reiniciar todos os containers de PRODUÇÃO?" || return 0
      (cd "$APP_DIR_PROD" && $compose restart) && log "PRODUÇÃO reiniciada" ;;
    2)
      confirm "Reiniciar todos os containers de TESTES?" || return 0
      (cd "$APP_DIR_TEST" && $compose restart) && log "TESTES reiniciado" ;;
    3)
      confirm "Reiniciar AMBOS os ambientes?" || return 0
      (cd "$APP_DIR_PROD" && $compose restart 2>/dev/null) && log "PRODUÇÃO reiniciada"
      (cd "$APP_DIR_TEST" && $compose restart 2>/dev/null) && log "TESTES reiniciado" ;;
    4)
      (cd "$APP_DIR_PROD" && $compose restart backend) && log "Backend PROD reiniciado" ;;
    5)
      (cd "$APP_DIR_TEST" && $compose restart backend) && log "Backend TEST reiniciado" ;;
    6)
      nginx -t && systemctl reload nginx && log "Nginx recarregado" ;;
    *)
      warn "Opção inválida." ;;
  esac

  press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# OPÇÃO 9 — STATUS
# ══════════════════════════════════════════════════════════════════════════════

cmd_status() {
  step "Status dos Ambientes"

  local compose; compose=$(get_compose_cmd)

  for env_type in prod test; do
    local dir; dir=$(app_dir "$env_type")
    local label; [[ "$env_type" == "prod" ]] && label="PRODUÇÃO" || label="TESTES"
    local color; [[ "$env_type" == "prod" ]] && color="$GREEN" || color="$YELLOW"

    echo -e "  ${color}${BOLD}── ${label} ──${RESET}"

    if [[ ! -f "$dir/docker-compose.yml" ]]; then
      echo -e "  ${DIM}  Não instalado${RESET}\n"
      continue
    fi

    if [[ -n "$compose" ]]; then
      (cd "$dir" && $compose ps 2>/dev/null) | while IFS= read -r line; do
        echo "    $line"
      done
    fi

    # Uso de recursos
    local data_size; data_size=$(du -sh "/opt/visitas/${env_type}/data" 2>/dev/null | cut -f1 || echo "?")
    echo -e "\n    ${DIM}Dados: ${data_size}${RESET}"

    # Último backup
    local last_bak; last_bak=$(ls -t "$BACKUP_DIR"/db_${label^}_*.sql.gz 2>/dev/null | head -1)
    if [[ -n "$last_bak" ]]; then
      local age; age=$(( ($(date +%s) - $(stat -c %Y "$last_bak")) / 3600 ))
      echo -e "    ${DIM}Último backup: há ${age}h${RESET}"
    fi
    echo ""
  done

  echo -e "  ${BOLD}── Nginx ──${RESET}"
  systemctl is-active nginx > /dev/null 2>&1 \
    && echo -e "    ${GREEN}● nginx ativo${RESET}" \
    || echo -e "    ${RED}○ nginx inativo${RESET}"

  echo -e "\n  ${BOLD}── Firewall ──${RESET}"
  ufw status 2>/dev/null | grep -E "^Status:|^To" | while IFS= read -r line; do
    echo "    $line"
  done

  press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# OPÇÃO 10 — MONITOR SERVIDOR
# ══════════════════════════════════════════════════════════════════════════════

cmd_monitor() {
  # Monitor em tempo real — atualiza a cada 3 segundos
  local compose; compose=$(get_compose_cmd)

  while true; do
    clear
    echo -e "${BOLD}${CYAN}  ── Monitor do Servidor — $(date '+%d/%m/%Y %H:%M:%S') ──${RESET}"
    echo -e "  ${DIM}Pressione Ctrl+C ou Q para sair${RESET}\n"

    # CPU
    local cpu_use; cpu_use=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | tr -d '%us,')
    local load; load=$(uptime | awk -F'load average:' '{print $2}' | xargs)
    echo -e "  ${BOLD}CPU${RESET}   ${cpu_use:-?}% uso  |  Load: $load"

    # RAM
    local ram_info; ram_info=$(free -m | awk '/^Mem:/ {printf "%dMB / %dMB (%.0f%%)", $3, $2, $3/$2*100}')
    echo -e "  ${BOLD}RAM${RESET}   $ram_info"

    # Swap
    local swap_info; swap_info=$(free -m | awk '/^Swap:/ {if($2>0) printf "%dMB / %dMB", $3, $2; else print "não configurado"}')
    echo -e "  ${BOLD}Swap${RESET}  $swap_info"

    # Disco
    echo -e "  ${BOLD}Disco${RESET}"
    df -h / /opt 2>/dev/null | awk 'NR>1 {printf "        %-15s %5s usados de %5s (%s)\n", $6, $3, $2, $5}'

    echo ""

    # Containers
    echo -e "  ${BOLD}Containers${RESET}"
    if [[ -n "$compose" ]]; then
      for env_type in prod test; do
        local dir; dir=$(app_dir "$env_type")
        [[ ! -f "$dir/docker-compose.yml" ]] && continue
        local label; [[ "$env_type" == "prod" ]] && label="PROD" || label="TEST"
        (cd "$dir" && $compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null) | \
          grep -v "^NAME" | while IFS= read -r line; do
            if echo "$line" | grep -qi "running\|up"; then
              echo -e "    ${GREEN}●${RESET} [$label] $line"
            else
              echo -e "    ${RED}○${RESET} [$label] $line"
            fi
          done
      done
    fi

    echo ""

    # Rede
    echo -e "  ${BOLD}Rede${RESET}"
    local rx tx
    rx=$(cat /proc/net/dev 2>/dev/null | awk '/eth0|ens|enp/ {printf "%.1f MB", $2/1048576; exit}')
    tx=$(cat /proc/net/dev 2>/dev/null | awk '/eth0|ens|enp/ {printf "%.1f MB", $10/1048576; exit}')
    echo -e "    RX: ${rx:-?}  |  TX: ${tx:-?}"

    echo ""

    # Nginx
    local nginx_status; nginx_status=$(systemctl is-active nginx 2>/dev/null)
    [[ "$nginx_status" == "active" ]] \
      && echo -e "  ${BOLD}Nginx${RESET} ${GREEN}● ativo${RESET}" \
      || echo -e "  ${BOLD}Nginx${RESET} ${RED}○ $nginx_status${RESET}"

    # Verificar tecla Q (sem bloquear)
    if read -r -t 3 -n1 key 2>/dev/null; then
      [[ "${key,,}" == "q" ]] && break
    fi
  done

  echo ""
  press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# OPÇÃO 11 — VER LOGS
# ══════════════════════════════════════════════════════════════════════════════

cmd_logs() {
  step "Ver Logs"

  local compose; compose=$(get_compose_cmd)

  echo -e "  ${BOLD}Qual log deseja visualizar?${RESET}\n"
  echo -e "  ${GREEN} 1${RESET}  Backend     PRODUÇÃO  (últimas 100 linhas)"
  echo -e "  ${GREEN} 2${RESET}  Frontend    PRODUÇÃO"
  echo -e "  ${GREEN} 3${RESET}  Banco DB    PRODUÇÃO"
  echo -e "  ${YELLOW} 4${RESET}  Backend     TESTES"
  echo -e "  ${YELLOW} 5${RESET}  Frontend    TESTES"
  echo -e "  ${WHITE} 6${RESET}  Nginx       (error.log)"
  echo -e "  ${WHITE} 7${RESET}  Nginx       (access.log)"
  echo -e "  ${CYAN} 8${RESET}  Backup      (cron)"
  echo -e "  ${CYAN} 9${RESET}  Instalação  (install.log)"
  echo -ne "\n  Opção: "
  read -r choice

  case "$choice" in
    1) [[ -n "$compose" ]] && (cd "$APP_DIR_PROD" && $compose logs backend --tail=100 2>/dev/null) ;;
    2) [[ -n "$compose" ]] && (cd "$APP_DIR_PROD" && $compose logs frontend --tail=100 2>/dev/null) ;;
    3) [[ -n "$compose" ]] && (cd "$APP_DIR_PROD" && $compose logs db --tail=100 2>/dev/null) ;;
    4) [[ -n "$compose" ]] && (cd "$APP_DIR_TEST" && $compose logs backend --tail=100 2>/dev/null) ;;
    5) [[ -n "$compose" ]] && (cd "$APP_DIR_TEST" && $compose logs frontend --tail=100 2>/dev/null) ;;
    6) tail -100 /var/log/nginx/error.log 2>/dev/null ;;
    7) tail -100 /var/log/nginx/access.log 2>/dev/null ;;
    8) tail -100 "$LOG_DIR/backup.log" 2>/dev/null || warn "Nenhum log de backup ainda." ;;
    9) tail -200 "$LOG_DIR/install.log" 2>/dev/null || warn "Nenhum log de instalação encontrado." ;;
    *) warn "Opção inválida." ;;
  esac

  press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# OPÇÃO 12 — LOGS EM TEMPO REAL
# ══════════════════════════════════════════════════════════════════════════════

cmd_logs_realtime() {
  step "Logs em Tempo Real"

  local compose; compose=$(get_compose_cmd)

  echo -e "  ${BOLD}Qual serviço acompanhar?${RESET}\n"
  echo -e "  ${GREEN}1${RESET}  Backend  PRODUÇÃO"
  echo -e "  ${GREEN}2${RESET}  Todos os containers PRODUÇÃO"
  echo -e "  ${YELLOW}3${RESET}  Backend  TESTES"
  echo -e "  ${YELLOW}4${RESET}  Todos os containers TESTES"
  echo -e "  ${WHITE}5${RESET}  Nginx (access + error)"
  echo -ne "\n  Opção: "
  read -r choice

  echo -e "\n  ${DIM}Pressione Ctrl+C para parar${RESET}\n"
  sleep 1

  case "$choice" in
    1) (cd "$APP_DIR_PROD" && $compose logs backend -f --tail=30 2>/dev/null) ;;
    2) (cd "$APP_DIR_PROD" && $compose logs -f --tail=20 2>/dev/null) ;;
    3) (cd "$APP_DIR_TEST" && $compose logs backend -f --tail=30 2>/dev/null) ;;
    4) (cd "$APP_DIR_TEST" && $compose logs -f --tail=20 2>/dev/null) ;;
    5) tail -f /var/log/nginx/access.log /var/log/nginx/error.log 2>/dev/null ;;
    *) warn "Opção inválida." ;;
  esac

  press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# OPÇÃO 13 — INFORMAÇÕES DO SERVIDOR
# ══════════════════════════════════════════════════════════════════════════════

cmd_info_servidor() {
  step "Informações do Servidor"

  local PASS=0 WARN=0 FAIL=0
_info_ok()   { echo -e "  ${GREEN}✔${RESET}  $*"; ((PASS++)) || true; }
_info_wl()   { echo -e "  ${YELLOW}⚠${RESET}  $*"; ((WARN++)) || true; }
_info_fl()   { echo -e "  ${RED}✘${RESET}  $*"; ((FAIL++)) || true; }

  . /etc/os-release
  echo -e "  ${BOLD}── Sistema ──${RESET}"
  echo -e "  OS         : ${PRETTY_NAME}"
  echo -e "  Kernel     : $(uname -r)"
  echo -e "  Hostname   : $(hostname -f 2>/dev/null || hostname)"
  echo -e "  IP Público : $(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo 'não detectado')"
  echo -e "  Uptime     : $(uptime -p)"
  echo -e "  Timezone   : $(timedatectl show -p Timezone --value 2>/dev/null || date +%Z)"
  echo ""

  echo -e "  ${BOLD}── Hardware ──${RESET}"
  echo -e "  CPUs       : $(nproc) core(s) — $(grep 'model name' /proc/cpuinfo | head -1 | cut -d: -f2 | xargs)"
  echo -e "  RAM        : $(free -h | awk '/^Mem:/ {print $2 " total / " $3 " usados / " $7 " disponíveis"}')"
  echo -e "  Swap       : $(free -h | awk '/^Swap:/ {if($2=="0B") print "não configurado"; else print $3 " / " $2}')"
  echo -e "  Disco (/opt): $(df -h /opt 2>/dev/null | tail -1 | awk '{print $3 " usados / " $2 " total (" $5 ")"}')"
  echo ""

  echo -e "  ${BOLD}── Versões instaladas ──${RESET}"
  echo -e "  Docker     : $(docker --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' | head -1 || echo 'não instalado')"
  echo -e "  Compose    : $(docker compose version --short 2>/dev/null || docker-compose version --short 2>/dev/null || echo 'não instalado')"
  echo -e "  Nginx      : $(nginx -v 2>&1 | grep -oP 'nginx/[\d.]+' || echo 'não instalado')"
  echo -e "  Python     : $(python3 --version 2>/dev/null | cut -d' ' -f2 || echo 'não instalado')"
  echo -e "  OpenSSL    : $(openssl version 2>/dev/null | cut -d' ' -f2 || echo 'não instalado')"
  echo ""

  echo -e "  ${BOLD}── Segurança ──${RESET}"
  ufw status 2>/dev/null | grep -q "active" \
    && _info_ok "UFW firewall ativo" || _info_wl "UFW inativo"
  systemctl is-active fail2ban > /dev/null 2>&1 \
    && _info_ok "Fail2ban ativo" || _info_wl "Fail2ban inativo"
  [[ -d /etc/letsencrypt/live ]] && \
    { local domains; domains=$(ls /etc/letsencrypt/live/ 2>/dev/null | grep -v README | tr '\n' ' '); \
      _info_ok "SSL configurado: $domains"; } || \
    warn_l "Nenhum certificado SSL encontrado"
  systemctl is-active unattended-upgrades > /dev/null 2>&1 \
    && _info_ok "Atualizações automáticas ativas" || _info_wl "Atualizações automáticas inativas"
  echo ""

  echo -e "  ${BOLD}── Backups ──${RESET}"
  local total_baks; total_baks=$(ls "$BACKUP_DIR"/*.gz 2>/dev/null | wc -l)
  local total_size; total_size=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1 || echo "?")
  echo -e "  Total backups : $total_baks arquivo(s) — $total_size"
  local last_bak; last_bak=$(ls -t "$BACKUP_DIR"/*.gz 2>/dev/null | head -1)
  if [[ -n "$last_bak" ]]; then
    local age; age=$(( ($(date +%s) - $(stat -c %Y "$last_bak")) / 3600 ))
    [[ $age -lt 26 ]] && ok "Último backup há ${age}h" || _info_wl "Último backup há ${age}h"
  else
    _info_wl "Nenhum backup encontrado"
  fi
  echo ""

  echo -e "  ${BOLD}${GREEN}✔ OK: $PASS  ${YELLOW}⚠ Avisos: $WARN  ${RED}✘ Falhas: $FAIL${RESET}"

  press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# OPÇÃO 14 — VERSÃO DO SISTEMA
# ══════════════════════════════════════════════════════════════════════════════

cmd_versao() {
  step "Versão do Sistema"

  local compose; compose=$(get_compose_cmd)

  for env_type in prod test; do
    local dir; dir=$(app_dir "$env_type")
    local label; [[ "$env_type" == "prod" ]] && label="PRODUÇÃO" || label="TESTES"
    local color; [[ "$env_type" == "prod" ]] && color="$GREEN" || color="$YELLOW"

    echo -e "  ${color}${BOLD}── ${label} ──${RESET}"

    if [[ ! -f "$dir/docker-compose.yml" ]]; then
      echo -e "    ${DIM}Não instalado${RESET}\n"
      continue
    fi

    # Versão via Git
    if [[ -d "$dir/.git" ]]; then
      local commit; commit=$(git -C "$dir" rev-parse --short HEAD 2>/dev/null || echo "?")
      local branch; branch=$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
      local tag; tag=$(git -C "$dir" describe --tags --abbrev=0 2>/dev/null || echo "sem tag")
      local last_commit; last_commit=$(git -C "$dir" log -1 --format="%s (%ar)" 2>/dev/null || echo "?")
      echo -e "    Branch  : $branch"
      echo -e "    Commit  : $commit"
      echo -e "    Tag     : $tag"
      echo -e "    Último  : $last_commit"
    else
      echo -e "    ${DIM}Repositório git não encontrado em $dir${RESET}"
    fi

    # Imagens Docker em uso
    if [[ -n "$compose" ]]; then
      echo -e "    ${DIM}Imagens Docker:${RESET}"
      (cd "$dir" && $compose images 2>/dev/null) | grep -v "^CONTAINER\|^---" | \
        while IFS= read -r line; do echo -e "      $line"; done
    fi

    # Data de instalação/atualização
    if [[ -f "/opt/visitas/INSTALL_${env_type^^}.txt" ]]; then
      local inst_date; inst_date=$(head -2 "/opt/visitas/INSTALL_${env_type^^}.txt" | tail -1)
      echo -e "    ${DIM}Instalado: $inst_date${RESET}"
    fi
    echo ""
  done

  press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# DISPATCHER — roteamento de comandos
# ══════════════════════════════════════════════════════════════════════════════

dispatch() {
  local opt=$1
  case "$opt" in
    1)  cmd_instalar prod ;;
    2)  cmd_instalar test ;;
    3)  cmd_atualizar prod ;;
    4)  cmd_atualizar test ;;
    5)  cmd_backup ;;
    6)  cmd_restaurar ;;
    7)  cmd_replicar ;;
    8)  cmd_reiniciar ;;
    9)  cmd_status ;;
    10) cmd_monitor ;;
    11) cmd_logs ;;
    12) cmd_logs_realtime ;;
    13) cmd_info_servidor ;;
    14) cmd_versao ;;
    0)  echo -e "\n  ${DIM}Saindo...${RESET}\n"; exit 0 ;;
    backup-auto)
      # Chamado pelo cron — backup silencioso de prod
      mkdir -p "$BACKUP_DIR" "$LOG_DIR"
      local compose; compose=$(get_compose_cmd)
      [[ -z "$compose" || ! -f "$APP_DIR_PROD/docker-compose.yml" ]] && exit 0
      local DATE; DATE=$(date +%Y%m%d_%H%M%S)
      local db_container; db_container=$(cd "$APP_DIR_PROD" && $compose ps -q db 2>/dev/null | head -1)
      if [[ -n "$db_container" ]]; then
        local db_name; db_name=$(grep "^POSTGRES_DB=" "$APP_DIR_PROD/.env" | cut -d= -f2)
        local db_user_v; db_user_v=$(grep "^POSTGRES_USER=" "$APP_DIR_PROD/.env" | cut -d= -f2)
        docker exec "$db_container" pg_dump -U "$db_user_v" "$db_name" 2>/dev/null \
          | gzip > "$BACKUP_DIR/db_PROD_${DATE}.sql.gz"
        tar -czf "$BACKUP_DIR/uploads_PROD_${DATE}.tar.gz" \
          -C "/opt/visitas/prod/data" uploads/ 2>/dev/null || true
        find "$BACKUP_DIR" -name "*.gz" -mtime +"$BACKUP_KEEP_DAYS" -delete 2>/dev/null || true
        echo "$(date) — Backup automático concluído: db_PROD_${DATE}.sql.gz"
      fi
      exit 0
      ;;
    *)
      warn "Opção inválida: $opt"
      sleep 1
      ;;
  esac
}

# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

main() {
  # Execução direta via argumento: bash manage.sh 1
  if [[ $# -gt 0 ]]; then
    require_root
    dispatch "$1"
    exit 0
  fi

  # Menu interativo
  require_root

  while true; do
    show_menu
    read -r opt
    dispatch "$opt"
  done
}

main "$@"
