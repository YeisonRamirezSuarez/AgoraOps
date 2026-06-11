/**
 * Reportes — manual §1.9.
 * Origen PHP: obtener_ventas.php (filtros fecha/usuario/método),
 * reportes.php (áreas, cancelados), productos.php (cancelados por fecha).
 * §1.9.2: un trabajador (empleado) solo ve SUS ventas del día actual.
 */
import { Router } from "express";
import { query } from "../db.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

/** Reporte de ventas (§1.9.2) — admin y mesero_cocina. */
reportsRouter.get("/sales", async (req, res) => {
  const isAdmin = req.user!.roleType === "administrador" || req.user!.isSuperAdmin;
  const today = new Date().toISOString().slice(0, 10);

  // Trabajador: forzar sus propias ventas del día actual (§1.9.2)
  const from = isAdmin ? (req.query.from as string) || today : today;
  const to = isAdmin ? (req.query.to as string) || today : today;
  const userId = isAdmin ? (req.query.userId as string) || null : req.user!.id;

  const rows = await query(
    `SELECT o.id, o.order_number, o.created_at, o.customer_name, o.attended_by,
            o.status, o.total, o.tip, t.number AS table_number, r.name AS room_name,
            c.name AS client_name,
            COALESCE((SELECT json_agg(json_build_object(
              'name', oi.product_name, 'qty', oi.quantity,
              'price', oi.unit_price, 'subtotal', oi.subtotal))
              FROM order_items oi WHERE oi.order_id = o.id
                AND oi.kitchen_status <> 'cancelado'), '[]') AS items,
            COALESCE((SELECT json_agg(json_build_object(
              'method', pm.name, 'amount', op.amount))
              FROM order_payments op
              JOIN payment_methods pm ON pm.id = op.payment_method_id
              WHERE op.order_id = o.id), '[]') AS payments
     FROM orders o
     LEFT JOIN tables t ON t.id = o.table_id
     LEFT JOIN rooms r ON r.id = o.room_id
     LEFT JOIN clients c ON c.id = o.client_id
     WHERE o.tenant_id = $1 AND o.status = 'pagada'
       AND DATE(o.created_at) BETWEEN $2::date AND $3::date
       AND ($4::uuid IS NULL OR o.user_id = $4::uuid)
     ORDER BY o.created_at DESC`,
    [req.user!.tenantId, from, to, userId],
  );
  res.json(rows);
});

/** Reporte general (§1.9.1): órdenes en curso o finalizadas — solo admin. */
reportsRouter.get("/general", requireAdmin, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await query(
    `SELECT o.id, o.order_number, o.created_at, o.status, o.total, o.tip,
            o.attended_by, o.customer_name, t.number AS table_number,
            r.name AS room_name
     FROM orders o
     LEFT JOIN tables t ON t.id = o.table_id
     LEFT JOIN rooms r ON r.id = o.room_id
     WHERE o.tenant_id = $1 AND o.status <> 'cancelada'  -- §1.9.1: sin canceladas
       AND DATE(o.created_at) BETWEEN COALESCE($2::date, $4::date) AND COALESCE($3::date, $4::date)
     ORDER BY o.created_at DESC`,
    [
      req.user!.tenantId,
      (req.query.from as string) || null,
      (req.query.to as string) || null,
      today,
    ],
  );
  res.json(rows);
});

/** Órdenes canceladas (§1.9.3) — solo admin. */
reportsRouter.get("/cancelled", requireAdmin, async (req, res) => {
  const rows = await query(
    `SELECT o.id, o.order_number, o.cancelled_at, o.cancel_reason,
            o.cancelled_by_name, o.attended_by, o.cancelled_value,
            t.number AS table_number, r.name AS room_name,
            COALESCE((SELECT json_agg(json_build_object(
              'name', oi.product_name, 'qty', oi.quantity,
              'reason', oi.cancel_reason, 'by', oi.cancelled_by))
              FROM order_items oi WHERE oi.order_id = o.id
                AND oi.kitchen_status = 'cancelado'), '[]') AS cancelled_items
     FROM orders o
     LEFT JOIN tables t ON t.id = o.table_id
     LEFT JOIN rooms r ON r.id = o.room_id
     WHERE o.tenant_id = $1 AND o.status = 'cancelada'
       AND ($2::date IS NULL OR DATE(o.cancelled_at) >= $2::date)
       AND ($3::date IS NULL OR DATE(o.cancelled_at) <= $3::date)
     ORDER BY o.cancelled_at DESC`,
    [
      req.user!.tenantId,
      (req.query.from as string) || null,
      (req.query.to as string) || null,
    ],
  );
  res.json(rows);
});

/** Duplicado voucher (§1.9.4): por número de orden, con validaciones. */
reportsRouter.get("/voucher/:orderNumber", async (req, res) => {
  const rows = await query(
    `SELECT o.*, t.number AS table_number,
            COALESCE((SELECT json_agg(json_build_object(
              'method', pm.name, 'amount', op.amount, 'voucher', op.voucher_number))
              FROM order_payments op
              JOIN payment_methods pm ON pm.id = op.payment_method_id
              WHERE op.order_id = o.id), '[]') AS payments,
            COALESCE((SELECT json_agg(json_build_object(
              'name', oi.product_name, 'qty', oi.quantity, 'subtotal', oi.subtotal))
              FROM order_items oi WHERE oi.order_id = o.id
                AND oi.kitchen_status <> 'cancelado'), '[]') AS items
     FROM orders o
     LEFT JOIN tables t ON t.id = o.table_id
     WHERE o.tenant_id = $1 AND o.order_number = $2`,
    [req.user!.tenantId, req.params.orderNumber],
  );
  const order = rows[0] as { status?: string } | undefined;
  if (!order) {
    res.status(404).json({ error: "No existe una orden con ese número." });
    return;
  }
  if (order.status === "cancelada") {
    res.status(409).json({ error: "La orden fue cancelada; no tiene voucher." });
    return;
  }
  if (order.status === "abierta") {
    res.status(409).json({ error: "La orden aún se encuentra en uso." });
    return;
  }
  res.json(order);
});
