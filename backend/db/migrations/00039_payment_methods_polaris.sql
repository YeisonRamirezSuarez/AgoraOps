-- =============================================================
-- 00039: MÉTODOS DE PAGO — alinear catálogo al de Polaris
-- Polaris (form_tb_pay_methods) tiene exactamente 5 métodos fijos:
--   EFECTIVO, TARJETA, TRANSFERENCIA, VENTA A CREDITO, COMBINADO.
-- · CUENTA POR COBRAR pasa a llamarse VENTA A CREDITO (conserva su id y
--   las referencias en orders/order_payments — solo cambia el nombre).
-- · TARJETA queda activa y deja de ser legacy.
-- · Se garantizan los 5 métodos por establecimiento (inserta los faltantes).
-- EFECTIVO y TRANSFERENCIA conservan su nombre (lógica de caja/bancos los
-- referencia por nombre).
-- =============================================================

UPDATE payment_methods SET name = 'VENTA A CREDITO'
  WHERE name = 'CUENTA POR COBRAR';

UPDATE payment_methods SET is_active = true, is_legacy = false
  WHERE name = 'TARJETA';

INSERT INTO payment_methods (tenant_id, name, is_active, is_legacy)
SELECT t.id, m.name, true, false
FROM tenants t
CROSS JOIN (VALUES ('EFECTIVO'), ('TARJETA'), ('TRANSFERENCIA'),
                   ('VENTA A CREDITO'), ('COMBINADO')) AS m(name)
WHERE NOT EXISTS (
  SELECT 1 FROM payment_methods pm
  WHERE pm.tenant_id = t.id AND pm.name = m.name
);
