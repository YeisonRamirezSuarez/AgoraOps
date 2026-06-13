-- =============================================================
-- 00041: CAJAS — alinear a Polaris (Gestión de cajas → Cajas,
-- apps grid_public_cash_registers + form_public_cash_registers).
-- Cambios verificados en Polaris (QA prod, solo lectura):
--   · Estado: FUNCIONANDO / FALLANDO (default FUNCIONANDO) — antes
--     'activa'/'inactiva'. La apertura de caja solo permite FUNCIONANDO.
--   · Auditoría en el grid: Creado por / Fecha de creación / Actualizado
--     por / Fecha de actualización → se agregan created_by, updated_by,
--     updated_at (created_at ya existía).
-- Nombre máx 50 y nota máx 250 se validan en API/UI (la columna es TEXT).
-- La nota es obligatoria (se valida en el backend, como Polaris).
-- =============================================================

-- 1) Estado: migrar valores y reemplazar el CHECK
ALTER TABLE cash_registers DROP CONSTRAINT IF EXISTS cash_registers_status_check;

-- El relabel activa→FUNCIONANDO / inactiva→FALLANDO no es un cambio real de
-- estado, pero el trigger guard_cash_register_update lo trataría como tal y
-- abortaría si alguna caja tiene sesión abierta. Se desactiva solo durante
-- el UPDATE de migración.
ALTER TABLE cash_registers DISABLE TRIGGER trg_cash_registers_guard_update;

UPDATE cash_registers SET status = CASE status
  WHEN 'activa'   THEN 'FUNCIONANDO'
  WHEN 'inactiva' THEN 'FALLANDO'
  ELSE 'FUNCIONANDO'
END;

ALTER TABLE cash_registers ENABLE TRIGGER trg_cash_registers_guard_update;

ALTER TABLE cash_registers ALTER COLUMN status SET DEFAULT 'FUNCIONANDO';
ALTER TABLE cash_registers
  ADD CONSTRAINT cash_registers_status_check
  CHECK (status IN ('FUNCIONANDO', 'FALLANDO'));

-- 2) Auditoría (created_at ya existe desde 00012)
ALTER TABLE cash_registers
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
