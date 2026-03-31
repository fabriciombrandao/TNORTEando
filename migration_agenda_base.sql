-- Adicionar campos de frequência ABC e ciclo nos parâmetros
ALTER TABLE parametros_organizacao
  ADD COLUMN IF NOT EXISTS freq_a_dias    INTEGER DEFAULT 15,
  ADD COLUMN IF NOT EXISTS freq_b_dias    INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS freq_c_dias    INTEGER DEFAULT 45,
  ADD COLUMN IF NOT EXISTS ciclo_dias     INTEGER DEFAULT 45,
  ADD COLUMN IF NOT EXISTS horizonte_dias INTEGER DEFAULT 30;

-- Adicionar campos de controle nas agendas
ALTER TABLE agendas
  ADD COLUMN IF NOT EXISTS gerada_por  VARCHAR(20) DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS publicada   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS status      VARCHAR(20) DEFAULT 'RASCUNHO',
  ADD COLUMN IF NOT EXISTS publicada_em TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS publicada_por UUID REFERENCES usuarios(id);

-- Adicionar campo de tipo de visita nos itens
ALTER TABLE agenda_itens
  ADD COLUMN IF NOT EXISTS tipo_visita VARCHAR(50),
  ADD COLUMN IF NOT EXISTS justificativa_ajuste TEXT,
  ADD COLUMN IF NOT EXISTS ajustado_por UUID REFERENCES usuarios(id);

-- Atualizar valores defaults nos parâmetros existentes
UPDATE parametros_organizacao SET
  freq_a_dias    = 15,
  freq_b_dias    = 30,
  freq_c_dias    = 45,
  ciclo_dias     = 45,
  horizonte_dias = 30
WHERE freq_a_dias IS NULL;

SELECT 'Migration agenda base OK' as status;
