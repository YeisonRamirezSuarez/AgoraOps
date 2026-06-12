-- =============================================================
-- 00028: RESERVACIONES igual a Polaris (form_tb_reservations /
-- grid_tb_reservations, verificado en QA 2026-06-12).
-- Campos Polaris: estado, fecha (DATE), hora de inicio (TIME),
-- horas (1-12), cliente, personas (1-12). Se eliminan los campos
-- heredados del PHP que Polaris no usa (sala, mesa, decoración,
-- costo, observaciones, contacto libre) y se separa date en
-- fecha + hora como en Polaris.
-- =============================================================

ALTER TABLE reservations
  ADD COLUMN reservation_date DATE,
  ADD COLUMN reservation_time TIME,
  ADD COLUMN number_hours INT NOT NULL DEFAULT 1
    CONSTRAINT chk_reservations_hours CHECK (number_hours BETWEEN 1 AND 12),
  ADD COLUMN people INT NOT NULL DEFAULT 1
    CONSTRAINT chk_reservations_people CHECK (people BETWEEN 1 AND 12);

-- Datos existentes: derivar fecha/hora en hora local del negocio
UPDATE reservations SET
  reservation_date = (date AT TIME ZONE 'America/Bogota')::date,
  reservation_time = (date AT TIME ZONE 'America/Bogota')::time;

ALTER TABLE reservations
  ALTER COLUMN reservation_date SET NOT NULL,
  ALTER COLUMN reservation_time SET NOT NULL;

-- date se elimina; sus índices (uq_reservations_client_datetime,
-- idx_reservations_tenant) caen con la columna
ALTER TABLE reservations
  DROP COLUMN date,
  DROP COLUMN room_id,
  DROP COLUMN table_id,
  DROP COLUMN decoration_type,
  DROP COLUMN cost,
  DROP COLUMN observations,
  DROP COLUMN contact_name,
  DROP COLUMN contact_phone;

-- Polaris: "Este cliente ya reservó en esta fecha y hora."
CREATE UNIQUE INDEX uq_reservations_client_datetime
  ON reservations(tenant_id, client_id, reservation_date, reservation_time)
  WHERE client_id IS NOT NULL;

CREATE INDEX idx_reservations_tenant
  ON reservations(tenant_id, reservation_date);
