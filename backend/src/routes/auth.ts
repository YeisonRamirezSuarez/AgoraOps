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
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query, queryOne } from "../db.js";
import { requireAuth, signToken } from "../middleware/auth.js";

export const authRouter = Router();

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

  // Comparación exacta (= case-sensitive, manual §1.3.3)
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

authRouter.get("/me", requireAuth, async (req, res) => {
  // must_change_password autoritativo de BD: cubre tokens viejos y claves
  // restablecidas por el Super Admin durante una sesión activa.
  const row = await queryOne<{ must_change_password: boolean }>(
    "SELECT must_change_password FROM users WHERE id = $1",
    [req.user!.id],
  );
  res.json({ ...req.user, mustChangePassword: row?.must_change_password ?? false });
});
