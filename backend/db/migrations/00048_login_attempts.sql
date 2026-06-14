-- =============================================================
-- 00048: registro de intentos de login (rate-limit / anti-fuerza-bruta)
-- =============================================================
-- ⚠️ RECONSTRUIDA desde el estado en vivo de la BD (2026-06-14); el archivo
-- original no llegó a este repositorio (ver 00045).
--
-- Verificado en la BD: tabla login_attempts + índice por (purpose,
-- identifier, attempted_at) para contar intentos recientes por
-- propósito/identificador. RLS habilitado igual que el resto (ver 00045);
-- como se crea después de 00045, se activa aquí.
--
-- NOTA: este checkout aún NO contiene el código de app que escribe en
-- login_attempts (auth.ts local usa rate-limit en memoria, lib/rateLimit.ts).
-- La tabla queda disponible para cuando ese código se incorpore.
-- =============================================================

CREATE TABLE IF NOT EXISTS login_attempts (
  id           BIGSERIAL PRIMARY KEY,
  purpose      TEXT NOT NULL,
  identifier   TEXT NOT NULL,
  ip           TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts
  ON login_attempts (purpose, identifier, attempted_at);

ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
