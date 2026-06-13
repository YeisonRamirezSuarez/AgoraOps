-- =============================================================
-- 00036: ÍNDICES de order_payments para el Dashboard (§1.5)
-- El Dashboard agrega pagos por fecha (op.created_at) y los une a orders
-- por order_id. order_payments no tenía índice en ninguna de las dos: las
-- FKs no crean índice automáticamente en Postgres, así que cada consulta de
-- pagos hacía un Seq Scan completo de la tabla. Con datos crecientes eso es
-- el cuello de botella de las ~24 consultas de "Desempeño por Usuario".
-- =============================================================

-- Filtro por rango de fecha local (op.created_at) en KPIs/ranking/tendencia.
CREATE INDEX IF NOT EXISTS idx_order_payments_created
  ON order_payments(created_at);

-- Join order_payments → orders (y borrado en cascada lógico por orden).
CREATE INDEX IF NOT EXISTS idx_order_payments_order
  ON order_payments(order_id);
