-- =============================================================
-- 00033: FUNCIONES DEL FLUJO DE ORDEN POLARIS
-- Devolución parcial por cantidades, reorden (Solicitar de nuevo) en lote
-- y confirmación que incluye los ítems "devuelto" (estado 5 de Polaris).
-- Origen: modal-return de blank_tb_order_items (acciones devolution /
-- request_order) — motivo obligatorio en ambos.
-- =============================================================

-- confirm_order_items ahora confirma también los re-pedidos ('devuelto'),
-- que en Polaris (estado 5) viven en el carrito junto a los pendientes.
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
      AND oi.kitchen_status IN ('nuevo', 'devuelto')
  LOOP
    IF v_item.goes_to_kitchen THEN
      UPDATE order_items SET kitchen_status = 'requerido', confirmed_at = now()
      WHERE id = v_item.id;
    ELSE
      UPDATE order_items SET kitchen_status = 'listo', confirmed_at = now()
      WHERE id = v_item.id;
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
-- Devolución por cantidades (Polaris action=devolution).
-- p_items: [{"item_id": 1, "quantity": 2}]. Si la cantidad devuelta es
-- menor que la del ítem, el ítem se divide: el original conserva el resto
-- y se crea una fila cancelada con la cantidad devuelta.
-- Solo aplica a confirmados (2/3/4/5 de Polaris = requerido, en_preparacion,
-- listo, entregado, devuelto). Repone stock solo si seguía en Requerido
-- (consumible ya descontado), igual que cancel_order_item.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION devolution_order_items(
  p_order_id INT,
  p_reason TEXT,
  p_items JSONB,
  p_user_name TEXT,
  p_user_id UUID DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  entry JSONB;
  v_item RECORD;
  v_qty INT;
  v_per_unit NUMERIC;
  v_cancel_id INT;
  r RECORD;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Debes ingresar un motivo para devolver.';
  END IF;

  FOR entry IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT oi.*, o.tenant_id, p.is_inventariable, p.goes_to_kitchen
    INTO v_item
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    WHERE oi.id = (entry->>'item_id')::INT AND oi.order_id = p_order_id;

    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_item.kitchen_status IN ('nuevo', 'cancelado') THEN
      RAISE EXCEPTION 'Solo se devuelven productos confirmados';
    END IF;

    v_qty := LEAST((entry->>'quantity')::INT, v_item.quantity);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    IF v_qty = v_item.quantity THEN
      -- Devolución total del ítem
      UPDATE order_items
      SET kitchen_status = 'cancelado', cancel_reason = p_reason,
          cancelled_by = p_user_name
      WHERE id = v_item.id
      RETURNING id INTO v_cancel_id;
    ELSE
      -- Parcial: dividir el ítem
      v_per_unit := v_item.subtotal / v_item.quantity;

      UPDATE order_items
      SET quantity = v_item.quantity - v_qty,
          subtotal = round(v_per_unit * (v_item.quantity - v_qty), 2)
      WHERE id = v_item.id;

      INSERT INTO order_items
        (order_id, product_id, variant_id, product_name, quantity, unit_price,
         cost_price, subtotal, notes, kitchen_status, confirmed_at, customer_id,
         cancel_reason, cancelled_by, unique_code, printer_id)
      VALUES
        (v_item.order_id, v_item.product_id, v_item.variant_id, v_item.product_name,
         v_qty, v_item.unit_price, v_item.cost_price, round(v_per_unit * v_qty, 2),
         v_item.notes, 'cancelado', v_item.confirmed_at, v_item.customer_id,
         p_reason, p_user_name,
         to_char(now(), 'YYYYMMDDHH24MISS') || floor(random()*90000+10000)::TEXT,
         v_item.printer_id)
      RETURNING id INTO v_cancel_id;

      -- Copiar toppings a la fila cancelada (registro histórico)
      INSERT INTO order_item_toppings
        (order_item_id, topping_id, topping_name, topping_price, quantity)
      SELECT v_cancel_id, topping_id, topping_name, topping_price, quantity
      FROM order_item_toppings WHERE order_item_id = v_item.id;
    END IF;

    -- §1.6.3: solo en Requerido la cantidad vuelve al inventario
    IF v_item.kitchen_status = 'requerido' AND v_item.is_inventariable
       AND NOT v_item.goes_to_kitchen THEN
      FOR r IN SELECT id FROM inventory_products
               WHERE product_id = v_item.product_id AND type = 'consumible' LOOP
        PERFORM return_inventory(r.id, v_qty, p_user_name);
      END LOOP;
    END IF;

    INSERT INTO notifications (tenant_id, order_item_id, status, created_by)
    VALUES (v_item.tenant_id, v_cancel_id, 'Cancelado', p_user_id);
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -------------------------------------------------------------
-- Solicitar de nuevo en lote (Polaris action=request_order).
-- Solo productos ENTREGADOS (estado 4); en hpos se admite también 'listo'
-- mientras el Monitor de cocina no marque entregas. El original (o la
-- porción solicitada) queda en $0 y Cancelado; el nuevo ítem nace como
-- 'devuelto' (estado 5: vuelve al carrito con etiqueta "Devuelto" y se
-- reconfirma para ir a cocina).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION reorder_order_items(
  p_order_id INT,
  p_reason TEXT,
  p_items JSONB,
  p_user_name TEXT
) RETURNS VOID AS $$
DECLARE
  entry JSONB;
  v_item RECORD;
  v_qty INT;
  v_per_unit NUMERIC;
  v_cancel_id INT;
  v_new_id INT;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Debes ingresar el motivo de la solicitud.';
  END IF;

  FOR entry IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT oi.* INTO v_item FROM order_items oi
    WHERE oi.id = (entry->>'item_id')::INT AND oi.order_id = p_order_id;

    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_item.kitchen_status NOT IN ('listo', 'entregado') THEN
      RAISE EXCEPTION 'El producto no ha sido entregado, no es posible solicitarlo nuevamente';
    END IF;

    v_qty := LEAST((entry->>'quantity')::INT, v_item.quantity);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    v_per_unit := v_item.subtotal / v_item.quantity;

    IF v_qty = v_item.quantity THEN
      UPDATE order_items
      SET unit_price = 0, subtotal = 0, kitchen_status = 'cancelado',
          cancel_reason = p_reason, cancelled_by = p_user_name
      WHERE id = v_item.id
      RETURNING id INTO v_cancel_id;
    ELSE
      UPDATE order_items
      SET quantity = v_item.quantity - v_qty,
          subtotal = round(v_per_unit * (v_item.quantity - v_qty), 2)
      WHERE id = v_item.id;

      INSERT INTO order_items
        (order_id, product_id, variant_id, product_name, quantity, unit_price,
         cost_price, subtotal, notes, kitchen_status, confirmed_at, customer_id,
         cancel_reason, cancelled_by, unique_code, printer_id)
      VALUES
        (v_item.order_id, v_item.product_id, v_item.variant_id, v_item.product_name,
         v_qty, 0, v_item.cost_price, 0, v_item.notes, 'cancelado',
         v_item.confirmed_at, v_item.customer_id, p_reason, p_user_name,
         to_char(now(), 'YYYYMMDDHH24MISS') || floor(random()*90000+10000)::TEXT,
         v_item.printer_id)
      RETURNING id INTO v_cancel_id;
    END IF;

    -- Ítem re-pedido: estado 'devuelto', mismo precio original (la porción
    -- cancelada quedó en $0 para no cobrar dos veces).
    INSERT INTO order_items
      (order_id, product_id, variant_id, product_name, quantity, unit_price,
       cost_price, subtotal, notes, kitchen_status, customer_id, unique_code,
       printer_id, reordered_from)
    VALUES
      (v_item.order_id, v_item.product_id, v_item.variant_id, v_item.product_name,
       v_qty, v_item.unit_price, v_item.cost_price, round(v_per_unit * v_qty, 2),
       v_item.notes, 'devuelto', v_item.customer_id,
       to_char(now(), 'YYYYMMDDHH24MISS') || floor(random()*90000+10000)::TEXT,
       v_item.printer_id, v_item.id)
    RETURNING id INTO v_new_id;

    INSERT INTO order_item_toppings
      (order_item_id, topping_id, topping_name, topping_price, quantity)
    SELECT v_new_id, topping_id, topping_name, topping_price, quantity
    FROM order_item_toppings WHERE order_item_id = v_item.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
