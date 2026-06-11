-- =============================================================
-- 00021: FIX pay_order — el pago COMPLETO/COMBINADO (sin item_ids)
-- no marcaba los ítems como pagados, por lo que la orden nunca pasaba
-- a 'pagada' (detectado por smoke test E2E 2026-06-11).
-- Regla: pagos sin item_ids = pago completo → paga todos los ítems
-- activos; pagos con item_ids = pago por producto (§1.6.3).
-- =============================================================

CREATE OR REPLACE FUNCTION pay_order(
  p_order_id INT,
  p_client_id INT,
  p_tip NUMERIC,
  p_payments JSONB
) RETURNS VOID AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_session_id INT;
  pay JSONB;
  v_paid NUMERIC := 0;
  v_pending INT;
  v_by_product BOOLEAN := false;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.status <> 'abierta' THEN
    RAISE EXCEPTION 'La orden no está abierta';
  END IF;

  -- §1.6.3: el cliente es obligatorio al pagar
  IF p_client_id IS NULL THEN
    RAISE EXCEPTION 'Debe seleccionar un cliente para facturar el pago';
  END IF;

  -- §1.6.3: requiere una caja abierta
  SELECT cs.id INTO v_session_id FROM cash_sessions cs
  WHERE cs.tenant_id = v_order.tenant_id AND cs.status = 'abierta'
  ORDER BY cs.opened_at DESC LIMIT 1;
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'No hay cajas abiertas; no es posible registrar el pago';
  END IF;

  FOR pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM payment_methods pm
      WHERE pm.id = (pay->>'method_id')::INT
        AND pm.tenant_id = v_order.tenant_id AND pm.is_active
    ) THEN
      RAISE EXCEPTION 'Método de pago inválido o inactivo';
    END IF;

    INSERT INTO order_payments
      (order_id, payment_method_id, bank_id, amount, tip_included,
       change_given, paid_item_ids, voucher_number)
    VALUES
      (p_order_id,
       (pay->>'method_id')::INT,
       NULLIF(pay->>'bank_id', '')::INT,
       (pay->>'amount')::NUMERIC,
       COALESCE((pay->>'tip_included')::NUMERIC, 0),
       COALESCE((pay->>'change_given')::NUMERIC, 0),
       CASE WHEN pay ? 'item_ids' AND jsonb_typeof(pay->'item_ids') = 'array'
            THEN ARRAY(SELECT jsonb_array_elements_text(pay->'item_ids')::INT)
            ELSE NULL END,
       to_char(now(), 'YYYYMMDDHH24MISS') || p_order_id::TEXT);

    v_paid := v_paid + (pay->>'amount')::NUMERIC
              - COALESCE((pay->>'change_given')::NUMERIC, 0);

    -- Pago por producto: marcar solo los ítems seleccionados
    IF pay ? 'item_ids' AND jsonb_typeof(pay->'item_ids') = 'array' THEN
      v_by_product := true;
      UPDATE order_items SET is_paid = true
      WHERE id = ANY(ARRAY(SELECT jsonb_array_elements_text(pay->'item_ids')::INT));
    END IF;
  END LOOP;

  -- Pago completo/combinado (sin item_ids): cubre todos los ítems activos
  IF NOT v_by_product THEN
    UPDATE order_items SET is_paid = true
    WHERE order_id = p_order_id AND kitchen_status <> 'cancelado';
  END IF;

  SELECT COUNT(*) INTO v_pending FROM order_items
  WHERE order_id = p_order_id AND kitchen_status <> 'cancelado' AND NOT is_paid;

  IF v_pending = 0 THEN
    UPDATE orders
    SET status = 'pagada', client_id = p_client_id, tip = COALESCE(p_tip, 0),
        amount_paid = amount_paid + v_paid, cash_session_id = v_session_id,
        subtotal = (SELECT COALESCE(SUM(subtotal), 0) FROM order_items
                    WHERE order_id = p_order_id AND kitchen_status <> 'cancelado'),
        total = (SELECT COALESCE(SUM(subtotal), 0) FROM order_items
                 WHERE order_id = p_order_id AND kitchen_status <> 'cancelado')
                + COALESCE(p_tip, 0),
        cost_total = (SELECT COALESCE(SUM(cost_price * quantity), 0) FROM order_items
                      WHERE order_id = p_order_id AND kitchen_status <> 'cancelado'),
        updated_at = now()
    WHERE id = p_order_id;

    -- §1.6.4: al pagar se eliminan las notificaciones no leídas de la orden
    DELETE FROM notifications n USING order_items oi
    WHERE n.order_item_id = oi.id AND oi.order_id = p_order_id
      AND n.is_viewed = false;
  ELSE
    UPDATE orders
    SET amount_paid = amount_paid + v_paid, client_id = p_client_id,
        cash_session_id = v_session_id, updated_at = now()
    WHERE id = p_order_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
