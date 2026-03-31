-- Adicionar coluna publicado em agenda_itens
ALTER TABLE agenda_itens ADD COLUMN IF NOT EXISTS publicado BOOLEAN DEFAULT FALSE;

-- Atualizar itens já publicados (agendas com status PUBLICADA)
UPDATE agenda_itens ai SET publicado = true
FROM agendas a
WHERE a.id = ai.agenda_id AND a.publicada = true;

SELECT 'Migration agenda_itens v2 OK' as status;
