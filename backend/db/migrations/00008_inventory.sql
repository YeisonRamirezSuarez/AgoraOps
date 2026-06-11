-- =============================================================
-- 00008: INVENTARIO — manual §1.11
-- Origen PHP: insumoinventario (nombre, existencia), consumo_inventario
-- (recetas: cantidad, insumo_id, inventario_id), historial_inventario
-- (producto, cantidad_antes/despues, tipo_movimiento, usuario, motivo).
-- El manual añade: tipo ingrediente/consumible, presentaciones de compra,
-- proveedores, razones de movimiento y vínculo opcional con caja.
-- =============================================================

CREATE TABLE inventory_products (
  id            SERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  type          TEXT NOT NULL CHECK (type IN ('ingrediente', 'consumible')),
  name          TEXT,                         -- Consumible: hereda nombre del producto del menú
  unit          TEXT DEFAULT 'Unidad',        -- Consumible: siempre 'Unidad' (§1.11.1)
  product_id    INT REFERENCES products(id),  -- Solo consumibles
  variant_id    INT REFERENCES product_variants(id),
  topping_id    INT REFERENCES toppings(id),
  stock         NUMERIC(12,2) NOT NULL DEFAULT 0,  -- Negativo permitido con sobregiro (§1.8.1)
  min_stock     NUMERIC(12,2) DEFAULT 0,      -- Alertas en Dashboard (§1.5)
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_inventory_products_updated BEFORE UPDATE ON inventory_products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Presentaciones de compra: paca/paquete con factor de conversión (§1.11.1)
CREATE TABLE purchase_presentations (
  id                   SERIAL PRIMARY KEY,
  inventory_product_id INT NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  conversion_factor    NUMERIC(12,2) NOT NULL CHECK (conversion_factor > 0)
);

-- Recetas (PHP: consumo_inventario) — por producto, variante o topping
CREATE TABLE recipes (
  id                   SERIAL PRIMARY KEY,
  product_id           INT REFERENCES products(id) ON DELETE CASCADE,
  variant_id           INT REFERENCES product_variants(id) ON DELETE CASCADE,
  topping_id           INT REFERENCES toppings(id) ON DELETE CASCADE,
  inventory_product_id INT NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
  quantity_used        NUMERIC(12,4) NOT NULL CHECK (quantity_used > 0),
  CHECK (num_nonnulls(product_id, variant_id, topping_id) = 1)
);

CREATE TABLE suppliers (
  id          SERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Movimientos (§1.11.4). PHP descontaba al pagar; el nuevo sistema (manual)
-- descuenta consumibles al CONFIRMAR y recetas al marcar LISTO en cocina
-- (decisión 2026-06-11, pregunta C).
CREATE TABLE inventory_movements (
  id                   SERIAL PRIMARY KEY,
  tenant_id            UUID NOT NULL REFERENCES tenants(id),
  inventory_product_id INT NOT NULL REFERENCES inventory_products(id),
  direction            TEXT NOT NULL CHECK (direction IN ('ENTRADA', 'SALIDA')),
  reason               TEXT NOT NULL CHECK (reason IN
                         ('Compra', 'Ajuste', 'Devolución', 'Venta', 'Daño', 'Vencido')),
  quantity             NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  presentation_id      INT REFERENCES purchase_presentations(id),
  supplier_id          INT REFERENCES suppliers(id),     -- Solo entradas
  total                NUMERIC(12,2),                    -- Solo entradas
  reference_document   TEXT,                  -- Único campo editable después (§1.11.4)
  cash_session_id      INT,                   -- FK añadida en 00012 (mov. de caja opcional)
  cash_movement_type   TEXT CHECK (cash_movement_type IN ('ENTRADA', 'SALIDA')),
  qty_before           NUMERIC(12,2) NOT NULL,
  qty_after            NUMERIC(12,2) NOT NULL,
  user_id              UUID REFERENCES users(id),
  user_name            TEXT,                  -- PHP: historial_inventario.usuario
  created_at           TIMESTAMPTZ DEFAULT now()
);

-- §1.11.3: no eliminar proveedor con movimientos asociados
CREATE OR REPLACE FUNCTION guard_supplier_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM inventory_movements WHERE supplier_id = OLD.id) THEN
    RAISE EXCEPTION 'No se puede eliminar un proveedor con movimientos asociados';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_suppliers_guard_delete BEFORE DELETE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION guard_supplier_delete();
