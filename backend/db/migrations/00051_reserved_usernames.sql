-- =============================================================
-- 00051: nombres de usuario reservados (admin, root, …)
-- =============================================================
-- Decisión (2026-06-14): ningún establecimiento puede tener usuarios con
-- nombres sensibles tipo admin/root. Dos partes, EN ORDEN:
--
-- 1) Renombrar el admin histórico de Polaris Food ('demo') a 'polaris', porque
--    'admin' pasa a estar prohibido y la fila existente violaría el CHECK.
-- 2) CHECK a nivel de BD que prohíbe los nombres reservados (case-insensitive).
--    Espejo de RESERVED_USERNAMES en src/lib/constants.ts, que da el error
--    amigable en la app (users.ts y superadmin.ts).
--
-- 'superadmin' queda EXCLUIDO del CHECK a propósito: ya existe la cuenta de
-- plataforma con ese nombre (tenant_id NULL) y debe seguir siendo válida; su
-- creación nueva sí se bloquea en la capa de app.
-- =============================================================

-- 1) Renombrar el admin de Polaris Food (por slug, robusto si cambia el UUID).
UPDATE users
SET username = 'polaris'
WHERE username = 'admin'
  AND tenant_id = (SELECT id FROM tenants WHERE slug = 'demo');

-- 2) Prohibir los reservados a nivel de BD (respaldo de la validación de app).
ALTER TABLE users
  ADD CONSTRAINT users_username_not_reserved
  CHECK (lower(username) <> ALL (ARRAY[
    'admin', 'root', 'administrator', 'administrador',
    'superuser', 'sysadmin', 'postgres', 'system'
  ]));
