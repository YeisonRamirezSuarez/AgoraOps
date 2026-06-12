-- =============================================================
-- 00030: GESTIÓN DE DOMICILIOS igual a Polaris
-- (blank_gestion_domicilio, verificado en QA 2026-06-12).
-- Empresas aliadas (RAPPI, etc.) y su personal domiciliario.
-- Polaris permite nombres de empresa duplicados (replicado: sin
-- unique). orders.delivery_personnel_id habilita la regla "si el
-- domiciliario tiene pedidos asociados se DESACTIVA en vez de
-- borrarse" (has_history) para el futuro flujo de venta a
-- domicilio.
-- =============================================================

CREATE TABLE delivery_companies (
  id         SERIAL PRIMARY KEY,
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  name       TEXT NOT NULL,
  phone      TEXT,
  address    TEXT,
  status     TEXT NOT NULL DEFAULT 'ACTIVO'
    CONSTRAINT chk_delivery_companies_status CHECK (status IN ('ACTIVO', 'INACTIVO')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_delivery_companies_updated BEFORE UPDATE ON delivery_companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_delivery_companies_tenant ON delivery_companies(tenant_id);

CREATE TABLE delivery_personnel (
  id         SERIAL PRIMARY KEY,
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  company_id INT NOT NULL REFERENCES delivery_companies(id),
  first_name TEXT NOT NULL,
  last_name  TEXT NOT NULL,
  phone      TEXT NOT NULL,
  plate      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'ACTIVO'
    CONSTRAINT chk_delivery_personnel_status CHECK (status IN ('ACTIVO', 'INACTIVO')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_delivery_personnel_updated BEFORE UPDATE ON delivery_personnel
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_delivery_personnel_tenant ON delivery_personnel(tenant_id, company_id);

-- Pedido a domicilio asignado a un domiciliario (flujo de venta futuro)
ALTER TABLE orders
  ADD COLUMN delivery_personnel_id INT REFERENCES delivery_personnel(id);
