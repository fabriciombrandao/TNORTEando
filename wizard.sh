#!/usr/bin/env bash
# =============================================================================
#  VISITAS — Wizard de Instalação e Gestão
#
#  Um único comando para instalar, configurar e gerenciar tudo.
#  Não é necessário editar nenhum arquivo antes de rodar.
#
#  Uso:
#    curl -fsSL https://seuservidor.com/wizard.sh | sudo bash
#    — ou —
#    sudo bash wizard.sh
#
#  Testado em: Ubuntu 22.04 / 24.04 LTS · Debian 11 / 12
# =============================================================================

set -uo pipefail

# ══════════════════════════════════════════════════════════════════════════════
# CORES E UI
# ══════════════════════════════════════════════════════════════════════════════

R='\033[0;31m' G='\033[0;32m' Y='\033[1;33m' B='\033[0;34m'
C='\033[0;36m' M='\033[0;35m' W='\033[1;37m' D='\033[2m'
BOLD='\033[1m' RESET='\033[0m'
BG_C='\033[46m' BG_G='\033[42m' BG_R='\033[41m' FG_BK='\033[30m'

# Dimensões do terminal
COLS=$(tput cols 2>/dev/null || echo 80)
HALF=$(( COLS / 2 ))

# ── Primitivos de UI ──────────────────────────────────────────────────────────

_cls()    { clear; }
_line()   { printf "${D}%*s${RESET}\n" "$COLS" "" | tr ' ' '─'; }
_gap()    { echo ""; }

_header() {
  _cls
  echo -e "${BOLD}${C}"
  printf '%*s\n' "$COLS" "" | tr ' ' '═'
  printf "%-${COLS}s\n" "  VISITAS — Gestão de Carteira  |  Wizard v2.0"
  printf '%*s\n' "$COLS" "" | tr ' ' '═'
  echo -e "${RESET}"
}

_title() {
  _gap
  echo -e "  ${BOLD}${W}$*${RESET}"
  echo -e "  ${D}$(printf '%*s' $((COLS-4)) '' | tr ' ' '─')${RESET}"
  _gap
}

_ok()     { echo -e "  ${G}✔${RESET}  $*"; }
_info()   { echo -e "  ${B}→${RESET}  $*"; }
_warn()   { echo -e "  ${Y}⚠${RESET}  $*"; }
_err()    { echo -e "  ${R}✘${RESET}  $*" >&2; }
_step()   { echo -e "\n  ${BG_C}${FG_BK}${BOLD}  $*  ${RESET}"; _gap; }

_badge_ok()   { echo -e "  ${BG_G}${FG_BK}  ✔  ${RESET}  $*"; }
_badge_warn() { echo -e "  ${BG_R}${FG_BK}  ⚠  ${RESET}  $*"; }

_progress() {
  local current=$1 total=$2 label=$3
  local pct=$(( current * 100 / total ))
  local filled=$(( current * (COLS - 20) / total ))
  local empty=$(( (COLS - 20) - filled ))
  printf "  ${C}[${G}"
  printf '%*s' "$filled" '' | tr ' ' '█'
  printf "${D}"
  printf '%*s' "$empty" '' | tr ' ' '░'
  printf "${C}]${RESET} ${W}%3d%%${RESET}  %s\n" "$pct" "$label"
}

_spinner() {
  local pid=$1 msg=$2
  local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  local i=0
  tput civis 2>/dev/null || true
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  ${C}%s${RESET}  %-55s" "${frames[$((i % 10))]}" "$msg"
    sleep 0.08; ((i++)) || true
  done
  tput cnorm 2>/dev/null || true
  wait "$pid"
  local rc=$?
  if [[ $rc -eq 0 ]]; then
    printf "\r  ${G}✔${RESET}  %-55s\n" "$msg"
  else
    printf "\r  ${R}✘${RESET}  %-55s\n" "$msg"
  fi
  return $rc
}

_run() {
  # _run "Mensagem" comando args...
  local msg=$1; shift
  mkdir -p /opt/visitas/logs
  "$@" >> /opt/visitas/logs/wizard.log 2>&1 &
  _spinner $! "$msg"
}

# ── Inputs interativos ────────────────────────────────────────────────────────

_ask() {
  # _ask VAR "Pergunta" "default"
  local var=$1 prompt=$2 default=${3:-}
  local hint=""
  [[ -n "$default" ]] && hint=" ${D}[${default}]${RESET}"
  echo -ne "  ${W}▸${RESET}  ${prompt}${hint}: "
  read -r input
  [[ -z "$input" && -n "$default" ]] && input="$default"
  printf -v "$var" '%s' "$input"
}

_ask_secret() {
  local var=$1 prompt=$2
  echo -ne "  ${W}▸${RESET}  ${prompt}: "
  local input
  read -rs input
  echo ""
  printf -v "$var" '%s' "$input"
}

_ask_yn() {
  # Retorna 0 = sim, 1 = não
  local prompt=$1 default=${2:-s}
  local hint
  [[ "$default" == "s" ]] && hint="${W}S${RESET}/n" || hint="s/${W}N${RESET}"
  echo -ne "  ${W}▸${RESET}  ${prompt} [${hint}]: "
  read -r resp
  [[ -z "$resp" ]] && resp="$default"
  [[ "${resp,,}" == "s" || "${resp,,}" == "sim" || "${resp,,}" == "y" || "${resp,,}" == "yes" ]]
}

_ask_choice() {
  # _ask_choice VAR "Título" "Op1" "Op2" "Op3"...
  local var=$1 title=$2; shift 2
  local options=("$@")
  _gap
  echo -e "  ${W}${title}${RESET}"
  for i in "${!options[@]}"; do
    echo -e "  ${C}$((i+1))${RESET}  ${options[$i]}"
  done
  _gap
  local choice
  while true; do
    echo -ne "  ${W}▸${RESET}  Escolha [1-${#options[@]}]: "
    read -r choice
    if [[ "$choice" =~ ^[0-9]+$ && $choice -ge 1 && $choice -le ${#options[@]} ]]; then
      printf -v "$var" '%s' "$((choice-1))"
      break
    fi
    _warn "Opção inválida, tente novamente."
  done
}

_confirm_config() {
  # Exibe um resumo e pede confirmação
  local title=$1; shift
  local items=("$@")  # pares "label" "valor"
  _gap
  _line
  echo -e "  ${BOLD}${W}  Confirme as configurações:${RESET}"
  _line
  for (( i=0; i<${#items[@]}; i+=2 )); do
    printf "  ${D}%-30s${RESET}  ${W}%s${RESET}\n" "${items[$i]}" "${items[$((i+1))]}"
  done
  _line
  _gap
  _ask_yn "Tudo certo, pode prosseguir?"
}

_press_enter() {
  _gap
  echo -ne "  ${D}Pressione ENTER para continuar...${RESET}"
  read -r
}

_countdown() {
  local secs=$1 msg=$2
  for (( i=secs; i>0; i-- )); do
    printf "\r  ${Y}⏱${RESET}  %s em %ds..." "$msg" "$i"
    sleep 1
  done
  printf "\r%-70s\n" ""
}

# ══════════════════════════════════════════════════════════════════════════════
# ESTADO GLOBAL (preenchido pelo wizard)
# ══════════════════════════════════════════════════════════════════════════════

CFG_DOMAIN_PROD=""
CFG_DOMAIN_TEST=""
CFG_EMAIL=""
CFG_GIT_REPO=""
CFG_GIT_BRANCH_PROD="main"
CFG_GIT_BRANCH_TEST="develop"
CFG_INSTALL_ENV=""     # prod | test | both
CFG_ENABLE_TEST="n"
CFG_DB_PASS_PROD=""
CFG_DB_PASS_TEST=""
CFG_SECRET_PROD=""
CFG_SECRET_TEST=""

STATE_FILE="/opt/visitas/.wizard_state"

_save_state() {
  mkdir -p /opt/visitas
  cat > "$STATE_FILE" << EOF
CFG_DOMAIN_PROD="${CFG_DOMAIN_PROD}"
CFG_DOMAIN_TEST="${CFG_DOMAIN_TEST}"
CFG_EMAIL="${CFG_EMAIL}"
CFG_GIT_REPO="${CFG_GIT_REPO}"
CFG_GIT_BRANCH_PROD="${CFG_GIT_BRANCH_PROD}"
CFG_GIT_BRANCH_TEST="${CFG_GIT_BRANCH_TEST}"
CFG_ENABLE_TEST="${CFG_ENABLE_TEST}"
EOF
  chmod 600 "$STATE_FILE"
}

_load_state() {
  [[ -f "$STATE_FILE" ]] && source "$STATE_FILE" || true
}

# ══════════════════════════════════════════════════════════════════════════════
# TELA DE BOAS-VINDAS
# ══════════════════════════════════════════════════════════════════════════════

_screen_welcome() {
  _header
  echo -e "${BOLD}${C}"
  cat << 'ART'
     ██╗   ██╗██╗███████╗██╗████████╗ █████╗ ███████╗
     ██║   ██║██║██╔════╝██║╚══██╔══╝██╔══██╗██╔════╝
     ██║   ██║██║███████╗██║   ██║   ███████║███████╗
     ╚██╗ ██╔╝██║╚════██║██║   ██║   ██╔══██║╚════██║
      ╚████╔╝ ██║███████║██║   ██║   ██║  ██║███████║
       ╚═══╝  ╚═╝╚══════╝╚═╝   ╚═╝   ╚═╝  ╚═╝╚══════╝
ART
  echo -e "${RESET}"
  echo -e "  ${W}Gestão de Carteira de Clientes${RESET}"
  echo -e "  ${D}Wizard de instalação — v2.0${RESET}"
  _gap

  _line
  echo -e "  ${G}✔${RESET}  Instalação totalmente guiada — nenhuma edição manual"
  echo -e "  ${G}✔${RESET}  Ambientes de Produção e Testes independentes"
  echo -e "  ${G}✔${RESET}  Docker, Nginx, SSL e Firewall configurados automaticamente"
  echo -e "  ${G}✔${RESET}  Backup diário automático"
  _line
  _gap

  # Verificar se já existe instalação
  if [[ -f "$STATE_FILE" ]]; then
    _load_state
    _warn "Instalação anterior detectada."
    _gap
    if _ask_yn "Continuar para o menu principal (gerenciar instalação existente)?"; then
      return 0  # vai para o menu
    fi
  fi

  if ! _ask_yn "Iniciar o wizard de instalação agora?"; then
    _gap
    echo -e "  ${D}Execute novamente quando estiver pronto.${RESET}"
    _gap
    exit 0
  fi
  return 1  # sinaliza: ir para o wizard
}

# ══════════════════════════════════════════════════════════════════════════════
# PASSO 1 — VERIFICAÇÃO DO SISTEMA
# ══════════════════════════════════════════════════════════════════════════════

_step_check_system() {
  _header
  _title "Passo 1 de 5 — Verificando o servidor"

  local ok=0 fail=0

  # Root
  if [[ $EUID -eq 0 ]]; then
    _ok "Executando como root"
    ((ok++)) || true
  else
    _err "Este script precisa ser executado como root (sudo bash wizard.sh)"
    exit 1
  fi

  # OS
  . /etc/os-release
  local os_ok=false
  [[ "$ID" == "ubuntu" || "$ID" == "debian" ]] && os_ok=true
  if $os_ok; then
    _ok "Sistema operacional: ${PRETTY_NAME}"
    ((ok++)) || true
  else
    _err "Sistema não suportado: ${PRETTY_NAME}"
    _info "Use Ubuntu 22.04/24.04 ou Debian 11/12"
    exit 1
  fi

  # RAM
  local ram; ram=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
  if [[ $ram -ge 1024 ]]; then
    _ok "RAM: ${ram} MB"
    ((ok++)) || true
  else
    _warn "RAM: ${ram} MB (mínimo recomendado: 1024 MB)"
    ((fail++)) || true
  fi

  # Disco
  local disk; disk=$(df / --output=avail -BG | tail -1 | tr -dc '0-9')
  if [[ $disk -ge 10 ]]; then
    _ok "Disco livre: ${disk} GB"
    ((ok++)) || true
  else
    _warn "Disco livre: ${disk} GB (mínimo recomendado: 10 GB)"
    ((fail++)) || true
  fi

  # Arquitetura
  local arch; arch=$(uname -m)
  _ok "Arquitetura: $arch"
  ((ok++)) || true

  # Internet
  if curl -fsSL --max-time 8 https://google.com > /dev/null 2>&1; then
    _ok "Conexão com a internet OK"
    ((ok++)) || true
  else
    _err "Sem acesso à internet"
    exit 1
  fi

  # IP público
  local pub_ip; pub_ip=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo "não detectado")
  _info "IP público deste servidor: ${W}${pub_ip}${RESET}"

  _gap
  _line

  if [[ $fail -gt 0 ]]; then
    _warn "Alguns requisitos estão abaixo do recomendado."
    _ask_yn "Deseja continuar mesmo assim?" || exit 0
  else
    _badge_ok "Servidor aprovado — ${ok} verificações passaram"
  fi

  _press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# PASSO 2 — CONFIGURAÇÕES DO PROJETO
# ══════════════════════════════════════════════════════════════════════════════

_step_config() {
  _header
  _title "Passo 2 de 5 — Configurações do projeto"

  echo -e "  ${D}Preencha as informações abaixo. Pressione ENTER para aceitar o valor padrão.${RESET}"
  _gap

  # ── Domínio de produção ───────────────────────────────────────────────────
  echo -e "  ${C}Domínio${RESET}"
  echo -e "  ${D}O endereço que seus usuários vão acessar (ex: visitas.suaempresa.com.br)${RESET}"
  _ask CFG_DOMAIN_PROD "Domínio de produção" "visitas.suaempresa.com.br"

  # ── Ambiente de testes ────────────────────────────────────────────────────
  _gap
  echo -e "  ${C}Ambiente de testes${RESET}"
  echo -e "  ${D}Opcional: um segundo ambiente isolado para homologação${RESET}"
  if _ask_yn "Instalar também um ambiente de testes?" "n"; then
    CFG_ENABLE_TEST="s"
    local test_default; test_default="test.${CFG_DOMAIN_PROD#*.}"
    _ask CFG_DOMAIN_TEST "Domínio de testes" "$test_default"
  else
    CFG_ENABLE_TEST="n"
    CFG_DOMAIN_TEST=""
  fi

  # ── E-mail SSL ────────────────────────────────────────────────────────────
  _gap
  echo -e "  ${C}SSL / Let's Encrypt${RESET}"
  echo -e "  ${D}E-mail para notificações de renovação do certificado SSL${RESET}"
  _ask CFG_EMAIL "E-mail para SSL" "admin@${CFG_DOMAIN_PROD#*.}"

  # ── Repositório Git ───────────────────────────────────────────────────────
  _gap
  echo -e "  ${C}Código-fonte${RESET}"
  echo -e "  ${D}Repositório Git com o código do projeto (deixe em branco para fazer upload manual)${RESET}"
  _ask CFG_GIT_REPO "URL do repositório Git" ""

  if [[ -n "$CFG_GIT_REPO" ]]; then
    _ask CFG_GIT_BRANCH_PROD "Branch de produção" "main"
    [[ "$CFG_ENABLE_TEST" == "s" ]] && \
      _ask CFG_GIT_BRANCH_TEST "Branch de testes" "develop"
  fi

  # ── Confirmação ───────────────────────────────────────────────────────────
  _gap
  local items=(
    "Domínio produção"  "$CFG_DOMAIN_PROD"
    "Domínio testes"    "$( [[ "$CFG_ENABLE_TEST" == "s" ]] && echo "$CFG_DOMAIN_TEST" || echo "não ativado" )"
    "E-mail SSL"        "$CFG_EMAIL"
    "Repositório Git"   "$( [[ -n "$CFG_GIT_REPO" ]] && echo "$CFG_GIT_REPO ($CFG_GIT_BRANCH_PROD)" || echo "upload manual" )"
  )

  _confirm_config "Configurações do projeto" "${items[@]}" || {
    _warn "Reiniciando configuração..."
    sleep 1
    _step_config
  }

  _save_state
}

# ══════════════════════════════════════════════════════════════════════════════
# PASSO 3 — INSTALAÇÃO DO SISTEMA
# ══════════════════════════════════════════════════════════════════════════════

_step_install_system() {
  _header
  _title "Passo 3 de 5 — Instalando dependências do sistema"

  export DEBIAN_FRONTEND=noninteractive
  local PKG="apt-get"
  local TOTAL=8 CURRENT=0

  _progress $CURRENT $TOTAL "Iniciando..."
  sleep 0.5

  # 1. Atualizar índice
  ((CURRENT++)) || true
  _progress $CURRENT $TOTAL "Atualizando lista de pacotes"
  _run "Atualizando lista de pacotes" $PKG update -y

  # 2. Upgrade
  ((CURRENT++)) || true
  _progress $CURRENT $TOTAL "Atualizando pacotes instalados"
  _run "Atualizando pacotes instalados" \
    bash -c "$PKG upgrade -y 2>&1 | tail -5"

  # 3. Dependências base
  ((CURRENT++)) || true
  _progress $CURRENT $TOTAL "Instalando dependências base"
  _run "Instalando dependências base" \
    $PKG install -y curl wget git unzip zip openssl net-tools jq \
      build-essential software-properties-common \
      apt-transport-https ca-certificates gnupg lsb-release \
      ufw fail2ban python3 python3-pip python3-dev libpq-dev gcc

  # 4. Docker
  ((CURRENT++)) || true
  _progress $CURRENT $TOTAL "Instalando Docker Engine"
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
      bash -c "$PKG update -y && $PKG install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
    systemctl enable --now docker >> /opt/visitas/logs/wizard.log 2>&1
  else
    _ok "Docker já instalado: $(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1)"
  fi

  # 5. Nginx
  ((CURRENT++)) || true
  _progress $CURRENT $TOTAL "Instalando Nginx"
  if ! command -v nginx &>/dev/null; then
    _run "Instalando Nginx" $PKG install -y nginx
    systemctl enable nginx >> /opt/visitas/logs/wizard.log 2>&1
  else
    _ok "Nginx já instalado"
  fi

  # 6. Certbot
  ((CURRENT++)) || true
  _progress $CURRENT $TOTAL "Instalando Certbot (SSL)"
  if ! command -v certbot &>/dev/null; then
    _run "Instalando Certbot" \
      $PKG install -y certbot python3-certbot-nginx
  else
    _ok "Certbot já instalado"
  fi

  # 7. Usuário do sistema
  ((CURRENT++)) || true
  _progress $CURRENT $TOTAL "Criando usuário 'visitas'"
  if ! id "visitas" &>/dev/null; then
    useradd -r -m -d /opt/visitas -s /bin/bash visitas
    usermod -aG docker visitas
  fi
  mkdir -p /opt/visitas/{prod,test,backups,logs}
  mkdir -p /opt/visitas/prod/data/{postgres,redis,uploads}
  mkdir -p /opt/visitas/test/data/{postgres,redis,uploads}
  chown -R visitas:visitas /opt/visitas

  # 8. Swap + kernel
  ((CURRENT++)) || true
  _progress $CURRENT $TOTAL "Otimizando servidor"
  local ram; ram=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
  if [[ $ram -lt 2048 ]] && ! swapon --show=NAME --noheadings 2>/dev/null | grep -q .; then
    fallocate -l 2G /swapfile && chmod 600 /swapfile
    mkswap /swapfile > /dev/null && swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    _ok "Swap de 2 GB criado"
  fi
  grep -q 'somaxconn' /etc/sysctl.conf 2>/dev/null || \
    printf '\nnet.core.somaxconn=65535\nfs.file-max=100000\n' >> /etc/sysctl.conf
  sysctl -p >> /opt/visitas/logs/wizard.log 2>&1 || true

  _gap
  _badge_ok "Sistema pronto"
  _press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# PASSO 4 — CONFIGURAR AMBIENTES
# ══════════════════════════════════════════════════════════════════════════════

_gen_env() {
  local dir=$1 env_type=$2 domain=$3

  local db_pass secret_key
  # Reusar senhas existentes se já houver .env
  if [[ -f "$dir/.env" ]]; then
    db_pass=$(grep "^POSTGRES_PASSWORD=" "$dir/.env" | cut -d= -f2)
    secret_key=$(grep "^SECRET_KEY=" "$dir/.env" | cut -d= -f2)
    cp "$dir/.env" "$dir/.env.bak.$(date +%Y%m%d%H%M%S)"
  fi
  db_pass="${db_pass:-$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)}"
  secret_key="${secret_key:-$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 64)}"

  local port_back port_front db_name
  if [[ "$env_type" == "prod" ]]; then
    port_back=8000; port_front=3000; db_name="visitas_prod"
  else
    port_back=8001; port_front=3001; db_name="visitas_test"
  fi

  cat > "$dir/.env" << EOF
# Gerado pelo Wizard em $(date) — ambiente: ${env_type^^}
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

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EOF
  chmod 600 "$dir/.env"
  chown visitas:visitas "$dir/.env"

  if [[ "$env_type" == "prod" ]]; then
    CFG_DB_PASS_PROD="$db_pass"
  else
    CFG_DB_PASS_TEST="$db_pass"
  fi
}

_gen_compose() {
  local dir=$1 env_type=$2

  local port_back port_front vol_prefix
  if [[ "$env_type" == "prod" ]]; then
    port_back=8000; port_front=3000
    vol_prefix="/opt/visitas/prod/data"
  else
    port_back=8001; port_front=3001
    vol_prefix="/opt/visitas/test/data"
  fi

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
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      retries: 3

  frontend:
    image: visitas-frontend:${env_type}
    restart: unless-stopped
    ports: ["127.0.0.1:${port_front}:80"]
    networks: [net-${env_type}]

networks:
  net-${env_type}:
    driver: bridge
COMPOSE
  chown visitas:visitas "$dir/docker-compose.yml"
}

_gen_nginx() {
  local env_type=$1 domain=$2
  local port_back port_front
  [[ "$env_type" == "prod" ]] && port_back=8000 || port_back=8001
  [[ "$env_type" == "prod" ]] && port_front=3000 || port_front=3001

  cat > "/etc/nginx/sites-available/visitas-${env_type}" << NGINX
upstream ${env_type}_back  { server 127.0.0.1:${port_back};  keepalive 16; }
upstream ${env_type}_front { server 127.0.0.1:${port_front}; keepalive 8;  }

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
        proxy_pass http://${env_type}_back;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
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
  ln -sf "/etc/nginx/sites-available/visitas-${env_type}" \
         "/etc/nginx/sites-enabled/visitas-${env_type}"
}

_gen_nginx_http_only() {
  # Fallback sem SSL (quando DNS ainda não aponta)
  local env_type=$1 domain=$2
  local port_back port_front
  [[ "$env_type" == "prod" ]] && port_back=8000 || port_back=8001
  [[ "$env_type" == "prod" ]] && port_front=3000 || port_front=3001

  cat > "/etc/nginx/sites-available/visitas-${env_type}" << NGINX
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
  ln -sf "/etc/nginx/sites-available/visitas-${env_type}" \
         "/etc/nginx/sites-enabled/visitas-${env_type}"
}

_setup_ssl() {
  local domain=$1
  local srv_ip dom_ip
  srv_ip=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo "")
  dom_ip=$(getent hosts "$domain" 2>/dev/null | awk '{print $1}' | head -1 || echo "")

  mkdir -p /var/www/certbot

  if [[ -n "$srv_ip" && "$srv_ip" == "$dom_ip" ]]; then
    _info "DNS OK — solicitando certificado SSL para ${domain}..."
    certbot --nginx -d "$domain" \
      --non-interactive --agree-tos \
      --email "$CFG_EMAIL" --redirect --no-eff-email \
      >> /opt/visitas/logs/wizard.log 2>&1 && \
      _ok "Certificado SSL emitido para ${domain}" || \
      _warn "Certbot falhou — acesse por HTTP por enquanto"

    # Renovação automática
    (crontab -l 2>/dev/null | grep -v "certbot renew";
     echo "0 3 * * * certbot renew --quiet && systemctl reload nginx") | crontab -
    return 0
  else
    _warn "DNS de '${domain}' ainda não aponta para este servidor."
    _warn "  IP do servidor : ${srv_ip:-não detectado}"
    _warn "  IP no DNS      : ${dom_ip:-não resolvido}"
    _info "O sistema funcionará em HTTP. Quando o DNS estiver correto, execute:"
    echo  ""
    echo  "  certbot --nginx -d ${domain} --email ${CFG_EMAIL} --agree-tos --non-interactive"
    echo  ""
    return 1
  fi
}

_setup_firewall() {
  ufw --force reset > /dev/null 2>&1
  ufw default deny incoming > /dev/null 2>&1
  ufw default allow outgoing > /dev/null 2>&1
  ufw allow ssh > /dev/null 2>&1
  ufw allow 80/tcp > /dev/null 2>&1
  ufw allow 443/tcp > /dev/null 2>&1
  ufw --force enable > /dev/null 2>&1

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
  systemctl enable --now fail2ban >> /opt/visitas/logs/wizard.log 2>&1 || true
}

_gen_systemd() {
  local env_type=$1 dir=$2
  cat > "/etc/systemd/system/visitas-${env_type}.service" << SVC
[Unit]
Description=Visitas ${env_type^^}
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
}

_gen_cron_backup() {
  (crontab -l 2>/dev/null | grep -v "visitas.*backup";
   echo "0 2 * * * bash $0 --backup-auto >> /opt/visitas/logs/backup.log 2>&1") | crontab -
}

_step_setup_envs() {
  _header
  _title "Passo 4 de 5 — Configurando ambientes"

  local envs=("prod")
  [[ "$CFG_ENABLE_TEST" == "s" ]] && envs+=("test")

  rm -f /etc/nginx/sites-enabled/default

  for env_type in "${envs[@]}"; do
    local dir="/opt/visitas/${env_type}"
    local domain
    [[ "$env_type" == "prod" ]] && domain="$CFG_DOMAIN_PROD" || domain="$CFG_DOMAIN_TEST"
    local label; [[ "$env_type" == "prod" ]] && label="PRODUÇÃO" || label="TESTES"

    _step "Configurando ${label}"

    _run "Gerando arquivo .env"          _gen_env "$dir" "$env_type" "$domain"
    _run "Gerando docker-compose.yml"    _gen_compose "$dir" "$env_type"
    _run "Configurando Nginx"            _gen_nginx_http_only "$env_type" "$domain"
    _run "Registrando serviço no boot"   _gen_systemd "$env_type" "$dir"

    # SSL
    _info "Verificando DNS para SSL..."
    if _setup_ssl "$domain"; then
      _gen_nginx "$env_type" "$domain"
      nginx -t >> /opt/visitas/logs/wizard.log 2>&1 && systemctl reload nginx
    else
      nginx -t >> /opt/visitas/logs/wizard.log 2>&1 && systemctl reload nginx
    fi

    _ok "${label} configurado"
  done

  # Firewall
  _run "Configurando firewall (UFW + Fail2ban)" _setup_firewall

  # Backup automático apenas para prod
  _gen_cron_backup
  _ok "Backup automático agendado (diário às 02:00)"

  _gap
  _badge_ok "Ambientes configurados"
  _press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# PASSO 5 — CÓDIGO E PRIMEIRO DEPLOY
# ══════════════════════════════════════════════════════════════════════════════

_step_deploy() {
  _header
  _title "Passo 5 de 5 — Código-fonte e primeiro deploy"

  local envs=("prod")
  [[ "$CFG_ENABLE_TEST" == "s" ]] && envs+=("test")

  for env_type in "${envs[@]}"; do
    local dir="/opt/visitas/${env_type}"
    local label; [[ "$env_type" == "prod" ]] && label="PRODUÇÃO" || label="TESTES"
    local branch; [[ "$env_type" == "prod" ]] && branch="$CFG_GIT_BRANCH_PROD" || branch="$CFG_GIT_BRANCH_TEST"

    _step "Deploy de ${label}"

    # ── Origem do código ────────────────────────────────────────────────────
    local src_ready=false

    if [[ -n "$CFG_GIT_REPO" ]]; then
      # Clone do Git
      _info "Clonando repositório ($branch)..."
      if git clone --branch "$branch" --depth 1 "$CFG_GIT_REPO" "$dir/src" \
          >> /opt/visitas/logs/wizard.log 2>&1; then
        _ok "Código clonado de ${CFG_GIT_REPO}"
        src_ready=true
      else
        _warn "Falha no clone — verifique a URL e permissões do repositório"
      fi
    fi

    if ! $src_ready; then
      # Upload manual via SCP
      _gap
      echo -e "  ${Y}Upload manual do código${RESET}"
      echo -e "  ${D}Abra um segundo terminal no seu Mac e execute:${RESET}"
      echo ""
      echo -e "  ${W}scp -r ~/Downloads/visitas/ root@$(curl -fsSL --max-time 3 https://api.ipify.org 2>/dev/null):/opt/visitas/${env_type}/src${RESET}"
      echo ""
      _info "Aguardando o upload... (pressione ENTER quando o SCP terminar)"
      read -r

      if [[ -d "$dir/src/backend" && -d "$dir/src/frontend" ]]; then
        _ok "Código encontrado em $dir/src"
        src_ready=true
      else
        _warn "Código não encontrado em $dir/src — o build será pulado."
        _info "Após copiar o código, execute: bash $0 --build ${env_type}"
      fi
    fi

    # ── Build das imagens ────────────────────────────────────────────────────
    if $src_ready && [[ -d "$dir/src/backend" ]]; then
      _info "Fazendo build das imagens Docker (pode levar alguns minutos)..."

      docker build \
        -f "$dir/src/backend/Dockerfile" \
        -t "visitas-backend:${env_type}" \
        "$dir/src/backend" \
        >> /opt/visitas/logs/wizard.log 2>&1 &
      _spinner $! "Build da imagem backend (${label})"

      docker build \
        -f "$dir/src/frontend/Dockerfile" \
        --build-arg "VITE_API_URL=https://$( [[ "$env_type" == "prod" ]] && echo "$CFG_DOMAIN_PROD" || echo "$CFG_DOMAIN_TEST" )" \
        -t "visitas-frontend:${env_type}" \
        "$dir/src/frontend" \
        >> /opt/visitas/logs/wizard.log 2>&1 &
      _spinner $! "Build da imagem frontend (${label})"
    fi

    # ── Subir containers ─────────────────────────────────────────────────────
    if docker image inspect "visitas-backend:${env_type}" &>/dev/null 2>&1 && \
       docker image inspect "visitas-frontend:${env_type}" &>/dev/null 2>&1; then

      _info "Subindo containers..."
      cd "$dir"
      docker compose up -d >> /opt/visitas/logs/wizard.log 2>&1 &
      _spinner $! "Iniciando containers (${label})"

      # Aguardar health check
      local healthy=false
      _info "Aguardando containers ficarem prontos..."
      for i in {1..20}; do
        sleep 3
        local running; running=$(cd "$dir" && docker compose ps -q 2>/dev/null | wc -l)
        [[ $running -ge 2 ]] && { healthy=true; break; }
        printf "\r  ${D}Verificando... tentativa $i/20${RESET}"
      done
      printf "\r%-60s\n" ""

      if $healthy; then
        _badge_ok "${label} online"
      else
        _warn "Alguns containers podem não estar respondendo ainda."
        _info "Verifique com: docker compose -f $dir/docker-compose.yml ps"
      fi
    else
      _warn "Imagens não encontradas — containers não foram iniciados."
    fi
  done

  _press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# TELA FINAL DE CONCLUSÃO
# ══════════════════════════════════════════════════════════════════════════════

_screen_done() {
  _header

  echo -e "${BOLD}${G}"
  cat << 'DONE'
  ╔══════════════════════════════════════════════════════╗
  ║                                                      ║
  ║        Instalação concluída com sucesso!             ║
  ║                                                      ║
  ╚══════════════════════════════════════════════════════╝
DONE
  echo -e "${RESET}"

  local pub_ip; pub_ip=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo "—")

  _line
  printf "  ${D}%-28s${RESET}  ${W}%s${RESET}\n" "IP do servidor"       "$pub_ip"
  printf "  ${D}%-28s${RESET}  ${W}%s${RESET}\n" "URL de produção"      "https://${CFG_DOMAIN_PROD}"
  [[ "$CFG_ENABLE_TEST" == "s" ]] && \
  printf "  ${D}%-28s${RESET}  ${W}%s${RESET}\n" "URL de testes"        "https://${CFG_DOMAIN_TEST}"
  printf "  ${D}%-28s${RESET}  ${W}%s${RESET}\n" "Senha padrão inicial" "Mudar@123"
  printf "  ${D}%-28s${RESET}  ${W}%s${RESET}\n" "Credenciais salvas"   "/opt/visitas/CREDENTIALS.txt"
  printf "  ${D}%-28s${RESET}  ${W}%s${RESET}\n" "Logs do wizard"       "/opt/visitas/logs/wizard.log"
  _line
  _gap

  echo -e "  ${BOLD}Próximos passos:${RESET}"
  echo ""
  echo -e "  ${C}1${RESET}  Aponte o DNS do domínio ${W}${CFG_DOMAIN_PROD}${RESET} para ${W}${pub_ip}${RESET}"
  echo -e "  ${C}2${RESET}  Acesse ${W}https://${CFG_DOMAIN_PROD}${RESET} e faça o primeiro login"
  echo -e "  ${C}3${RESET}  Vá em ${W}Importação${RESET} e carregue o arquivo CSV dos contratos"
  _gap

  echo -e "  ${BOLD}Gerenciar o sistema:${RESET}"
  echo ""
  echo -e "  ${W}sudo bash $0${RESET}   ${D}— abre o menu de gestão${RESET}"
  _gap

  # Salvar credenciais
  mkdir -p /opt/visitas
  cat > /opt/visitas/CREDENTIALS.txt << CREDS
Visitas — Credenciais de Instalação
Gerado em: $(date)
════════════════════════════════════════

PRODUÇÃO
  URL          : https://${CFG_DOMAIN_PROD}
  DB senha     : ${CFG_DB_PASS_PROD}
  .env          : /opt/visitas/prod/.env

$( [[ "$CFG_ENABLE_TEST" == "s" ]] && cat << TTEST
TESTES
  URL          : https://${CFG_DOMAIN_TEST}
  DB senha     : ${CFG_DB_PASS_TEST}
  .env          : /opt/visitas/test/.env

TTEST
)
Senha inicial de todos os usuários: Mudar@123
CREDS
  chmod 600 /opt/visitas/CREDENTIALS.txt
  _ok "Credenciais salvas em /opt/visitas/CREDENTIALS.txt (apenas root)"
}

# ══════════════════════════════════════════════════════════════════════════════
# MENU PRINCIPAL (pós-instalação)
# ══════════════════════════════════════════════════════════════════════════════

_menu_status_bar() {
  local prod_status test_status compose
  compose="docker compose"
  if [[ -f "/opt/visitas/prod/docker-compose.yml" ]]; then
    local r; r=$(cd /opt/visitas/prod && $compose ps -q 2>/dev/null | wc -l)
    [[ $r -gt 0 ]] && prod_status="${G}● PROD online${RESET}" || prod_status="${R}○ PROD offline${RESET}"
  else
    prod_status="${D}○ PROD não instalado${RESET}"
  fi
  if [[ -f "/opt/visitas/test/docker-compose.yml" ]]; then
    local r; r=$(cd /opt/visitas/test && $compose ps -q 2>/dev/null | wc -l)
    [[ $r -gt 0 ]] && test_status="${Y}● TEST online${RESET}" || test_status="${D}○ TEST offline${RESET}"
  else
    test_status="${D}○ TEST não instalado${RESET}"
  fi
  echo -e "  ${prod_status}    ${test_status}    ${D}$(date '+%d/%m/%Y %H:%M:%S')${RESET}"
}

_menu_main() {
  while true; do
    _header
    _menu_status_bar
    _gap
    _line

    echo -e "  ${BOLD}${W}  Instalação & Atualização${RESET}"
    echo -e "   ${G}1${RESET}  Instalar / Reinstalar"
    echo -e "   ${C}2${RESET}  Atualizar PRODUÇÃO"
    echo -e "   ${C}3${RESET}  Atualizar TESTES"
    _gap
    echo -e "  ${BOLD}${W}  Dados${RESET}"
    echo -e "   ${B}4${RESET}  Backup agora"
    echo -e "   ${B}5${RESET}  Restaurar backup"
    echo -e "   ${M}6${RESET}  Replicar PROD → TESTES"
    _gap
    echo -e "  ${BOLD}${W}  Operações${RESET}"
    echo -e "   ${Y}7${RESET}  Reiniciar serviços"
    echo -e "   ${W}8${RESET}  Status"
    echo -e "   ${W}9${RESET}  Monitor ao vivo"
    _gap
    echo -e "  ${BOLD}${W}  Diagnóstico${RESET}"
    echo -e "  ${W}10${RESET}  Ver logs"
    echo -e "  ${W}11${RESET}  Logs em tempo real"
    echo -e "  ${W}12${RESET}  Informações do servidor"
    _gap
    _line
    echo -e "   ${R}0${RESET}  Sair"
    _gap
    echo -ne "  ${BOLD}Opção:${RESET} "
    read -r opt

    case "$opt" in
      1)  _run_wizard ;;
      2)  _menu_atualizar prod ;;
      3)  _menu_atualizar test ;;
      4)  _menu_backup ;;
      5)  _menu_restaurar ;;
      6)  _menu_replicar ;;
      7)  _menu_reiniciar ;;
      8)  _menu_status ;;
      9)  _menu_monitor ;;
      10) _menu_logs ;;
      11) _menu_logs_live ;;
      12) _menu_info ;;
      0)  _gap; echo -e "  ${D}Saindo...${RESET}"; _gap; exit 0 ;;
      *)  _warn "Opção inválida."; sleep 1 ;;
    esac
  done
}

# ── Sub-menus de gestão ───────────────────────────────────────────────────────

_menu_atualizar() {
  local env_type=$1
  local label; [[ "$env_type" == "prod" ]] && label="PRODUÇÃO" || label="TESTES"
  local dir="/opt/visitas/${env_type}"
  _header; _title "Atualizar ${label}"
  [[ ! -f "$dir/docker-compose.yml" ]] && { _err "${label} não instalado."; _press_enter; return; }
  _ask_yn "Confirmar atualização de ${label}?" || return
  [[ -n "$CFG_GIT_REPO" ]] && {
    local branch; [[ "$env_type" == "prod" ]] && branch="$CFG_GIT_BRANCH_PROD" || branch="$CFG_GIT_BRANCH_TEST"
    _run "Baixando código ($branch)" git -C "$dir/src" pull origin "$branch" 2>/dev/null || true
  }
  _run "Baixando imagens Docker"  bash -c "cd $dir && docker compose pull"
  _run "Reiniciando containers"   bash -c "cd $dir && docker compose up -d --force-recreate --remove-orphans"
  _badge_ok "Atualização concluída"; _press_enter
}

_menu_backup() {
  _header; _title "Backup"
  local DATE; DATE=$(date +%Y%m%d_%H%M%S)
  mkdir -p /opt/visitas/backups
  for env_type in prod test; do
    local dir="/opt/visitas/${env_type}"
    [[ ! -f "$dir/docker-compose.yml" ]] && continue
    local label; [[ "$env_type" == "prod" ]] && label="PROD" || label="TEST"
    local db_c; db_c=$(cd "$dir" && docker compose ps -q db 2>/dev/null | head -1)
    [[ -z "$db_c" ]] && { _warn "DB de $label não está rodando"; continue; }
    local db_name; db_name=$(grep "^POSTGRES_DB=" "$dir/.env" | cut -d= -f2)
    local db_user; db_user=$(grep "^POSTGRES_USER=" "$dir/.env" | cut -d= -f2)
    docker exec "$db_c" pg_dump -U "$db_user" "$db_name" 2>/dev/null \
      | gzip > "/opt/visitas/backups/db_${label}_${DATE}.sql.gz" && \
      _ok "Backup $label: db_${label}_${DATE}.sql.gz ($(du -sh "/opt/visitas/backups/db_${label}_${DATE}.sql.gz" | cut -f1))"
  done
  find /opt/visitas/backups -name "*.gz" -mtime +7 -delete 2>/dev/null || true
  _press_enter
}

_menu_restaurar() {
  _header; _title "Restaurar Backup"
  local backups=(); mapfile -t backups < <(ls -t /opt/visitas/backups/db_*.sql.gz 2>/dev/null)
  [[ ${#backups[@]} -eq 0 ]] && { _warn "Nenhum backup encontrado."; _press_enter; return; }
  for i in "${!backups[@]}"; do
    echo -e "  ${G}$((i+1))${RESET}  $(basename "${backups[$i]}")  ${D}($(du -sh "${backups[$i]}" | cut -f1) — $(stat -c '%y' "${backups[$i]}" | cut -d. -f1))${RESET}"
  done
  local idx
  echo -ne "\n  Escolha [1-${#backups[@]}]: "; read -r idx
  [[ ! "$idx" =~ ^[0-9]+$ || $idx -lt 1 || $idx -gt ${#backups[@]} ]] && { _warn "Inválido."; _press_enter; return; }
  local sel="${backups[$((idx-1))]}"
  local env_type="prod"; echo "$sel" | grep -qi "_TEST_" && env_type="test"
  local label; [[ "$env_type" == "prod" ]] && label="PRODUÇÃO" || label="TESTES"
  _ask_yn "${R}ATENÇÃO: sobrescrever banco de ${label}?${RESET}" "n" || return
  local dir="/opt/visitas/${env_type}"
  local db_c; db_c=$(cd "$dir" && docker compose ps -q db 2>/dev/null | head -1)
  [[ -z "$db_c" ]] && { _err "DB de ${label} não está rodando."; _press_enter; return; }
  local db_name; db_name=$(grep "^POSTGRES_DB=" "$dir/.env" | cut -d= -f2)
  local db_user; db_user=$(grep "^POSTGRES_USER=" "$dir/.env" | cut -d= -f2)
  (cd "$dir" && docker compose stop backend 2>/dev/null) || true
  gunzip -c "$sel" | docker exec -i "$db_c" psql -U "$db_user" -d "$db_name" 2>/dev/null && \
    _badge_ok "Banco restaurado" || _err "Falha na restauração"
  (cd "$dir" && docker compose start backend 2>/dev/null) || true
  _press_enter
}

_menu_replicar() {
  _header; _title "Replicar PROD → TESTES"
  _ask_yn "${R}Isso sobrescreve todos os dados de TESTES. Confirmar?${RESET}" "n" || return
  local DATE; DATE=$(date +%Y%m%d_%H%M%S)
  local db_prod; db_prod=$(cd /opt/visitas/prod && docker compose ps -q db 2>/dev/null | head -1)
  local db_test; db_test=$(cd /opt/visitas/test && docker compose ps -q db 2>/dev/null | head -1)
  [[ -z "$db_prod" || -z "$db_test" ]] && { _err "Ambos os bancos precisam estar rodando."; _press_enter; return; }
  local dump="/opt/visitas/backups/replica_${DATE}.sql.gz"
  _run "Exportando banco de PROD" \
    bash -c "docker exec $db_prod pg_dump -U $(grep '^POSTGRES_USER=' /opt/visitas/prod/.env | cut -d= -f2) $(grep '^POSTGRES_DB=' /opt/visitas/prod/.env | cut -d= -f2) | gzip > $dump"
  (cd /opt/visitas/test && docker compose stop backend 2>/dev/null) || true
  _run "Restaurando em TESTES" \
    bash -c "gunzip -c $dump | docker exec -i $db_test psql -U $(grep '^POSTGRES_USER=' /opt/visitas/test/.env | cut -d= -f2) -d $(grep '^POSTGRES_DB=' /opt/visitas/test/.env | cut -d= -f2)"
  (cd /opt/visitas/test && docker compose start backend 2>/dev/null) || true
  _badge_ok "Replicação concluída"; _press_enter
}

_menu_reiniciar() {
  _header; _title "Reiniciar Serviços"
  _ask_choice IDX "O que reiniciar?" \
    "Todos os containers de PRODUÇÃO" \
    "Todos os containers de TESTES" \
    "Apenas backend (PRODUÇÃO)" \
    "Apenas backend (TESTES)" \
    "Nginx"
  case $IDX in
    0) (cd /opt/visitas/prod && docker compose restart 2>/dev/null) && _ok "PROD reiniciado" ;;
    1) (cd /opt/visitas/test && docker compose restart 2>/dev/null) && _ok "TEST reiniciado" ;;
    2) (cd /opt/visitas/prod && docker compose restart backend 2>/dev/null) && _ok "Backend PROD reiniciado" ;;
    3) (cd /opt/visitas/test && docker compose restart backend 2>/dev/null) && _ok "Backend TEST reiniciado" ;;
    4) nginx -t && systemctl reload nginx && _ok "Nginx recarregado" ;;
  esac
  _press_enter
}

_menu_status() {
  _header; _title "Status dos Ambientes"
  for env_type in prod test; do
    local dir="/opt/visitas/${env_type}"
    local label; [[ "$env_type" == "prod" ]] && label="PRODUÇÃO" || label="TESTES"
    echo -e "  ${BOLD}── ${label} ──${RESET}"
    [[ ! -f "$dir/docker-compose.yml" ]] && { echo -e "  ${D}  Não instalado${RESET}\n"; continue; }
    (cd "$dir" && docker compose ps 2>/dev/null) | sed 's/^/    /'
    echo ""
  done
  echo -e "  ${BOLD}── Nginx ──${RESET}"
  systemctl is-active nginx > /dev/null 2>&1 && echo -e "    ${G}● ativo${RESET}" || echo -e "    ${R}○ inativo${RESET}"
  _press_enter
}

_menu_monitor() {
  while true; do
    _header
    echo -e "  ${D}Pressione Q para sair${RESET}\n"
    echo -e "  ${BOLD}CPU / RAM / Disco${RESET}"
    echo -e "  CPU   $(top -bn1 | grep "Cpu(s)" | awk '{print $2}')% uso  |  Load: $(uptime | awk -F'load average:' '{print $2}' | xargs)"
    echo -e "  RAM   $(free -m | awk '/^Mem:/ {printf "%dMB / %dMB (%.0f%%)", $3, $2, $3/$2*100}')"
    echo -e "  Disco $(df -h / | tail -1 | awk '{printf "%s usados / %s total (%s)", $3, $2, $5}')"
    _gap
    echo -e "  ${BOLD}Containers${RESET}"
    for env_type in prod test; do
      local dir="/opt/visitas/${env_type}"
      [[ ! -f "$dir/docker-compose.yml" ]] && continue
      local label; [[ "$env_type" == "prod" ]] && label="PROD" || label="TEST"
      (cd "$dir" && docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null) | \
        grep -v "^NAME" | while IFS= read -r line; do
          echo "$line" | grep -qi "running\|up" \
            && echo -e "    ${G}●${RESET} [${label}] $line" \
            || echo -e "    ${R}○${RESET} [${label}] $line"
        done
    done
    if read -r -t 3 -n1 key 2>/dev/null; then
      [[ "${key,,}" == "q" ]] && break
    fi
  done
  _press_enter
}

_menu_logs() {
  _header; _title "Ver Logs"
  _ask_choice IDX "Qual log?" \
    "Backend PRODUÇÃO (últimas 100 linhas)" \
    "Frontend PRODUÇÃO" \
    "Backend TESTES" \
    "Nginx — error.log" \
    "Nginx — access.log" \
    "Backup (cron)" \
    "Wizard (instalação)"
  case $IDX in
    0) (cd /opt/visitas/prod && docker compose logs backend --tail=100 2>/dev/null) ;;
    1) (cd /opt/visitas/prod && docker compose logs frontend --tail=100 2>/dev/null) ;;
    2) (cd /opt/visitas/test && docker compose logs backend --tail=100 2>/dev/null) ;;
    3) tail -100 /var/log/nginx/error.log 2>/dev/null ;;
    4) tail -100 /var/log/nginx/access.log 2>/dev/null ;;
    5) tail -100 /opt/visitas/logs/backup.log 2>/dev/null || _warn "Sem logs de backup ainda." ;;
    6) tail -100 /opt/visitas/logs/wizard.log 2>/dev/null ;;
  esac
  _press_enter
}

_menu_logs_live() {
  _header; _title "Logs em Tempo Real"
  _ask_choice IDX "Qual serviço acompanhar?" \
    "Backend PRODUÇÃO" \
    "Todos os containers PRODUÇÃO" \
    "Backend TESTES" \
    "Nginx (access + error)"
  echo -e "\n  ${D}Pressione Ctrl+C para parar${RESET}\n"; sleep 1
  case $IDX in
    0) (cd /opt/visitas/prod && docker compose logs backend -f --tail=30 2>/dev/null) ;;
    1) (cd /opt/visitas/prod && docker compose logs -f --tail=20 2>/dev/null) ;;
    2) (cd /opt/visitas/test && docker compose logs backend -f --tail=30 2>/dev/null) ;;
    3) tail -f /var/log/nginx/access.log /var/log/nginx/error.log 2>/dev/null ;;
  esac
  _press_enter
}

_menu_info() {
  _header; _title "Informações do Servidor"
  . /etc/os-release
  local pub_ip; pub_ip=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo "—")
  printf "  ${D}%-22s${RESET}  %s\n" "Sistema"     "${PRETTY_NAME}"
  printf "  ${D}%-22s${RESET}  %s\n" "Kernel"      "$(uname -r)"
  printf "  ${D}%-22s${RESET}  %s\n" "IP público"  "$pub_ip"
  printf "  ${D}%-22s${RESET}  %s\n" "Uptime"      "$(uptime -p)"
  printf "  ${D}%-22s${RESET}  %s\n" "CPUs"        "$(nproc) core(s)"
  printf "  ${D}%-22s${RESET}  %s\n" "RAM"         "$(free -h | awk '/^Mem:/ {print $2" total / "$3" usados"}')"
  printf "  ${D}%-22s${RESET}  %s\n" "Disco (/opt)" "$(df -h /opt 2>/dev/null | tail -1 | awk '{print $3" usados / "$2" total"}')"
  _gap
  printf "  ${D}%-22s${RESET}  %s\n" "Docker"      "$(docker --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || echo 'não instalado')"
  printf "  ${D}%-22s${RESET}  %s\n" "Nginx"       "$(nginx -v 2>&1 | grep -oP 'nginx/[\d.]+' || echo 'não instalado')"
  printf "  ${D}%-22s${RESET}  %s\n" "Certbot"     "$(certbot --version 2>/dev/null || echo 'não instalado')"
  _gap
  ufw status 2>/dev/null | grep -q "active" && _ok "Firewall UFW ativo" || _warn "Firewall UFW inativo"
  systemctl is-active fail2ban > /dev/null 2>&1 && _ok "Fail2ban ativo" || _warn "Fail2ban inativo"
  _press_enter
}

# ══════════════════════════════════════════════════════════════════════════════
# FLUXO DO WIZARD
# ══════════════════════════════════════════════════════════════════════════════

_run_wizard() {
  _step_check_system
  _step_config
  _step_install_system
  _step_setup_envs
  _step_deploy
  _screen_done
  _save_state
}

# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

main() {
  # Modos de execução direta (chamados por cron ou scripts externos)
  case "${1:-}" in
    --backup-auto)
      mkdir -p /opt/visitas/backups /opt/visitas/logs
      DATE=$(date +%Y%m%d_%H%M%S)
      for env_type in prod test; do
        [[ ! -f "/opt/visitas/${env_type}/.env" ]] && continue
        db_c=$(cd "/opt/visitas/${env_type}" && docker compose ps -q db 2>/dev/null | head -1)
        [[ -z "$db_c" ]] && continue
        db_n=$(grep "^POSTGRES_DB=" "/opt/visitas/${env_type}/.env" | cut -d= -f2)
        db_u=$(grep "^POSTGRES_USER=" "/opt/visitas/${env_type}/.env" | cut -d= -f2)
        docker exec "$db_c" pg_dump -U "$db_u" "$db_n" 2>/dev/null \
          | gzip > "/opt/visitas/backups/db_${env_type^^}_${DATE}.sql.gz"
        echo "$(date) — Backup ${env_type^^} concluído"
      done
      find /opt/visitas/backups -name "*.gz" -mtime +7 -delete 2>/dev/null || true
      exit 0
      ;;
    --build)
      env_type="${2:-prod}"
      _run "Build backend" docker build \
        -f "/opt/visitas/${env_type}/src/backend/Dockerfile" \
        -t "visitas-backend:${env_type}" \
        "/opt/visitas/${env_type}/src/backend"
      _run "Build frontend" docker build \
        -f "/opt/visitas/${env_type}/src/frontend/Dockerfile" \
        -t "visitas-frontend:${env_type}" \
        "/opt/visitas/${env_type}/src/frontend"
      exit 0
      ;;
  esac

  # Verificar root antes de qualquer coisa
  [[ $EUID -ne 0 ]] && { echo "Execute como root: sudo bash wizard.sh"; exit 1; }

  _load_state

  # Decidir: wizard ou menu
  if _screen_welcome; then
    _menu_main
  else
    _run_wizard
    _menu_main
  fi
}

main "$@"
