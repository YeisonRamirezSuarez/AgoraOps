/**
 * Monitor de Cocina — manual §1.6.4.
 * Productos confirmados con "A cocina"; estados Requerido → En preparación
 * → Listo; agrupación de productos idénticos; actualización individual o
 * masiva. El tiempo real lo entrega /api/events (SSE).
 */
import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { dbErrorMessage } from "../lib/crud.js";
import { requireAuth } from "../middleware/auth.js";

export const kitchenRouter = Router();
kitchenRouter.use(requireAuth);

/** Tablero: ítems en requerido/en_preparacion agrupados por orden. */
kitchenRouter.get("/board", async (req, res) => {
  const rows = await query(
    `SELECT o.id AS order_id, o.order_number, t.number AS table_number,
            r.name AS room_name, o.opened_at,
            json_agg(json_build_object(
              'ids', i.ids, 'product_name', i.product_name,
              'notes', i.notes, 'toppings', i.toppings,
              'quantity', i.quantity, 'kitchen_status', i.kitchen_status
            ) ORDER BY i.min_id) AS items
     FROM (
       -- §1.6.4: productos idénticos (nombre, notas y toppings) se agrupan
       SELECT oi.order_id, array_agg(oi.id) AS ids, MIN(oi.id) AS min_id,
              oi.product_name, oi.notes, oi.kitchen_status,
              SUM(oi.quantity) AS quantity,
              COALESCE((
                SELECT string_agg(oit.topping_name || ' x' || oit.quantity, ', ' ORDER BY oit.topping_name)
                FROM order_item_toppings oit WHERE oit.order_item_id = MIN(oi.id)
              ), '') AS toppings
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.kitchen_status IN ('requerido', 'en_preparacion')
         AND p.goes_to_kitchen
       GROUP BY oi.order_id, oi.product_name, oi.notes, oi.kitchen_status
     ) i
     JOIN orders o ON o.id = i.order_id AND o.tenant_id = $1
     LEFT JOIN tables t ON t.id = o.table_id
     LEFT JOIN rooms r ON r.id = o.room_id
     GROUP BY o.id, o.order_number, t.number, r.name, o.opened_at
     ORDER BY o.opened_at`,
    [req.user!.tenantId],
  );
  res.json(rows);
});

/** Cambio de estado individual o masivo (§1.6.4). */
kitchenRouter.post("/status", async (req, res) => {
  const schema = z.object({
    itemIds: z.array(z.number()).min(1),
    status: z.enum(["requerido", "en_preparacion", "listo"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Estado o productos inválidos" });
    return;
  }
  try {
    await query("SELECT set_kitchen_status($1, $2, $3)", [
      parsed.data.itemIds, parsed.data.status, req.user!.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** Notificaciones (§1.6.7): campana + módulo de administración. */
kitchenRouter.get("/notifications", async (req, res) => {
  const onlyUnviewed = req.query.unviewed === "1";
  const rows = await query(
    `SELECT n.*, oi.product_name, o.order_number, t.number AS table_number,
            cu.full_name AS created_by_name, vu.full_name AS viewed_by_name
     FROM notifications n
     LEFT JOIN order_items oi ON oi.id = n.order_item_id
     LEFT JOIN orders o ON o.id = oi.order_id
     LEFT JOIN tables t ON t.id = o.table_id
     LEFT JOIN users cu ON cu.id = n.created_by
     LEFT JOIN users vu ON vu.id = n.viewed_by
     WHERE n.tenant_id = $1 ${onlyUnviewed ? "AND n.is_viewed = false" : ""}
     ORDER BY n.created_at DESC LIMIT 100`,
    [req.user!.tenantId],
  );
  res.json(rows);
});

/** Tocar la notificación la marca vista y registra quién la vio (§1.6.4). */
kitchenRouter.post("/notifications/:id/view", async (req, res) => {
  await query(
    `UPDATE notifications SET is_viewed = true, viewed_by = $1
     WHERE id = $2 AND tenant_id = $3`,
    [req.user!.id, req.params.id, req.user!.tenantId],
  );
  res.json({ ok: true });
});
