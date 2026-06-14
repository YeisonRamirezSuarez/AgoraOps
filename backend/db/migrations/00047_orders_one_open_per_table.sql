-- =============================================================
-- 00047: una sola orden "abierta" por mesa
-- =============================================================
-- ⚠️ RECONSTRUIDA desde el estado en vivo de la BD (2026-06-14); el archivo
-- original no llegó a este repositorio (ver 00045).
--
-- Verificado en la BD: índice único parcial que impide dos órdenes abiertas
-- sobre la misma mesa. table_id NULL (p. ej. domicilios/para llevar) queda
-- fuera del índice, así que no choca entre sí.
-- =============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_open_per_table
  ON orders (table_id)
  WHERE (status = 'abierta'::order_status AND table_id IS NOT NULL);
