-- =============================================================
-- 00022: pay_order — Caja de Pago elegible + bloqueo por estado de cocina
-- (pantalla "Resumen de Transacción" de Pago full, manual §1.6.3).
-- 1) No se puede cobrar si algún producto a pagar no está 'listo'
--    (los que no van a cocina quedan 'listo' al confirmar — 00019).
-- 2) El resumen de transacción permite elegir la caja que recibe el
--    pago (p_session_id); sin elección se usa la última caja abierta.
-- =============================================================

DROP FUNCTION IF EXISTS pay_order(INT, INT, NUMERIC, JSONB);

CREATE OR REPLACE FUNCTION pay_order(
  p_order_id INT,
  p_client_id INT,
  p_tip NUMERIC,
  p_payments JSONB,
  p_session_id INT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_session_id INT;
  pay JSONB;
  v_paid NUMERIC := 0;
  v_pending INT;
  v_by_product BOOLEAN := false;
  v_item_ids INT[] := '{}';
  v_not_ready INT;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.status <> 'abierta' THEN
    RAISE EXCEPTION 'La orden no está abierta';
  END IF;

  -- §1.6.3: el cliente es obligatorio al pagar
  IF p_client_id IS NULL THEN
    RAISE EXCEPTION 'Debe seleccionar un cliente para facturar el pago';
  END IF;

  -- Ítems cubiertos por este cobro: los seleccionados (pago por producto)
  -- o todos los activos sin pagar (pago completo/combinado)
  FOR pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    IF pay ? 'item_ids' AND jsonb_typeof(pay->'item_ids') = 'array' THEN
      v_item_ids := v_item_ids ||
        ARRAY(SELECT jsonb_array_elements_text(pay->'item_ids')::INT);
    END IF;
  END LOOP;
  IF array_length(v_item_ids, 1) IS NULL THEN
    v_item_ids := ARRAY(SELECT id FROM order_items
      WHERE order_id = p_order_id AND kitchen_status <> 'cancelado' AND NOT is_paid);
  END IF;

  -- Bloqueo: solo se cobra lo que está Listo (§1.6.4)
  SELECT COUNT(*) INTO v_not_ready FROM order_items
  WHERE id = ANY(v_item_ids) AND kitchen_status NOT IN ('listo', 'cancelado');
  IF v_not_ready > 0 THEN
    RAISE EXCEPTION 'No se puede cobrar. Algunos productos aún se encuentran en preparación.';
  END IF;

  -- Caja de Pago elegida en el resumen; sin elección → última caja abierta
  IF p_session_id IS NOT NULL THEN
    SELECT cs.id INTO v_session_id FROM cash_sessions cs
    WHERE cs.id = p_session_id AND cs.tenant_id = v_order.tenant_id
      AND cs.status = 'abierta';
    IF v_session_id IS NULL THEN
      RAISE EXCEPTION 'La caja seleccionada no está abierta';
    END IF;
  ELSE
    SELECT cs.id INTO v_session_id FROM cash_sessions cs
    WHERE cs.tenant_id = v_order.tenant_id AND cs.status = 'abierta'
    ORDER BY cs.opened_at DESC LIMIT 1;
    IF v_session_id IS NULL THEN
      RAISE EXCEPTION 'No hay cajas abiertas; no es posible registrar el pago';
    END IF;
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
