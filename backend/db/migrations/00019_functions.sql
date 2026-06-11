-- =============================================================
-- 00019: FUNCIONES DE NEGOCIO
-- Replican las reglas del manual y la lógica PHP migrada. Cada función
-- referencia su origen PHP para trazabilidad.
-- =============================================================

-- -------------------------------------------------------------
-- Descuento de inventario por receta o consumible.
-- Origen PHP: actualizarCantidadInsumoInventario() — recorría
-- consumo_inventario, restaba (cantidadConsumo * cantidadVendida) y
-- registraba historial_inventario tipo 'venta'.
-- Decisión 2026-06-11 (C): el MOMENTO cambia — consumibles al confirmar,
-- recetas al marcar Listo — pero el cálculo es el mismo.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION deduct_inventory(
  p_inventory_product_id INT,
  p_quantity NUMERIC,
  p_user_name TEXT
) RETURNS VOID AS $$
DECLARE
  v_item inventory_products%ROWTYPE;
  v_overdraft BOOLEAN;
BEGIN
  SELECT * INTO v_item FROM inventory_products WHERE id = p_inventory_product_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(bs.allow_overdraft, false) INTO v_overdraft
  FROM business_settings bs WHERE bs.tenant_id = v_item.tenant_id;

  -- §1.8.1: sin sobregiro no se permite stock negativo
  IF NOT v_overdraft AND v_item.stock < p_quantity THEN
    RAISE EXCEPTION 'Stock insuficiente para % (disponible %, requerido %)',
      COALESCE(v_item.name, v_item.id::TEXT), v_item.stock, p_quantity;
  END IF;

  INSERT INTO inventory_movements
    (tenant_id, inventory_product_id, direction, reason, quantity,
     qty_before, qty_after, user_name)
  VALUES
    (v_item.tenant_id, v_item.id, 'SALIDA', 'Venta', p_quantity,
     v_item.stock, v_item.stock - p_quantity, p_user_name);

  UPDATE inventory_products
  SET stock = stock - p_quantity, updated_at = now()
  WHERE id = p_inventory_product_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Devolución de stock (cancelar producto en estado Requerido — §1.6.3)
CREATE OR REPLACE FUNCTION return_inventory(
  p_inventory_product_id INT,
  p_quantity NUMERIC,
  p_user_name TEXT
) RETURNS VOID AS $$
DECLARE
  v_item inventory_products%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM inventory_products WHERE id = p_inventory_product_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO inventory_movements
    (tenant_id, inventory_product_id, direction, reason, quantity,
     qty_before, qty_after, user_name)
  VALUES
    (v_item.tenant_id, v_item.id, 'ENTRADA', 'Devolución', p_quantity,
     v_item.stock, v_item.stock + p_quantity, p_user_name);

  UPDATE inventory_products
  SET stock = stock + p_quantity, updated_at = now()
  WHERE id = p_inventory_product_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Aplica la receta de un producto/variante (y combos por componente)
CREATE OR REPLACE FUNCTION deduct_recipe_for_item(p_item_id INT) RETURNS VOID AS $$
DECLARE
  v_item order_items%ROWTYPE;
  r RECORD;
  c RECORD;
  v_user TEXT;
BEGIN
  SELECT * INTO v_item FROM order_items WHERE id = p_item_id;
  SELECT attended_by INTO v_user FROM orders WHERE id = v_item.order_id;

  -- Receta directa del producto o variante
  FOR r IN
    SELECT inventory_product_id, quantity_used FROM recipes
    WHERE (v_item.variant_id IS NOT NULL AND variant_id = v_item.variant_id)
       OR (v_item.variant_id IS NULL AND product_id = v_item.product_id)
  LOOP
    PERFORM deduct_inventory(r.inventory_product_id, r.quantity_used * v_item.quantity, v_user);
  END LOOP;

  -- Combos: aplicar receta/consumible de cada componente (§1.10.1)
  FOR c IN
    SELECT ci.product_id AS component_id, ci.quantity AS component_qty,
           p.goes_to_kitchen, p.is_inventariable
    FROM combo_items ci JOIN products p ON p.id = ci.product_id
    WHERE ci.combo_id = v_item.product_id
  LOOP
    IF c.goes_to_kitchen THEN
      FOR r IN SELECT inventory_product_id, quantity_used FROM recipes
               WHERE product_id = c.component_id LOOP
        PERFORM deduct_inventory(r.inventory_product_id,
          r.quantity_used * c.component_qty * v_item.quantity, v_user);
      END LOOP;
    ELSIF c.is_inventariable THEN
      FOR r IN SELECT id FROM inventory_products
               WHERE product_id = c.component_id AND type = 'consumible' LOOP
        PERFORM deduct_inventory(r.id, c.component_qty * v_item.quantity, v_user);
      END LOOP;
    END IF;
  END LOOP;

  -- Toppings con inventario propio (§1.10.4)
  FOR r IN
    SELECT rc.inventory_product_id, rc.quantity_used * oit.quantity AS qty
    FROM order_item_toppings oit
    JOIN recipes rc ON rc.topping_id = oit.topping_id
    WHERE oit.order_item_id = p_item_id
  LOOP
    PERFORM deduct_inventory(r.inventory_product_id, r.qty * v_item.quantity, v_user);
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -------------------------------------------------------------
-- Confirmar productos de una orden (§1.6.3).
-- Origen PHP: ocuparMesa*() escribía CSV + registroHistorialComanda.
-- Consumibles (inventariable, no cocina) descuentan AQUÍ (manual §1.10.1).
-- La impresión de comanda la dispara la app vía print-service.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION confirm_order_items(p_order_id INT, p_item_ids INT[])
RETURNS VOID AS $$
DECLARE
  v_item RECORD;
  v_user TEXT;
  r RECORD;
BEGIN
  SELECT attended_by INTO v_user FROM orders WHERE id = p_order_id;

  FOR v_item IN
    SELECT oi.*, p.goes_to_kitchen, p.is_inventariable
    FROM order_items oi JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id AND oi.id = ANY(p_item_ids)
      AND oi.kitchen_status = 'nuevo'
  LOOP
    IF v_item.goes_to_kitchen THEN
      -- Va a cocina → estado Requerido; la receta descuenta al marcar Listo
      UPDATE order_items SET kitchen_status = 'requerido', confirmed_at = now()
      WHERE id = v_item.id;
    ELSE
      -- No va a cocina → queda confirmado/listo de inmediato
      UPDATE order_items SET kitchen_status = 'listo', confirmed_at = now()
      WHERE id = v_item.id;
      -- Consumible → movimiento de salida por Venta al confirmar (§1.10.1)
      IF v_item.is_inventariable THEN
        FOR r IN SELECT id FROM inventory_products
                 WHERE (v_item.variant_id IS NOT NULL AND variant_id = v_item.variant_id)
                    OR (v_item.variant_id IS NULL AND product_id = v_item.product_id)
                 AND type = 'consumible' LOOP
          PERFORM deduct_inventory(r.id, v_item.quantity, v_user);
        END LOOP;
      END IF;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -------------------------------------------------------------
-- Monitor de Cocina: cambio de estado (§1.6.4)
-- Al marcar Listo: descuenta receta + crea notificación (sonido en app).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_kitchen_status(p_item_ids INT[], p_status kitchen_status, p_user_id UUID DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
  v_item RECORD;
BEGIN
  IF p_status NOT IN ('requerido', 'en_preparacion', 'listo') THEN
    RAISE EXCEPTION 'Estado de cocina inválido: %', p_status;
  END IF;

  FOR v_item IN
    SELECT oi.*, o.tenant_id FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.id = ANY(p_item_ids)
      AND oi.kitchen_status IN ('requerido', 'en_preparacion')
  LOOP
    UPDATE order_items SET kitchen_status = p_status WHERE id = v_item.id;

    IF p_status = 'listo' THEN
      PERFORM deduct_recipe_for_item(v_item.id);
      INSERT INTO notifications (tenant_id, order_item_id, status, created_by)
      VALUES (v_item.tenant_id, v_item.id, 'Listo', p_user_id);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -------------------------------------------------------------
-- Cancelar producto (§1.6.3 Devolución). Origen PHP: registrarEliminacion()
-- + productos_cancelados + estadoComanda='PRODUCTO CANCELADO'.
-- Si está en Requerido → repone stock (consumible ya descontado).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION cancel_order_item(p_item_id INT, p_reason TEXT, p_user_name TEXT, p_user_id UUID DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
  v_item RECORD;
  r RECORD;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'La descripción de la cancelación es obligatoria';
  END IF;

  SELECT oi.*, o.tenant_id, p.is_inventariable, p.goes_to_kitchen
  INTO v_item
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  JOIN products p ON p.id = oi.product_id
  WHERE oi.id = p_item_id;

  IF v_item.kitchen_status = 'nuevo' THEN
    RAISE EXCEPTION 'Los productos sin confirmar se eliminan, no se cancelan';
  END IF;

  -- §1.6.3: solo si sigue en Requerido la cantidad vuelve al inventario
  IF v_item.kitchen_status = 'requerido' AND v_item.is_inventariable
     AND NOT v_item.goes_to_kitchen THEN
    FOR r IN SELECT id FROM inventory_products
             WHERE product_id = v_item.product_id AND type = 'consumible' LOOP
      PERFORM return_inventory(r.id, v_item.quantity, p_user_name);
    END LOOP;
  END IF;

  UPDATE order_items
  SET kitchen_status = 'cancelado', cancel_reason = p_reason,
      cancelled_by = p_user_name
  WHERE id = p_item_id;

  INSERT INTO notifications (tenant_id, order_item_id, status, created_by)
  VALUES (v_item.tenant_id, p_item_id, 'Cancelado', p_user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -------------------------------------------------------------
-- Solicitar de nuevo (§1.6.3): solo si está Listo. El original queda en
-- $0 y Cancelado; se crea el ítem nuevo con los cambios.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION reorder_item(p_item_id INT, p_reason TEXT, p_user_name TEXT)
RETURNS INT AS $$
DECLARE
  v_item order_items%ROWTYPE;
  v_new_id INT;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'La descripción es obligatoria';
  END IF;

  SELECT * INTO v_item FROM order_items WHERE id = p_item_id;
  IF v_item.kitchen_status <> 'listo' THEN
    RAISE EXCEPTION 'Solo se puede solicitar de nuevo un producto marcado como Listo';
  END IF;

  UPDATE order_items
  SET unit_price = 0, subtotal = 0, kitchen_status = 'cancelado',
      cancel_reason = p_reason, cancelled_by = p_user_name
  WHERE id = p_item_id;

  INSERT INTO order_items
    (order_id, product_id, variant_id, product_name, quantity, unit_price,
     cost_price, subtotal, notes, kitchen_status, unique_code, printer_id,
     reordered_from)
  SELECT order_id, product_id, variant_id, product_name, quantity, unit_price,
         cost_price, subtotal, notes, 'requerido',
         to_char(now(), 'YYYYMMDDHH24MISS') || floor(random()*90000+10000)::TEXT,
         printer_id, id
  FROM order_items WHERE id = p_item_id
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -------------------------------------------------------------
-- Pagar orden (§1.6.3 Pago). Origen PHP: registrarVenta*() + cobroDivido().
-- p_payments: [{method_id, bank_id, amount, tip_included, change_given, item_ids}]
-- Pago por producto: pagos con item_ids marcan esos ítems; la orden se
-- paga del todo cuando no quedan ítems activos sin pagar.
-- Al pagar: elimina notificaciones no leídas de la orden (§1.6.4).
-- -------------------------------------------------------------
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
       CASE WHEN pay ? 'item_ids'
            THEN ARRAY(SELECT jsonb_array_elements_text(pay->'item_ids')::INT)
            ELSE NULL END,
       to_char(now(), 'YYYYMMDDHH24MISS') || p_order_id::TEXT);

    v_paid := v_paid + (pay->>'amount')::NUMERIC;

    -- Pago por producto: marcar ítems pagados
    IF pay ? 'item_ids' THEN
      UPDATE order_items SET is_paid = true
      WHERE id = ANY(ARRAY(SELECT jsonb_array_elements_text(pay->'item_ids')::INT));
    END IF;
  END LOOP;

  -- ¿Quedan ítems activos sin pagar?
  SELECT COUNT(*) INTO v_pending FROM order_items
  WHERE order_id = p_order_id AND kitchen_status <> 'cancelado' AND NOT is_paid;

  IF v_pending = 0 THEN
    UPDATE order_items SET is_paid = true
    WHERE order_id = p_order_id AND kitchen_status <> 'cancelado';

    UPDATE orders
    SET status = 'pagada', client_id = p_client_id, tip = COALESCE(p_tip, 0),
        amount_paid = amount_paid + v_paid, cash_session_id = v_session_id,
        updated_at = now()
    WHERE id = p_order_id;

    -- §1.6.4: al pagar se eliminan las notificaciones no leídas de la orden
    DELETE FROM notifications n USING order_items oi
    WHERE n.order_item_id = oi.id AND oi.order_id = p_order_id
      AND n.is_viewed = false;
  ELSE
    UPDATE orders
    SET amount_paid = amount_paid + v_paid, client_id = p_client_id,
        updated_at = now()
    WHERE id = p_order_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -------------------------------------------------------------
-- Cerrar mesa / cancelar orden (§1.6.3, §1.9.3).
-- Origen PHP: cancelarMesa*() + cancelaMesa() (cancelacion_mesas).
-- Solo si todos los productos están cancelados o no hay productos.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION close_order(p_order_id INT, p_reason TEXT, p_user_name TEXT, p_user_id UUID DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
  v_pending INT;
  v_total NUMERIC;
BEGIN
  SELECT COUNT(*) INTO v_pending FROM order_items
  WHERE order_id = p_order_id AND kitchen_status <> 'cancelado' AND NOT is_paid;

  IF v_pending > 0 THEN
    RAISE EXCEPTION 'La mesa tiene productos sin cancelar; no puede cerrarse';
  END IF;

  SELECT COALESCE(SUM(subtotal), 0) INTO v_total
  FROM order_items WHERE order_id = p_order_id;

  UPDATE orders
  SET status = 'cancelada', cancelled_by = p_user_id,
      cancelled_by_name = p_user_name, cancel_reason = p_reason,
      cancelled_value = v_total, cancelled_at = now(), updated_at = now()
  WHERE id = p_order_id AND status = 'abierta';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -------------------------------------------------------------
-- Trasladar productos entre mesas (§1.6.3).
-- Origen PHP: editarMesa*() con areaNueva (borraba y reescribía CSVs).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION transfer_order_items(
  p_from_order_id INT,
  p_table_id INT,
  p_room_id INT,
  p_item_ids INT[],
  p_user_id UUID DEFAULT NULL
) RETURNS INT AS $$
DECLARE
  v_from orders%ROWTYPE;
  v_to_id INT;
  v_remaining INT;
BEGIN
  SELECT * INTO v_from FROM orders WHERE id = p_from_order_id FOR UPDATE;

  -- Orden destino: la abierta de esa mesa, o una nueva
  SELECT id INTO v_to_id FROM orders
  WHERE table_id = p_table_id AND status = 'abierta' AND tenant_id = v_from.tenant_id;

  IF v_to_id IS NULL THEN
    INSERT INTO orders
      (tenant_id, order_number, table_id, room_id, user_id, attended_by, customer_name)
    VALUES
      (v_from.tenant_id,
       to_char(now(), 'YYYYMMDDHH24MISS') || p_table_id::TEXT,
       p_table_id, p_room_id, v_from.user_id, v_from.attended_by, v_from.customer_name)
    RETURNING id INTO v_to_id;
  END IF;

  UPDATE order_items SET order_id = v_to_id WHERE id = ANY(p_item_ids);

  INSERT INTO order_transfers (tenant_id, from_order_id, to_order_id, item_ids, user_id)
  VALUES (v_from.tenant_id, p_from_order_id, v_to_id, p_item_ids, p_user_id);

  -- Si la orden origen quedó vacía, se cierra
  SELECT COUNT(*) INTO v_remaining FROM order_items WHERE order_id = p_from_order_id;
  IF v_remaining = 0 THEN
    UPDATE orders SET status = 'cancelada', cancel_reason = 'Traslado de productos',
      cancelled_at = now() WHERE id = p_from_order_id;
  END IF;

  RETURN v_to_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -------------------------------------------------------------
-- Cierre de caja (§1.8.3). Origen PHP: registrarCierre() +
-- obtenerValoresParaCierre() + cerrarventas()/cerrartransacciones()/
-- cerrarCancelador(). El flag PHP cierre='NO/SI' se reemplaza por
-- orders.cash_session_id.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION close_cash_session(
  p_session_id INT,
  p_counted_cash NUMERIC,
  p_note TEXT
) RETURNS VOID AS $$
DECLARE
  v_session cash_sessions%ROWTYPE;
  v_cash_method_id INT;
  v_cash_total NUMERIC;
  v_registered NUMERIC;
  v_income NUMERIC;
  v_expense NUMERIC;
  v_tips NUMERIC;
  v_cancelled NUMERIC;
  v_discounts NUMERIC;
BEGIN
  SELECT * INTO v_session FROM cash_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.status <> 'abierta' THEN
    RAISE EXCEPTION 'La caja ya está cerrada';
  END IF;

  -- §1.8.3: la nota es obligatoria
  IF p_note IS NULL OR btrim(p_note) = '' THEN
    RAISE EXCEPTION 'El campo Nota es obligatorio para cerrar la caja';
  END IF;

  -- Desglose por método de pago de las ventas de esta sesión
  INSERT INTO cash_session_totals (cash_session_id, payment_method_id, total)
  SELECT p_session_id, op.payment_method_id, SUM(op.amount - op.change_given)
  FROM order_payments op
  JOIN orders o ON o.id = op.order_id
  WHERE o.cash_session_id = p_session_id
  GROUP BY op.payment_method_id
  ON CONFLICT (cash_session_id, payment_method_id)
  DO UPDATE SET total = EXCLUDED.total;

  SELECT COALESCE(SUM(amount), 0) INTO v_income FROM cash_transactions
  WHERE cash_session_id = p_session_id AND type = 'ENTRADA';
  SELECT COALESCE(SUM(amount), 0) INTO v_expense FROM cash_transactions
  WHERE cash_session_id = p_session_id AND type = 'SALIDA';
  SELECT COALESCE(SUM(total), 0) INTO v_registered FROM cash_session_totals
  WHERE cash_session_id = p_session_id;
  SELECT COALESCE(SUM(tip), 0), COALESCE(SUM(discount), 0)
  INTO v_tips, v_discounts FROM orders WHERE cash_session_id = p_session_id;
  SELECT COALESCE(SUM(cancelled_value), 0) INTO v_cancelled FROM orders
  WHERE cash_session_id = p_session_id AND status = 'cancelada';

  -- Total en efectivo = apertura + ventas en EFECTIVO + entradas - salidas
  SELECT pm.id INTO v_cash_method_id FROM payment_methods pm
  WHERE pm.tenant_id = v_session.tenant_id AND pm.name = 'EFECTIVO';
  SELECT COALESCE((SELECT total FROM cash_session_totals
    WHERE cash_session_id = p_session_id AND payment_method_id = v_cash_method_id), 0)
  INTO v_cash_total;
  v_cash_total := v_session.opening_amount + v_cash_total + v_income - v_expense;

  -- §1.8.3: efectivo contado solo aplica si el total en efectivo > 0
  IF v_cash_total <= 0 THEN
    p_counted_cash := NULL;
  END IF;

  UPDATE cash_sessions SET
    status = 'cerrada',
    income_total = v_income,
    expense_total = v_expense,
    tips_total = v_tips,
    registered_total = v_registered,
    cash_total = v_cash_total,
    counted_cash = p_counted_cash,
    difference = CASE WHEN p_counted_cash IS NULL THEN NULL
                      ELSE p_counted_cash - v_cash_total END,
    note = p_note,
    cancelled_total = v_cancelled,
    discount_total = v_discounts,
    closed_at = now()
  WHERE id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -------------------------------------------------------------
-- Estadísticas del Dashboard (§1.5).
-- Origen PHP: inicio.php (obtenerVentasDelDia, obtenerVentasDiasSemana,
-- obtenerInsumosMasVendidos, obtenerNumeroMesasOcupadas...).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_dashboard_stats(p_tenant UUID, p_date DATE DEFAULT CURRENT_DATE)
RETURNS JSON AS $$
DECLARE result JSON;
BEGIN
  SELECT json_build_object(
    'sales_today', COALESCE((SELECT SUM(total) FROM orders
      WHERE tenant_id = p_tenant AND DATE(created_at) = p_date AND status = 'pagada'), 0),
    'orders_today', (SELECT COUNT(*) FROM orders
      WHERE tenant_id = p_tenant AND DATE(created_at) = p_date),
    'tables_occupied', (SELECT COUNT(*) FROM orders
      WHERE tenant_id = p_tenant AND status = 'abierta' AND table_id IS NOT NULL),
    'low_stock', (SELECT COALESCE(json_agg(json_build_object(
        'id', id, 'name', name, 'stock', stock, 'min_stock', min_stock)), '[]'::json)
      FROM inventory_products
      WHERE tenant_id = p_tenant AND is_active AND stock <= min_stock AND stock >= 0),
    'overdrafts', (SELECT COALESCE(json_agg(json_build_object(
        'id', id, 'name', name, 'stock', stock)), '[]'::json)
      FROM inventory_products
      WHERE tenant_id = p_tenant AND is_active AND stock < 0),
    'objectives', (SELECT row_to_json(o) FROM objectives o WHERE o.tenant_id = p_tenant),
    'top_products', (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
      SELECT oi.product_name, SUM(oi.quantity) AS qty, SUM(oi.subtotal) AS total
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.tenant_id = p_tenant AND o.status = 'pagada'
        AND oi.kitchen_status <> 'cancelado'
      GROUP BY oi.product_name ORDER BY total DESC LIMIT 5) t)
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Los eventos en tiempo real se emiten vía pg_notify (ver 00020_events.sql)
