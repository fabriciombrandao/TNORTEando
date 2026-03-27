-- Adicionar campos faltantes nos itens de contrato
ALTER TABLE itens_contrato
  ADD COLUMN IF NOT EXISTS status_cancelamento VARCHAR(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS data_assinatura_item DATE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS valor_unitario NUMERIC(12,2) DEFAULT 0;

-- Adicionar valor_recorrente nas propostas (MRR da proposta)
ALTER TABLE propostas_contrato
  ADD COLUMN IF NOT EXISTS valor_recorrente NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS data_assinatura DATE DEFAULT NULL;

-- Recalcular valor_recorrente das propostas excluindo itens cancelados
UPDATE propostas_contrato p SET valor_recorrente = COALESCE((
    SELECT SUM(i.valor_total)
    FROM itens_contrato i
    WHERE i.proposta_id = p.id
      AND i.recorrente = true
      AND COALESCE(i.status_cancelamento, '') != 'CANCELADO'
), 0);

-- Recalcular valor_mensal dos contratos excluindo itens cancelados
UPDATE contratos c SET valor_mensal = COALESCE((
    SELECT SUM(i.valor_total)
    FROM itens_contrato i
    JOIN propostas_contrato p ON p.id = i.proposta_id
    WHERE p.contrato_id = c.id
      AND i.recorrente = true
      AND COALESCE(i.status_cancelamento, '') != 'CANCELADO'
), 0)
WHERE c.status = 'ATIVO';

SELECT 'Migração itens OK' as status,
    COUNT(*) as total_itens,
    COUNT(*) FILTER (WHERE status_cancelamento = 'CANCELADO') as cancelados
FROM itens_contrato;

-- Adicionar status_item por linha de item
ALTER TABLE itens_contrato
  ADD COLUMN IF NOT EXISTS status_item VARCHAR(20) DEFAULT 'ATIVO';
