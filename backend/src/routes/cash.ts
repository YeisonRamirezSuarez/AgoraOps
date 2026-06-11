/**
 * Gestión de Cajas — manual §1.8.3–1.8.4.
 * Origen PHP: AbrirCaja.php (pulse), cierreCaja.php, registrar_entrada/
 * salida, obtenerValoresParaCierre, obtenerSalidasIngresos.
 * El CRUD de cajas vive en /catalogs/cash-registers; aquí van las
 * sesiones (apertura/cierre), entradas/salidas y el reporte.
 */
import { Router } from "express";
import { z } from "zod";
import { query, queryOne } from "../db.js";
import { dbErrorMessage } from "../lib/crud.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

export const cashRouter = Router();
cashRouter.use(requireAuth, requireAdmin);

/** Cajas con su sesión abierta (si existe). */
cashRouter.get("/sessions", async (req, res) => {
  const rows = await query(
    `SELECT cr.id AS cash_register_id, cr.name, cr.status AS register_status,
            cs.id AS session_id, cs.status, cs.opening_amount, cs.opened_at,
            cs.user_name
     FROM cash_registers cr
     LEFT JOIN cash_sessions cs
       ON cs.cash_register_id = cr.id AND cs.status = 'abierta'
     WHERE cr.tenant_id = $1
     ORDER BY cr.name`,
    [req.user!.tenantId],
  );
  res.json(rows);
});

/** Abrir caja (§1.8.3). */
cashRouter.post("/sessions", async (req, res) => {
  const schema = z.object({
    cashRegisterId: z.number(),
    openingAmount: z.number().min(0),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Complete todos los campos requeridos" });
    return;
  }
  try {
    const row = await queryOne(
      `INSERT INTO cash_sessions (tenant_id, cash_register_id, user_id, user_name, opening_amount)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        req.user!.tenantId, parsed.data.cashRegisterId, req.user!.id,
        req.user!.fullName, parsed.data.openingAmount,
      ],
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** Valores para el cierre (PHP: obtenerValoresParaCierre). */
cashRouter.get("/sessions/:id/summary", async (req, res) => {
  const session = await queryOne(
    "SELECT * FROM cash_sessions WHERE id = $1 AND tenant_id = $2",
    [req.params.id, req.user!.tenantId],
  );
  if (!session) {
    res.status(404).json({ error: "Sesión no encontrada" });
    return;
  }
  const byMethod = await query(
    `SELECT pm.name, SUM(op.amount - op.change_given) AS total
     FROM order_payments op
     JOIN orders o ON o.id = op.order_id
     JOIN payment_methods pm ON pm.id = op.payment_method_id
     WHERE o.cash_session_id = $1
     GROUP BY pm.name`,
    [req.params.id],
  );
  const transactions = await query(
    "SELECT * FROM cash_transactions WHERE cash_session_id = $1 ORDER BY created_at",
    [req.params.id],
  );
  res.json({ session, byMethod, transactions });
});

/** Cerrar caja: efectivo contado + nota obligatoria (§1.8.3). */
cashRouter.post("/sessions/:id/close", async (req, res) => {
  const schema = z.object({
    countedCash: z.number().min(0).nullable(),
    note: z.string().min(1, "El campo Nota es obligatorio"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "El campo Nota es obligatorio para cerrar la caja" });
    return;
  }
  try {
    await query("SELECT close_cash_session($1, $2, $3)", [
      req.params.id, parsed.data.countedCash, parsed.data.note,
    ]);
    const session = await queryOne(
      "SELECT * FROM cash_sessions WHERE id = $1",
      [req.params.id],
    );
    res.json(session);
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
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
      `SELECT cs.opening_amount
         + COALESCE((SELECT SUM(op.amount - op.change_given) FROM order_payments op
             JOIN orders o ON o.id = op.order_id
             JOIN payment_methods pm ON pm.id = op.payment_method_id
             WHERE o.cash_session_id = cs.id AND pm.name = 'EFECTIVO'), 0)
         + COALESCE((SELECT SUM(amount) FROM cash_transactions
             WHERE cash_session_id = cs.id AND type = 'ENTRADA'), 0)
         - COALESCE((SELECT SUM(amount) FROM cash_transactions
             WHERE cash_session_id = cs.id AND type = 'SALIDA'), 0) AS total
       FROM cash_sessions cs WHERE cs.id = $1 AND cs.tenant_id = $2`,
      [req.params.id, req.user!.tenantId],
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
