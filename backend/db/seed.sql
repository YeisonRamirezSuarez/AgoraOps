-- =============================================================
-- SEED: datos iniciales de AgoraOps
-- Origen PHP: crear_tablas.php creaba un usuario admin por defecto
-- (admin@admin.com / clave por defecto → forzar cambio). Se replica con
-- bcrypt vía pgcrypto y must_change_password = true.
-- =============================================================

-- Etapas de reserva (manual §1.7.3 — catálogo solo visual)
INSERT INTO reservation_stages (name) VALUES
  ('Reservado'), ('Confirmado'), ('Cancelado')
ON CONFLICT (name) DO NOTHING;

-- Tenant de desarrollo
INSERT INTO tenants (id, name, slug, country)
VALUES ('00000000-0000-0000-0000-000000000001', 'Restaurante Demo', 'demo', 'CO')
ON CONFLICT (slug) DO NOTHING;

-- Grupos base (manual §1.2)
INSERT INTO groups (tenant_id, name, role_type) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Administrador', 'administrador'),
  ('00000000-0000-0000-0000-000000000001', 'Mesero', 'empleado'),
  ('00000000-0000-0000-0000-000000000001', 'Cocina', 'empleado'),
  ('00000000-0000-0000-0000-000000000001', 'Mesero_cocina', 'empleado')
ON CONFLICT (tenant_id, name) DO NOTHING;

-- Usuario administrador inicial: admin / admin1234 (debe cambiarla al entrar)
INSERT INTO users (tenant_id, username, email, password_hash, full_name, group_id, must_change_password)
SELECT '00000000-0000-0000-0000-000000000001', 'admin', 'admin@demo.local',
       crypt('admin1234', gen_salt('bf', 10)), 'Administrador',
       g.id, true
FROM groups g
WHERE g.tenant_id = '00000000-0000-0000-0000-000000000001' AND g.name = 'Administrador'
ON CONFLICT (tenant_id, username) DO NOTHING;

-- Parámetros del negocio
INSERT INTO business_settings (tenant_id, business_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Restaurante Demo')
ON CONFLICT (tenant_id) DO NOTHING;

-- Métodos de pago del manual (§1.7.7) + legacy PHP inactivos (Fase 4,
-- necesarios para migrar ventas históricas con tarjeta/nequi/etc.)
INSERT INTO payment_methods (tenant_id, name, is_active, is_legacy) VALUES
  ('00000000-0000-0000-0000-000000000001', 'EFECTIVO',          true,  false),
  ('00000000-0000-0000-0000-000000000001', 'TRANSFERENCIA',     true,  false),
  ('00000000-0000-0000-0000-000000000001', 'CUENTA POR COBRAR', true,  false),
  ('00000000-0000-0000-0000-000000000001', 'TARJETA',           false, true),
  ('00000000-0000-0000-0000-000000000001', 'NEQUI',             false, true),
  ('00000000-0000-0000-0000-000000000001', 'DAVIPLATA',         false, true),
  ('00000000-0000-0000-0000-000000000001', 'RAPPI',             false, true)
ON CONFLICT (tenant_id, name) DO NOTHING;

-- Denominaciones de moneda COP (§1.7.8 — atajos de pago)
INSERT INTO currency_denominations (tenant_id, value)
SELECT '00000000-0000-0000-0000-000000000001', v
FROM (VALUES (1000), (2000), (5000), (10000), (20000), (50000), (100000)) AS d(v)
WHERE NOT EXISTS (
  SELECT 1 FROM currency_denominations
  WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
);

-- Sala y mesas demo
INSERT INTO rooms (tenant_id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Sala Principal')
ON CONFLICT (tenant_id, name) DO NOTHING;

-- Sala de sistema DOMICILIO (protegida, igual a Polaris §1.7.1)
INSERT INTO rooms (tenant_id, name, is_active, is_system)
VALUES ('00000000-0000-0000-0000-000000000001', 'DOMICILIO', true, true)
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO tables (tenant_id, room_id, number, seats)
SELECT '00000000-0000-0000-0000-000000000001', r.id, n, 4
FROM rooms r, generate_series(1, 5) AS n
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND r.name = 'Sala Principal'
ON CONFLICT (tenant_id, room_id, number) DO NOTHING;

-- Caja inicial (PHP era caja única; el manual exige al menos una)
INSERT INTO cash_registers (tenant_id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Caja Principal')
ON CONFLICT (tenant_id, name) DO NOTHING;

-- Objetivos (solo editables — debe existir la fila, §1.7.5)
INSERT INTO objectives (tenant_id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (tenant_id) DO NOTHING;
