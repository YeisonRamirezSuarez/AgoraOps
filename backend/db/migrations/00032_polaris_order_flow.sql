-- =============================================================
-- 00032: FLUJO DE ORDEN POLARIS (Restaurante › Mesas)
-- Réplica de blank_tb_order_items (ver docs/polaris-restaurante-mesas-spec.md):
--  · id_kitchen_status 4 = "entregado" (reorden solo aplica a entregados)
--  · id_kitchen_status 5 = "devuelto" (re-pedido tras devolución; se comporta
--    como pendiente en el carrito con etiqueta "Devuelto")
--  · order_items.customer_id → Compras Compartidas (ticket dividido por cliente)
--  · printers.purpose / url_send → listas printersComanda/printersPrefactura
--    y agente local de impresión (url_send) de Polaris
-- NOTA: los valores nuevos del enum no pueden usarse en esta misma
-- transacción; las funciones que los usan van en 00033.
-- =============================================================

ALTER TYPE kitchen_status ADD VALUE IF NOT EXISTS 'entregado' AFTER 'listo';
ALTER TYPE kitchen_status ADD VALUE IF NOT EXISTS 'devuelto' AFTER 'entregado';

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS customer_id INT REFERENCES clients(id);

ALTER TABLE printers
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'ambas'
    CHECK (purpose IN ('comanda', 'prefactura', 'ambas')),
  ADD COLUMN IF NOT EXISTS url_send TEXT;
