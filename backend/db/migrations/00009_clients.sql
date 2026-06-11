-- =============================================================
-- 00009: CLIENTES — manual §1.6.6
-- Origen PHP: tabla clientes (nit, nombre, telefono, correo, direccion).
-- PHP autoregistraba clientes por teléfono al vender domicilios
-- (registrarclientes) → ese flujo va con Domicilios a Fase 4.
-- =============================================================

CREATE TABLE clients (
  id          SERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  document_id TEXT,                           -- NIT/Cédula (CO) / RUC/Cédula (EC)
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
