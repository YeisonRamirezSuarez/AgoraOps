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

// requireAuth a nivel de router: garantiza req.user en el param callback de
// abajo (los param callbacks corren antes que el middleware por-ruta). Todas
// las rutas de productos requieren autenticación; requireAdmin sigue por ruta.
productsRouter.use(requireAuth);

/** Aislamiento multi-tenant para los subrecursos (/:id/recipe, /toppings,
 * /variants, /combo): valida que el producto sea del tenant del JWT. No
 * afecta al crudRouter de abajo, cuyo :id es interno y ya filtra tenant. */
productsRouter.param("id", (req, res, next, id) => {
  queryOne("SELECT id FROM products WHERE id = $1 AND tenant_id = $2", [
    id,
    req.user!.tenantId,
  ])
    .then((product) => {
      if (!product) {
        res.status(404).json({ error: "Producto no encontrado" });
        return;
      }
      next();
    })
    .catch(next);
});

// Autogeneración de código (§1.10.1): Polaris no pide un código manual al
// crear el producto. Si el cliente no envía `code`, asignamos el siguiente
// correlativo numérico del tenant para satisfacer UNIQUE(tenant_id, code) sin
// exponer el campo en la UI. next() cae en el POST "/" del crudRouter de abajo.
productsRouter.post("/", requireAdmin, async (req, res, next) => {
  if (req.body.code === undefined || req.body.code === null || req.body.code === "") {
    try {
      const row = await queryOne<{ next: string }>(
        `SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '\\D', '', 'g'), '')::bigint), 0) + 1 AS next
           FROM products WHERE tenant_id = $1`,
        [req.user!.tenantId],
      );
      req.body.code = String(row?.next ?? 1);
    } catch (err) {
      next(err);
      return;
    }
  }
  next();
});

/* ───────── Carga masiva de productos por Excel (§1.10.2) ─────────
   El frontend lee el XLS/XLSX y envía las filas como JSON. Se procesa fila
   por fila (errores aislados, reporte por fila estilo Polaris). Columnas de
   la plantilla: Categoría, NombreProducto, PrecioVenta, Cocina, Estado,
   Descripción, Inventariable, CantidadInicial, CantidadMinima e Impuestos
   (estas últimas se ignoran: AgoraOps aún no tiene módulo de impuestos). */
function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "");
}
const TRUE_TOKENS = new Set(["si", "s", "x", "1", "true", "verdadero", "activo", "yes", "y"]);
function parseBool(v: unknown, dflt: boolean): boolean {
  if (v === undefined || v === null || String(v).trim() === "") return dflt;
  return TRUE_TOKENS.has(norm(String(v)));
}
function parseNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v === undefined || v === null) return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
/** Acceso a una celda por nombre de columna, tolerante a acentos/mayúsculas. */
function rowGetter(row: Record<string, unknown>) {
  const map = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) map.set(norm(k), v);
  return (...keys: string[]): unknown => {
    for (const k of keys) {
      const v = map.get(norm(k));
      if (v !== undefined) return v;
    }
    return undefined;
  };
}

productsRouter.post("/bulk", requireAdmin, async (req, res) => {
  const operation = req.body.operation === "update" ? "update" : "create";
  const rows: Record<string, unknown>[] = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (rows.length === 0) {
    res.status(400).json({ error: "No hay filas para procesar." });
    return;
  }
  const tenantId = req.user!.tenantId;
  const errors: { row: number; name: string; message: string }[] = [];
  let created = 0, updated = 0, skipped = 0;

  // Cache de categorías por nombre normalizado (para resolver/crear)
  const catRows = await query<{ id: number; name: string }>(
    "SELECT id, name FROM categories WHERE tenant_id = $1", [tenantId]);
  const catByName = new Map<string, number>();
  for (const c of catRows) catByName.set(norm(c.name), c.id);

  // Código base para autogeneración (solo en create); se incrementa por fila.
  let nextCode = 0;
  if (operation === "create") {
    const r = await queryOne<{ next: string }>(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '\\D', '', 'g'), '')::bigint), 0) + 1 AS next
         FROM products WHERE tenant_id = $1`, [tenantId]);
    nextCode = Number(r?.next ?? 1);
  }

  for (let i = 0; i < rows.length; i++) {
    const excelRow = i + 2; // fila 1 = encabezados
    const get = rowGetter(rows[i]);
    const catNameRaw = String(get("Categoria", "Categoría") ?? "").trim();
    const name = String(get("NombreProducto", "Nombre", "Producto") ?? "").trim();
    if (!name && !catNameRaw) { skipped++; continue; } // fila vacía
    try {
      if (!name) throw new Error("NombreProducto está vacío");
      if (!catNameRaw) throw new Error("Categoría está vacía");

      let categoryId = catByName.get(norm(catNameRaw));
      if (!categoryId) {
        const nc = await queryOne<{ id: number }>(
          "INSERT INTO categories (tenant_id, name, is_active) VALUES ($1, $2, true) RETURNING id",
          [tenantId, catNameRaw]);
        categoryId = nc!.id;
        catByName.set(norm(catNameRaw), categoryId);
      }

      const salePrice = parseNum(get("PrecioVenta", "Precio"));
      const goesToKitchen = parseBool(get("Cocina"), false);
      const isActive = parseBool(get("Estado"), true);
      const description = String(get("Descripcion", "Descripción") ?? "").trim() || null;
      const isInventariable = parseBool(get("Inventariable"), false);
      const cantInicial = parseNum(get("CantidadInicial"));
      const cantMinima = parseNum(get("CantidadMinima"));

      if (operation === "create") {
        const prod = await queryOne<{ id: number }>(
          `INSERT INTO products
             (tenant_id, category_id, code, name, description, product_type,
              sale_price, cost_price, is_inventariable, goes_to_kitchen, is_active)
           VALUES ($1, $2, $3, $4, $5, 'NORMAL', $6, 0, $7, $8, $9) RETURNING id`,
          [tenantId, categoryId, String(nextCode++), name, description,
            salePrice, isInventariable, goesToKitchen, isActive]);
        if (isInventariable) {
          await query(
            `INSERT INTO inventory_products (tenant_id, type, name, unit, product_id, stock, min_stock, is_active)
             VALUES ($1, 'consumible', $2, 'Unidad', $3, $4, $5, true)`,
            [tenantId, name, prod!.id, cantInicial, cantMinima]);
        }
        created++;
      } else {
        const existing = await queryOne<{ id: number }>(
          "SELECT id FROM products WHERE tenant_id = $1 AND category_id = $2 AND lower(name) = lower($3)",
          [tenantId, categoryId, name]);
        if (!existing) {
          throw new Error(`No existe el producto "${name}" en la categoría "${catNameRaw}"`);
        }
        await query(
          `UPDATE products SET sale_price = $1, goes_to_kitchen = $2, is_active = $3,
                  description = $4, is_inventariable = $5
           WHERE id = $6 AND tenant_id = $7`,
          [salePrice, goesToKitchen, isActive, description, isInventariable, existing.id, tenantId]);
        if (isInventariable) {
          const cons = await queryOne<{ id: number }>(
            "SELECT id FROM inventory_products WHERE tenant_id = $1 AND product_id = $2 AND type = 'consumible'",
            [tenantId, existing.id]);
          if (cons) {
            await query("UPDATE inventory_products SET stock = $1, min_stock = $2 WHERE id = $3",
              [cantInicial, cantMinima, cons.id]);
          } else {
            await query(
              `INSERT INTO inventory_products (tenant_id, type, name, unit, product_id, stock, min_stock, is_active)
               VALUES ($1, 'consumible', $2, 'Unidad', $3, $4, $5, true)`,
              [tenantId, name, existing.id, cantInicial, cantMinima]);
          }
        }
        updated++;
      }
    } catch (err) {
      errors.push({ row: excelRow, name: name || catNameRaw || "(fila)", message: dbErrorMessage(err) });
    }
  }

  res.json({ operation, total: rows.length, created, updated, skipped, errors });
});

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

/** Zona horaria del negocio: el día de la semana para Prioridad del Menú debe
 * calcularse en hora local de Colombia, no en la del servidor. En Vercel (UTC)
 * `new Date().getDay()` adelanta el día tras ~7pm CO y desalineaba la prioridad
 * de "hoy" con la guardada, dejando ver categorías no priorizadas. */
const MENU_TZ = "America/Bogota";
function menuWeekday(): number {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: MENU_TZ }).format(new Date());
  return new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0=domingo … 6=sábado
}

/** Menú (§1.6.1): activos, con precio > 0; respeta Prioridad del Menú. */
productsRouter.get("/menu/list", requireAuth, async (req, res) => {
  const weekday = menuWeekday();
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
         -- Inventariable pero aún sin consumible vinculado: nada que descontar,
         -- así que sigue visible (evita que un producto recién creado, que por
         -- defecto nace is_inventariable=true, desaparezca del menú sin stock).
         OR NOT EXISTS (SELECT 1 FROM inventory_products ip
                    WHERE ip.product_id = p.id AND ip.type = 'consumible')
       )
       -- Solo categorías en la prioridad del día (§1.7.6); sin prioridad → oculto
       AND mp.id IS NOT NULL
     ORDER BY category_order, c.name, p.name`,
    [req.user!.tenantId, weekday],
  );
  res.json(rows);
});

/** Menú con la forma de Polaris (get_products_by_category): productos con
 * variantes, toppings y receta, más mapa de inventario {id: {name, stock}}
 * para la validación de disponibilidad en el cliente (array_inventario). */
productsRouter.get("/menu/polaris", requireAuth, async (req, res) => {
  const weekday = menuWeekday();
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
         -- Solo categorías en la prioridad del día (§1.7.6); sin prioridad → oculto
         AND mp.id IS NOT NULL
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
    if (items.length > 0) {
      // Un INSERT por lote (unnest) en lugar de uno por ingrediente.
      await query(
        `INSERT INTO recipes (product_id, inventory_product_id, quantity_used)
         SELECT $1, x.inv_id, x.qty
         FROM unnest($2::int[], $3::numeric[]) AS x(inv_id, qty)`,
        [req.params.id, items.map((i) => i.inventoryProductId), items.map((i) => i.quantityUsed)],
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
    if (items.length > 0) {
      // Un INSERT por lote (unnest) en lugar de uno por topping.
      await query(
        `INSERT INTO product_toppings (product_id, topping_id, max_allowed)
         SELECT $1, x.topping_id, x.max_allowed
         FROM unnest($2::int[], $3::int[]) AS x(topping_id, max_allowed)`,
        [req.params.id, items.map((i) => i.toppingId), items.map((i) => i.maxAllowed)],
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

productsRouter.delete("/:id/variants/:variantId", requireAuth, requireAdmin, async (req, res) => {
  try {
    const row = await queryOne(
      "DELETE FROM product_variants WHERE id = $1 AND product_id = $2 RETURNING id",
      [req.params.variantId, req.params.id],
    );
    if (!row) {
      res.status(404).json({ error: "Variante no encontrada" });
      return;
    }
    res.json({ ok: true });
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
    if (items.length > 0) {
      // Un INSERT por lote (unnest) en lugar de uno por componente del combo.
      await query(
        `INSERT INTO combo_items (combo_id, product_id, quantity)
         SELECT $1, x.product_id, x.qty
         FROM unnest($2::int[], $3::int[]) AS x(product_id, qty)`,
        [req.params.id, items.map((i) => i.productId), items.map((i) => i.quantity)],
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});
