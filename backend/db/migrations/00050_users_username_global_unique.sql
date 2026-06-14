-- =============================================================
-- 00050: username ÚNICO GLOBALMENTE (no por tenant)
-- =============================================================
-- Decisión de producto (2026-06-14): el login es por username solo, desde un
-- único enlace para todos los establecimientos. Para que esa búsqueda sea
-- inequívoca, el username debe ser único en TODA la plataforma, no solo dentro
-- del tenant. Antes existía únicamente UNIQUE(tenant_id, username), por lo que
-- "admin"/"carlos" podían repetirse entre restaurantes y el login devolvía una
-- fila al azar (lockout del tenant equivocado + riesgo de entrar a otro tenant).
--
-- Índice case-sensitive (igual que el login, manual §1.3.3): a la fecha no hay
-- duplicados exactos, así que se crea sin conflicto. Cubre también al super
-- admin (tenant_id NULL). La validación en la app (users.ts y superadmin.ts)
-- devuelve un 409 amigable; este índice es el respaldo a nivel de BD.
-- =============================================================

CREATE UNIQUE INDEX IF NOT EXISTS users_username_global_key ON users (username);
