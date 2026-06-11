-- =============================================================
-- 00005: CATEGORÍAS y PRIORIDAD DEL MENÚ — manual §1.10.3, §1.7.6
-- Origen PHP: tabla categorias (tipo ENUM PLATILLO/BEBIDA, nombre,
-- descripcion). El tipo PLATILLO/BEBIDA se conserva como legacy_type para
-- la migración; la lógica nueva no lo usa (el manual no clasifica así).
-- =============================================================

CREATE TABLE categories (
  id          SERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,
  description TEXT,
  legacy_type TEXT CHECK (legacy_type IN ('PLATILLO', 'BEBIDA')),  -- Solo migración
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, name)                      -- §1.10.3: nombre único
);

-- Prioridad del menú: categorías favoritas visibles por día de semana (§1.7.6)
CREATE TABLE menu_priority (
  id          SERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  weekday     INT NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0=domingo
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  sort_order  INT NOT NULL DEFAULT 0,
  UNIQUE(tenant_id, weekday, category_id)
);
