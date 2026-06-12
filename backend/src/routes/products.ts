/**
 * Productos — manual §1.10.
 * Origen PHP: registrar_insumo, editar_insumo, eliminar_insumo,
 * obtener_insumo*, insumos.php (precio/costo/impresora rápidos),
 * producto_topings, consumo_inventario (recetas).
 * CRUD base + subrecursos: receta, toppings asociados, variantes, combo.
 */
import { Router } from "express";
import { query, queryOne } from "../db.js";
import { crudRouter, dbErrorMessage } from "../lib/crud.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

export const productsRouter = Router();

// CRUD base (eliminar con ventas asociadas lo bloquea la FK de order_items)
productsRouter.use("/", crudRouter({
  table: "products",
  columns: [
    "category_id", "code", "name", "description", "product_type",
    "sale_price", "cost_price", "is_inventariable", "goes_to_kitchen",
    "image_url", "printer_id", "is_active",
  ],
  orderBy: "name",
  // Productos es exclusivo del administrador (§1.10); el menú para
  // mesero/mesero_cocina se sirve aparte en GET /menu/list.
}));

/** Menú (§1.6.1): activos, con precio > 0; respeta Prioridad del Menú. */
productsRouter.get("/menu/list", requireAuth, async (req, res) => {
  const weekday = new Date().getDay();
  const rows = await query(
    `SELECT p.*, c.name AS category_name,
            COALESCE(mp.sort_order, 999) AS category_order
     FROM products p
     JOIN categories c ON c.id = p.category_id AND c.is_active
     LEFT JOIN menu_priority mp
       ON mp.category_id = c.id AND mp.weekday = $2 AND mp.tenant_id = $1
     WHERE p.tenant_id = $1 AND p.is_active AND p.sale_price > 0
       -- Sin stock → oculto salvo sobregiro activo (§1.8.1)
       AND (
         NOT p.is_inventariable OR p.goes_to_kitchen
         OR EXISTS (SELECT 1 FROM business_settings bs
                    WHERE bs.tenant_id = $1 AND bs.allow_overdraft)
         OR EXISTS (SELECT 1 FROM inventory_products ip
                    WHERE ip.product_id = p.id AND ip.type = 'consumible' AND ip.stock > 0)
       )
       -- Si hay categorías favoritas para hoy, solo esas (§1.7.6)
       AND (
         NOT EXISTS (SELECT 1 FROM menu_priority WHERE tenant_id = $1 AND weekday = $2)
         OR mp.id IS NOT NULL
       )
     ORDER BY category_order, c.name, p.name`,
    [req.user!.tenantId, weekday],
  );
  res.json(rows);
});

/** Menú con la forma de Polaris (get_products_by_category): productos con
 * variantes, toppings y receta, más mapa de inventario {id: {name, stock}}
 * para la validación de disponibilidad en el cliente (array_inventario). */
productsRouter.get("/menu/polaris", requireAuth, async (req, res) => {
  const weekday = new Date().getDay();
  const [products, inventory] = await Promise.all([
    query(
      `SELECT p.id, p.name, p.description AS "desc", p.sale_price AS price,
              p.is_inventariable, p.goes_to_kitchen, p.product_type AS type_product,
              p.category_id, c.name AS category_name,
              COALESCE(mp.sort_order, 999) AS category_order,
              COALESCE((SELECT json_agg(json_build_object(
                  'id', v.id, 'name', v.name, 'price', v.sale_price,
                  'uses_inventory', v.uses_inventory,
                  'receta', (SELECT COALESCE(json_agg(json_build_object(
                      'product_id', r.inventory_product_id, 'quantity', r.quantity_used)), '[]')
                    FROM recipes r WHERE r.variant_id = v.id)))
                FROM product_variants v
                WHERE v.product_id = p.id AND v.is_active), '[]') AS variantes,
              COALESCE((SELECT json_agg(json_build_object(
                  'id', t.id, 'name', t.name, 'price', t.price,
                  'max_allowed', pt.max_allowed))
                FROM product_toppings pt
                JOIN toppings t ON t.id = pt.topping_id AND t.is_active
                WHERE pt.product_id = p.id), '[]') AS toppings,
              (SELECT json_agg(json_build_object(
                  'product_id', r.inventory_product_id, 'quantity', r.quantity_used))
                FROM recipes r WHERE r.product_id = p.id) AS receta
       FROM products p
       JOIN categories c ON c.id = p.category_id AND c.is_active
       LEFT JOIN menu_priority mp
         ON mp.category_id = c.id AND mp.weekday = $2 AND mp.tenant_id = $1
       WHERE p.tenant_id = $1 AND p.is_active AND p.sale_price >= 0
         AND (
           NOT EXISTS (SELECT 1 FROM menu_priority WHERE tenant_id = $1 AND weekday = $2)
           OR mp.id IS NOT NULL
         )
       ORDER BY category_order, c.name, p.name`,
      [req.user!.tenantId, weekday],
    ),
    query(
      `SELECT id, name AS product_name, stock AS quantity
       FROM inventory_products WHERE tenant_id = $1 AND is_active`,
      [req.user!.tenantId],
    ),
  ]);

  const inventoryMap: Record<string, { product_name: string; quantity: number }> = {};
  for (const row of inventory as { id: number; product_name: string; quantity: string }[]) {
    inventoryMap[row.id] = { product_name: row.product_name, quantity: Number(row.quantity) };
  }
  res.json({ status: "success", products, inventory: inventoryMap });
});

/** Receta del producto (PHP: consumo_inventario). */
productsRouter.get("/:id/recipe", requireAuth, requireAdmin, async (req, res) => {
  const rows = await query(
    `SELECT r.*, ip.name AS ingredient_name, ip.unit
     FROM recipes r
     JOIN inventory_products ip ON ip.id = r.inventory_product_id
     WHERE r.product_id = $1`,
    [req.params.id],
  );
  res.json(rows);
});

productsRouter.put("/:id/recipe", requireAuth, requireAdmin, async (req, res) => {
  const items: { inventoryProductId: number; quantityUsed: number }[] =
    req.body.items ?? [];
  try {
    await query("DELETE FROM recipes WHERE product_id = $1", [req.params.id]);
    for (const item of items) {
      await query(
        "INSERT INTO recipes (product_id, inventory_product_id, quantity_used) VALUES ($1, $2, $3)",
        [req.params.id, item.inventoryProductId, item.quantityUsed],
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** Toppings por producto (§1.10.5; PHP: guardarProductoTopings). */
productsRouter.get("/:id/toppings", requireAuth, async (req, res) => {
  const rows = await query(
    `SELECT pt.*, t.name, t.price FROM product_toppings pt
     JOIN toppings t ON t.id = pt.topping_id WHERE pt.product_id = $1`,
    [req.params.id],
  );
  res.json(rows);
});

productsRouter.put("/:id/toppings", requireAuth, requireAdmin, async (req, res) => {
  const items: { toppingId: number; maxAllowed: number }[] = req.body.items ?? [];
  try {
    await query("DELETE FROM product_toppings WHERE product_id = $1", [req.params.id]);
    for (const item of items) {
      await query(
        "INSERT INTO product_toppings (product_id, topping_id, max_allowed) VALUES ($1, $2, $3)",
        [req.params.id, item.toppingId, item.maxAllowed],
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** Variantes (§1.10.1 Habilitar variantes). */
productsRouter.get("/:id/variants", requireAuth, async (req, res) => {
  res.json(await query(
    "SELECT * FROM product_variants WHERE product_id = $1 ORDER BY name",
    [req.params.id],
  ));
});

productsRouter.post("/:id/variants", requireAuth, requireAdmin, async (req, res) => {
  try {
    const row = await queryOne(
      `INSERT INTO product_variants (product_id, name, sale_price, uses_inventory, inventory_mode)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        req.params.id, req.body.name, req.body.salePrice,
        req.body.usesInventory ?? false, req.body.inventoryMode ?? null,
      ],
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** Componentes de combo (§1.10.1 Configurar combo). */
productsRouter.get("/:id/combo", requireAuth, async (req, res) => {
  res.json(await query(
    `SELECT ci.*, p.name FROM combo_items ci
     JOIN products p ON p.id = ci.product_id WHERE ci.combo_id = $1`,
    [req.params.id],
  ));
});

productsRouter.put("/:id/combo", requireAuth, requireAdmin, async (req, res) => {
  const items: { productId: number; quantity: number }[] = req.body.items ?? [];
  try {
    await query("DELETE FROM combo_items WHERE combo_id = $1", [req.params.id]);
    for (const item of items) {
      await query(
        "INSERT INTO combo_items (combo_id, product_id, quantity) VALUES ($1, $2, $3)",
        [req.params.id, item.productId, item.quantity],
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});
