-- =============================================================
-- 00034: SALDO EN EFECTIVO DE UNA SESIÓN DE CAJA
-- Centraliza el cálculo que el API repetía en /cash/sessions (columna
-- "Total") y en la validación de salidas (§1.8.3): apertura + ventas en
-- efectivo netas (amount - cambio) + entradas - salidas manuales.
-- Devuelve NULL si la sesión no existe.
-- =============================================================

CREATE OR REPLACE FUNCTION cash_session_balance(p_session_id INT)
RETURNS NUMERIC AS $$
  SELECT cs.opening_amount
    + COALESCE((SELECT SUM(op.amount - op.change_given)
        FROM order_payments op
        JOIN orders o ON o.id = op.order_id
        JOIN payment_methods pm ON pm.id = op.payment_method_id
        WHERE o.cash_session_id = cs.id AND pm.name = 'EFECTIVO'), 0)
    + COALESCE((SELECT SUM(amount) FROM cash_transactions
        WHERE cash_session_id = cs.id AND type = 'ENTRADA'), 0)
    - COALESCE((SELECT SUM(amount) FROM cash_transactions
        WHERE cash_session_id = cs.id AND type = 'SALIDA'), 0)
  FROM cash_sessions cs
  WHERE cs.id = p_session_id;
$$ LANGUAGE sql STABLE;
