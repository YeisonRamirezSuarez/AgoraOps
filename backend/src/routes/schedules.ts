/**
 * Horarios (Malla de Horarios) — réplica de Polaris (Configuración
 * restaurante → Horarios, verificado en QA 2026-06-13).
 *
 *  - Horarios Base (schedule_templates): turnos hora_inicio–hora_fin. El
 *    nombre se autogenera en el cliente como "Turno (HH:MM - HH:MM)". Borrar
 *    un preset arrastra en cascada todas sus asignaciones (migración 00037).
 *  - Asignaciones (schedules): empleado (trabajador activo) + turno + fecha.
 *    Validaciones con los mensajes exactos del QA:
 *      · duplicado exacto (mismo empleado+turno+día) → "No se pudo guardar
 *        la asignación laboral".
 *      · cruce de horarios (mismo empleado+día, franjas que se solapan) →
 *        "Cruce de Horarios" con el detalle nuevo vs existente.
 *  - El calendario carga por rango de fechas (vistas Mes/Semana/Día).
 */
import { Router } from "express";
import { z } from "zod";
import { query, queryOne } from "../db.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

export const schedulesRouter = Router();
schedulesRouter.use(requireAuth, requireAdmin);

/* ───────────────────────── Horarios Base (presets) ───────────────────────── */

schedulesRouter.get("/presets", async (req, res) => {
  const rows = await query(
    `SELECT id,
            to_char(start_time, 'HH24:MI') AS start_time,
            to_char(end_time,   'HH24:MI') AS end_time
       FROM schedule_templates
      WHERE tenant_id = $1
      ORDER BY start_time, end_time`,
    [req.user!.tenantId],
  );
  res.json(rows);
});

schedulesRouter.post("/presets", async (req, res) => {
  const schema = z.object({
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Indica la hora de inicio y la hora de fin." });
    return;
  }
  const { startTime, endTime } = parsed.data;
  if (endTime <= startTime) {
    res.status(400).json({ error: "La hora de fin debe ser mayor que la hora de inicio." });
    return;
  }
  const row = await queryOne(
    `INSERT INTO schedule_templates (tenant_id, start_time, end_time)
     VALUES ($1, $2, $3)
     RETURNING id, to_char(start_time,'HH24:MI') AS start_time,
               to_char(end_time,'HH24:MI') AS end_time`,
    [req.user!.tenantId, startTime, endTime],
  );
  res.status(201).json(row);
});

// Borra el preset y, en cascada (FK 00037), todas sus asignaciones
schedulesRouter.delete("/presets/:id", async (req, res) => {
  const row = await queryOne(
    `DELETE FROM schedule_templates WHERE id = $1 AND tenant_id = $2 RETURNING id`,
    [req.params.id, req.user!.tenantId],
  );
  if (!row) {
    res.status(404).json({ error: "No fue posible eliminar el horario base." });
    return;
  }
  res.json({ ok: true });
});

/* ───────────────────────── Empleados (trabajadores activos) ───────────────────────── */

schedulesRouter.get("/employees", async (req, res) => {
  const rows = await query(
    `SELECT u.id, u.full_name, u.username,
            COALESCE(g.name, '—') AS role
       FROM users u
       LEFT JOIN groups g ON g.id = u.group_id
      WHERE u.tenant_id = $1 AND u.is_worker = true AND u.is_active = true
      ORDER BY u.full_name`,
    [req.user!.tenantId],
  );
  res.json(rows);
});

/* ───────────────────────── Asignaciones (schedules) ───────────────────────── */

// Calendario por rango de fechas (from/to inclusive)
schedulesRouter.get("/", async (req, res) => {
  const schema = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Rango de fechas inválido" });
    return;
  }
  const rows = await query(
    `SELECT s.id, to_char(s.date, 'YYYY-MM-DD') AS date,
            s.template_id, s.user_id,
            to_char(t.start_time, 'HH24:MI') AS start_time,
            to_char(t.end_time,   'HH24:MI') AS end_time,
            u.full_name AS user_name, u.username,
            COALESCE(g.name, '—') AS role
       FROM schedules s
       JOIN schedule_templates t ON t.id = s.template_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN groups g ON g.id = u.group_id
      WHERE s.tenant_id = $1 AND s.date BETWEEN $2 AND $3
      ORDER BY t.start_time, u.full_name`,
    [req.user!.tenantId, parsed.data.from, parsed.data.to],
  );
  res.json(rows);
});

const assignSchema = z.object({
  userId: z.string().uuid(),
  templateId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Valida duplicado exacto y cruce de horarios; devuelve el mensaje exacto de
 *  Polaris o null si la asignación es válida. excludeId omite la propia fila
 *  (al editar). */
async function validateAssignment(
  tenantId: string | null,
  userId: string, templateId: number, date: string, excludeId: number | null,
): Promise<string | null> {
  // El turno debe existir (y obtener sus horas)
  const tpl = await queryOne<{ start_time: string; end_time: string }>(
    `SELECT to_char(start_time,'HH24:MI') AS start_time,
            to_char(end_time,'HH24:MI') AS end_time
       FROM schedule_templates WHERE id = $1 AND tenant_id = $2`,
    [templateId, tenantId],
  );
  if (!tpl) return "No se pudo guardar la asignación laboral";

  // 1) Duplicado exacto: mismo empleado + turno + día (Polaris: mensaje genérico)
  const dup = await queryOne(
    `SELECT id FROM schedules
      WHERE tenant_id = $1 AND user_id = $2 AND template_id = $3 AND date = $4
        AND ($5::int IS NULL OR id <> $5::int)`,
    [tenantId, userId, templateId, date, excludeId],
  );
  if (dup) return "No se pudo guardar la asignación laboral";

  // 2) Cruce: mismo empleado + día con franja que se solapa (start < ne && end > ns)
  const clash = await queryOne<{ st: string; en: string }>(
    `SELECT to_char(t.start_time,'HH24:MI') AS st, to_char(t.end_time,'HH24:MI') AS en
       FROM schedules s JOIN schedule_templates t ON t.id = s.template_id
      WHERE s.tenant_id = $1 AND s.user_id = $2 AND s.date = $3
        AND t.start_time < $5::time AND t.end_time > $4::time
        AND ($6::int IS NULL OR s.id <> $6::int)
      ORDER BY t.start_time
      LIMIT 1`,
    [tenantId, userId, date, tpl.start_time, tpl.end_time, excludeId],
  );
  if (clash) {
    const [y, m, d] = date.split("-");
    const dm = `${d}/${m}`;
    return "Cruce de Horarios\n" +
      "El empleado ya tiene asignado un turno que se cruza con el horario seleccionado:\n" +
      `${dm} (${tpl.start_time} - ${tpl.end_time}) vs ${dm} (${clash.st} - ${clash.en})\n` +
      "Por favor, ajusta los horarios para evitar el cruce.";
  }
  return null;
}

schedulesRouter.post("/", async (req, res) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "No se pudo guardar la asignación laboral" });
    return;
  }
  const { userId, templateId, date } = parsed.data;
  const error = await validateAssignment(req.user!.tenantId, userId, templateId, date, null);
  if (error) {
    res.status(409).json({ error });
    return;
  }
  try {
    const row = await queryOne(
      `INSERT INTO schedules (tenant_id, user_id, template_id, date)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user!.tenantId, userId, templateId, date],
    );
    res.status(201).json({ ok: true, id: row!.id });
  } catch {
    res.status(409).json({ error: "No se pudo guardar la asignación laboral" });
  }
});

schedulesRouter.put("/:id", async (req, res) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "No se pudo guardar la asignación laboral" });
    return;
  }
  const id = Number(req.params.id);
  const { userId, templateId, date } = parsed.data;
  const error = await validateAssignment(req.user!.tenantId, userId, templateId, date, id);
  if (error) {
    res.status(409).json({ error });
    return;
  }
  const row = await queryOne(
    `UPDATE schedules SET user_id = $3, template_id = $4, date = $5
      WHERE id = $1 AND tenant_id = $2 RETURNING id`,
    [id, req.user!.tenantId, userId, templateId, date],
  );
  if (!row) {
    res.status(404).json({ error: "Asignación no encontrada" });
    return;
  }
  res.json({ ok: true });
});

schedulesRouter.delete("/:id", async (req, res) => {
  const row = await queryOne(
    `DELETE FROM schedules WHERE id = $1 AND tenant_id = $2 RETURNING id`,
    [req.params.id, req.user!.tenantId],
  );
  if (!row) {
    res.status(404).json({ error: "Asignación no encontrada" });
    return;
  }
  res.json({ ok: true });
});
