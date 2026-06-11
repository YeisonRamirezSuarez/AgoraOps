-- =============================================================
-- 00007: TOPPINGS — manual §1.10.4, §1.10.5
-- Origen PHP: tablas topings (nombre, precio), producto_topings
-- (idProducto, idToping, maximo_permitido) e insumos_venta_topings.
-- El manual añade inventario propio al topping (consumible o receta).
-- =============================================================

CREATE TABLE toppings (
  id              SERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  name            TEXT NOT NULL,
  price           NUMERIC(12,2) NOT NULL DEFAULT 0,
  inventory_mode  TEXT CHECK (inventory_mode IN ('consumible', 'receta')),
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE product_toppings (
  id          SERIAL PRIMARY KEY,
  product_id  INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  topping_id  INT NOT NULL REFERENCES toppings(id) ON DELETE CASCADE,
  max_allowed INT DEFAULT 1,                  -- PHP: maximo_permitido
  UNIQUE(product_id, topping_id)              -- §1.10.5: sin duplicados
);
