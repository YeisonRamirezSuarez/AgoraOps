-- =============================================================
-- 00049: Índices sobre Foreign Keys sin soporte de índice
-- Postgres NO indexa automáticamente las columnas FK. Sin un índice
-- sobre la columna que referencia, cada JOIN por esa FK y cada
-- DELETE/UPDATE en CASCADE de la tabla padre obliga a un Seq Scan de
-- la tabla hija. Con datos pequeños no se nota; al crecer el inventario
-- y el histórico de órdenes degrada recipes, order_items, orders,
-- inventory_movements y reservations (ya con seq_scan>0 e idx_scan=0).
--
-- Se cubren las 64 FK del esquema public que hoy no tienen índice cuya
-- primera columna coincida con la primera columna de la FK. Todos son
-- CREATE INDEX IF NOT EXISTS (idempotente). Reversible con DROP INDEX.
-- Nota: el runner (src/db/migrate.ts) envuelve cada migración en una
-- transacción, por eso NO se usa CONCURRENTLY (no permitido en TX);
-- con el volumen actual el bloqueo de creación es instantáneo.
-- =============================================================

-- Caja
CREATE INDEX IF NOT EXISTS idx_cash_registers_created_by ON cash_registers (created_by);
CREATE INDEX IF NOT EXISTS idx_cash_registers_updated_by ON cash_registers (updated_by);
CREATE INDEX IF NOT EXISTS idx_cash_session_totals_payment_method_id ON cash_session_totals (payment_method_id);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_responsible_id ON cash_sessions (responsible_id);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_user_id ON cash_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_tenant_id ON cash_transactions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_user_id ON cash_transactions (user_id);

-- Clientes / geografía
CREATE INDEX IF NOT EXISTS idx_clients_city_id ON clients (city_id);
CREATE INDEX IF NOT EXISTS idx_clients_department_id ON clients (department_id);

-- Catálogo (productos, combos, variantes, toppings)
CREATE INDEX IF NOT EXISTS idx_combo_items_product_id ON combo_items (product_id);
CREATE INDEX IF NOT EXISTS idx_product_toppings_topping_id ON product_toppings (topping_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_printer_id ON products (printer_id);
CREATE INDEX IF NOT EXISTS idx_menu_priority_category_id ON menu_priority (category_id);

-- Inventario y recetas
CREATE INDEX IF NOT EXISTS idx_inventory_products_product_id ON inventory_products (product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_products_topping_id ON inventory_products (topping_id);
CREATE INDEX IF NOT EXISTS idx_inventory_products_variant_id ON inventory_products (variant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_presentations_inventory_product_id ON purchase_presentations (inventory_product_id);
CREATE INDEX IF NOT EXISTS idx_recipes_inventory_product_id ON recipes (inventory_product_id);
CREATE INDEX IF NOT EXISTS idx_recipes_product_id ON recipes (product_id);
CREATE INDEX IF NOT EXISTS idx_recipes_topping_id ON recipes (topping_id);
CREATE INDEX IF NOT EXISTS idx_recipes_variant_id ON recipes (variant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_cash_session_id ON inventory_movements (cash_session_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_inventory_product_id ON inventory_movements (inventory_product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_presentation_id ON inventory_movements (presentation_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_supplier_id ON inventory_movements (supplier_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_user_id ON inventory_movements (user_id);

-- Órdenes e ítems
CREATE INDEX IF NOT EXISTS idx_orders_cancelled_by ON orders (cancelled_by);
CREATE INDEX IF NOT EXISTS idx_orders_cash_session_id ON orders (cash_session_id);
CREATE INDEX IF NOT EXISTS idx_orders_client_id ON orders (client_id);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_personnel_id ON orders (delivery_personnel_id);
CREATE INDEX IF NOT EXISTS idx_orders_room_id ON orders (room_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_cash_session_id ON order_items (cash_session_id);
CREATE INDEX IF NOT EXISTS idx_order_items_customer_id ON order_items (customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_printer_id ON order_items (printer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items (product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_reordered_from ON order_items (reordered_from);
CREATE INDEX IF NOT EXISTS idx_order_items_variant_id ON order_items (variant_id);
CREATE INDEX IF NOT EXISTS idx_order_item_toppings_order_item_id ON order_item_toppings (order_item_id);
CREATE INDEX IF NOT EXISTS idx_order_item_toppings_topping_id ON order_item_toppings (topping_id);
CREATE INDEX IF NOT EXISTS idx_order_payments_bank_id ON order_payments (bank_id);
CREATE INDEX IF NOT EXISTS idx_order_payments_payment_method_id ON order_payments (payment_method_id);
CREATE INDEX IF NOT EXISTS idx_order_transfers_from_order_id ON order_transfers (from_order_id);
CREATE INDEX IF NOT EXISTS idx_order_transfers_tenant_id ON order_transfers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_order_transfers_to_order_id ON order_transfers (to_order_id);
CREATE INDEX IF NOT EXISTS idx_order_transfers_user_id ON order_transfers (user_id);

-- Facturación
CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices (client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_order_id ON invoices (order_id);
CREATE INDEX IF NOT EXISTS idx_invoice_certificates_tenant_id ON invoice_certificates (tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoice_sequences_tenant_id ON invoice_sequences (tenant_id);

-- Métodos de pago / bancos
CREATE INDEX IF NOT EXISTS idx_payment_method_banks_bank_id ON payment_method_banks (bank_id);

-- Mesas / salas
CREATE INDEX IF NOT EXISTS idx_tables_room_id ON tables (room_id);

-- Domiciliarios
CREATE INDEX IF NOT EXISTS idx_delivery_personnel_company_id ON delivery_personnel (company_id);

-- Reservas
CREATE INDEX IF NOT EXISTS idx_reservations_client_id ON reservations (client_id);
CREATE INDEX IF NOT EXISTS idx_reservations_stage_id ON reservations (stage_id);

-- Horarios
CREATE INDEX IF NOT EXISTS idx_schedule_templates_tenant_id ON schedule_templates (tenant_id);
CREATE INDEX IF NOT EXISTS idx_schedules_template_id ON schedules (template_id);

-- Notificaciones
CREATE INDEX IF NOT EXISTS idx_notifications_created_by ON notifications (created_by);
CREATE INDEX IF NOT EXISTS idx_notifications_order_item_id ON notifications (order_item_id);
CREATE INDEX IF NOT EXISTS idx_notifications_viewed_by ON notifications (viewed_by);

-- Usuarios / seguridad
CREATE INDEX IF NOT EXISTS idx_users_group_id ON users (group_id);
CREATE INDEX IF NOT EXISTS idx_password_history_user_id ON password_history (user_id);
