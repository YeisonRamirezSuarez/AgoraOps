/**
 * Autenticación — manual §1.3, §1.16.
 * Origen PHP: api/iniciar_sesion.php, cambiar_password.php,
 * verificar_password.php.
 * - Usuario case-sensitive; mensajes: credenciales inválidas,
 *   restaurante inactivo, usuario bloqueado.
 * - must_change_password = concepto PHP "cambia" (clave por defecto).
 * - Cambio de contraseña: requiere la anterior y rechaza claves usadas
 *   antes (password_history, §1.16).
 */
import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query, queryOne } from "../db.js";
import { requireAuth, signToken } from "../middleware/auth.js";
import { config } from "../config.js";
import { sendPasswordResetEmail } from "../lib/mailer.js";
import { rateLimit } from "../lib/rateLimit.js";

export const authRouter = Router();

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Usuario y contraseña son obligatorios" });
    return;
  }
  const { username, password } = parsed.data;

  // Comparación exacta (= case-sensitive, manual §1.3.3). El username es ÚNICO
  // globalmente (índice users_username_global_key, mig 00050), así que buscar
  // por username solo es inequívoco aunque haya varios restaurantes.
  const user = await queryOne<{
    id: string;
    tenant_id: string | null;
    username: string;
    password_hash: string;
    full_name: string;
    is_locked: boolean;
    is_active: boolean;
    is_super_admin: boolean;
    must_change_password: boolean;
    group_name: string | null;
    role_type: "administrador" | "empleado" | null;
    tenant_active: boolean | null;
  }>(
    `SELECT u.*, g.name AS group_name, g.role_type, t.is_active AS tenant_active
     FROM users u
     LEFT JOIN groups g ON g.id = u.group_id
     LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE u.username = $1`,
    [username],
  );

  const invalid = () =>
    res.status(401).json({ error: "Usuario o contraseña incorrectos." });

  if (!user || !user.is_active) return invalid();

  if (user.is_locked) {
    res.status(403).json({ error: "El usuario se encuentra bloqueado." });
    return;
  }

  if (user.tenant_id && user.tenant_active === false) {
    res.status(403).json({
      error: "El restaurante se encuentra inactivo. Contacte al administrador.",
    });
    return;
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return invalid();

  // Última conexión (consumo por establecimiento en el panel Super Admin)
  await query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);

  const token = signToken({
    id: user.id,
    tenantId: user.tenant_id,
    username: user.username,
    fullName: user.full_name,
    groupName: user.group_name,
    roleType: user.role_type,
    isSuperAdmin: user.is_super_admin,
    mustChangePassword: user.must_change_password,
  });

  res.json({
    token,
    mustChangePassword: user.must_change_password,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      groupName: user.group_name,
      roleType: user.role_type,
      isSuperAdmin: user.is_super_admin,
    },
  });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
  confirmPassword: z.string().min(1),
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Todos los campos son obligatorios (mínimo 8 caracteres).",
    });
    return;
  }
  const { currentPassword, newPassword, confirmPassword } = parsed.data;

  if (newPassword !== confirmPassword) {
    res.status(400).json({
      error: "La nueva contraseña y su confirmación no coinciden.",
    });
    return;
  }

  const user = await queryOne<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id = $1",
    [req.user!.id],
  );
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    res.status(400).json({ error: "La contraseña anterior no coincide." });
    return;
  }

  // §1.16: la nueva contraseña no puede haberse usado antes
  const history = await query<{ password_hash: string }>(
    "SELECT password_hash FROM password_history WHERE user_id = $1",
    [req.user!.id],
  );
  for (const h of [...history, user]) {
    if (await bcrypt.compare(newPassword, h.password_hash)) {
      res.status(400).json({
        error: "La nueva contraseña ya fue utilizada anteriormente.",
      });
      return;
    }
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await query(
    "INSERT INTO password_history (user_id, password_hash) SELECT id, password_hash FROM users WHERE id = $1",
    [req.user!.id],
  );
  await query(
    "UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2",
    [newHash, req.user!.id],
  );

  // Token nuevo sin la marca de clave temporal (el anterior queda bloqueado
  // por requireAuth). Se reconstruye el payload sin iat/exp del JWT viejo.
  const u = req.user!;
  const token = signToken({
    id: u.id,
    tenantId: u.tenantId,
    username: u.username,
    fullName: u.fullName,
    groupName: u.groupName,
    roleType: u.roleType,
    isSuperAdmin: u.isSuperAdmin,
    mustChangePassword: false,
  });

  res.json({ ok: true, token });
});

/* ─────────── Recuperación de contraseña por correo (público) ─────────── */

const forgotSchema = z.object({ username: z.string().min(1) });

// Respuesta genérica SIEMPRE: no revela si el usuario/correo existe.
const GENERIC_FORGOT =
  "Si el usuario existe, enviamos un correo con el enlace para restablecer la contraseña.";

// Rate-limit por IP: máx 5 solicitudes cada 15 min (mitiga abuso/enumeración).
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message:
    "Demasiados intentos de recuperación. Espera unos minutos e inténtalo de nuevo.",
});

authRouter.post("/forgot-password", forgotLimiter, async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "El usuario es obligatorio." });
    return;
  }
  const { username } = parsed.data;

  // Username case-sensitive (igual que el login); solo usuarios activos.
  const user = await queryOne<{ id: string; email: string; full_name: string }>(
    "SELECT id, email, full_name FROM users WHERE username = $1 AND is_active = true",
    [username],
  );

  if (user) {
    // Cooldown por cuenta (en BD, válido entre instancias serverless): no se
    // reenvía si ya se generó un token para este usuario hace < 60 s. Evita
    // bombardear el correo de una víctima aunque varíe el IP.
    const recent = await queryOne(
      `SELECT 1 FROM password_resets
        WHERE user_id = $1 AND created_at > now() - interval '60 seconds'
        LIMIT 1`,
      [user.id],
    );
    if (!recent) {
      // Token de un solo uso (se guarda el hash); invalida tokens previos.
      const token = crypto.randomBytes(32).toString("hex");
      await query(
        "DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL",
        [user.id],
      );
      await query(
        `INSERT INTO password_resets (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '1 hour')`,
        [user.id, sha256(token)],
      );
      const resetUrl = `${config.appUrl}/restablecer?token=${token}`;
      try {
        await sendPasswordResetEmail(user.email, user.full_name, resetUrl);
      } catch (err) {
        // No se filtra al cliente; se registra para diagnóstico del servidor.
        console.error("[forgot-password] fallo enviando correo:", err);
      }
    }
  }

  res.json({ ok: true, message: GENERIC_FORGOT });
});

const resetSchema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(8),
  confirmPassword: z.string().min(1),
});

authRouter.post("/reset-password", async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "La nueva contraseña debe tener al menos 8 caracteres.",
    });
    return;
  }
  const { token, newPassword, confirmPassword } = parsed.data;

  if (newPassword !== confirmPassword) {
    res.status(400).json({
      error: "La nueva contraseña y su confirmación no coinciden.",
    });
    return;
  }

  // Token válido = existe, no usado y no vencido.
  const reset = await queryOne<{ id: string; user_id: string; password_hash: string }>(
    `SELECT pr.id, pr.user_id, u.password_hash
       FROM password_resets pr
       JOIN users u ON u.id = pr.user_id
      WHERE pr.token_hash = $1 AND pr.used_at IS NULL AND pr.expires_at > now()`,
    [sha256(token)],
  );
  if (!reset) {
    res.status(400).json({
      error: "El enlace es inválido o ya expiró. Solicita uno nuevo.",
    });
    return;
  }

  // §1.16: la nueva contraseña no puede haberse usado antes.
  const history = await query<{ password_hash: string }>(
    "SELECT password_hash FROM password_history WHERE user_id = $1",
    [reset.user_id],
  );
  for (const h of [...history, { password_hash: reset.password_hash }]) {
    if (await bcrypt.compare(newPassword, h.password_hash)) {
      res.status(400).json({
        error: "La nueva contraseña ya fue utilizada anteriormente.",
      });
      return;
    }
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await query(
    "INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)",
    [reset.user_id, reset.password_hash],
  );
  await query(
    "UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2",
    [newHash, reset.user_id],
  );
  // Marca el token usado e invalida cualquier otro pendiente del usuario.
  await query(
    "UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
    [reset.user_id],
  );

  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  // must_change_password autoritativo de BD: cubre tokens viejos y claves
  // restablecidas por el Super Admin durante una sesión activa.
  const row = await queryOne<{ must_change_password: boolean }>(
    "SELECT must_change_password FROM users WHERE id = $1",
    [req.user!.id],
  );
  res.json({ ...req.user, mustChangePassword: row?.must_change_password ?? false });
});
