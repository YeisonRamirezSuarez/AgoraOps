-- =============================================================
-- 00013: RESERVACIONES — manual §1.6.5, §1.7.3
-- Origen PHP: tabla reservas (nombre, telefono, tipo_decoracion, fecha,
-- area, mesa, observaciones, costo). El manual organiza por cliente y
-- añade etapas (Reservado/Confirmado/Cancelado — catálogo solo visual).
-- tipo_decoracion y costo del PHP se conservan.
-- =============================================================

CREATE TABLE reservation_stages (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE                  -- Reservado, Confirmado, Cancelado
);

CREATE TABLE reservations (
  id              SERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  client_id       INT REFERENCES clients(id), -- NULL solo en datos migrados sin cliente
  contact_name    TEXT,                       -- PHP: nombre (texto libre)
  contact_phone   TEXT,                       -- PHP: telefono
  stage_id        INT NOT NULL REFERENCES reservation_stages(id),
  date            TIMESTAMPTZ NOT NULL,       -- §1.6.5: sin fecha/hora pasada (valida la app)
  room_id         INT REFERENCES rooms(id),
  table_id        INT REFERENCES tables(id),
  decoration_type TEXT,                       -- PHP: tipo_decoracion
  cost            NUMERIC(12,2),              -- PHP: costo
  observations    TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- §1.6.5: sin duplicado del mismo cliente en misma fecha y hora
CREATE UNIQUE INDEX uq_reservations_client_datetime
  ON reservations(tenant_id, client_id, date) WHERE client_id IS NOT NULL;
