-- =============================================================
-- 00015: NOTIFICACIONES — manual §1.6.7
-- Sin equivalente directo en PHP (el monitor de cocina PHP no existía;
-- los estados de comanda vivían en historial_comandas → Fase 4).
-- =============================================================

CREATE TABLE notifications (
  id            SERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  order_item_id INT REFERENCES order_items(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('Listo', 'Cancelado')),
  is_viewed     BOOLEAN DEFAULT false,
  created_by    UUID REFERENCES users(id),   -- Quien cambió el estado del producto
  viewed_by     UUID REFERENCES users(id),   -- "Actualizado por" (quien la vio)
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_notifications_tenant_unviewed
  ON notifications(tenant_id) WHERE is_viewed = false;
