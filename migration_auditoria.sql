-- Tabela de auditoria
CREATE TABLE IF NOT EXISTS audit_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id    UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    usuario_nome  VARCHAR(200),
    usuario_email VARCHAR(200),
    acao          VARCHAR(50)  NOT NULL,  -- LOGIN, LOGOUT, CREATE, UPDATE, DELETE
    entidade      VARCHAR(100),           -- usuarios, clientes, contratos, etc
    entidade_id   VARCHAR(100),
    descricao     TEXT,
    valor_anterior JSONB,
    valor_novo     JSONB,
    ip            VARCHAR(50),
    user_agent    TEXT,
    sucesso       BOOLEAN DEFAULT TRUE,
    criado_em     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_audit_log_usuario ON audit_log(usuario_id);
CREATE INDEX IF NOT EXISTS ix_audit_log_acao ON audit_log(acao);
CREATE INDEX IF NOT EXISTS ix_audit_log_entidade ON audit_log(entidade, entidade_id);
CREATE INDEX IF NOT EXISTS ix_audit_log_criado ON audit_log(criado_em DESC);

SELECT 'Migration auditoria OK' as status;
