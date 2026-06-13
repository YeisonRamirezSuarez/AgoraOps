-- =============================================================
-- 00034: Sala de sistema DOMICILIO — réplica exacta de Polaris §1.7.1.
-- En "Sala del restaurante" Polaris incluye la sala DOMICILIO protegida:
-- su descripción no se puede renombrar ni eliminar; solo se activa/desactiva.
-- Se modela con una bandera is_system + triggers que bloquean rename/delete.
-- =============================================================

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

-- Sembrar DOMICILIO (protegida, activa) para cada tenant que aún no la tenga.
INSERT INTO rooms (tenant_id, name, is_active, is_system)
SELECT t.id, 'DOMICILIO', true, true
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM rooms r WHERE r.tenant_id = t.id AND r.name = 'DOMICILIO'
);

-- Marcar como sistema cualquier DOMICILIO preexistente.
UPDATE rooms SET is_system = true WHERE name = 'DOMICILIO' AND is_system = false;

-- Protección §1.7.1: la sala de sistema no se renombra ni se elimina, y la
-- bandera is_system no se puede cambiar desde el cliente.
CREATE OR REPLACE FUNCTION guard_room_system_protected()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'No se puede eliminar una sala del sistema.';
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE
  IF OLD.is_system AND NEW.name IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION 'No se puede modificar la descripción de una sala del sistema.';
  END IF;
  IF NEW.is_system IS DISTINCT FROM OLD.is_system THEN
    NEW.is_system := OLD.is_system;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rooms_system_protected_upd ON rooms;
CREATE TRIGGER trg_rooms_system_protected_upd BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION guard_room_system_protected();

DROP TRIGGER IF EXISTS trg_rooms_system_protected_del ON rooms;
CREATE TRIGGER trg_rooms_system_protected_del BEFORE DELETE ON rooms
  FOR EACH ROW EXECUTE FUNCTION guard_room_system_protected();
