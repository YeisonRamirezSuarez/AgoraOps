-- Restablecimiento de contraseña por correo (login → "¿Restablecer contraseña?").
-- Se guarda solo el HASH del token (sha256), nunca el token en claro; el enlace
-- del correo lleva el token original. Tokens de un solo uso y con expiración.
CREATE TABLE password_resets (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,                 -- sha256(token) en hex
  expires_at  TIMESTAMPTZ NOT NULL,          -- típicamente now() + 1 hora
  used_at     TIMESTAMPTZ,                   -- NULL = aún válido
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_password_resets_user ON password_resets(user_id);
CREATE INDEX idx_password_resets_token ON password_resets(token_hash);
