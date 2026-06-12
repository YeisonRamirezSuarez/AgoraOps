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

/**
 * Aislamiento multi-tenant (decisión 00018): toda ruta con :id opera sobre
 * una orden; aquí se verifica una sola vez que esa orden pertenezca al
 * tenant del JWT antes de ejecutar cualquier handler o función SQL
 * (confirm/pay/transfer/close…), que reciben el id sin re-validar tenant.
 * Express ejecuta este callback solo en rutas que declaran :id.
 */
ordersRouter.param("id", (req, res, next, id) => {
  queryOne("SELECT id FROM orders WHERE id = $1 AND tenant_id = $2", [
    id,
    req.user!.tenantId,
  ])
    .then((order) => {
      if (!order) {
        res.status(404).json({ error: "Orden no encontrada" });
        return;
      }
      next();
    })
    .catch(next);
});

type ToppingSel = { toppingId: number; quantity: number };

/** Suma price×qty de los toppings (compartido por agregar/editar ítem). */
async function toppingsTotalOf(toppings: ToppingSel[]): Promise<number> {
  if (toppings.length === 0) return 0;
  const row = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(t.price * x.qty), 0) AS total
     FROM unnest($1::int[], $2::int[]) AS x(id, qty)
     JOIN toppings t ON t.id = x.id`,
    [toppings.map((t) => t.toppingId), toppings.map((t) => t.quantity)],
  );
  return Number(row?.total ?? 0);
}

/** Inserta los toppings de un ítem copiando nombre/precio actuales. */
async function insertItemToppings(itemId: number, toppings: ToppingSel[]): Promise<void> {
  for (const t of toppings) {
    await query(
      `INSERT INTO order_item_toppings (order_item_id, topping_id, topping_name, topping_price, quantity)
       SELECT $1, id, name, price, $3 FROM toppings WHERE id = $2`,
      [itemId, t.toppingId, t.quantity],
    );
  }
}

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

/** Vista de mesas por sala: mesas + orden abierta (si la hay).
 * is_reserved replica el estado "Reservada" de Polaris: mesa libre con una
 * reservación vigente ahora (fecha hoy, dentro de la ventana de horas y en
 * etapa distinta de Cancelado). */
ordersRouter.get("/board", async (req, res) => {
  const rows = await query(
    `SELECT t.id AS table_id, t.number, t.seats, t.room_id, r.name AS room_name,
            o.id AS order_id, o.order_number, o.opened_at, o.comment,
            o.customer_name, o.attended_by,
            COALESCE((SELECT SUM(oi.subtotal) FROM order_items oi
              WHERE oi.order_id = o.id AND oi.kitchen_status <> 'cancelado'), 0) AS total,
            false AS is_reserved
     FROM tables t
     JOIN rooms r ON r.id = t.room_id AND r.is_active
     LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'abierta'
     WHERE t.tenant_id = $1 AND t.is_active
     ORDER BY r.name, t.number`,
    [req.user!.tenantId],
  );
  res.json(rows);
});

/** Domiciliarios activos + empresas para el flujo de domicilio del mesero
 * (Polaris: domiciliariosActivos/empresasDomiciliarios embebidos en la orden;
 * la gestión completa es de admin en /api/delivery). */
ordersRouter.get("/delivery-options", async (req, res) => {
  const [drivers, companies] = await Promise.all([
    query(
      `SELECT p.id, p.first_name, p.last_name,
              (p.first_name || ' ' || p.last_name) AS name,
              p.phone, p.plate, c.name AS company_name
       FROM delivery_personnel p
       JOIN delivery_companies c ON c.id = p.company_id
       WHERE p.tenant_id = $1 AND p.status = 'ACTIVO'
       ORDER BY p.first_name`,
      [req.user!.tenantId],
    ),
    query(
      `SELECT id, name FROM delivery_companies
       WHERE tenant_id = $1 AND status = 'ACTIVO' ORDER BY name`,
      [req.user!.tenantId],
    ),
  ]);
  res.json({ drivers, companies });
});

/** Registro rápido de domiciliario desde la orden (Polaris:
 * register_delivery_personnel_quick — no requiere rol admin). */
ordersRouter.post("/delivery-personnel-quick", async (req, res) => {
  const schema = z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    phone: z.string().min(1),
    plate: z.string().min(1),
    companyId: z.number(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Completa todos los campos para continuar." });
    return;
  }
  const row = await queryOne<{ id: number }>(
    `INSERT INTO delivery_personnel
       (tenant_id, company_id, first_name, last_name, phone, plate, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVO') RETURNING id`,
    [
      req.user!.tenantId, parsed.data.companyId, parsed.data.firstName.trim(),
      parsed.data.lastName.trim(),
      parsed.data.phone.replace(/\D/g, ""),
      parsed.data.plate.trim().toUpperCase(),
    ],
  );
  res.status(201).json({ ok: true, id: row!.id, message: "Domiciliario creado correctamente." });
});

/** Asignar cliente y/o domiciliario a una orden de domicilio (Polaris:
 * register_cliente_dilevery / register_delivery_personnel). */
ordersRouter.put("/:id/delivery", async (req, res) => {
  const schema = z.object({
    clientId: z.number().nullish(),
    personnelId: z.number().nullish(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de domicilio inválidos" });
    return;
  }
  const sets: string[] = [];
  const params: unknown[] = [req.params.id, req.user!.tenantId];
  if (parsed.data.clientId !== undefined) {
    params.push(parsed.data.clientId);
    sets.push(`client_id = $${params.length}`);
  }
  if (parsed.data.personnelId !== undefined) {
    params.push(parsed.data.personnelId);
    sets.push(`delivery_personnel_id = $${params.length}`);
  }
  if (sets.length === 0) {
    res.status(400).json({ error: "Nada para actualizar" });
    return;
  }
  await query(
    `UPDATE orders SET ${sets.join(", ")} WHERE id = $1 AND tenant_id = $2`,
    params,
  );
  res.json({ ok: true, message: "Cliente asignado correctamente" });
});

/** Impresoras activas para comanda/prefactura (Polaris: printersComanda y
 * printersPrefactura embebidas en la pantalla de orden). */
ordersRouter.get("/printers/list", async (req, res) => {
  const rows = await query(
    `SELECT id, name, connection_type, device_name AS printer_name,
            ip_address, port, purpose, url_send
     FROM printers WHERE tenant_id = $1 AND is_active ORDER BY name`,
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
    `SELECT oi.*, c.name AS customer_name_shared,
            COALESCE(json_agg(json_build_object(
        'id', oit.id, 'topping_id', oit.topping_id, 'topping_name', oit.topping_name,
        'topping_price', oit.topping_price, 'quantity', oit.quantity))
        FILTER (WHERE oit.id IS NOT NULL), '[]') AS toppings
     FROM order_items oi
     LEFT JOIN order_item_toppings oit ON oit.order_item_id = oi.id
     LEFT JOIN clients c ON c.id = oi.customer_id
     WHERE oi.order_id = $1
     GROUP BY oi.id, c.name ORDER BY oi.id`,
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
    customerId: z.number().nullish(), // Compras Compartidas (Polaris)
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
  const { productId, variantId, quantity, notes, toppings, customerId } = parsed.data;

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

  const subtotal = (unitPrice + (await toppingsTotalOf(toppings))) * quantity;

  try {
    const item = await queryOne<{ id: number }>(
      `INSERT INTO order_items (order_id, product_id, variant_id, product_name,
         quantity, unit_price, cost_price, subtotal, notes, unique_code, printer_id,
         customer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        req.params.id, productId, variantId ?? null, name, quantity, unitPrice,
        Number(product.cost_price), subtotal, notes ?? null, uniqueCode,
        product.printer_id, customerId ?? null,
      ],
    );
    await insertItemToppings(item!.id, toppings);
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** Eliminar ítem: solo pendientes ('nuevo') o re-pedidos sin confirmar
 * ('devuelto') — Polaris action=deleteProduct. */
ordersRouter.delete("/:id/items/:itemId", async (req, res) => {
  const row = await queryOne(
    `DELETE FROM order_items WHERE id = $1 AND order_id = $2
       AND kitchen_status IN ('nuevo', 'devuelto') RETURNING id`,
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

/** Editar ítem pendiente (Polaris blank_product_update: cantidad, nota,
 * toppings y cliente, solo antes de confirmar). */
ordersRouter.put("/:id/items/:itemId", async (req, res) => {
  const schema = z.object({
    quantity: z.number().int().positive(),
    notes: z.string().optional(),
    customerId: z.number().nullish(),
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
  const { quantity, notes, toppings, customerId } = parsed.data;

  const item = await queryOne<{ id: number; unit_price: string }>(
    `SELECT id, unit_price FROM order_items
     WHERE id = $1 AND order_id = $2 AND kitchen_status IN ('nuevo', 'devuelto')`,
    [req.params.itemId, req.params.id],
  );
  if (!item) {
    res.status(409).json({ error: "Solo se pueden editar productos sin confirmar." });
    return;
  }

  const subtotal = (Number(item.unit_price) + (await toppingsTotalOf(toppings))) * quantity;

  try {
    await query(
      `UPDATE order_items SET quantity = $1, notes = $2, subtotal = $3,
         customer_id = $4 WHERE id = $5`,
      [quantity, notes ?? null, subtotal, customerId ?? null, item.id],
    );
    await query("DELETE FROM order_item_toppings WHERE order_item_id = $1", [item.id]);
    await insertItemToppings(item.id, toppings);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** Asignar cliente a ítems (Polaris action=update_cart_customer — modal de
 * asignación de Compras Compartidas). */
ordersRouter.put("/:id/items-customer", async (req, res) => {
  const schema = z.object({
    assignments: z.array(z.object({
      itemId: z.number(),
      customerId: z.number().nullable(),
    })).min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Asignaciones inválidas" });
    return;
  }
  for (const a of parsed.data.assignments) {
    await query(
      "UPDATE order_items SET customer_id = $1 WHERE id = $2 AND order_id = $3",
      [a.customerId, a.itemId, req.params.id],
    );
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

/** Devolución por cantidades (Polaris action=devolution, modal-return).
 * body: { reason, items: [{itemId, quantity}] } — motivo obligatorio. */
ordersRouter.post("/:id/devolution", async (req, res) => {
  const schema = z.object({
    reason: z.string(),
    items: z.array(z.object({
      itemId: z.number(),
      quantity: z.number().int().positive(),
    })).min(1, "Selecciona productos."),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Selecciona productos." });
    return;
  }
  try {
    await query("SELECT devolution_order_items($1, $2, $3, $4, $5)", [
      req.params.id, parsed.data.reason,
      JSON.stringify(parsed.data.items.map((i) => ({ item_id: i.itemId, quantity: i.quantity }))),
      req.user!.fullName, req.user!.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** Solicitar de nuevo en lote (Polaris action=request_order): solo
 * entregados/listos; el nuevo ítem vuelve al carrito como "Devuelto". */
ordersRouter.post("/:id/reorder", async (req, res) => {
  const schema = z.object({
    reason: z.string(),
    items: z.array(z.object({
      itemId: z.number(),
      quantity: z.number().int().positive(),
    })).min(1, "Selecciona productos para pedir de nuevo."),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Selecciona productos para pedir de nuevo." });
    return;
  }
  try {
    await query("SELECT reorder_order_items($1, $2, $3, $4)", [
      req.params.id, parsed.data.reason,
      JSON.stringify(parsed.data.items.map((i) => ({ item_id: i.itemId, quantity: i.quantity }))),
      req.user!.fullName,
    ]);
    res.json({ ok: true });
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

/* ════════════ Impresión (formatos de Polaris) ════════════
 * La app envía estos JSON al bridge local (http://localhost:8080/voucher en
 * equipos POS) o al agente de la impresora (printers.url_send). Formatos
 * capturados de blank_json_comanda y blank_printer_pago (ver spec). */

interface PrintLine {
  tipo: "linea" | "matriz";
  tam: "p" | "m" | "g";
  align?: string | string[];
  valor: string | string[][];
  longitud?: string[];
}

/** Parte el nombre en renglones de `width` caracteres (matriz de Polaris). */
function wrapName(name: string, width = 18): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < name.length; i += width) chunks.push(name.slice(i, i + width));
  return chunks.length ? chunks : [""];
}

async function orderPrintContext(orderId: string, tenantId: string | null) {
  const order = await queryOne<{
    id: number; order_number: string; attended_by: string | null;
    comment: string | null; table_number: number | null; room_name: string | null;
    tip: string;
  }>(
    `SELECT o.id, o.order_number, o.attended_by, o.comment, o.tip,
            t.number AS table_number, r.name AS room_name
     FROM orders o
     LEFT JOIN tables t ON t.id = o.table_id
     LEFT JOIN rooms r ON r.id = o.room_id
     WHERE o.id = $1 AND o.tenant_id = $2`,
    [orderId, tenantId],
  );
  const settings = await queryOne<{
    business_name: string; address: string | null; tax_id: string | null;
    tip_enabled: boolean; tip_percentage: string;
  }>(
    `SELECT business_name, address, tax_id, tip_enabled, tip_percentage
     FROM business_settings WHERE tenant_id = $1`,
    [tenantId],
  );
  return { order, settings };
}

/** Comanda (Polaris blank_json_comanda): {json_local, json_externo}.
 * ?items=1,2,3 limita a esos ítems (al confirmar se imprimen solo los nuevos). */
ordersRouter.get("/:id/comanda", async (req, res) => {
  const { order } = await orderPrintContext(req.params.id, req.user!.tenantId);
  if (!order) {
    res.status(404).json({ error: "Orden no encontrada" });
    return;
  }
  const itemIds = String(req.query.items ?? "")
    .split(",").map((s) => Number(s)).filter((n) => n > 0);

  const items = await query<{
    product_name: string; quantity: number; notes: string | null;
    toppings: { topping_name: string; quantity: number }[];
  }>(
    `SELECT oi.product_name, oi.quantity, oi.notes,
            COALESCE(json_agg(json_build_object(
              'topping_name', oit.topping_name, 'quantity', oit.quantity))
              FILTER (WHERE oit.id IS NOT NULL), '[]') AS toppings
     FROM order_items oi
     LEFT JOIN order_item_toppings oit ON oit.order_item_id = oi.id
     WHERE oi.order_id = $1 AND oi.kitchen_status <> 'cancelado'
       AND ($2::int[] = '{}' OR oi.id = ANY($2))
     GROUP BY oi.id ORDER BY oi.id`,
    [req.params.id, itemIds],
  );

  const now = new Date();
  const fecha = now.toLocaleDateString("sv-SE", { timeZone: "America/Bogota" });
  const hora = now.toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour12: false });

  const matriz: string[][] = [["Cant", "Productos"]];
  for (const it of items) {
    const lines = wrapName(it.product_name);
    matriz.push([` ${it.quantity}`, lines[0]]);
    for (const extra of lines.slice(1)) matriz.push([" ", extra]);
    for (const tp of it.toppings) {
      for (const tl of wrapName(`+ ${tp.topping_name} x${tp.quantity}`)) {
        matriz.push([" ", tl]);
      }
    }
    if (it.notes) {
      for (const nl of wrapName(`NOTA: ${it.notes}`)) matriz.push([" ", nl]);
    }
    matriz.push(["", ""]);
  }

  const imprimir: PrintLine[] = [
    { tipo: "linea", tam: "m", align: "c", valor: `PEDIDO N ${order.id}` },
    { tipo: "linea", tam: "m", valor: "" },
    { tipo: "linea", tam: "m", align: "i", valor: `FECHA: ${fecha}` },
    { tipo: "linea", tam: "m", align: "i", valor: `HORA: ${hora}` },
    { tipo: "linea", tam: "m", align: "i", valor: `ZONA: ${order.room_name ?? ""}` },
    { tipo: "linea", tam: "m", valor: "" },
    { tipo: "linea", tam: "m", align: "i", valor: `MESA #: ${order.table_number ?? ""}` },
    { tipo: "linea", tam: "m", align: "i", valor: `MESERO: ${order.attended_by ?? ""}` },
    { tipo: "linea", tam: "m", valor: "" },
    { tipo: "matriz", tam: "m", valor: matriz, longitud: ["5", "30"], align: ["c", "i"] },
    { tipo: "linea", tam: "m", valor: "" },
    { tipo: "linea", tam: "m", valor: "" },
    { tipo: "linea", tam: "p", align: "c", valor: "Impreso por AgoraOps" },
    { tipo: "linea", tam: "m", valor: "" },
  ];

  res.json({
    json_local: JSON.stringify({ imprimir }),
    json_externo: JSON.stringify({
      pedido: String(order.id),
      fecha, hora,
      mesero: order.attended_by ?? "",
      mesa: order.table_number,
      zona: order.room_name ?? "",
      comentario: order.comment ?? "",
      productos: items.map((i) => ({ nombre: i.product_name, cantidad: i.quantity })),
      conexion: { tipo: "", parametros: ["", ""] },
    }),
  });
});

/** Prefactura (Polaris blank_printer_pago type=Pre_Factura). */
ordersRouter.get("/:id/prefactura", async (req, res) => {
  const { order, settings } = await orderPrintContext(req.params.id, req.user!.tenantId);
  if (!order) {
    res.status(404).json({ error: "Orden no encontrada" });
    return;
  }
  const items = await query<{
    product_name: string; quantity: number; unit_price: string; subtotal: string;
  }>(
    `SELECT product_name, quantity, unit_price, subtotal FROM order_items
     WHERE order_id = $1 AND kitchen_status <> 'cancelado' ORDER BY id`,
    [req.params.id],
  );
  const subtotal = items.reduce((s, i) => s + Number(i.subtotal), 0);
  const propina = settings?.tip_enabled
    ? Math.round(subtotal * Number(settings.tip_percentage) / 100)
    : 0;

  res.json({
    formato_moneda: "es-CO",
    comercio: settings?.business_name ?? "",
    direccion: settings?.address ?? "",
    nit: settings?.tax_id ?? "",
    pais: "COLOMBIA",
    ciudad: "",
    pedido: order.id,
    mesa: order.table_number,
    mesero: order.attended_by ?? "",
    simbolo_moneda: "$",
    productos: items.map((i) => ({
      nombre: i.product_name,
      cantidad: i.quantity,
      valor_unitario: Number(i.unit_price),
      valor: Number(i.subtotal),
    })),
    subtotal,
    total: subtotal + propina,
    propina,
    impuestos: [],
    conexion: { tipo: "", parametros: [""] },
  });
});
