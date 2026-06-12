-- =============================================================
-- 00026: Ubicación de la impresora — el formulario "Agregar nueva
-- impresora" de Polaris (§1.8.6) incluye el campo Ubicación.
-- =============================================================

ALTER TABLE printers
  ADD COLUMN IF NOT EXISTS location TEXT;
