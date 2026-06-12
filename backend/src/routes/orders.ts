/**
 * Mesas y Órdenes — manual §1.6.3.
 * Origen PHP: ocupar_mesa*, obtener_mesas*, editar_mesa* (traslado),
 * cancelar_mesa*, registrar_venta*, cobroDivido, marcar_insumo.
 * La lógica transaccional vive en las funciones SQL de 00019 (confirm,
 * cancel, reorder, transfer, pay, close); aquí se validan permisos y
 * se orquesta.
 */
import { Router } from "express";
import { z } from "zod";
import { query, queryOne } from "../db.js";
import { dbErrorMessage } from "../lib/crud.js";
import { requireAuth } from "../middleware/auth.js";

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

/** Opciones para la pantalla de pago (§1.6.3): métodos activos, bancos,
 * denominaciones (atajos de efectivo §1.7.8), propina configurada y
 * cajas abiertas (Caja de Pago del resumen de transacción). */
ordersRouter.get("/payment-options", async (req, res) => {
  const [methods, banks, denominations, settings, sessions] = await Promise.all([
    query(
      "SELECT id, name FROM payment_methods WHERE tenant_id = $1 AND is_active ORDER BY name",
      [req.user!.tenantId],
    ),
    query(
      `SELECT DISTINCT b.id, b.name FROM banks b
       JOIN payment_method_banks pmb ON pmb.bank_id = b.id
       JOIN payment_methods pm ON pm.id = pmb.payment_method_id
       WHERE b.tenant_id = $1 AND b.is_active AND pm.is_active
       ORDER BY b.name`,
      [req.user!.tenantId],
    ),
    query(
      "SELECT id, value FROM currency_denominations WHERE tenant_id = $1 AND is_active ORDER BY value",
      [req.user!.tenantId],
    ),
    queryOne(
      `SELECT tip_enabled, tip_percentage, service_enabled, service_percentage,
              business_name, address, phone, tax_id
       FROM business_settings WHERE tenant_id = $1`,
      [req.user!.tenantId],
    ),
    query(
      `SELECT cs.id, cr.name FROM cash_sessions cs
       JOIN cash_registers cr ON cr.id = cs.cash_register_id
       WHERE cs.tenant_id = $1 AND cs.status = 'abierta'
       ORDER BY cs.opened_at DESC`,
      [req.user!.tenantId],
    ),
  ]);
  res.json({ methods, banks, denominations, settings, sessions });
});

/** ¿Hay alguna caja abierta? Sin caja no se abren mesas (§1.6.3).
 * Accesible a todos los roles que gestionan mesas (no solo admin). */
ordersRouter.get("/cash-status", async (req, res) => {
  const open = await queryOne(
    "SELECT id FROM cash_sessions WHERE tenant_id = $1 AND status = 'abierta' LIMIT 1",
    [req.user!.tenantId],
  );
  res.json({ open: !!open });
});

/** Vista de mesas por sala: mesas + orden abierta (si la hay). */
ordersRouter.get("/board", async (req, res) => {
  const rows = await query(
    `SELECT t.id AS table_id, t.number, t.seats, t.room_id, r.name AS room_name,
            o.id AS order_id, o.order_number, o.opened_at, o.comment,
            o.customer_name, o.attended_by,
            COALESCE((SELECT SUM(oi.subtotal) FROM order_items oi
              WHERE oi.order_id = o.id AND oi.kitchen_status <> 'cancelado'), 0) AS total
     FROM tables t
     JOIN rooms r ON r.id = t.room_id AND r.is_active
     LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'abierta'
     WHERE t.tenant_id = $1 AND t.is_active
     ORDER BY r.name, t.number`,
    [req.user!.tenantId],
  );
  res.json(rows);
});

/** Ocupar mesa (§1.6.3): requiere caja abierta; genera número de orden. */
ordersRouter.post("/occupy", async (req, res) => {
  const schema = z.object({ tableId: z.number(), customerName: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Mesa inválida" });
    return;
  }

  // Solo administrador o mesero cambian el estado de las mesas (§1.6.3)
  if (req.user!.roleType !== "administrador" && req.user!.groupName === "Cocina") {
    res.status(403).json({ error: "Su rol no puede gestionar mesas" });
    return;
  }

  // Si todas las cajas están cerradas, las mesas no se pueden abrir (§1.6.3)
  const openSession = await queryOne(
    "SELECT id FROM cash_sessions WHERE tenant_id = $1 AND status = 'abierta' LIMIT 1",
    [req.user!.tenantId],
  );
  if (!openSession) {
    res.status(409).json({
      error: "Todas las cajas están cerradas; no es posible abrir mesas.",
    });
    return;
  }

  const existing = await queryOne(
    "SELECT id FROM orders WHERE table_id = $1 AND status = 'abierta'",
    [parsed.data.tableId],
  );
  if (existing) {
    res.json(existing);
    return;
  }

  const table = await queryOne<{ room_id: number }>(
    "SELECT room_id FROM tables WHERE id = $1 AND tenant_id = $2",
    [parsed.data.tableId, req.user!.tenantId],
  );
  if (!table) {
    res.status(404).json({ error: "Mesa no encontrada" });
    return;
  }

  // PHP: codigo = YmdHis + idMesa
  const orderNumber =
    new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14) +
    parsed.data.tableId;

  const order = await queryOne(
    `INSERT INTO orders (tenant_id, order_number, table_id, room_id, user_id,
       attended_by, customer_name)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE(NULLIF($7, ''), 'Nuevo'))
     RETURNING *`,
    [
      req.user!.tenantId, orderNumber, parsed.data.tableId, table.room_id,
      req.user!.id, req.user!.fullName, parsed.data.customerName ?? "",
    ],
  );
  res.status(201).json(order);
});

/** Detalle de la orden con ítems y toppings. */
ordersRouter.get("/:id", async (req, res) => {
  const order = await queryOne(
    "SELECT * FROM orders WHERE id = $1 AND tenant_id = $2",
    [req.params.id, req.user!.tenantId],
  );
  if (!order) {
    res.status(404).json({ error: "Orden no encontrada" });
    return;
  }
  const items = await query(
    `SELECT oi.*, COALESCE(json_agg(json_build_object(
        'id', oit.id, 'topping_name', oit.topping_name,
        'topping_price', oit.topping_price, 'quantity', oit.quantity))
        FILTER (WHERE oit.id IS NOT NULL), '[]') AS toppings
     FROM order_items oi
     LEFT JOIN order_item_toppings oit ON oit.order_item_id = oi.id
     WHERE oi.order_id = $1
     GROUP BY oi.id ORDER BY oi.id`,
    [req.params.id],
  );
  res.json({ ...order, items });
});

/** Agregar producto a la orden (estado 'nuevo' hasta confirmar). */
ordersRouter.post("/:id/items", async (req, res) => {
  const schema = z.object({
    productId: z.number(),
    variantId: z.number().nullish(),
    quantity: z.number().int().positive(),
    notes: z.string().optional(),
    toppings: z.array(z.object({
      toppingId: z.number(),
      quantity: z.number().int().positive().default(1),
    })).default([]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos del producto inválidos" });
    return;
  }
  const { productId, variantId, quantity, notes, toppings } = parsed.data;

  const product = await queryOne<{
    name: string; sale_price: string; cost_price: string; printer_id: number | null;
  }>(
    "SELECT name, sale_price, cost_price, printer_id FROM products WHERE id = $1 AND tenant_id = $2 AND is_active",
    [productId, req.user!.tenantId],
  );
  if (!product) {
    res.status(404).json({ error: "Producto no encontrado" });
    return;
  }

  let unitPrice = Number(product.sale_price);
  let name = product.name;
  if (variantId) {
    const variant = await queryOne<{ name: string; sale_price: string }>(
      "SELECT name, sale_price FROM product_variants WHERE id = $1 AND product_id = $2",
      [variantId, productId],
    );
    if (!variant) {
      res.status(404).json({ error: "Variante no encontrada" });
      return;
    }
    unitPrice = Number(variant.sale_price);
    name = `${product.name} (${variant.name})`;
  }

  // PHP: codigoUnico = YmdHis + rand(10000,99999)
  const uniqueCode =
    new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14) +
    Math.floor(Math.random() * 90000 + 10000);

  const toppingsTotal = toppings.length
    ? Number(
        (await queryOne<{ total: string }>(
          `SELECT COALESCE(SUM(t.price * x.qty), 0) AS total
           FROM unnest($1::int[], $2::int[]) AS x(id, qty)
           JOIN toppings t ON t.id = x.id`,
          [toppings.map((t) => t.toppingId), toppings.map((t) => t.quantity)],
        ))?.total ?? 0,
      )
    : 0;

  const subtotal = (unitPrice + toppingsTotal) * quantity;

  try {
    const item = await queryOne<{ id: number }>(
      `INSERT INTO order_items (order_id, product_id, variant_id, product_name,
         quantity, unit_price, cost_price, subtotal, notes, unique_code, printer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        req.params.id, productId, variantId ?? null, name, quantity, unitPrice,
        Number(product.cost_price), subtotal, notes ?? null, uniqueCode,
        product.printer_id,
      ],
    );
    for (const t of toppings) {
      await query(
        `INSERT INTO order_item_toppings (order_item_id, topping_id, topping_name, topping_price, quantity)
         SELECT $1, id, name, price, $3 FROM toppings WHERE id = $2`,
        [item!.id, t.toppingId, t.quantity],
      );
    }
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** Editar/eliminar ítem: solo sin confirmar (§1.6.3). */
ordersRouter.delete("/:id/items/:itemId", async (req, res) => {
  const row = await queryOne(
    `DELETE FROM order_items WHERE id = $1 AND order_id = $2
       AND kitchen_status = 'nuevo' RETURNING id`,
    [req.params.itemId, req.params.id],
  );
  if (!row) {
    res.status(409).json({
      error: "Solo se pueden eliminar productos sin confirmar.",
    });
    return;
  }
  res.json({ ok: true });
});

/** Confirmar productos → imprime comanda (§1.6.3). */
ordersRouter.post("/:id/confirm", async (req, res) => {
  const itemIds: number[] = req.body.itemIds ?? [];
  try {
    await query("SELECT confirm_order_items($1, $2)", [
      req.params.id,
      itemIds,
    ]);
    // "Sobre comanda" si ya hubo una confirmación previa (§1.6.3)
    const prior = await queryOne<{ n: string }>(
      `SELECT COUNT(*) AS n FROM order_items
       WHERE order_id = $1 AND confirmed_at IS NOT NULL AND NOT (id = ANY($2))`,
      [req.params.id, itemIds],
    );
    res.json({ ok: true, sobreComanda: Number(prior?.n ?? 0) > 0 });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** Comentario de la mesa (PHP: nota / modal de comentario). */
ordersRouter.put("/:id/comment", async (req, res) => {
  await query(
    "UPDATE orders SET comment = $1 WHERE id = $2 AND tenant_id = $3",
    [req.body.comment ?? null, req.params.id, req.user!.tenantId],
  );
  res.json({ ok: true });
});

/** Devolución/cancelación de producto (descripción obligatoria, §1.6.3). */
ordersRouter.post("/:id/items/:itemId/cancel", async (req, res) => {
  try {
    await query("SELECT cancel_order_item($1, $2, $3, $4)", [
      req.params.itemId, req.body.reason, req.user!.fullName, req.user!.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** Solicitar de nuevo (solo si está Listo, §1.6.3). */
ordersRouter.post("/:id/items/:itemId/reorder", async (req, res) => {
  try {
    const row = await queryOne<{ reorder_item: number }>(
      "SELECT reorder_item($1, $2, $3)",
      [req.params.itemId, req.body.reason, req.user!.fullName],
    );
    res.json({ ok: true, newItemId: row?.reorder_item });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** Trasladar productos a otra mesa/sala (§1.6.3). */
ordersRouter.post("/:id/transfer", async (req, res) => {
  const schema = z.object({
    tableId: z.number(),
    roomId: z.number(),
    itemIds: z.array(z.number()).min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Seleccione productos y mesa destino" });
    return;
  }
  try {
    const row = await queryOne<{ transfer_order_items: number }>(
      "SELECT transfer_order_items($1, $2, $3, $4, $5)",
      [
        req.params.id, parsed.data.tableId, parsed.data.roomId,
        parsed.data.itemIds, req.user!.id,
      ],
    );
    res.json({ ok: true, toOrderId: row?.transfer_order_items });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** Pago: completo, combinado (dividir) o por producto (§1.6.3).
 * sessionId = Caja de Pago elegida en el resumen de transacción.
 * Devuelve los pagos con su voucher para imprimir el comprobante. */
ordersRouter.post("/:id/pay", async (req, res) => {
  const schema = z.object({
    clientId: z.number(),
    tip: z.number().min(0).default(0),
    sessionId: z.number().nullish(),
    payments: z.array(z.object({
      method_id: z.number(),
      bank_id: z.number().nullish(),
      amount: z.number().positive(),
      tip_included: z.number().min(0).default(0),
      change_given: z.number().min(0).default(0),
      item_ids: z.array(z.number()).optional(),
    })).min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de pago incompletos" });
    return;
  }
  try {
    await query("SELECT pay_order($1, $2, $3, $4, $5, $6)", [
      req.params.id, parsed.data.clientId, parsed.data.tip,
      JSON.stringify(parsed.data.payments), parsed.data.sessionId ?? null,
      req.user!.id,
    ]);
    const payments = await query(
      `SELECT op.amount, op.tip_included, op.change_given, op.voucher_number,
              pm.name AS method
       FROM order_payments op
       JOIN payment_methods pm ON pm.id = op.payment_method_id
       WHERE op.order_id = $1 ORDER BY op.id`,
      [req.params.id],
    );
    res.json({ ok: true, payments });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** Cerrar mesa (solo sin productos activos, §1.6.3). */
ordersRouter.post("/:id/close", async (req, res) => {
  try {
    await query("SELECT close_order($1, $2, $3, $4)", [
      req.params.id, req.body.reason ?? "Cierre de mesa",
      req.user!.fullName, req.user!.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});
