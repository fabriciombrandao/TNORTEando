# Visitas — Gestão de Carteira de Clientes

Sistema para controle de visitas de vendedores à base de clientes.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | Python 3.12 + FastAPI + SQLAlchemy async |
| Banco de dados | PostgreSQL 16 |
| Cache | Redis 7 |
| Frontend | React 18 + Vite + TypeScript + TailwindCSS |
| Autenticação | JWT (access + refresh token) |

---

## Hierarquia de Usuários

```
Organização (Empresa/Franquia)
  └── DSN  — Diretor de Vendas    (vê toda a org)
        └── GSN — Gerente          (vê seus ESNs)
              └── ESN — Executivo  (faz visitas, vê seus clientes)
```

> Um mesmo ESN pode estar vinculado a múltiplos GSNs (tabela `hierarquia_vendas`).

---

## Como rodar

### Com Docker Compose

```bash
docker-compose up --build
```

- Backend: http://localhost:8000
- Docs da API: http://localhost:8000/docs
- Frontend: http://localhost:5173

### Local (sem Docker)

**Backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

---

## Importação do CSV

1. Acesse o sistema com um usuário `GESTOR_EMPRESA` ou `DSN`
2. Vá em **Importação** no menu lateral
3. Arraste ou selecione o arquivo `.csv` exportado do TOTVS
4. Revise os alertas:
   - **Clientes órfãos**: importados com status `PENDENTE`, precisam ser atribuídos a um ESN
   - **Clientes sem município**: endereço não preenchido na origem
   - **Avisos de duplo código**: vendedores com múltiplos vínculos (ex: Stela T10387 / T26875)

**Senha padrão** gerada na importação: `Mudar@123`

---

## Papéis e permissões

| Ação | GESTOR | DSN | GSN | ESN |
|------|:------:|:---:|:---:|:---:|
| Importar CSV | ✅ | ✅ | — | — |
| Ver mapa ao vivo | ✅ | ✅ | ✅ | — |
| Gerenciar clientes | ✅ | ✅ | ✅ | — |
| Ver agenda | — | — | — | ✅ |
| Fazer check-in/out | — | — | — | ✅ |

---

## Validação de check-in

O sistema valida se o vendedor está dentro de um raio configurável do cliente antes de registrar o check-in. O raio padrão é **300 metros** e pode ser alterado na variável `CHECKIN_RADIUS_METERS` no `.env`.

Clientes sem coordenadas cadastradas ignoram esta validação.

---

## Variáveis de ambiente

```env
DATABASE_URL=postgresql+asyncpg://visitas_user:visitas_pass@localhost:5432/visitas_db
REDIS_URL=redis://localhost:6379/0
SECRET_KEY=troque_em_producao
CHECKIN_RADIUS_METERS=300
GOOGLE_MAPS_API_KEY=opcional
```
