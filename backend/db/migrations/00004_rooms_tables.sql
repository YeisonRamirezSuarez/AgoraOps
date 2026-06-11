-- =============================================================
-- 00004: SALAS y MESAS — manual §1.7.1, §1.7.2
-- Origen PHP: 4 áreas fijas (mesas_ocupadas{,2,3,4}/ + domicilios/) y
-- tabla mesas (idMesa, nombre, x, y, area). El plan reemplaza áreas fijas
-- por salas configurables. Coordenadas x/y (drag & drop) → Fase 4: se
-- preservan las columnas pos_x/pos_y solo para la migración histórica.
-- =============================================================

CREATE TABLE rooms (
  id          SERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE TABLE tables (
  id          SERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  room_id     INT NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  number      INT NOT NULL,                   -- No editable después de creada (§1.7.2)
  seats       INT DEFAULT 4,
  pos_x       INT DEFAULT 0,                  -- Legacy PHP (drag & drop → Fase 4)
  pos_y       INT DEFAULT 0,
  is_active   BOOLEAN DEFAULT true,
  UNIQUE(tenant_id, room_id, number)
);

-- Regla §1.7.1: no eliminar sala con mesas asociadas (la cubre ON DELETE RESTRICT).
-- Regla §1.7.2: número de mesa inmutable.
CREATE OR REPLACE FUNCTION guard_table_number_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.number <> OLD.number THEN
    RAISE EXCEPTION 'El número de la mesa no puede modificarse';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tables_number_immutable BEFORE UPDATE ON tables
  FOR EACH ROW EXECUTE FUNCTION guard_table_number_immutable();
