-- =============================================================
-- 00020: EVENTOS EN TIEMPO REAL (pg_notify → SSE)
-- El API Express hace LISTEN en el canal 'app_events' y reenvía cada
-- evento por Server-Sent Events al frontend, filtrando por tenant.
-- Reemplaza a Supabase Realtime de la arquitectura anterior.
-- Tablas notificadas: orders, order_items, notifications,
-- inventory_products (alertas de stock del Dashboard §1.5).
-- =============================================================

CREATE OR REPLACE FUNCTION notify_app_event()
RETURNS TRIGGER AS $$
DECLARE
  v_tenant UUID;
  v_row JSONB;
BEGIN
  v_row := to_jsonb(COALESCE(NEW, OLD));

  -- order_items no tiene tenant_id: lo hereda de la orden
  IF TG_TABLE_NAME = 'order_items' THEN
    SELECT tenant_id INTO v_tenant FROM orders
    WHERE id = (v_row->>'order_id')::INT;
  ELSE
    v_tenant := (v_row->>'tenant_id')::UUID;
  END IF;

  PERFORM pg_notify('app_events', json_build_object(
    'tenant_id', v_tenant,
    'table', TG_TABLE_NAME,
    'action', TG_OP,
    'id', v_row->>'id'
  )::TEXT);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_notify
  AFTER INSERT OR UPDATE OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION notify_app_event();

CREATE TRIGGER trg_order_items_notify
  AFTER INSERT OR UPDATE OR DELETE ON order_items
  FOR EACH ROW EXECUTE FUNCTION notify_app_event();

CREATE TRIGGER trg_notifications_notify
  AFTER INSERT OR UPDATE OR DELETE ON notifications
  FOR EACH ROW EXECUTE FUNCTION notify_app_event();

CREATE TRIGGER trg_inventory_notify
  AFTER UPDATE ON inventory_products
  FOR EACH ROW EXECUTE FUNCTION notify_app_event();
