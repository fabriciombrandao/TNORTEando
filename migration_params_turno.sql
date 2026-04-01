ALTER TABLE parametros_organizacao
  ADD COLUMN IF NOT EXISTS visitas_manha_max INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS visitas_tarde_max INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_visitas_base_novos INTEGER DEFAULT 1;

UPDATE parametros_organizacao
  SET visitas_manha_max = 1, visitas_tarde_max = 1, max_visitas_base_novos = 1
  WHERE visitas_manha_max IS NULL;

SELECT 'Migration params_turno OK' as status;
