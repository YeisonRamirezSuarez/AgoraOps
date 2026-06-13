-- =============================================================
-- 00037: HORARIOS (Malla de Horarios) — réplica de Polaris
-- (Configuración restaurante → Horarios, verificado en QA 2026-06-13).
--
-- Reutiliza las tablas de 00014 (schedule_templates = "Horarios Base",
-- schedules = asignaciones empleado+turno+fecha). Cambios respecto a 00014:
--  · Polaris NO bloquea borrar un Horario Base en uso: advierte y borra en
--    cascada el preset + TODAS las asignaciones vinculadas. Por eso se quita
--    el trigger guard_schedule_template_delete y se pone ON DELETE CASCADE
--    en schedules.template_id (decisión del usuario: cascada como Polaris).
-- =============================================================

-- Quitar el guard de borrado de 00014 (Polaris borra en cascada)
DROP TRIGGER IF EXISTS trg_schedule_templates_guard_delete ON schedule_templates;
DROP FUNCTION IF EXISTS guard_schedule_template_delete();

-- Recrear la FK de asignaciones con ON DELETE CASCADE
ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_template_id_fkey;
ALTER TABLE schedules
  ADD CONSTRAINT schedules_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES schedule_templates(id) ON DELETE CASCADE;

-- Índice para la consulta del calendario por rango de fechas
CREATE INDEX IF NOT EXISTS idx_schedules_tenant_date ON schedules(tenant_id, date);
