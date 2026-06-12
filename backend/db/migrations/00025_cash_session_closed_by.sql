-- =============================================================
-- 00025: Usuario de cierre de la caja — el Reporte de cajas estilo
-- Polaris muestra "Usuario de apertura" y "Usuario de cierre".
-- =============================================================

ALTER TABLE cash_sessions
  ADD COLUMN IF NOT EXISTS closed_by_name TEXT;
