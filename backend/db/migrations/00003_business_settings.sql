-- =============================================================
-- 00003: PARÁMETROS DEL RESTAURANTE — manual §1.8.1 + datos del negocio
-- Origen PHP: tabla informacion_negocio (nombre, telefono, nit, direccion,
-- logo, procenpro→tip_percentage, modopropina→tip_enabled, facebook,
-- instagram). Flags PHP diferidos a Fase 4 se preservan en legacy_flags
-- para la migración histórica: modoMenu, modoPrefactura, contramesa,
-- logoqr, usarLogo, numeronequi, nequi, numeroMesas, numeroDomis.
-- =============================================================

CREATE TABLE business_settings (
  id                  SERIAL PRIMARY KEY,
  tenant_id           UUID NOT NULL UNIQUE REFERENCES tenants(id),
  business_name       TEXT NOT NULL,
  phone               TEXT,
  tax_id              TEXT,                   -- NIT (CO) / RUC (EC)
  address             TEXT,
  logo_url            TEXT,
  facebook            TEXT,
  instagram           TEXT,
  tip_enabled         BOOLEAN DEFAULT false,  -- Propina: CO y EC (§1.8.1)
  tip_percentage      NUMERIC(5,2) DEFAULT 0,
  service_enabled     BOOLEAN DEFAULT false,  -- % de servicio: solo EC (§1.8.1)
  service_percentage  NUMERIC(5,2) DEFAULT 0,
  allow_overdraft     BOOLEAN DEFAULT false,  -- Sobregiro de inventario (§1.8.1)
  legacy_flags        JSONB DEFAULT '{}',     -- Flags PHP diferidos a Fase 4
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_business_settings_updated BEFORE UPDATE ON business_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
