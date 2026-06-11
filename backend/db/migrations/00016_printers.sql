-- =============================================================
-- 00016: IMPRESORAS — manual §1.8.6
-- Origen PHP: impresoras lógicas hardcodeadas IMPRESORA1..IMPRESORA4
-- mapeadas todas a la física "POS-80C" (comanda.php), campo
-- insumos.impresora. El manual las convierte en CRUD con conexión
-- USB o ETHERNET.
-- =============================================================

CREATE TABLE printers (
  id              SERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  name            TEXT NOT NULL,              -- No editable después de creada (§1.8.6)
  connection_type TEXT NOT NULL CHECK (connection_type IN ('USB', 'ETHERNET')),
  device_name     TEXT,                       -- USB: nombre de la impresora en Windows (PHP: POS-80C)
  ip_address      TEXT,                       -- Solo ETHERNET
  port            INT,                        -- Solo ETHERNET
  is_active       BOOLEAN DEFAULT true,
  UNIQUE(tenant_id, name)
);

-- §1.8.6: el nombre de la impresora no puede modificarse
CREATE OR REPLACE FUNCTION guard_printer_name_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.name <> OLD.name THEN
    RAISE EXCEPTION 'El nombre de la impresora no puede modificarse';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_printers_name_immutable BEFORE UPDATE ON printers
  FOR EACH ROW EXECUTE FUNCTION guard_printer_name_immutable();

-- FKs diferidas
ALTER TABLE products ADD CONSTRAINT fk_products_printer
  FOREIGN KEY (printer_id) REFERENCES printers(id);
ALTER TABLE order_items ADD CONSTRAINT fk_order_items_printer
  FOREIGN KEY (printer_id) REFERENCES printers(id);
