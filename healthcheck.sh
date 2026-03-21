#!/usr/bin/env bash
# =============================================================================
#  VISITAS — Diagnóstico completo da VPS
#  Uso: sudo bash healthcheck.sh
# =============================================================================

set -uo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

PASS=0; WARN=0; FAIL=0

ok()   { echo -e "  ${GREEN}✔${RESET}  $*"; ((PASS++)); }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $*"; ((WARN++)); }
fail() { echo -e "  ${RED}✘${RESET}  $*"; ((FAIL++)); }
section() { echo -e "\n${BOLD}${CYAN}  ── $* ──${RESET}"; }

echo -e "\n${BOLD}  VISITAS — Diagnóstico da VPS  $(date)${RESET}"

# ─── Sistema Operacional ───────────────────────────────────────────────────────
section "Sistema Operacional"
. /etc/os-release
echo -e "     OS      : ${PRETTY_NAME}"
echo -e "     Kernel  : $(uname -r)"
echo -e "     Uptime  : $(uptime -p)"
echo -e "     Arch    : $(uname -m)"

[[ "$ID" == "ubuntu" || "$ID" == "debian" ]] && ok "SO suportado: $ID $VERSION_ID" || warn "SO não oficialmente suportado: $ID"

# ─── Hardware ─────────────────────────────────────────────────────────────────
section "Hardware"
RAM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
RAM_FREE=$(awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo)
DISK_FREE=$(df / --output=avail -BG | tail -1 | tr -dc '0-9')
CPU_COUNT=$(nproc)
LOAD=$(uptime | awk -F'load average:' '{print $2}' | awk '{print $1}' | tr -d ',')

echo -e "     RAM     : ${RAM_MB} MB total / ${RAM_FREE} MB livre"
echo -e "     Disco   : ${DISK_FREE} GB livres em /"
echo -e "     CPUs    : ${CPU_COUNT} core(s)"
echo -e "     Load    : ${LOAD}"

[[ $RAM_MB -ge 1024 ]] && ok "RAM suficiente (${RAM_MB} MB)" || fail "RAM abaixo do mínimo: ${RAM_MB} MB < 1024 MB"
[[ $DISK_FREE -ge 5 ]]  && ok "Disco OK (${DISK_FREE} GB livres)" || fail "Disco crítico: apenas ${DISK_FREE} GB livres"
[[ $CPU_COUNT -ge 1 ]] && ok "CPU OK (${CPU_COUNT} core(s))" || fail "Sem CPUs?"

# Swap
SWAP=$(swapon --show=SIZE --noheadings 2>/dev/null | head -1)
[[ -n "$SWAP" ]] && ok "Swap ativo: $SWAP" || warn "Sem swap configurado (recomendado se RAM < 2GB)"

# ─── Rede ─────────────────────────────────────────────────────────────────────
section "Rede e Conectividade"
PUBLIC_IP=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo "não detectado")
echo -e "     IP Público : $PUBLIC_IP"

curl -fsSL --max-time 5 https://google.com > /dev/null 2>&1 \
  && ok "Internet OK" || fail "Sem acesso à internet"

# DNS
getent hosts github.com > /dev/null 2>&1 \
  && ok "DNS resolvendo corretamente" || fail "DNS com problema"

# Portas abertas
for PORT in 80 443; do
  ss -tlnp | grep -q ":${PORT} " \
    && ok "Porta $PORT em escuta" || warn "Porta $PORT não está em escuta"
done

# ─── Docker ───────────────────────────────────────────────────────────────────
section "Docker"
if command -v docker &>/dev/null; then
  DOCKER_VER=$(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1)
  ok "Docker instalado: v${DOCKER_VER}"
  systemctl is-active docker > /dev/null 2>&1 && ok "Docker service ativo" || fail "Docker service inativo"

  if docker compose version &>/dev/null 2>&1; then
    ok "Docker Compose v2 disponível"
  elif command -v docker-compose &>/dev/null; then
    ok "Docker Compose standalone disponível"
  else
    fail "Docker Compose não encontrado"
  fi
else
  fail "Docker não instalado"
fi

# ─── Containers ───────────────────────────────────────────────────────────────
section "Containers da Aplicação"
if [[ -f /opt/visitas/app/docker-compose.yml ]]; then
  cd /opt/visitas/app
  CONTAINERS=$(docker compose ps --format json 2>/dev/null || echo "")

  if [[ -n "$CONTAINERS" ]]; then
    for SERVICE in db redis backend frontend; do
      STATUS=$(docker compose ps "$SERVICE" 2>/dev/null | grep -v "^NAME" | awk '{print $4}' | head -1)
      if [[ "$STATUS" == "running" ]] || echo "$STATUS" | grep -qi "up"; then
        ok "Container '$SERVICE': rodando"
      elif [[ -z "$STATUS" ]]; then
        warn "Container '$SERVICE': não iniciado"
      else
        fail "Container '$SERVICE': $STATUS"
      fi
    done
  else
    warn "Nenhum container da aplicação em execução"
  fi
else
  warn "docker-compose.yml não encontrado em /opt/visitas/app — aplicação não implantada ainda"
fi

# ─── Nginx ────────────────────────────────────────────────────────────────────
section "Nginx"
if command -v nginx &>/dev/null; then
  ok "Nginx instalado: $(nginx -v 2>&1 | grep -oP 'nginx/[\d.]+')"
  systemctl is-active nginx > /dev/null 2>&1 && ok "Nginx ativo" || fail "Nginx inativo"
  nginx -t 2>/dev/null && ok "Configuração Nginx válida" || fail "Configuração Nginx inválida"
else
  fail "Nginx não instalado"
fi

# ─── SSL ──────────────────────────────────────────────────────────────────────
section "SSL / TLS"
DOMAIN=$(grep server_name /etc/nginx/sites-available/visitas 2>/dev/null | head -1 | awk '{print $2}' | tr -d ';' || echo "")
if [[ -n "$DOMAIN" && "$DOMAIN" != "_" ]]; then
  echo -e "     Domínio configurado: $DOMAIN"
  if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    EXPIRY=$(openssl x509 -enddate -noout -in "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" 2>/dev/null | cut -d= -f2)
    EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s 2>/dev/null || echo 0)
    NOW_EPOCH=$(date +%s)
    DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))
    [[ $DAYS_LEFT -gt 30 ]] && ok "Certificado SSL válido — expira em ${DAYS_LEFT} dias" \
      || warn "Certificado SSL expira em ${DAYS_LEFT} dias — renovar em breve"
  else
    warn "Certificado SSL Let's Encrypt não encontrado para $DOMAIN"
  fi
else
  warn "Domínio não configurado no Nginx"
fi

# ─── Firewall ─────────────────────────────────────────────────────────────────
section "Segurança"
ufw status 2>/dev/null | grep -q "Status: active" \
  && ok "UFW firewall ativo" || warn "UFW firewall inativo"

systemctl is-active fail2ban > /dev/null 2>&1 \
  && ok "Fail2ban ativo" || warn "Fail2ban inativo"

# SSH senha (melhor usar chave)
if grep -q "PasswordAuthentication yes" /etc/ssh/sshd_config 2>/dev/null; then
  warn "SSH aceita autenticação por senha — recomendado usar apenas chaves"
else
  ok "SSH configurado para chaves (ou padrão seguro)"
fi

# ─── Backups ──────────────────────────────────────────────────────────────────
section "Backups"
BACKUP_DIR="/opt/visitas/backups"
if [[ -d "$BACKUP_DIR" ]]; then
  LAST_BACKUP=$(ls -t "$BACKUP_DIR"/*.gz 2>/dev/null | head -1)
  if [[ -n "$LAST_BACKUP" ]]; then
    BACKUP_AGE=$(( ($(date +%s) - $(stat -c %Y "$LAST_BACKUP")) / 3600 ))
    [[ $BACKUP_AGE -lt 26 ]] && ok "Último backup: há ${BACKUP_AGE}h ($(basename "$LAST_BACKUP"))" \
      || warn "Último backup há ${BACKUP_AGE}h — verifique o agendamento"
  else
    warn "Nenhum backup encontrado em $BACKUP_DIR"
  fi
else
  warn "Diretório de backups não encontrado"
fi

crontab -l 2>/dev/null | grep -q visitas-backup \
  && ok "Backup automático agendado via cron" || warn "Backup automático não agendado"

# ─── Resultado final ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "  ${GREEN}✔ OK: ${PASS}${RESET}  ${YELLOW}⚠ Avisos: ${WARN}${RESET}  ${RED}✘ Falhas: ${FAIL}${RESET}"
echo -e "${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

if [[ $FAIL -gt 0 ]]; then
  echo -e "\n  ${RED}${BOLD}Sistema com falhas — revise os itens marcados com ✘${RESET}\n"
  exit 1
elif [[ $WARN -gt 0 ]]; then
  echo -e "\n  ${YELLOW}Sistema operacional com avisos — revise os itens marcados com ⚠${RESET}\n"
  exit 0
else
  echo -e "\n  ${GREEN}${BOLD}Tudo OK — sistema pronto para produção!${RESET}\n"
  exit 0
fi
