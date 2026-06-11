/**
 * Inventario → Movimientos — manual §1.11.4.
 * Origen PHP: anadirInventario() + historialInsumo() (historial_inventario)
 * y materia_prima.php. Entradas: Compra/Ajuste (proveedor y total);
 * Salidas: Devolución/Venta/Daño/Vencido/Ajuste. Presentación de compra
 * multiplica por el factor de conversión. Movimiento de caja opcional
 * (solo cajas abiertas).
 */
import { Router } from "express";
import { z } from "zod";
import { pool, query } from "../db.js";
import { dbErrorMessage } from "../lib/crud.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { ENTRY_REASONS, EXIT_REASONS } from "../lib/constants.js";

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth, requireAdmin);

inventoryRouter.get("/movements", async (req, res) => {
  const rows = await query(
    `SELECT im.*, ip.name AS product_name, ip.unit, s.name AS supplier_name,
            pp.name AS presentation_name
     FROM inventory_movements im
     JOIN inventory_products ip ON ip.id = im.inventory_product_id
     LEFT JOIN suppliers s ON s.id = im.supplier_id
     LEFT JOIN purchase_presentations pp ON pp.id = im.presentation_id
     WHERE im.tenant_id = $1
     ORDER BY im.created_at DESC LIMIT 300`,
    [req.user!.tenantId],
  );
  res.json(rows);
});

inventoryRouter.post("/movements", async (req, res) => {
  const schema = z.object({
    inventoryProductId: z.number(),
    direction: z.enum(["ENTRADA", "SALIDA"]),
    reason: z.string(),
    quantity: z.number().positive(),
    presentationId: z.number().nullish(),
    supplierId: z.number().nullish(),
    total: z.number().min(0).nullish(),
    referenceDocument: z.string().nullish(),
    cashSessionId: z.number().nullish(),
    cashMovementType: z.enum(["ENTRADA", "SALIDA"]).nullish(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Complete todos los campos requeridos" });
    return;
  }
  const d = parsed.data;

  const validReasons = d.direction === "ENTRADA" ? ENTRY_REASONS : EXIT_REASONS;
  if (!validReasons.includes(d.reason)) {
    res.status(400).json({ error: `Razón inválida para ${d.direction}` });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: [item] } = await client.query(
      "SELECT * FROM inventory_products WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
      [d.inventoryProductId, req.user!.tenantId],
    );
    if (!item) throw Object.assign(new Error("Producto de inventario no encontrado"), { code: "P0001", message: "Producto de inventario no encontrado" });

    // Presentación de compra: 1 paca = factor unidades (§1.11.1)
    let qty = d.quantity;
    if (d.presentationId) {
      const { rows: [pres] } = await client.query(
        "SELECT conversion_factor FROM purchase_presentations WHERE id = $1 AND inventory_product_id = $2",
        [d.presentationId, d.inventoryProductId],
      );
      if (pres) qty = d.quantity * Number(pres.conversion_factor);
    }

    const before = Number(item.stock);
    const after = d.direction === "ENTRADA" ? before + qty : before - qty;

    // §1.11.4: salida sin stock suficiente → error (salvo sobregiro §1.8.1)
    if (d.direction === "SALIDA" && after < 0) {
      const { rows: [bs] } = await client.query(
        "SELECT allow_overdraft FROM business_settings WHERE tenant_id = $1",
        [req.user!.tenantId],
      );
      if (!bs?.allow_overdraft) {
        throw Object.assign(new Error("No se cuenta con la cantidad necesaria del producto"), { code: "P0001", message: "No se cuenta con la cantidad necesaria del producto" });
      }
    }

    const { rows: [movement] } = await client.query(
      `INSERT INTO inventory_movements
         (tenant_id, inventory_product_id, direction, reason, quantity,
          presentation_id, supplier_id, total, reference_document,
          cash_session_id, cash_movement_type, qty_before, qty_after,
          user_id, user_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        req.user!.tenantId, d.inventoryProductId, d.direction, d.reason, qty,
        d.presentationId ?? null,
        d.direction === "ENTRADA" ? d.supplierId ?? null : null,
        d.direction === "ENTRADA" ? d.total ?? null : null,
        d.referenceDocument ?? null,
        d.cashSessionId ?? null, d.cashMovementType ?? null,
        before, after, req.user!.id, req.user!.fullName,
      ],
    );

    await client.query(
      "UPDATE inventory_products SET stock = $1, updated_at = now() WHERE id = $2",
      [after, d.inventoryProductId],
    );

    // Movimiento de caja opcional (§1.11.4): solo cajas abiertas
    if (d.cashSessionId && d.cashMovementType) {
      const { rows: [session] } = await client.query(
        "SELECT id FROM cash_sessions WHERE id = $1 AND tenant_id = $2 AND status = 'abierta'",
        [d.cashSessionId, req.user!.tenantId],
      );
      if (!session) {
        throw Object.assign(new Error("La caja seleccionada no está abierta"), { code: "P0001", message: "La caja seleccionada no está abierta" });
      }
      const amount = d.total ?? 0;
      if (amount <= 0) {
        throw Object.assign(new Error("Indique el total para el movimiento de caja"), { code: "P0001", message: "Indique el total para el movimiento de caja" });
      }
      await client.query(
        `INSERT INTO cash_transactions (tenant_id, cash_session_id, type, reason, amount, user_id, user_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user!.tenantId, d.cashSessionId, d.cashMovementType,
          `Inventario: ${d.reason} — ${item.name ?? d.inventoryProductId}`,
          amount, req.user!.id, req.user!.fullName,
        ],
      );
    }

    await client.query("COMMIT");
    res.status(201).json(movement);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: dbErrorMessage(err) });
  } finally {
    client.release();
  }
});

/** Editar movimiento: solo Documento de referencia; salidas solo lectura (§1.11.4). */
inventoryRouter.put("/movements/:id", async (req, res) => {
  const rows = await query(
    `UPDATE inventory_movements SET reference_document = $3
     WHERE id = $1 AND tenant_id = $2 AND direction = 'ENTRADA' RETURNING *`,
    [req.params.id, req.user!.tenantId, req.body.referenceDocument ?? null],
  );
  if (rows.length === 0) {
    res.status(409).json({
      error: "Solo se puede editar el documento de referencia de las entradas.",
    });
    return;
  }
  res.json(rows[0]);
});

/** Presentaciones de compra de un producto (§1.11.1). */
inventoryRouter.get("/products/:id/presentations", async (req, res) => {
  res.json(await query(
    "SELECT * FROM purchase_presentations WHERE inventory_product_id = $1",
    [req.params.id],
  ));
});

inventoryRouter.post("/products/:id/presentations", async (req, res) => {
  const schema = z.object({ name: z.string().min(1), conversionFactor: z.number().positive() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Nombre y factor de conversión son obligatorios" });
    return;
  }
  const rows = await query(
    `INSERT INTO purchase_presentations (inventory_product_id, name, conversion_factor)
     VALUES ($1, $2, $3) RETURNING *`,
    [req.params.id, parsed.data.name, parsed.data.conversionFactor],
  );
  res.status(201).json(rows[0]);
});
