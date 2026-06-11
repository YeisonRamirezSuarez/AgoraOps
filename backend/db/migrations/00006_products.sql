-- =============================================================
-- 00006: PRODUCTOS — manual §1.10.1
-- Origen PHP: tabla insumos (codigo, nombre, descripcion, precio,
-- preciocosto, tipo, categoria, impresora, subcategoria).
-- subcategoria/adicionales por categoría → Fase 4 (se preserva
-- legacy_subcategory para migración). Combos y variantes no existían en
-- PHP: vienen del manual.
-- =============================================================

CREATE TABLE products (
  id                SERIAL PRIMARY KEY,
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  category_id       INT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  product_type      TEXT NOT NULL DEFAULT 'NORMAL' CHECK (product_type IN ('NORMAL', 'COMBO')),
  sale_price        NUMERIC(12,2) NOT NULL DEFAULT 0,  -- 0 o NULL → no aparece en menú (§1.6.1)
  cost_price        NUMERIC(12,2) DEFAULT 0,
  is_inventariable  BOOLEAN DEFAULT false,
  goes_to_kitchen   BOOLEAN DEFAULT false,    -- Sí → receta; No + inventariable → consumible
  image_url         TEXT,                     -- Máx 5MB (límite en Storage)
  printer_id        INT,                      -- FK añadida en 00016 (printers)
  legacy_subcategory TEXT,                    -- PHP insumos.subcategoria (Fase 4)
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, code)
);

CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Componentes de un combo (§1.10.1 Configurar combo)
CREATE TABLE combo_items (
  id          SERIAL PRIMARY KEY,
  combo_id    INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_id  INT NOT NULL REFERENCES products(id),
  quantity    INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  UNIQUE(combo_id, product_id)
);

-- Variantes: presentaciones del mismo producto (§1.10.1 Habilitar variantes)
CREATE TABLE product_variants (
  id              SERIAL PRIMARY KEY,
  product_id      INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  sale_price      NUMERIC(12,2) NOT NULL,
  uses_inventory  BOOLEAN DEFAULT false,
  inventory_mode  TEXT CHECK (inventory_mode IN ('receta', 'consumible')),
  is_active       BOOLEAN DEFAULT true
);

-- §1.10.3: no eliminar categoría con productos asociados (la cubre ON DELETE RESTRICT)
