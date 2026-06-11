-- =============================================================
-- 00002: GRUPOS y USUARIOS — Seguridad (manual §1.12–1.16)
-- Origen PHP: tabla usuarios (correo, nombre, telefono, rol, password,
-- restaurante_id). Roles PHP eran texto libre; el manual los gestiona en
-- Grupos (tipo administrador/empleado). Login PHP forzaba cambio de
-- contraseña si seguía la clave por defecto → must_change_password.
-- Auth propia: password_hash (bcrypt) + JWT emitido por el API Express.
-- =============================================================

CREATE TABLE groups (
  id          SERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,                  -- Administrador, Mesero, Cocina, Mesero_cocina, ...
  role_type   TEXT NOT NULL CHECK (role_type IN ('administrador', 'empleado')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE TABLE users (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID REFERENCES tenants(id),  -- NULL solo para Super Administrador
  username        TEXT NOT NULL,                -- Case-sensitive en login (manual §1.3.3)
  email           TEXT NOT NULL,
  password_hash   TEXT NOT NULL,                -- bcrypt (PHP usaba password_hash PASSWORD_DEFAULT)
  full_name       TEXT NOT NULL,
  phone           TEXT,
  group_id        INT REFERENCES groups(id),
  is_super_admin  BOOLEAN DEFAULT false,
  is_worker       BOOLEAN DEFAULT false,        -- Trabajador → requiere horario (§1.13)
  is_locked       BOOLEAN DEFAULT false,        -- Usuario bloqueado (§1.3.3)
  must_change_password BOOLEAN DEFAULT false,   -- Concepto PHP: clave por defecto → forzar cambio
  avatar_url      TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, email),                     -- Correo único por restaurante (§1.13)
  UNIQUE(tenant_id, username)
);

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Historial de contraseñas: la nueva no puede repetir anteriores (§1.16)
CREATE TABLE password_history (
  id            SERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Regla del manual (§1.14): un grupo solo se elimina sin usuarios asociados
CREATE OR REPLACE FUNCTION guard_group_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE group_id = OLD.id) THEN
    RAISE EXCEPTION 'No se puede eliminar un grupo con usuarios asociados';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_groups_guard_delete BEFORE DELETE ON groups
  FOR EACH ROW EXECUTE FUNCTION guard_group_delete();
