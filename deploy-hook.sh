#!/usr/bin/env bash
# =============================================================================
#  VISITAS — Servidor de Webhook para Deploy Automático
#
#  Recebe um POST do GitHub/GitLab após cada git push e executa o deploy.
#  Roda como serviço systemd na VPS, escutando na porta 9000 (interno).
#
#  NÃO exponha esta porta diretamente — o Nginx faz o proxy com autenticação.
#
#  Uso:
#    bash deploy-hook.sh install   → instala como serviço systemd
#    bash deploy-hook.sh start     → inicia em modo servidor
#    bash deploy-hook.sh test      → simula um webhook localmente
# =============================================================================

set -euo pipefail

# ── Configurações ─────────────────────────────────────────────────────────────
HOOK_PORT="${HOOK_PORT:-9000}"
HOOK_SECRET="${HOOK_SECRET:-}"          # preenchido pelo wizard.sh
APP_DIR_PROD="/opt/visitas/prod"
APP_DIR_TEST="/opt/visitas/test"
LOG_FILE="/opt/visitas/logs/deploy.log"
LOCK_FILE="/tmp/visitas_deploy.lock"

# ── Cores ─────────────────────────────────────────────────────────────────────
G='\033[0;32m' Y='\033[1;33m' R='\033[0;31m' D='\033[2m' RESET='\033[0m'

log() { echo -e "$(date '+%Y-%m-%d %H:%M:%S')  $*" | tee -a "$LOG_FILE"; }

# ══════════════════════════════════════════════════════════════════════════════
# LÓGICA DE DEPLOY
# ══════════════════════════════════════════════════════════════════════════════

_deploy() {
  local env_type=$1   # prod | test
  local branch=$2     # main | develop
  local dir

  [[ "$env_type" == "prod" ]] && dir="$APP_DIR_PROD" || dir="$APP_DIR_TEST"

  # Impede deploys simultâneos
  if [ -f "$LOCK_FILE" ]; then
    log "⚠  Deploy já em andamento (lock existe). Ignorando."
    return 0
  fi

  touch "$LOCK_FILE"
  trap 'rm -f "$LOCK_FILE"' EXIT

  log "🚀  Iniciando deploy [$env_type] branch=$branch"

  [[ ! -d "$dir/src/.git" ]] && {
    log "✘  Repositório não encontrado em $dir/src. Execute o wizard primeiro."
    return 1
  }

  # 1. Pull do código
  log "→  git pull origin $branch"
  git -C "$dir/src" fetch --all >> "$LOG_FILE" 2>&1
  git -C "$dir/src" reset --hard "origin/$branch" >> "$LOG_FILE" 2>&1
  log "✔  Código atualizado — commit: $(git -C "$dir/src" rev-parse --short HEAD)"

  # 2. Build das imagens
  log "→  docker build backend"
  docker build \
    -f "$dir/src/backend/Dockerfile" \
    -t "visitas-backend:${env_type}" \
    "$dir/src/backend" >> "$LOG_FILE" 2>&1
  log "✔  Imagem backend construída"

  log "→  docker build frontend"
  docker build \
    -f "$dir/src/frontend/Dockerfile" \
    --build-arg "VITE_API_URL=https://$(grep '^APP_DOMAIN=' "$dir/.env" | cut -d= -f2)" \
    -t "visitas-frontend:${env_type}" \
    "$dir/src/frontend" >> "$LOG_FILE" 2>&1
  log "✔  Imagem frontend construída"

  # 3. Restart dos containers
  log "→  docker compose up -d"
  cd "$dir"
  docker compose up -d --remove-orphans --force-recreate >> "$LOG_FILE" 2>&1
  log "✔  Containers reiniciados"

  # 4. Health check
  local ok=false
  for i in $(seq 1 12); do
    sleep 5
    if curl -sf "http://localhost:$(grep 'BACKEND_PORT=' "$dir/.env" | cut -d= -f2)/health" > /dev/null 2>&1; then
      ok=true
      break
    fi
    log "   Aguardando health check... ($i/12)"
  done

  rm -f "$LOCK_FILE"

  if $ok; then
    log "✅  Deploy [$env_type] concluído com sucesso!"
    return 0
  else
    log "⚠  Deploy concluído mas health check não passou — verifique os logs"
    return 1
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# SERVIDOR DE WEBHOOK (HTTP puro via bash + netcat-like via socat/ncat)
# ══════════════════════════════════════════════════════════════════════════════

_validate_signature() {
  local payload=$1 signature=$2
  if [[ -z "$HOOK_SECRET" ]]; then
    return 0  # sem secret configurado, aceita tudo (não recomendado em prod)
  fi
  local expected
  expected="sha256=$(echo -n "$payload" | openssl dgst -sha256 -hmac "$HOOK_SECRET" | awk '{print $2}')"
  [[ "$signature" == "$expected" ]]
}

_parse_branch() {
  # Extrai a branch do payload JSON do GitHub/GitLab
  local payload=$1
  echo "$payload" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    ref = data.get('ref', '')
    print(ref.replace('refs/heads/', ''))
except:
    print('')
" 2>/dev/null || echo ""
}

_handle_request() {
  local raw_request=$1
  local method body signature branch env_type

  # Extrair método e headers
  method=$(echo "$raw_request" | head -1 | awk '{print $1}')
  signature=$(echo "$raw_request" | grep -i "x-hub-signature-256:" | awk '{print $2}' | tr -d '\r')

  # Extrair body (após linha em branco)
  body=$(echo "$raw_request" | awk 'BEGIN{found=0} /^\r?$/{found=1; next} found{print}')

  if [[ "$method" != "POST" ]]; then
    echo -e "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nVisitas Deploy Hook OK"
    return
  fi

  # Validar assinatura
  if ! _validate_signature "$body" "$signature"; then
    log "✘  Webhook rejeitado: assinatura inválida"
    echo -e "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nForbidden"
    return
  fi

  # Determinar branch → ambiente
  branch=$(_parse_branch "$body")
  log "→  Webhook recebido — branch: $branch"

  case "$branch" in
    main|master)     env_type="prod" ;;
    develop|staging) env_type="test" ;;
    *)
      log "ℹ  Branch '$branch' ignorada (não é main/develop)"
      echo -e "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nIgnored branch"
      return
      ;;
  esac

  # Responder imediatamente (GitHub tem timeout de 10s)
  echo -e "HTTP/1.1 202 Accepted\r\nContent-Type: application/json\r\n\r\n{\"status\":\"deploying\",\"env\":\"${env_type}\",\"branch\":\"${branch}\"}"

  # Deploy em background
  _deploy "$env_type" "$branch" &
}

_start_server() {
  log "🔌  Webhook server iniciando na porta $HOOK_PORT"
  mkdir -p "$(dirname "$LOG_FILE")"

  # Requer socat ou ncat
  if command -v socat &>/dev/null; then
    log "   Usando socat"
    socat TCP-LISTEN:${HOOK_PORT},reuseaddr,fork \
      EXEC:"bash $0 _handle_one" &
  elif command -v ncat &>/dev/null; then
    log "   Usando ncat"
    while true; do
      ncat -l "$HOOK_PORT" -e "bash $0 _handle_one" 2>/dev/null || true
    done
  else
    log "✘  socat ou ncat não encontrado. Instale: apt-get install -y socat"
    exit 1
  fi

  log "✔  Servidor webhook rodando (PID: $!)"
  wait
}

# ── handler para uma conexão (chamado pelo socat/ncat) ─────────────────────
_handle_one() {
  local request=""
  while IFS= read -r -t 5 line; do
    request+="$line"$'\n'
    [[ -z "$(echo "$line" | tr -d '\r')" ]] && break
  done
  # Ler body se houver Content-Length
  local content_length=0
  content_length=$(echo "$request" | grep -i "content-length:" | awk '{print $2}' | tr -d '\r' || echo 0)
  if [[ $content_length -gt 0 ]]; then
    local body
    body=$(dd bs=1 count="$content_length" 2>/dev/null)
    request+="$body"
  fi
  _handle_request "$request"
}

# ══════════════════════════════════════════════════════════════════════════════
# INSTALAÇÃO COMO SERVIÇO SYSTEMD
# ══════════════════════════════════════════════════════════════════════════════

_install_service() {
  [[ $EUID -ne 0 ]] && { echo "Execute como root"; exit 1; }

  # Instalar socat se não existir
  if ! command -v socat &>/dev/null; then
    apt-get install -y socat >> "$LOG_FILE" 2>&1
  fi

  # Copiar script para local permanente
  cp "$0" /usr/local/bin/visitas-webhook
  chmod +x /usr/local/bin/visitas-webhook

  # Carregar secret do .env de prod
  local secret=""
  [[ -f "$APP_DIR_PROD/.env" ]] && \
    secret=$(grep "^WEBHOOK_SECRET=" "$APP_DIR_PROD/.env" | cut -d= -f2)

  # Criar serviço systemd
  cat > /etc/systemd/system/visitas-webhook.service << SERVICE
[Unit]
Description=Visitas Deploy Webhook
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=simple
ExecStart=/usr/local/bin/visitas-webhook start
Restart=always
RestartSec=5
Environment=HOOK_PORT=${HOOK_PORT}
Environment=HOOK_SECRET=${secret}
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}

[Install]
WantedBy=multi-user.target
SERVICE

  systemctl daemon-reload
  systemctl enable visitas-webhook
  systemctl restart visitas-webhook

  # Adicionar rota no Nginx para o webhook
  _configure_nginx_webhook

  echo -e "${G}✔  Webhook service instalado e rodando${RESET}"
  echo -e "   URL do webhook: https://$(grep 'APP_DOMAIN=' "$APP_DIR_PROD/.env" 2>/dev/null | cut -d= -f2)/webhook/deploy"
  echo -e "   Logs: $LOG_FILE"
}

_configure_nginx_webhook() {
  local nginx_conf="/etc/nginx/sites-available/visitas-prod"
  [[ ! -f "$nginx_conf" ]] && return

  # Verificar se já tem a rota /webhook/
  grep -q "location /webhook/" "$nginx_conf" 2>/dev/null && return

  # Inserir antes do location /api/
  sed -i '/location \/api\//i\
    location /webhook/ {\
        proxy_pass http://127.0.0.1:'"$HOOK_PORT"'/;\
        proxy_set_header Host $host;\
        proxy_set_header X-Real-IP $remote_addr;\
        proxy_read_timeout 15s;\
    }\
' "$nginx_conf"

  nginx -t 2>/dev/null && systemctl reload nginx
  echo "✔  Nginx configurado para /webhook/"
}

# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

case "${1:-start}" in
  install)    _install_service ;;
  start)      _start_server ;;
  _handle_one) _handle_one ;;
  test)
    echo "Simulando webhook para branch 'main'..."
    payload='{"ref":"refs/heads/main","after":"abc1234"}'
    curl -s -X POST "http://localhost:$HOOK_PORT/" \
      -H "Content-Type: application/json" \
      -d "$payload"
    ;;
  deploy)
    env_type="${2:-prod}"
    branch="${3:-main}"
    _deploy "$env_type" "$branch"
    ;;
  logs)
    tail -f "$LOG_FILE"
    ;;
  *)
    echo "Uso: $0 {install|start|test|deploy [prod|test] [branch]|logs}"
    ;;
esac
