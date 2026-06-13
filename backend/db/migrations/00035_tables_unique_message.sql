-- =============================================================
-- 00035: Mensaje exacto de Polaris al duplicar número de mesa en una sala.
-- Polaris (form_add_tables) bloquea con "Ya existe una mesa con ese número
-- en: {SALA}". El número es único POR SALA (se permite repetir entre salas);
-- ya lo cubre UNIQUE(tenant_id, room_id, number), pero el mensaje del 23505
-- es genérico. Un trigger BEFORE lo reemplaza por el texto de Polaris.
-- =============================================================

CREATE OR REPLACE FUNCTION guard_table_number_unique_per_room()
RETURNS TRIGGER AS $$
DECLARE
  v_room TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM tables
    WHERE tenant_id = NEW.tenant_id
      AND room_id   = NEW.room_id
      AND number    = NEW.number
      AND id <> COALESCE(NEW.id, -1)
  ) THEN
    SELECT name INTO v_room FROM rooms WHERE id = NEW.room_id;
    RAISE EXCEPTION 'Ya existe una mesa con ese número en: %', v_room;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tables_number_unique ON tables;
CREATE TRIGGER trg_tables_number_unique BEFORE INSERT OR UPDATE ON tables
  FOR EACH ROW EXECUTE FUNCTION guard_table_number_unique_per_room();
