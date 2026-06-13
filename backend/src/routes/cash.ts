/**
 * Gestión de Cajas — manual §1.8.3–1.8.4.
 * Origen PHP: AbrirCaja.php (pulse), cierreCaja.php, registrar_entrada/
 * salida, obtenerValoresParaCierre, obtenerSalidasIngresos.
 * El CRUD de cajas vive en /catalogs/cash-registers; aquí van las
 * sesiones (apertura/cierre), entradas/salidas y el reporte.
 */
import { Router } from "express";
import { z } from "zod";
import { readdirSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { query, queryOne } from "../db.js";
import { dbErrorMessage } from "../lib/crud.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

export const cashRouter = Router();
cashRouter.use(requireAuth, requireAdmin);

// Carpeta con los instaladores del servicio de impresión (servida estática
// en /print-service desde index.ts). Resuelta relativa a la raíz de backend
// (funciona tanto en src/ con tsx como en dist/).
export const INSTALLERS_DIR = join(
  dirname(fileURLToPath(import.meta.url)), "..", "..", "print-service-installers",
);

/** Aislamiento multi-tenant: toda ruta con :id opera sobre una sesión de
 * caja; se valida una vez que pertenezca al tenant del JWT antes de
 * ejecutar el handler o las funciones SQL (close_cash_session…). */
cashRouter.param("id", (req, res, next, id) => {
  queryOne("SELECT id FROM cash_sessions WHERE id = $1 AND tenant_id = $2", [
    id,
    req.user!.tenantId,
  ])
    .then((session) => {
      if (!session) {
        res.status(404).json({ error: "Sesión no encontrada" });
        return;
      }
      next();
    })
    .catch(next);
});

/* ═══════════ Descargar servicio de impresión (§1.8.5) — réplica de Polaris
   (blank_descarga_servicios): lista los instaladores disponibles en la
   carpeta del servidor con su metadata. La descarga la sirve el estático
   /print-service (index.ts). ═══════════ */
cashRouter.get("/print-service", (_req, res) => {
  let files: { name: string; size: number; type: string; date: string }[] = [];
  try {
    files = readdirSync(INSTALLERS_DIR)
      .filter((n) => !n.startsWith(".") && n.toLowerCase() !== "readme.md")
      .map((name) => {
        const st = statSync(join(INSTALLERS_DIR, name));
        return st.isFile()
          ? {
              name,
              size: st.size,
              type: (extname(name).slice(1) || "—").toUpperCase(),
              date: st.mtime.toISOString(),
            }
          : null;
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);
  } catch {
    files = []; // carpeta inexistente → sin archivos
  }
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  res.json({ files, count: files.length, totalSize });
});

/* ═════════════ Cajas (§1.8.2) — CRUD con auditoría, réplica de Polaris
   (grid_public_cash_registers + form_public_cash_registers). El nombre es
   inmutable; el estado solo cambia con la caja cerrada y solo se elimina si
   nunca fue abierta (triggers de 00012). Estado: FUNCIONANDO/FALLANDO. ═══ */
cashRouter.get("/registers", async (req, res) => {
  const rows = await query(
    `SELECT cr.id, cr.name, cr.status, cr.note,
            bs.business_name AS restaurant_name,
            cr.created_at, cr.updated_at,
            cu.full_name AS created_by_name,
            uu.full_name AS updated_by_name
     FROM cash_registers cr
     LEFT JOIN business_settings bs ON bs.tenant_id = cr.tenant_id
     LEFT JOIN users cu ON cu.id = cr.created_by
     LEFT JOIN users uu ON uu.id = cr.updated_by
     WHERE cr.tenant_id = $1
     ORDER BY cr.id`,
    [req.user!.tenantId],
  );
  res.json(rows);
});

const REGISTER_STATUS = z.enum(["FUNCIONANDO", "FALLANDO"]);

cashRouter.post("/registers", async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(1, "Nombre de la caja: Campo obligatorio").max(50),
    status: REGISTER_STATUS.default("FUNCIONANDO"),
    note: z.string().trim().min(1, "Nota: Campo obligatorio").max(250),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
    return;
  }
  const { name, status, note } = parsed.data;
  try {
    const row = await queryOne(
      `INSERT INTO cash_registers (tenant_id, name, status, note, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user!.tenantId, name, status, note, req.user!.id],
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

// El nombre es inmutable (Polaris): solo se actualizan estado y nota.
cashRouter.put("/registers/:rid", async (req, res) => {
  const schema = z.object({
    status: REGISTER_STATUS,
    note: z.string().trim().min(1, "Nota: Campo obligatorio").max(250),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
    return;
  }
  try {
    const row = await queryOne(
      `UPDATE cash_registers SET status = $3, note = $4,
              updated_by = $5, updated_at = now()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.rid, req.user!.tenantId, parsed.data.status, parsed.data.note, req.user!.id],
    );
    if (!row) {
      res.status(404).json({ error: "Caja no encontrada" });
      return;
    }
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

cashRouter.delete("/registers/:rid", async (req, res) => {
  try {
    const row = await queryOne(
      "DELETE FROM cash_registers WHERE id = $1 AND tenant_id = $2 RETURNING id",
      [req.params.rid, req.user!.tenantId],
    );
    if (!row) {
      res.status(404).json({ error: "Caja no encontrada" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** Cajas con su sesión abierta (si existe) + total en efectivo actual
 * (columna "Total" de la lista Apertura/Cierre estilo Polaris). */
cashRouter.get("/sessions", async (req, res) => {
  const rows = await query(
    `SELECT cr.id AS cash_register_id, cr.name, cr.status AS register_status,
            cs.id AS session_id, cs.status, cs.opening_amount, cs.opened_at,
            cs.user_name, cs.responsible_name, cs.opening_note,
            cash_session_balance(cs.id) AS current_total
     FROM cash_registers cr
     LEFT JOIN cash_sessions cs
       ON cs.cash_register_id = cr.id AND cs.status = 'abierta'
     WHERE cr.tenant_id = $1
     ORDER BY cr.name`,
    [req.user!.tenantId],
  );
  res.json(rows);
});

/** Abrir caja (§1.8.3): caja, responsable, dinero de apertura y nota
 * obligatoria (formulario "Abrir caja" estilo Polaris). */
cashRouter.post("/sessions", async (req, res) => {
  const schema = z.object({
    cashRegisterId: z.number(),
    openingAmount: z.number().min(0),
    responsibleId: z.string().min(1, "El responsable de la caja es obligatorio"),
    note: z.string().min(1, "La nota es obligatoria"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Complete todos los campos requeridos" });
    return;
  }
  const responsible = await queryOne<{ full_name: string }>(
    "SELECT full_name FROM users WHERE id = $1 AND tenant_id = $2",
    [parsed.data.responsibleId, req.user!.tenantId],
  );
  if (!responsible) {
    res.status(404).json({ error: "El responsable seleccionado no existe" });
    return;
  }
  try {
    const row = await queryOne(
      `INSERT INTO cash_sessions (tenant_id, cash_register_id, user_id, user_name,
         opening_amount, responsible_id, responsible_name, opening_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        req.user!.tenantId, parsed.data.cashRegisterId, req.user!.id,
        req.user!.fullName, parsed.data.openingAmount,
        parsed.data.responsibleId, responsible.full_name, parsed.data.note,
      ],
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** Valores para el cierre y el informe de caja (PHP:
 * obtenerValoresParaCierre): desglose por método con propinas y nº de
 * transacciones, entradas/salidas y datos del establecimiento. */
cashRouter.get("/sessions/:id/summary", async (req, res) => {
  const session = await queryOne(
    `SELECT cs.*, cr.name AS register_name
     FROM cash_sessions cs
     JOIN cash_registers cr ON cr.id = cs.cash_register_id
     WHERE cs.id = $1 AND cs.tenant_id = $2`,
    [req.params.id, req.user!.tenantId],
  );
  if (!session) {
    res.status(404).json({ error: "Sesión no encontrada" });
    return;
  }
  const [byMethod, transactions, business] = await Promise.all([
    query(
      `SELECT pm.name, SUM(op.amount - op.change_given) AS total,
              SUM(op.tip_included) AS tips, COUNT(*) AS tx_count
       FROM order_payments op
       JOIN orders o ON o.id = op.order_id
       JOIN payment_methods pm ON pm.id = op.payment_method_id
       WHERE o.cash_session_id = $1
       GROUP BY pm.name ORDER BY pm.name`,
      [req.params.id],
    ),
    query(
      "SELECT * FROM cash_transactions WHERE cash_session_id = $1 ORDER BY created_at",
      [req.params.id],
    ),
    queryOne(
      "SELECT business_name, tax_id, address, phone FROM business_settings WHERE tenant_id = $1",
      [req.user!.tenantId],
    ),
  ]);
  res.json({ session, byMethod, transactions, business });
});

/** Cerrar caja: efectivo contado + nota obligatoria (§1.8.3). */
cashRouter.post("/sessions/:id/close", async (req, res) => {
  const schema = z.object({
    countedCash: z.number({
      required_error: "El campo Efectivo contado es obligatorio para cerrar la caja",
      invalid_type_error: "El campo Efectivo contado es obligatorio para cerrar la caja",
    }).min(0),
    note: z.string().min(1, "El campo Nota es obligatorio para cerrar la caja"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
    return;
  }
  try {
    await query("SELECT close_cash_session($1, $2, $3)", [
      req.params.id, parsed.data.countedCash, parsed.data.note,
    ]);
    const session = await queryOne(
      "UPDATE cash_sessions SET closed_by_name = $2 WHERE id = $1 RETURNING *",
      [req.params.id, req.user!.fullName],
    );
    res.json(session);
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** Movimientos detallados de la sesión (Reporte de cajas → Detalles):
 * ventas por método (COMBINADO si la orden tuvo varios pagos) +
 * entradas/salidas manuales, en orden cronológico. */
cashRouter.get("/sessions/:id/movements", async (req, res) => {
  const session = await queryOne(
    "SELECT id FROM cash_sessions WHERE id = $1 AND tenant_id = $2",
    [req.params.id, req.user!.tenantId],
  );
  if (!session) {
    res.status(404).json({ error: "Sesión no encontrada" });
    return;
  }
  const rows = await query(
    `SELECT cr.name AS register_name, m.type, m.reason, m.created_by,
            m.created_at, m.amount
     FROM (
       SELECT o.cash_session_id, 'ENTRADA' AS type,
              'VENTA / ' || CASE WHEN COUNT(*) OVER (PARTITION BY op.order_id) > 1
                                 THEN 'COMBINADO' ELSE pm.name END AS reason,
              o.attended_by AS created_by, op.created_at,
              (op.amount - op.change_given) AS amount
       FROM order_payments op
       JOIN orders o ON o.id = op.order_id
       JOIN payment_methods pm ON pm.id = op.payment_method_id
       WHERE o.cash_session_id = $1
       UNION ALL
       SELECT ct.cash_session_id, ct.type, ct.reason, ct.user_name, ct.created_at, ct.amount
       FROM cash_transactions ct
       WHERE ct.cash_session_id = $1
     ) m
     JOIN cash_sessions cs ON cs.id = m.cash_session_id
     JOIN cash_registers cr ON cr.id = cs.cash_register_id
     ORDER BY m.created_at`,
    [req.params.id],
  );
  res.json(rows);
});

/** Entradas y salidas de dinero (§1.8.3; PHP: transacciones). */
cashRouter.post("/sessions/:id/transactions", async (req, res) => {
  const schema = z.object({
    type: z.enum(["ENTRADA", "SALIDA"]),
    reason: z.string().min(1),
    amount: z.number().positive("El monto no puede ser 0"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Complete todos los campos; el monto debe ser mayor a 0" });
    return;
  }

  // §1.8.3: la salida no puede superar el disponible en caja
  if (parsed.data.type === "SALIDA") {
    const available = await queryOne<{ total: string }>(
      "SELECT cash_session_balance($1) AS total",
      [req.params.id],
    );
    if (Number(available?.total ?? 0) < parsed.data.amount) {
      res.status(409).json({
        error: "El monto de salida es mayor al monto disponible en la caja.",
      });
      return;
    }
  }

  try {
    const row = await queryOne(
      `INSERT INTO cash_transactions (tenant_id, cash_session_id, type, reason, amount, user_id, user_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        req.user!.tenantId, req.params.id, parsed.data.type,
        parsed.data.reason, parsed.data.amount, req.user!.id, req.user!.fullName,
      ],
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** Reporte de cajas: solo abiertas y ya cerradas (§1.8.4). */
cashRouter.get("/report", async (req, res) => {
  const rows = await query(
    `SELECT cs.*, cr.name AS register_name
     FROM cash_sessions cs
     JOIN cash_registers cr ON cr.id = cs.cash_register_id
     WHERE cs.tenant_id = $1 AND cs.status = 'cerrada'
     ORDER BY cs.closed_at DESC`,
    [req.user!.tenantId],
  );
  res.json(rows);
});
