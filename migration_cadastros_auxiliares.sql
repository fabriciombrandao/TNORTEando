-- ─────────────────────────────────────────────
-- Cadastros Auxiliares
-- ─────────────────────────────────────────────

-- 1. Objetivos de visita
CREATE TABLE IF NOT EXISTS objetivos_visita (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome      VARCHAR(100) NOT NULL UNIQUE,
    ativo     BOOLEAN DEFAULT TRUE,
    ordem     INTEGER DEFAULT 0,
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Tipos de resultado
CREATE TABLE IF NOT EXISTS tipos_resultado_visita (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome      VARCHAR(100) NOT NULL UNIQUE,
    icone     VARCHAR(10) DEFAULT '📋',
    ativo     BOOLEAN DEFAULT TRUE,
    ordem     INTEGER DEFAULT 0,
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Ações de próximo passo
CREATE TABLE IF NOT EXISTS acoes_proximo_passo (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome      VARCHAR(100) NOT NULL UNIQUE,
    ativo     BOOLEAN DEFAULT TRUE,
    ordem     INTEGER DEFAULT 0,
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Departamentos
CREATE TABLE IF NOT EXISTS departamentos (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome      VARCHAR(100) NOT NULL UNIQUE,
    ativo     BOOLEAN DEFAULT TRUE,
    ordem     INTEGER DEFAULT 0,
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Tipos de contato
CREATE TABLE IF NOT EXISTS tipos_contato (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome      VARCHAR(100) NOT NULL UNIQUE,
    ativo     BOOLEAN DEFAULT TRUE,
    ordem     INTEGER DEFAULT 0,
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Justificativas de ajuste de agenda
CREATE TABLE IF NOT EXISTS justificativas_agenda (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome      VARCHAR(200) NOT NULL UNIQUE,
    ativo     BOOLEAN DEFAULT TRUE,
    ordem     INTEGER DEFAULT 0,
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Motivos de cancelamento
CREATE TABLE IF NOT EXISTS motivos_cancelamento (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome      VARCHAR(200) NOT NULL UNIQUE,
    ativo     BOOLEAN DEFAULT TRUE,
    ordem     INTEGER DEFAULT 0,
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Feriados municipais e pontos facultativos
CREATE TABLE IF NOT EXISTS feriados (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome      VARCHAR(200) NOT NULL,
    data      DATE NOT NULL,
    uf        VARCHAR(2),  -- NULL = nacional
    municipio VARCHAR(100),
    tipo      VARCHAR(20) DEFAULT 'MUNICIPAL', -- MUNICIPAL, PONTO_FACULTATIVO
    ativo     BOOLEAN DEFAULT TRUE,
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(data, uf, municipio)
);

-- ─────────────────────────────────────────────
-- Dados iniciais
-- ─────────────────────────────────────────────

INSERT INTO objetivos_visita (nome, ordem) VALUES
  ('Relacionamento',  1),
  ('Renovação',       2),
  ('Upsell',          3),
  ('Demo',            4),
  ('Suporte',         5),
  ('Cobrança',        6),
  ('Implantação',     7),
  ('Outro',           99)
ON CONFLICT (nome) DO NOTHING;

INSERT INTO tipos_resultado_visita (nome, icone, ordem) VALUES
  ('Problema identificado',     '🔴', 1),
  ('Oportunidade de expansão',  '🟢', 2),
  ('Risco de cancelamento',     '⚠️',  3),
  ('Demo solicitada',           '📊', 4),
  ('Proposta apresentada',      '📄', 5),
  ('Outro',                     '📋', 99)
ON CONFLICT (nome) DO NOTHING;

INSERT INTO acoes_proximo_passo (nome, ordem) VALUES
  ('Enviar proposta comercial', 1),
  ('Agendar demonstração',      2),
  ('Abrir chamado técnico',     3),
  ('Retorno de visita',         4),
  ('Reunião com GSN',           5),
  ('Sem ação necessária',       6),
  ('Outro',                     99)
ON CONFLICT (nome) DO NOTHING;

INSERT INTO departamentos (nome, ordem) VALUES
  ('Diretoria',   1),
  ('Financeiro',  2),
  ('TI',          3),
  ('RH',          4),
  ('Operacional', 5),
  ('Comercial',   6),
  ('Jurídico',    7),
  ('Outro',       99)
ON CONFLICT (nome) DO NOTHING;

INSERT INTO tipos_contato (nome, ordem) VALUES
  ('Decisor',      1),
  ('Técnico',      2),
  ('Financeiro',   3),
  ('Operacional',  4),
  ('Outro',        99)
ON CONFLICT (nome) DO NOTHING;

INSERT INTO justificativas_agenda (nome, ordem) VALUES
  ('Cliente solicitou reagendamento',     1),
  ('ESN em viagem/indisponível',          2),
  ('Cliente sem expediente no dia',       3),
  ('Conflito com visita prioritária',     4),
  ('Condições climáticas',               5),
  ('Visita antecipada a pedido do cliente', 6),
  ('Problema técnico/operacional',        7),
  ('Outro',                               99)
ON CONFLICT (nome) DO NOTHING;

INSERT INTO motivos_cancelamento (nome, ordem) VALUES
  ('Cliente cancelou',     1),
  ('ESN cancelou',         2),
  ('Força maior',          3),
  ('Duplicidade',          4),
  ('Outro',                99)
ON CONFLICT (nome) DO NOTHING;

SELECT 'Migration cadastros auxiliares OK' as status;
