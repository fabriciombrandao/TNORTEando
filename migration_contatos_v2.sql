-- Tabela global de contatos
CREATE TABLE IF NOT EXISTS contatos (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome        VARCHAR(255) NOT NULL,
    cargo       VARCHAR(100),
    telefone    VARCHAR(20),
    email       VARCHAR(255),
    observacoes TEXT,
    criado_em   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vínculo contato × cliente (N:N)
CREATE TABLE IF NOT EXISTS contatos_clientes (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contato_id   UUID NOT NULL REFERENCES contatos(id) ON DELETE CASCADE,
    cliente_id   UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    departamento VARCHAR(100),
    tipo         VARCHAR(50) DEFAULT 'OUTRO',
    principal    BOOLEAN DEFAULT FALSE,
    ativo        BOOLEAN DEFAULT TRUE,
    criado_em    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(contato_id, cliente_id)
);

CREATE INDEX IF NOT EXISTS ix_contatos_clientes_cliente ON contatos_clientes(cliente_id);
CREATE INDEX IF NOT EXISTS ix_contatos_clientes_contato ON contatos_clientes(contato_id);

SELECT 'Migration contatos v2 OK' as status;
