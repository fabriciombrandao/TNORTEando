-- Adicionar campo tipo_esn na tabela de usuários
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tipo_esn VARCHAR(20) DEFAULT 'BASE';

-- Atualizar ESNs existentes com valor padrão
UPDATE usuarios SET tipo_esn = 'BASE' WHERE papel = 'ESN' AND tipo_esn IS NULL;

SELECT 'Migration tipo_esn OK' as status;
