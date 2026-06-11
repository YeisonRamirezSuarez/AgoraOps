-- =============================================================
-- 00010: MÉTODOS DE PAGO, BANCOS y DENOMINACIONES — manual §1.7.7–1.7.9
-- Origen PHP: los métodos eran COLUMNAS de ventas (efectivo, transferencia,
-- tarjeta, nequi, daviplata, rappi). Aquí se normalizan. Los métodos extra
-- (TARJETA, NEQUI, DAVIPLATA, RAPPI) se siembran INACTIVOS para poder
-- migrar ventas históricas sin perder información (Fase 4 los habilita).
-- =============================================================

CREATE TABLE payment_methods (
  id          SERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,                  -- EFECTIVO, TRANSFERENCIA, CUENTA POR COBRAR (+legacy)
  is_active   BOOLEAN DEFAULT true,
  is_legacy   BOOLEAN DEFAULT false,          -- Métodos PHP diferidos a Fase 4
  UNIQUE(tenant_id, name)
);

CREATE TABLE banks (
  id          SERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,
  is_active   BOOLEAN DEFAULT true,
  UNIQUE(tenant_id, name)
);

-- Bancos asociados al método TRANSFERENCIA (§1.7.7)
CREATE TABLE payment_method_banks (
  payment_method_id INT NOT NULL REFERENCES payment_methods(id) ON DELETE CASCADE,
  bank_id           INT NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  PRIMARY KEY (payment_method_id, bank_id)
);

-- Denominación de moneda: atajos de pago en efectivo (§1.7.8)
CREATE TABLE currency_denominations (
  id          SERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  value       NUMERIC(12,2) NOT NULL CHECK (value > 0),
  is_active   BOOLEAN DEFAULT true
);
