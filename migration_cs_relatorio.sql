-- Adicionar papel CS ao enum
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'CS' AND enumtypid = 'papelusuario'::regtype) THEN
        ALTER TYPE papelusuario ADD VALUE 'CS';
    END IF;
END $$;

-- Adicionar colunas de relatório na tabela visitas
ALTER TABLE visitas
    ADD COLUMN IF NOT EXISTS relatorio_tipo          VARCHAR(20)  DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS relatorio_resumo        TEXT         DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS relatorio_problema      BOOLEAN      DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS relatorio_problema_desc TEXT         DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS relatorio_oportunidade  BOOLEAN      DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS relatorio_oport_desc    TEXT         DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS relatorio_proximo_passo TEXT         DEFAULT NULL;

SELECT 'Migration CS + relatório OK' as status;
