-- Tabela de tokens (ativação + recuperação de senha)
CREATE TABLE IF NOT EXISTS tokens_usuario (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    token       VARCHAR(64) NOT NULL UNIQUE,
    tipo        VARCHAR(20) NOT NULL, -- 'ATIVACAO' ou 'RECUPERACAO'
    expira_em   TIMESTAMP WITH TIME ZONE NOT NULL,
    usado       BOOLEAN DEFAULT FALSE,
    criado_em   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_tokens_usuario_token ON tokens_usuario(token);
CREATE INDEX IF NOT EXISTS ix_tokens_usuario_usuario ON tokens_usuario(usuario_id);

-- Remover senha padrão dos usuários com primeiro_acesso = true
-- (eles vão receber link por e-mail)
-- Não alteramos agora pois depende do fluxo de envio de e-mail

SELECT 'Migration tokens OK' as status;
