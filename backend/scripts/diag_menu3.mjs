import "dotenv/config";
import pg from "pg";
import net from "node:net";
import dns from "node:dns";
const r = new dns.Resolver(); r.setServers(["8.8.8.8", "1.1.1.1"]);
function cs() {
  const s = new net.Socket(); const oc = s.connect;
  s.connect = function (o) {
    let host = "", port = 0;
    if (typeof o === "object") { host = o.host; port = o.port; } else { port = arguments[0]; host = arguments[1]; }
    if (host === "localhost" || host === "127.0.0.1" || net.isIP(host)) return oc.apply(this, arguments);
    r.resolve4(host, (e, a) => e || !a?.length ? oc.call(s, { host, port }) : oc.call(s, { host: a[0], port }));
    return s;
  };
  return s;
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, stream: cs });
const TENANT = "06d1d9c1-6d0f-4c30-bcdc-70497f4e6091";
const weekday = new Date().getDay();

// Consulta EXACTA de GET /api/products/menu/list (products.ts)
const MENU_SQL = `SELECT p.id, p.name, p.is_active, p.sale_price
     FROM products p
     JOIN categories c ON c.id = p.category_id AND c.is_active
     LEFT JOIN menu_priority mp
       ON mp.category_id = c.id AND mp.weekday = $2 AND mp.tenant_id = $1
     WHERE p.tenant_id = $1 AND p.is_active AND p.sale_price > 0
       AND (
         NOT p.is_inventariable OR p.goes_to_kitchen
         OR EXISTS (SELECT 1 FROM business_settings bs WHERE bs.tenant_id = $1 AND bs.allow_overdraft)
         OR EXISTS (SELECT 1 FROM inventory_products ip WHERE ip.product_id = p.id AND ip.type = 'consumible' AND ip.stock > 0)
         OR NOT EXISTS (SELECT 1 FROM inventory_products ip WHERE ip.product_id = p.id AND ip.type = 'consumible')
       )
       AND (
         NOT EXISTS (SELECT 1 FROM menu_priority WHERE tenant_id = $1 AND weekday = $2)
         OR mp.id IS NOT NULL
       )
     ORDER BY COALESCE(mp.sort_order, 999), c.name, p.name`;

try {
  console.log(`weekday hoy = ${weekday}`);
  const real = await pool.query(MENU_SQL, [TENANT, weekday]);
  console.log(`\n[1] Menú REAL (estado actual del producto, is_active=false):`);
  console.log(`    Filas devueltas: ${real.rows.length}`, real.rows);

  // Simulación: ¿qué pasaría si is_active fuese true? (en una transacción que se revierte)
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE products SET is_active = true WHERE id = 3 AND tenant_id = $1", [TENANT]);
    const sim = await client.query(MENU_SQL, [TENANT, weekday]);
    console.log(`\n[2] Menú SIMULADO (poniendo is_active=true, sin guardar):`);
    console.log(`    Filas devueltas: ${sim.rows.length}`, sim.rows);
    await client.query("ROLLBACK"); // no se guarda nada
    console.log("\n(La simulación se revirtió con ROLLBACK — no se modificó la base de datos.)");
  } finally { client.release(); }
} catch (e) { console.error("ERROR:", e.message); } finally { await pool.end(); }
