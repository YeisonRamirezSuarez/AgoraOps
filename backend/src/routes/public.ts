/**
 * Menú público (§1.6.2) — SIN autenticación. Es lo que ve el cliente al
 * escanear el QR de la mesa. La URL es estable por establecimiento
 * (`/m/<tenantId>?c=<code>`): el menú se resuelve según el día en el
 * servidor, así que el QR impreso nunca cambia aunque cambie el menú.
 *
 * Aislamiento multi-tenant: el tenant viene en la ruta y se valida con el
 * `code` (HMAC). Solo se exponen datos públicos del menú de ESE tenant.
 */
import { Router } from "express";
import { query, queryOne } from "../db.js";
import { verifyTenantCode } from "../lib/publicToken.js";

export const publicRouter = Router();

/** Día de la semana en hora local de Colombia (igual que products.ts). */
const MENU_TZ = "America/Bogota";
function menuWeekday(): number {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: MENU_TZ }).format(new Date());
  return new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0=domingo … 6=sábado
}

interface MenuProduct {
  id: number;
  name: string;
  desc: string | null;
  price: string;
  image_url: string | null;
  category_id: number;
  category_name: string;
  category_order: number;
}

publicRouter.get("/menu/:tenantId", async (req, res) => {
  const { tenantId } = req.params;
  const code = typeof req.query.c === "string" ? req.query.c : undefined;
  if (!verifyTenantCode(tenantId, code)) {
    res.status(404).json({ error: "Menú no encontrado" });
    return;
  }

  const business = await queryOne<{
    business_name: string | null;
    logo_url: string | null;
    theme_palette: string | null;
    address: string | null;
    phone: string | null;
    instagram: string | null;
    facebook: string | null;
    currency_symbol: string;
    currency_decimals: number;
  }>(
    `SELECT bs.business_name, bs.logo_url, bs.theme_palette, bs.address,
            bs.phone, bs.instagram, bs.facebook,
            t.currency_symbol, t.currency_decimals
     FROM business_settings bs
     JOIN tenants t ON t.id = bs.tenant_id
     WHERE bs.tenant_id = $1`,
    [tenantId],
  );
  if (!business) {
    res.status(404).json({ error: "Menú no encontrado" });
    return;
  }

  const weekday = menuWeekday();
  // Mismo criterio que GET /products/menu/* : activos, precio > 0 y solo
  // categorías priorizadas para el día (sin prioridad → no se muestra).
  const products = await query<MenuProduct>(
    `SELECT p.id, p.name, p.description AS "desc", p.sale_price AS price,
            p.image_url, p.category_id, c.name AS category_name,
            COALESCE(mp.sort_order, 999) AS category_order
     FROM products p
     JOIN categories c ON c.id = p.category_id AND c.is_active
     LEFT JOIN menu_priority mp
       ON mp.category_id = c.id AND mp.weekday = $2 AND mp.tenant_id = $1
     WHERE p.tenant_id = $1 AND p.is_active AND p.sale_price > 0
       AND mp.id IS NOT NULL
     ORDER BY category_order, c.name, p.name`,
    [tenantId, weekday],
  );

  // Agrupa por categoría conservando el orden de prioridad del día.
  type PubProduct = Omit<MenuProduct, "category_order">;
  const categories: { id: number; name: string; products: PubProduct[] }[] = [];
  const byId = new Map<number, number>(); // category_id → índice en categories
  const visibles = new Map<number, PubProduct>(); // product_id → producto visible
  for (const p of products) {
    let idx = byId.get(p.category_id);
    if (idx === undefined) {
      idx = categories.length;
      byId.set(p.category_id, idx);
      categories.push({ id: p.category_id, name: p.category_name, products: [] });
    }
    const prod: PubProduct = {
      id: p.id, name: p.name, desc: p.desc, price: p.price,
      image_url: p.image_url, category_id: p.category_id, category_name: p.category_name,
    };
    categories[idx].products.push(prod);
    visibles.set(p.id, prod);
  }

  // Recomendados: más vendidos (últimos 30 días, pedidos pagados) que sigan
  // visibles en el menú de hoy. Cuando exista el módulo de Promociones, sus
  // productos también entrarán aquí. Si no hay ventas, se rellena con los
  // primeros del menú para que la sección no quede vacía.
  const RECO_MAX = 8;
  const recommended: PubProduct[] = [];
  if (visibles.size > 0) {
    const masVendidos = await query<{ product_id: number }>(
      `SELECT oi.product_id
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.tenant_id = $1 AND o.status = 'pagada'
         AND oi.kitchen_status <> 'cancelado'
         AND oi.product_id IS NOT NULL
         AND o.created_at >= now() - interval '30 days'
       GROUP BY oi.product_id
       ORDER BY SUM(oi.quantity) DESC
       LIMIT 30`,
      [tenantId],
    );
    for (const r of masVendidos) {
      const p = visibles.get(r.product_id);
      if (p && !recommended.includes(p)) recommended.push(p);
      if (recommended.length >= RECO_MAX) break;
    }
    if (recommended.length < RECO_MAX) {
      for (const p of visibles.values()) {
        if (!recommended.includes(p)) recommended.push(p);
        if (recommended.length >= RECO_MAX) break;
      }
    }
  }

  res.json({
    recommended,
    business: {
      name: business.business_name,
      logo_url: business.logo_url,
      theme_palette: business.theme_palette,
      address: business.address,
      phone: business.phone,
      instagram: business.instagram,
      facebook: business.facebook,
      currency_symbol: business.currency_symbol ?? "$",
      currency_decimals: business.currency_decimals ?? 0,
    },
    categories,
  });
});
