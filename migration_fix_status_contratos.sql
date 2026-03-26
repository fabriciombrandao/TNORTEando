-- Corrigir status dos contratos que foram importados com status errado
-- Regra: se o contrato tem ao menos uma proposta ativa, marca como ATIVO
-- (solução pragmática pois não temos o CSV original no banco)

-- Marcar como ATIVO contratos que têm propostas com valor recorrente > 0
-- (indica que eram ativos quando importados)
UPDATE contratos SET status = 'ATIVO'
WHERE status = 'CANCELADO'
  AND id IN (
    SELECT DISTINCT contrato_id FROM propostas_contrato
    WHERE valor_recorrente > 0
  );

-- Recalcular valor_mensal dos contratos ativos baseado nas propostas
UPDATE contratos c SET valor_mensal = sub.mrr
FROM (
    SELECT p.contrato_id, SUM(p.valor_recorrente) as mrr
    FROM propostas_contrato p
    GROUP BY p.contrato_id
) sub
WHERE c.id = sub.contrato_id
  AND c.status = 'ATIVO';

-- Recalcular classificação ABC dos clientes com base no novo MRR
UPDATE clientes c SET classificacao_abc =
    CASE
        WHEN COALESCE(ct.mrr, 0) >= (SELECT COALESCE(mrr_cliente_a, 5000) FROM parametros_organizacao LIMIT 1) THEN 'A'
        WHEN COALESCE(ct.mrr, 0) >= (SELECT COALESCE(mrr_cliente_b, 1000) FROM parametros_organizacao LIMIT 1) THEN 'B'
        ELSE 'C'
    END
FROM (
    SELECT ct2.cliente_id, COALESCE(SUM(ct2.valor_mensal), 0) as mrr
    FROM contratos ct2 WHERE ct2.status = 'ATIVO'
    GROUP BY ct2.cliente_id
) ct
WHERE c.id = ct.cliente_id;

SELECT
    'Correção OK' as status,
    COUNT(*) FILTER (WHERE status = 'ATIVO')     as ativos,
    COUNT(*) FILTER (WHERE status = 'CANCELADO') as cancelados,
    COUNT(*) FILTER (WHERE status = 'GRATUITO')  as gratuitos
FROM contratos;
