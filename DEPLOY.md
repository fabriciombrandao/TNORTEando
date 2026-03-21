# Guia de Deploy — Do VSCode à VPS

## O que você vai ter no final

```
git push  →  GitHub recebe  →  VPS faz pull + build + restart  →  online
```

Além disso, o VSCode se conecta diretamente à VPS via SSH para rodar
comandos, ver logs e fazer deploys manuais com um clique.

---

## PARTE 1 — Configurar SSH (Mac → VPS)

### 1.1 Criar chave SSH no Mac

Abra o terminal do Mac e execute:

```bash
# Criar chave (pressione Enter 3x para aceitar os padrões)
ssh-keygen -t ed25519 -C "visitas-deploy" -f ~/.ssh/visitas_vps

# Ver a chave pública (você vai precisar dela no próximo passo)
cat ~/.ssh/visitas_vps.pub
```

### 1.2 Copiar a chave para a VPS

```bash
# Substitua SEU_USUARIO e IP_DA_VPS pelos seus dados reais
ssh-copy-id -i ~/.ssh/visitas_vps.pub SEU_USUARIO@IP_DA_VPS

# Testar a conexão (não deve pedir senha)
ssh -i ~/.ssh/visitas_vps SEU_USUARIO@IP_DA_VPS "echo 'Conexão OK'"
```

### 1.3 Criar o atalho SSH no Mac

Edite (ou crie) o arquivo `~/.ssh/config` no Mac:

```bash
nano ~/.ssh/config
```

Cole este conteúdo (ajuste o IP e usuário):

```
Host vps-visitas
    HostName IP_DA_VPS
    User SEU_USUARIO
    IdentityFile ~/.ssh/visitas_vps
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

Agora você pode conectar com apenas:
```bash
ssh vps-visitas
```

---

## PARTE 2 — Configurar o VSCode

### 2.1 Instalar extensões necessárias

Abra o VSCode, pressione `Cmd+Shift+P` e digite:
```
Extensions: Install Extensions
```

Instale estas extensões (ou rode o comando abaixo no terminal):

```bash
code --install-extension ms-vscode-remote.remote-ssh
code --install-extension ms-vscode-remote.remote-ssh-edit
code --install-extension ms-python.python
code --install-extension ms-python.black-formatter
code --install-extension esbenp.prettier-vscode
code --install-extension ms-azuretools.vscode-docker
code --install-extension eamodio.gitlens
```

### 2.2 Conectar o VSCode na VPS

1. Pressione `Cmd+Shift+P`
2. Digite: `Remote-SSH: Connect to Host`
3. Selecione: `vps-visitas`
4. Uma nova janela do VSCode abre **conectada à VPS**
5. Abra a pasta: `/opt/visitas/prod/src`

Agora você edita arquivos na VPS como se fossem locais.

---

## PARTE 3 — Configurar o repositório Git

### 3.1 Adicionar a chave SSH ao GitHub/GitLab

```bash
# No Mac, copiar a chave pública
cat ~/.ssh/visitas_vps.pub | pbcopy
```

**GitHub:** Settings → SSH and GPG keys → New SSH key → Cole e salve

**GitLab:** Profile → Preferences → SSH Keys → Cole e salve

### 3.2 Inicializar o repositório (se ainda não fez)

```bash
cd ~/Downloads/visitas   # pasta do projeto no Mac

git init
git add -A
git commit -m "feat: projeto inicial visitas"

# Substitua pela URL do seu repositório
git remote add origin git@github.com:SEU_USUARIO/visitas.git
git push -u origin main
```

### 3.3 Adicionar chave da VPS ao repositório (para o deploy automático)

A VPS precisa de permissão para fazer `git pull` no repositório:

```bash
# Na VPS (conectado via SSH)
ssh-keygen -t ed25519 -C "vps-visitas-deploy" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Copie a chave gerada e adicione ao GitHub/GitLab como **Deploy Key**:
- GitHub: Repositório → Settings → Deploy keys → Add deploy key
- GitLab: Repositório → Settings → Repository → Deploy keys

---

## PARTE 4 — Instalar o sistema na VPS

### 4.1 Enviar o wizard e rodar

```bash
# No terminal do Mac
scp ~/Downloads/visitas/wizard.sh vps-visitas:/tmp/

# Conectar e instalar
ssh vps-visitas
bash /tmp/wizard.sh
```

O wizard vai pedir:
- Domínio de produção (ex: visitas.suaempresa.com.br)
- E-mail para SSL
- URL do repositório Git (ex: git@github.com:usuario/visitas.git)
- Branch de produção: `main`

### 4.2 Instalar o serviço de webhook

Após o wizard terminar, ainda na VPS:

```bash
# Copiar o script de webhook
cp /opt/visitas/prod/src/deploy-hook.sh /usr/local/bin/
chmod +x /usr/local/bin/deploy-hook.sh

# Adicionar o WEBHOOK_SECRET no .env de prod
echo "WEBHOOK_SECRET=$(openssl rand -hex 32)" >> /opt/visitas/prod/.env

# Instalar como serviço
sudo bash /usr/local/bin/deploy-hook.sh install
```

---

## PARTE 5 — Configurar o Webhook no GitHub/GitLab

### GitHub

1. Acesse: Repositório → Settings → Webhooks → Add webhook
2. **Payload URL:** `https://SEU_DOMINIO/webhook/deploy`
3. **Content type:** `application/json`
4. **Secret:** o valor de `WEBHOOK_SECRET` do seu `.env`
5. **Which events:** `Just the push event`
6. Clique em **Add webhook**

### GitLab

1. Acesse: Repositório → Settings → Webhooks
2. **URL:** `https://SEU_DOMINIO/webhook/deploy`
3. **Secret token:** o valor de `WEBHOOK_SECRET`
4. **Trigger:** Push events → branch `main`
5. Clique em **Add webhook**

---

## PARTE 6 — Testar o fluxo completo

### 6.1 Teste manual de deploy

No terminal do VSCode (ou no Mac):
```bash
ssh vps-visitas 'bash deploy-hook.sh deploy prod main'
```

### 6.2 Teste do webhook

```bash
ssh vps-visitas 'bash deploy-hook.sh test'
```

### 6.3 Teste do fluxo completo

```bash
# No Mac, no projeto
echo "# teste deploy $(date)" >> README.md
git add -A
git commit -m "test: verificando deploy automático"
git push

# Na VPS, acompanhar em tempo real
ssh vps-visitas 'tail -f /opt/visitas/logs/deploy.log'
```

Você deve ver o deploy acontecendo automaticamente após o push.

---

## Uso diário — atalhos do VSCode

Pressione `Cmd+Shift+P` → `Tasks: Run Task` para executar qualquer uma dessas tarefas sem digitar comandos:

| Task | O que faz |
|------|-----------|
| 🚀 Deploy — PRODUÇÃO | Deploy manual na prod |
| 🧪 Deploy — TESTES | Deploy no ambiente de testes |
| 📊 Status da VPS | Ver containers e recursos |
| 📋 Logs — Backend PROD | Logs em tempo real |
| 💾 Backup agora | Backup imediato do banco |
| 🌱 Seed inicial | Criar usuário gestor |
| 📦 Git — commit e push | Commit + push com mensagem |

---

## Resumo do fluxo diário

```
1. Edite o código no VSCode (localmente ou via Remote SSH)
2. git push  →  deploy automático começa em segundos
3. Acompanhe em: Tasks → Logs — Backend PROD
```

Se precisar de um deploy manual urgente:
```
Tasks → 🚀 Deploy — PRODUÇÃO
```

---

## Solução de problemas

**Webhook não dispara:**
```bash
# Verificar se o serviço está rodando
ssh vps-visitas 'systemctl status visitas-webhook'

# Ver logs
ssh vps-visitas 'tail -50 /opt/visitas/logs/deploy.log'
```

**Deploy falhou no build:**
```bash
ssh vps-visitas 'tail -100 /opt/visitas/logs/deploy.log'
```

**Containers não sobem:**
```bash
ssh vps-visitas 'cd /opt/visitas/prod && docker compose ps && docker compose logs --tail=30'
```

**Resetar tudo e reiniciar:**
```bash
ssh vps-visitas 'bash wizard.sh'  # abre o menu de gestão
```
