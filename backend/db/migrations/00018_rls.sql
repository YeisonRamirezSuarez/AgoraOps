-- =============================================================
-- 00018: ÍNDICES DE AISLAMIENTO POR TENANT
-- Decisión de arquitectura (2026-06-11): el aislamiento multi-tenant se
-- aplica en el API Express (middleware: toda query filtra por el
-- tenant_id del JWT). Esta migración crea los índices que esas consultas
-- necesitan. (La versión anterior usaba RLS de Supabase.)
-- =============================================================

CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_groups_tenant ON groups(tenant_id);
CREATE INDEX idx_rooms_tenant ON rooms(tenant_id);
CREATE INDEX idx_tables_tenant ON tables(tenant_id);
CREATE INDEX idx_categories_tenant ON categories(tenant_id);
CREATE INDEX idx_products_tenant ON products(tenant_id);
CREATE INDEX idx_toppings_tenant ON toppings(tenant_id);
CREATE INDEX idx_inventory_products_tenant ON inventory_products(tenant_id);
CREATE INDEX idx_inventory_movements_tenant ON inventory_movements(tenant_id, created_at);
CREATE INDEX idx_suppliers_tenant ON suppliers(tenant_id);
CREATE INDEX idx_clients_tenant ON clients(tenant_id);
CREATE INDEX idx_payment_methods_tenant ON payment_methods(tenant_id);
CREATE INDEX idx_banks_tenant ON banks(tenant_id);
CREATE INDEX idx_denominations_tenant ON currency_denominations(tenant_id);
CREATE INDEX idx_cash_registers_tenant ON cash_registers(tenant_id);
CREATE INDEX idx_cash_sessions_tenant ON cash_sessions(tenant_id, status);
CREATE INDEX idx_cash_transactions_session ON cash_transactions(cash_session_id);
CREATE INDEX idx_reservations_tenant ON reservations(tenant_id, date);
CREATE INDEX idx_schedules_tenant ON schedules(tenant_id, date);
CREATE INDEX idx_printers_tenant ON printers(tenant_id);
CREATE INDEX idx_invoices_tenant ON invoices(tenant_id);
CREATE INDEX idx_order_payments_order ON order_payments(order_id);
