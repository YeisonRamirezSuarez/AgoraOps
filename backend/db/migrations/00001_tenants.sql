-- =============================================================
-- 00001: TENANTS (restaurantes) — módulo Multicomercio
-- Origen PHP: informacion_negocio.restaurante_id (usuarios), 1 solo restaurante.
-- Manual: restaurante inactivo bloquea el login (§1.3.3); Multicomercio (Super Admin).
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  country     TEXT NOT NULL DEFAULT 'CO' CHECK (country IN ('CO', 'EC')),
  timezone    TEXT DEFAULT 'America/Bogota',
  logo_url    TEXT,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenants_updated BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
