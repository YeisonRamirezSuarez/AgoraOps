-- =============================================================
-- 00024: Apertura de caja estilo Polaris (§1.8.3) — el formulario
-- "Abrir caja" pide Caja, Responsable de la caja, Dinero de la
-- apertura y Nota (obligatoria). El responsable puede ser distinto
-- de quien la abre ("Abierta por").
-- =============================================================

ALTER TABLE cash_sessions
  ADD COLUMN IF NOT EXISTS responsible_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS responsible_name TEXT,
  ADD COLUMN IF NOT EXISTS opening_note TEXT;
