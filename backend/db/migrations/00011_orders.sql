-- =============================================================
-- 00011: ÓRDENES — manual §1.6.3 (Mesas) y §1.6.4 (Monitor de Cocina)
-- Origen PHP: CSVs mesas_ocupadas*/ (cabecera: idMesa, atiende, idUsuario,
-- total, estado, cliente, horacomanda, nota, codigo; filas insumo con
-- codigoUnico y estado pendiente/entregado) + tablas ventas, insumos_venta,
-- insumos_venta_topings, cancelacion_mesas, productos_cancelados.
-- Campos PHP diferidos a Fase 4 pero preservados para migración histórica:
-- discount/discount_reason (descuentoManual/motivo), legacy_data (domicilio,
-- empresadomi, valorDomi, telefono, direccion).
-- =============================================================

CREATE TYPE order_status AS ENUM ('abierta', 'pagada', 'cancelada');
CREATE TYPE kitchen_status AS ENUM
  ('nuevo', 'requerido', 'en_preparacion', 'listo', 'cancelado');
  -- nuevo = sin confirmar (PHP "pendiente"); listo equivale a PHP "entregado"

CREATE TABLE orders (
  id               SERIAL PRIMARY KEY,
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  order_number     TEXT NOT NULL,             -- PHP: codigo = YmdHis + idMesa
  table_id         INT REFERENCES tables(id),
  room_id          INT REFERENCES rooms(id),
  status           order_status DEFAULT 'abierta',
  comment          TEXT,                      -- PHP: nota de la mesa ("S/N" por defecto)
  customer_name    TEXT DEFAULT 'Nuevo',      -- PHP: cliente texto libre en CSV
  opened_at        TIMESTAMPTZ DEFAULT now(), -- Contador de la mesa (§1.6.3)
  user_id          UUID NOT NULL REFERENCES users(id),
  attended_by      TEXT,                      -- PHP: atiende (nombre)
  client_id        INT REFERENCES clients(id),
  subtotal         NUMERIC(12,2) DEFAULT 0,
  tip              NUMERIC(12,2) DEFAULT 0,   -- PHP: vpropina
  service          NUMERIC(12,2) DEFAULT 0,   -- % servicio (solo EC)
  discount         NUMERIC(12,2) DEFAULT 0,   -- PHP: descuentoManual (UI → Fase 4)
  discount_reason  TEXT,                      -- PHP: motivo
  total            NUMERIC(12,2) DEFAULT 0,
  cost_total       NUMERIC(12,2) DEFAULT 0,   -- PHP: preciocosto
  amount_paid      NUMERIC(12,2) DEFAULT 0,   -- PHP: pagado
  cash_session_id  INT,                       -- FK añadida en 00012
  cufe             TEXT,                      -- Facturación electrónica
  legacy_data      JSONB DEFAULT '{}',        -- Domicilio PHP: telefono, direccion, empresadomi, valorDomi, tipo
  cancelled_by     UUID REFERENCES users(id),
  cancelled_by_name TEXT,                     -- PHP: cancelacion_mesas.nombreUsuario
  cancel_reason    TEXT,                      -- PHP: cancelacion_mesas.motivo
  cancelled_value  NUMERIC(12,2),             -- PHP: cancelacion_mesas.valormesa
  cancelled_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_orders_tenant_status ON orders(tenant_id, status);
CREATE INDEX idx_orders_tenant_created ON orders(tenant_id, created_at);

CREATE TABLE order_items (
  id              SERIAL PRIMARY KEY,
  order_id        INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      INT REFERENCES products(id),       -- NULL solo en datos migrados huérfanos
  variant_id      INT REFERENCES product_variants(id),
  product_name    TEXT NOT NULL,
  quantity        INT NOT NULL DEFAULT 1,
  unit_price      NUMERIC(12,2) NOT NULL,    -- $0 si fue "solicitado de nuevo" (§1.6.3)
  cost_price      NUMERIC(12,2) DEFAULT 0,
  subtotal        NUMERIC(12,2) NOT NULL,
  notes           TEXT,                       -- PHP: caracteristicas
  kitchen_status  kitchen_status DEFAULT 'nuevo',
  confirmed_at    TIMESTAMPTZ,                -- Confirmar → imprime comanda
  is_paid         BOOLEAN DEFAULT false,      -- Pago por producto
  cancel_reason   TEXT,                       -- PHP: productos_cancelados.motivo (obligatoria)
  cancelled_by    TEXT,                       -- PHP: productos_cancelados.usuario
  cash_session_id INT,                        -- PHP: productos_cancelados.IdCierre
  reordered_from  INT REFERENCES order_items(id),  -- "Solicitar de nuevo"
  unique_code     TEXT NOT NULL,              -- PHP: codigoUnico (YmdHis + rand)
  printer_id      INT,                        -- FK añadida en 00016
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_kitchen ON order_items(kitchen_status);

CREATE TABLE order_item_toppings (
  id            SERIAL PRIMARY KEY,
  order_item_id INT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  topping_id    INT REFERENCES toppings(id),
  topping_name  TEXT NOT NULL,
  topping_price NUMERIC(12,2) DEFAULT 0,
  quantity      INT DEFAULT 1                 -- PHP: insumos_venta_topings.cantidad
);

-- Pagos normalizados (PHP: columnas de ventas + cobroDivido)
CREATE TABLE order_payments (
  id                SERIAL PRIMARY KEY,
  order_id          INT NOT NULL REFERENCES orders(id),
  payment_method_id INT NOT NULL REFERENCES payment_methods(id),
  bank_id           INT REFERENCES banks(id),
  amount            NUMERIC(12,2) NOT NULL,
  tip_included      NUMERIC(12,2) DEFAULT 0,  -- Propina al primer pago ≥ propina (§1.6.3)
  change_given      NUMERIC(12,2) DEFAULT 0,  -- PHP cobroDivido: cambio
  voucher_number    TEXT,                     -- Un voucher por pago (§1.9.4)
  paid_item_ids     INT[],                    -- Pago por producto
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Traslado de productos entre mesas (PHP: editarMesa* con areaNueva)
CREATE TABLE order_transfers (
  id            SERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  from_order_id INT NOT NULL REFERENCES orders(id),
  to_order_id   INT NOT NULL REFERENCES orders(id),
  item_ids      INT[] NOT NULL,
  user_id       UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT now()
);
