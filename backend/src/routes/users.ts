/**
 * Seguridad → Usuarios — manual §1.13.
 * Origen PHP: registrar_usuario.php (clave por defecto), editar_usuario,
 * eliminar_usuario, obtener_usuarios. Incluye la sugerencia de nombres
 * cuando el usuario está duplicado (§1.13 Nombre duplicados).
 */
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query, queryOne } from "../db.js";
import { dbErrorMessage } from "../lib/crud.js";
import { TEMP_PASSWORD } from "../lib/constants.js";
import { generateUsername } from "../lib/username.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

export const usersRouter = Router();
usersRouter.use(requireAuth, requireAdmin);

usersRouter.get("/", async (req, res) => {
  const rows = await query(
    `SELECT u.id, u.username, u.email, u.full_name, u.phone, u.group_id,
            g.name AS group_name, g.role_type, u.is_worker, u.is_locked,
            u.is_active, u.created_at
     FROM users u LEFT JOIN groups g ON g.id = u.group_id
     WHERE u.tenant_id = $1 ORDER BY u.full_name`,
    [req.user!.tenantId],
  );
  res.json(rows);
});

const userSchema = z.object({
  email: z.string().email("Correo inválido"),
  fullName: z.string().min(1),
  phone: z.string().optional(),
  groupId: z.number(),
  isWorker: z.boolean().default(false),
});

usersRouter.post("/", async (req, res) => {
  const parsed = userSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Complete todos los campos requeridos" });
    return;
  }
  const d = parsed.data;

  // El username ya NO se escribe: se genera automáticamente desde el nombre
  // (inicial + apellido) y es único globalmente, evitando el prueba y error de
  // elegir nombres ya tomados. La contraseña temporal es fija (TEMP_PASSWORD) y
  // se fuerza su cambio en el primer ingreso.
  const username = await generateUsername(d.fullName);
  const hash = await bcrypt.hash(TEMP_PASSWORD, 10);

  try {
    const row = await queryOne(
      `INSERT INTO users (tenant_id, username, email, password_hash, full_name,
         phone, group_id, is_worker, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
       RETURNING id, username, email, full_name, is_worker`,
      [
        req.user!.tenantId, username, d.email, hash, d.fullName,
        d.phone ?? null, d.groupId, d.isWorker,
      ],
    );
    res.status(201).json({
      ...row,
      defaultPassword: TEMP_PASSWORD,
      // §1.13: si es trabajador, recordar asignarle horario
      workerReminder: d.isWorker
        ? "Recuerde asignar un horario al trabajador en Configuración → Horarios."
        : null,
    });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

usersRouter.put("/:id", async (req, res) => {
  const parsed = userSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  const d = parsed.data;
  try {
    const row = await queryOne(
      `UPDATE users SET
         email = COALESCE($3, email),
         full_name = COALESCE($4, full_name),
         phone = COALESCE($5, phone),
         group_id = COALESCE($6, group_id),
         is_worker = COALESCE($7, is_worker),
         is_locked = COALESCE($8, is_locked),
         is_active = COALESCE($9, is_active)
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, username, email, full_name, is_worker`,
      [
        req.params.id, req.user!.tenantId, d.email ?? null, d.fullName ?? null,
        d.phone ?? null, d.groupId ?? null, d.isWorker ?? null,
        (req.body.isLocked as boolean | undefined) ?? null,
        (req.body.isActive as boolean | undefined) ?? null,
      ],
    );
    if (!row) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

usersRouter.delete("/:id", async (req, res) => {
  if (req.params.id === req.user!.id) {
    res.status(400).json({ error: "No puede eliminar su propio usuario" });
    return;
  }
  try {
    const row = await queryOne(
      "DELETE FROM users WHERE id = $1 AND tenant_id = $2 RETURNING id",
      [req.params.id, req.user!.tenantId],
    );
    if (!row) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** §1.15 Grupos/Usuarios: buscar usuarios por rol. */
usersRouter.get("/by-group/:groupId", async (req, res) => {
  const rows = await query(
    `SELECT u.id, u.username, u.full_name, u.email
     FROM users u WHERE u.tenant_id = $1 AND u.group_id = $2
     ORDER BY u.full_name`,
    [req.user!.tenantId, req.params.groupId],
  );
  res.json(rows);
});
