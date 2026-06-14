-- =============================================================
-- 00045: Security scoping & hardening
-- =============================================================
-- ⚠️ RECONSTRUIDA desde el estado en vivo de la BD (2026-06-14). El
-- archivo original se aplicó a producción desde otra copia del código
-- que no llegó a este repositorio; se regenera leyendo el esquema real
-- para que una BD nueva reproduzca el mismo endurecimiento.
--
-- Contenido verificado en la BD: Row Level Security ENABLE (no FORCE) en
-- TODAS las tablas de public. Sin políticas (0 policies) → para los roles
-- anon/authenticated de Supabase (PostgREST) el acceso directo queda
-- denegado por defecto, mientras la API sigue operando porque conecta
-- como `postgres` (owner), que NO está sujeto a RLS salvo FORCE. Esto es
-- el "aislamiento por API, no por RLS" del proyecto: RLS actúa como cinturón
-- de seguridad contra accesos directos, no como filtro de tenant.
--
-- Se activa con un bucle sobre las tablas existentes al momento de aplicar:
-- en una BD nueva cubre todo lo creado hasta aquí; login_attempts (00048)
-- habilita su propio RLS en su migración, al crearse después.
-- =============================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
