-- =============================================================
-- 00031: NOTIFICACIONES igual a Polaris (grid_notifications +
-- campana del menú, verificado en QA 2026-06-12).
--  - viewed_at = columna "Actualizado" de Polaris (fecha en que se
--    visualizó; vacía mientras esté NO VISUALIZADO). Backfill con
--    created_at para las ya vistas (no hay mejor dato).
--  - Polaris solo notifica PEDIDO LISTO (decisión usuario): se
--    redefine cancel_order_item sin el INSERT de notificación.
--    Las notificaciones históricas de Cancelado se conservan.
-- =============================================================

ALTER TABLE notifications ADD COLUMN viewed_at TIMESTAMPTZ;

UPDATE notifications SET viewed_at = created_at WHERE is_viewed = true;

-- Igual que en 00019 pero sin notificar la cancelación
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
