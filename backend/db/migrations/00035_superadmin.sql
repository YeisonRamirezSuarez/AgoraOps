-- =============================================================
-- 00035: SUPERADMIN — módulo Multicomercio (manual §1.3.3 Super Admin)
-- - users.last_login_at: última conexión (consumo por establecimiento)
-- - business_settings.theme_palette: paleta de colores personalizada
--   del establecimiento (se aplica en el frontend al iniciar sesión)
-- - Usuario Super Administrador inicial (tenant_id NULL) con clave
--   temporal y cambio forzado al primer ingreso.
-- =============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS theme_palette TEXT NOT NULL DEFAULT 'celeste';

-- UNIQUE(tenant_id, username) no protege con tenant_id NULL (NULLs
-- distintos en Postgres) → guardia explícita contra duplicados.
INSERT INTO users (tenant_id, username, email, password_hash, full_name,
                   is_super_admin, must_change_password)
SELECT NULL, 'superadmin', 'generatepruebacolombia@gmail.com',
       crypt('SuperAgora2026!', gen_salt('bf', 10)),
       'Super Administrador', true, true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE is_super_admin);
