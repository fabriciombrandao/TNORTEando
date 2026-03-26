-- ═══════════════════════════════════════════════════════════════
-- Migration: Hierarquia de Acesso Completa
-- Unidade Consolidadora → Organização → DSN → GSN → ESN
-- ═══════════════════════════════════════════════════════════════

-- 1. Tabela de Unidades Consolidadoras (franquia/holding)
CREATE TABLE IF NOT EXISTS unidades_consolidadoras (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome            VARCHAR(255) NOT NULL,
    codigo          VARCHAR(50) UNIQUE,
    ativo           BOOLEAN DEFAULT true,
    criado_em       TIMESTAMPTZ DEFAULT now()
);

-- 2. Adicionar consolidadora nas organizações
ALTER TABLE organizacoes
    ADD COLUMN IF NOT EXISTS consolidadora_id UUID REFERENCES unidades_consolidadoras(id);

-- 3. Novos papéis de usuário
-- PostgreSQL não permite ADD VALUE IF NOT EXISTS diretamente, usamos DO block
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'ADMIN' AND enumtypid = 'papelusuario'::regtype) THEN
        ALTER TYPE papelusuario ADD VALUE 'ADMIN';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'GESTOR_CONSOLIDADORA' AND enumtypid = 'papelusuario'::regtype) THEN
        ALTER TYPE papelusuario ADD VALUE 'GESTOR_CONSOLIDADORA';
    END IF;
END;
$$;

-- 4. Adicionar consolidadora_id nos usuários (para GESTOR_CONSOLIDADORA)
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS consolidadora_id UUID REFERENCES unidades_consolidadoras(id);

-- 5. Criar consolidadora padrão e vincular organização existente
INSERT INTO unidades_consolidadoras (id, nome, codigo, ativo)
VALUES (gen_random_uuid(), 'TOTVS NORTE', 'TOTVS_NORTE', true)
ON CONFLICT (codigo) DO NOTHING;

-- Vincular organização existente à consolidadora
UPDATE organizacoes SET consolidadora_id = (
    SELECT id FROM unidades_consolidadoras WHERE codigo = 'TOTVS_NORTE' LIMIT 1
) WHERE consolidadora_id IS NULL;

-- 6. Tabela de parâmetros de acesso (regras via parâmetro)
CREATE TABLE IF NOT EXISTS parametros_acesso (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consolidadora_id            UUID REFERENCES unidades_consolidadoras(id),
    -- Permissões por papel (JSONB para flexibilidade)
    permissoes                  JSONB NOT NULL DEFAULT '{
        "ESN":                  ["ver_clientes_proprios", "checkin", "agenda", "contatos_cliente"],
        "GSN":                  ["ver_clientes_equipe", "ver_relatorios_equipe"],
        "DSN":                  ["ver_clientes_territorio", "ver_relatorios_territorio"],
        "GESTOR_EMPRESA":       ["ver_tudo_franquia", "importar_csv", "parametros", "usuarios"],
        "GESTOR_CONSOLIDADORA": ["ver_tudo_consolidadora", "relatorios_consolidados"],
        "ADMIN":                ["ver_tudo", "criar_consolidadoras", "criar_organizacoes", "criar_usuarios"]
    }'::jsonb,
    -- Regras de visibilidade
    esn_ve_apenas_proprios      BOOLEAN DEFAULT true,
    gsn_ve_esns_proprios        BOOLEAN DEFAULT true,
    dsn_ve_gsns_proprios        BOOLEAN DEFAULT true,
    criado_em                   TIMESTAMPTZ DEFAULT now()
);

-- Popular com padrão
INSERT INTO parametros_acesso (consolidadora_id)
SELECT id FROM unidades_consolidadoras
ON CONFLICT DO NOTHING;

SELECT
    'Migration hierarquia OK' as status,
    (SELECT COUNT(*) FROM unidades_consolidadoras) as consolidadoras,
    (SELECT COUNT(*) FROM organizacoes WHERE consolidadora_id IS NOT NULL) as orgs_vinculadas;
