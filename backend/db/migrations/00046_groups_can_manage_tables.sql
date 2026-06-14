-- =============================================================
-- 00046: groups.can_manage_tables — permiso de gestión de mesas por grupo
-- =============================================================
-- ⚠️ RECONSTRUIDA desde el estado en vivo de la BD (2026-06-14); el archivo
-- original no llegó a este repositorio (ver 00045).
--
-- Verificado en la BD: la única diferencia respecto al esquema previo es la
-- columna groups.can_manage_tables (boolean NOT NULL DEFAULT true). La
-- función/trigger guard_group_delete ya existe desde 00002 y NO fue
-- modificada por esta migración (en vivo no referencia can_manage_tables),
-- por eso aquí no se redefine.
-- =============================================================

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS can_manage_tables BOOLEAN NOT NULL DEFAULT true;
