-- Tabela de expediente semanal por organização
CREATE TABLE IF NOT EXISTS expediente_semanal (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizacao_id  UUID NOT NULL REFERENCES organizacoes(id) ON DELETE CASCADE,
    dia_semana      SMALLINT NOT NULL, -- 0=dom, 1=seg, 2=ter, 3=qua, 4=qui, 5=sex, 6=sab
    ativo           BOOLEAN DEFAULT TRUE,
    manha_inicio    TIME DEFAULT '08:00:00',
    manha_fim       TIME DEFAULT '12:00:00',
    tarde_inicio    TIME DEFAULT '14:00:00',
    tarde_fim       TIME DEFAULT '18:00:00',
    UNIQUE(organizacao_id, dia_semana)
);

-- Inserir expediente padrão (seg-sex) para organizações existentes
INSERT INTO expediente_semanal (organizacao_id, dia_semana, ativo, manha_inicio, manha_fim, tarde_inicio, tarde_fim)
SELECT id, g.dia, 
    CASE WHEN g.dia BETWEEN 1 AND 5 THEN true ELSE false END,
    '08:00:00', '12:00:00', '14:00:00', '18:00:00'
FROM organizacoes, generate_series(0, 6) AS g(dia)
ON CONFLICT (organizacao_id, dia_semana) DO NOTHING;

SELECT 'Migration expediente OK' as status;
