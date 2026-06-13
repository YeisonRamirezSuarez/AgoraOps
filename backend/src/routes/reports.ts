/**
 * Reportes — manual §1.9.
 * Origen PHP: obtener_ventas.php (filtros fecha/usuario/método),
 * reportes.php (áreas, cancelados), productos.php (cancelados por fecha).
 * §1.9.2: un trabajador (empleado) solo ve SUS ventas del día actual.
 */
import { Router } from "express";
import { query, queryOne } from "../db.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

const TZ = "America/Bogota";

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

/**
 * Reporte general (§1.9.1) — réplica del "Reporte general" de Polaris.
 * Filtros: Atendió (usuario que abrió la orden), Vendió (cajero que cobró),
 * Fecha de fin (paid_at), Método de pago y Caja (sesión). Columnas del grid:
 * N° orden, Fecha de inicio (opened_at), Fecha de fin (paid_at), Estado,
 * Atendió, Vendió, Método de pago (COMBINADO si >1), Subtotal (BRUTO: incluye
 * ítems cancelados), Propina, % propina, Descuento y Total (neto = orders.total).
 * Solo admin (igual que Polaris).
 */
reportsRouter.get("/general", requireAdmin, async (req, res) => {
  const rows = await query(
    `SELECT o.id, o.order_number, o.opened_at, o.paid_at, o.status,
            au.username AS atendio,
            (SELECT u.username FROM order_payments op
               JOIN users u ON u.id = op.user_id
              WHERE op.order_id = o.id
              ORDER BY op.created_at DESC LIMIT 1) AS vendio,
            (SELECT CASE WHEN COUNT(DISTINCT pm.name) = 1 THEN MAX(pm.name)
                         WHEN COUNT(DISTINCT pm.name) > 1 THEN 'COMBINADO' END
               FROM order_payments op
               JOIN payment_methods pm ON pm.id = op.payment_method_id
              WHERE op.order_id = o.id) AS pay_method,
            -- Subtotal BRUTO: incluye ítems cancelados (igual que Polaris)
            (SELECT COALESCE(SUM(oi.subtotal), 0) FROM order_items oi
              WHERE oi.order_id = o.id) AS subtotal,
            o.tip, COALESCE(bs.tip_percentage, 0) AS tip_percentage,
            o.discount, o.delivery_fee, o.total
     FROM orders o
     JOIN users au ON au.id = o.user_id
     LEFT JOIN business_settings bs ON bs.tenant_id = o.tenant_id
     WHERE o.tenant_id = $1 AND o.status <> 'cancelada'  -- §1.9.1: sin canceladas
       AND ($2::uuid IS NULL OR o.user_id = $2::uuid)
       AND ($3::uuid IS NULL OR EXISTS (
             SELECT 1 FROM order_payments op
              WHERE op.order_id = o.id AND op.user_id = $3::uuid))
       AND ($4::date IS NULL OR (o.paid_at AT TIME ZONE '${TZ}')::date = $4::date)
       AND ($5::int IS NULL OR EXISTS (
             SELECT 1 FROM order_payments op
              WHERE op.order_id = o.id AND op.payment_method_id = $5::int))
       AND ($6::int IS NULL OR o.cash_session_id = $6::int)
     ORDER BY o.id DESC`,
    [
      req.user!.tenantId,
      (req.query.atendio as string) || null,
      (req.query.vendio as string) || null,
      (req.query.fechaFin as string) || null,
      (req.query.payMethod as string) || null,
      (req.query.cashSession as string) || null,
    ],
  );
  res.json(rows);
});

/** Opciones de los filtros del Reporte general (usuarios, métodos, cajas). */
reportsRouter.get("/general/filters", requireAdmin, async (req, res) => {
  const [users, paymentMethods, cashSessions] = await Promise.all([
    query(
      `SELECT id, username, full_name FROM users
        WHERE tenant_id = $1 ORDER BY username`,
      [req.user!.tenantId],
    ),
    query(
      `SELECT id, name FROM payment_methods
        WHERE tenant_id = $1 AND is_active ORDER BY name`,
      [req.user!.tenantId],
    ),
    query(
      `SELECT cs.id,
              cr.name || ' - ' ||
              to_char(cs.opened_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS label
         FROM cash_sessions cs
         JOIN cash_registers cr ON cr.id = cs.cash_register_id
        WHERE cs.tenant_id = $1
        ORDER BY cs.opened_at DESC`,
      [req.user!.tenantId],
    ),
  ]);
  res.json({ users, paymentMethods, cashSessions });
});

/**
 * Registro de la orden (drill-down del Reporte general): todos los ítems de
 * la orden, incluidos los cancelados, con su Estado del pago. Réplica de
 * "grid_reporte_detalle_orden" de Polaris.
 */
reportsRouter.get("/general/:id/items", requireAdmin, async (req, res) => {
  const rows = await query(
    `SELECT o.order_number, t.number AS table_number,
            COALESCE(p.product_type, 'NORMAL') AS product_type,
            oi.product_name, oi.quantity,
            COALESCE((SELECT SUM(oit.quantity) FROM order_item_toppings oit
                       WHERE oit.order_item_id = oi.id), 0) AS topping_qty,
            oi.notes AS description,
            CASE WHEN oi.kitchen_status = 'cancelado' THEN 'CANCELADO'
                 WHEN oi.is_paid THEN 'PAGO' ELSE 'PENDIENTE' END AS pay_state,
            CASE WHEN oi.kitchen_status = 'cancelado' THEN 0
                 ELSE oi.subtotal END AS total
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN tables t ON t.id = o.table_id
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1 AND o.tenant_id = $2
     ORDER BY oi.id`,
    [req.params.id, req.user!.tenantId],
  );
  res.json(rows);
});

/**
 * Recibo de la orden (drill-down del Reporte general): encabezado del negocio,
 * datos de la orden, ítems no cancelados y totales. Réplica de
 * "blank_receipt_report" de Polaris.
 */
reportsRouter.get("/general/:id/receipt", requireAdmin, async (req, res) => {
  const order = await queryOne<Record<string, unknown>>(
    `SELECT o.id, o.order_number, o.opened_at, o.paid_at, o.subtotal, o.tip,
            o.discount, o.delivery_fee, o.total, t.number AS table_number,
            au.full_name AS attended_name,
            (SELECT u.full_name FROM order_payments op
               JOIN users u ON u.id = op.user_id
              WHERE op.order_id = o.id
              ORDER BY op.created_at DESC LIMIT 1) AS cashier_name,
            cr.name AS cash_register_name,
            (SELECT CASE WHEN COUNT(DISTINCT pm.name) = 1 THEN MAX(pm.name)
                         WHEN COUNT(DISTINCT pm.name) > 1 THEN 'COMBINADO' END
               FROM order_payments op
               JOIN payment_methods pm ON pm.id = op.payment_method_id
              WHERE op.order_id = o.id) AS pay_method,
            bs.business_name, bs.address, bs.tax_id,
            COALESCE(bs.tip_percentage, 0) AS tip_percentage,
            COALESCE((SELECT json_agg(json_build_object(
              'name', oi.product_name, 'qty', oi.quantity,
              'unit', oi.unit_price, 'subtotal', oi.subtotal) ORDER BY oi.id)
              FROM order_items oi WHERE oi.order_id = o.id
                AND oi.kitchen_status <> 'cancelado'), '[]') AS items
     FROM orders o
     JOIN users au ON au.id = o.user_id
     LEFT JOIN tables t ON t.id = o.table_id
     LEFT JOIN cash_sessions cs ON cs.id = o.cash_session_id
     LEFT JOIN cash_registers cr ON cr.id = cs.cash_register_id
     LEFT JOIN business_settings bs ON bs.tenant_id = o.tenant_id
     WHERE o.id = $1 AND o.tenant_id = $2`,
    [req.params.id, req.user!.tenantId],
  );
  if (!order) {
    res.status(404).json({ error: "No existe la orden." });
    return;
  }
  res.json(order);
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
