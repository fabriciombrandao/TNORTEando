-- Migrar tabela feriados para dia+mes em vez de data completa
ALTER TABLE feriados 
  ADD COLUMN IF NOT EXISTS dia  SMALLINT,
  ADD COLUMN IF NOT EXISTS mes  SMALLINT,
  ADD COLUMN IF NOT EXISTS ano  SMALLINT;

-- Migrar dados existentes
UPDATE feriados SET 
  dia = EXTRACT(DAY FROM data)::SMALLINT,
  mes = EXTRACT(MONTH FROM data)::SMALLINT
WHERE data IS NOT NULL;

-- Remover constraint UNIQUE antiga baseada em data
ALTER TABLE feriados DROP CONSTRAINT IF EXISTS feriados_data_uf_municipio_key;

-- Nova constraint baseada em dia+mes+uf+municipio
ALTER TABLE feriados ADD CONSTRAINT IF NOT EXISTS 
  feriados_dia_mes_uf_municipio_key UNIQUE (dia, mes, uf, municipio);

-- Limpar registros de teste
DELETE FROM feriados WHERE nome IN ('Teste', 'Teste novo');

SELECT 'Migration feriados v2 OK' as status;
