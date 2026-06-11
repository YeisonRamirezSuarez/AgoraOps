-- =============================================================
-- 00012: CAJAS — manual §1.8.2–1.8.4
-- Origen PHP: cierres_caja (caja única: usuario, total, propinas, métodos,
-- conteo de billetes de100..de2, monedas, totalCaja, observaciones,
-- ingresos, salidas, domicilios, descuentoManual, valorCancelado,
-- saldoDejado) y transacciones (motivo, valor, tipo, cierre NO/SI, idCierre).
-- El manual cambia a multi-caja con "efectivo contado" y diferencia; el
-- conteo de billetes PHP se preserva en legacy_data para la migración.
-- =============================================================

CREATE TABLE cash_registers (
  id          SERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,
  status      TEXT DEFAULT 'activa' CHECK (status IN ('activa', 'inactiva')),
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE TABLE cash_sessions (
  id               SERIAL PRIMARY KEY,
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  cash_register_id INT NOT NULL REFERENCES cash_registers(id),
  user_id          UUID NOT NULL REFERENCES users(id),
  user_name        TEXT,                      -- PHP: cierres_caja.usuario
  status           TEXT DEFAULT 'abierta' CHECK (status IN ('abierta', 'cerrada')),
  opening_amount   NUMERIC(12,2) DEFAULT 0,
  income_total     NUMERIC(12,2) DEFAULT 0,   -- PHP: ingresos
  expense_total    NUMERIC(12,2) DEFAULT 0,   -- PHP: salidas
  tips_total       NUMERIC(12,2) DEFAULT 0,   -- PHP: propinas
  registered_total NUMERIC(12,2) DEFAULT 0,   -- Total registrado en la caja (§1.8.3)
  cash_total       NUMERIC(12,2) DEFAULT 0,   -- Total en efectivo (dinero físico)
  counted_cash     NUMERIC(12,2),             -- Efectivo contado (solo si cash_total > 0)
  difference       NUMERIC(12,2),             -- counted_cash - cash_total (verde/rojo)
  note             TEXT,                      -- Obligatorio al cerrar (validado en app/función)
  cancelled_total  NUMERIC(12,2) DEFAULT 0,   -- PHP: valorCancelado
  discount_total   NUMERIC(12,2) DEFAULT 0,   -- PHP: descuentoManual (Fase 4)
  legacy_data      JSONB DEFAULT '{}',        -- PHP: de100..de2, monedas, totalCaja, saldoDejado, domicilios
  opened_at        TIMESTAMPTZ DEFAULT now(),
  closed_at        TIMESTAMPTZ
);

-- Solo una sesión abierta por caja
CREATE UNIQUE INDEX uq_cash_sessions_open
  ON cash_sessions(cash_register_id) WHERE status = 'abierta';

-- Desglose por método de pago al cierre (§1.8.3)
CREATE TABLE cash_session_totals (
  id                SERIAL PRIMARY KEY,
  cash_session_id   INT NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  payment_method_id INT NOT NULL REFERENCES payment_methods(id),
  total             NUMERIC(12,2) DEFAULT 0,
  UNIQUE(cash_session_id, payment_method_id)
);

-- Entradas y salidas de dinero (PHP: transacciones)
CREATE TABLE cash_transactions (
  id              SERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  cash_session_id INT NOT NULL REFERENCES cash_sessions(id),
  type            TEXT NOT NULL CHECK (type IN ('ENTRADA', 'SALIDA')),
  reason          TEXT NOT NULL,              -- PHP: motivo
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),  -- §1.8.3: monto > 0
  user_id         UUID NOT NULL REFERENCES users(id),
  user_name       TEXT,                       -- PHP: nombreUsuario
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- FKs diferidas de migraciones anteriores
ALTER TABLE orders ADD CONSTRAINT fk_orders_cash_session
  FOREIGN KEY (cash_session_id) REFERENCES cash_sessions(id);
ALTER TABLE order_items ADD CONSTRAINT fk_order_items_cash_session
  FOREIGN KEY (cash_session_id) REFERENCES cash_sessions(id);
ALTER TABLE inventory_movements ADD CONSTRAINT fk_inventory_movements_cash_session
  FOREIGN KEY (cash_session_id) REFERENCES cash_sessions(id);

-- §1.8.2: una caja solo se elimina si nunca fue abierta
CREATE OR REPLACE FUNCTION guard_cash_register_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM cash_sessions WHERE cash_register_id = OLD.id) THEN
    RAISE EXCEPTION 'No se puede eliminar una caja que ya fue abierta';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cash_registers_guard_delete BEFORE DELETE ON cash_registers
  FOR EACH ROW EXECUTE FUNCTION guard_cash_register_delete();

-- §1.8.2: el estado de la caja solo se edita con la caja cerrada
CREATE OR REPLACE FUNCTION guard_cash_register_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status <> OLD.status AND EXISTS (
    SELECT 1 FROM cash_sessions
    WHERE cash_register_id = OLD.id AND status = 'abierta'
  ) THEN
    RAISE EXCEPTION 'Para actualizar el estado de una caja, primero debe cerrarse';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cash_registers_guard_update BEFORE UPDATE ON cash_registers
  FOR EACH ROW EXECUTE FUNCTION guard_cash_register_update();
