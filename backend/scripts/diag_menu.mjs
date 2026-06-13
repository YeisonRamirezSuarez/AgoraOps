/**
 * Diagnóstico: por qué un producto no aparece en el menú.
 * Uso: node scripts/diag_menu.mjs [filtroTenant]
 * Replica el workaround DNS/SSL de src/db.ts para conectar a Supabase pooler.
 */
import "dotenv/config";
import pg from "pg";
import net from "node:net";
import dns from "node:dns";

const dnsResolver = new dns.Resolver();
dnsResolver.setServers(["8.8.8.8", "1.1.1.1"]);

function customStream(streamConfig) {
  const socket = new net.Socket();
  const originalConnect = socket.connect;
  socket.connect = function (options) {
    let host = "", port = 0;
    if (typeof options === "object") { host = options.host; port = options.port; }
    else { port = arguments[0]; host = arguments[1]; }
    if (host === "localhost" || host === "127.0.0.1" || net.isIP(host)) {
      return originalConnect.apply(this, arguments);
    }
    dnsResolver.resolve4(host, (err, addresses) => {
      if (err || !addresses?.length) originalConnect.call(socket, { host, port });
      else originalConnect.call(socket, { host: addresses[0], port });
    });
    return socket;
  };
  return socket;
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  stream: customStream,
});

const filtro = (process.argv[2] ?? "karen").toLowerCase();

try {
  // 1. Localizar tenants relacionados con el filtro (por nombre de tenant o usuario)
  const tenants = await pool.query(
    `SELECT DISTINCT t.id, t.name, t.slug, t.is_active, t.timezone
       FROM tenants t
       LEFT JOIN users u ON u.tenant_id = t.id
      WHERE lower(t.name) LIKE $1 OR lower(t.slug) LIKE $1
         OR lower(u.full_name) LIKE $1 OR lower(u.username) LIKE $1
      ORDER BY t.name`,
    [`%${filtro}%`],
  );

  if (tenants.rows.length === 0) {
    console.log(`No se encontró ningún tenant/usuario que coincida con "${filtro}".`);
    console.log("Tenants existentes:");
    const all = await pool.query("SELECT name, slug, is_active FROM tenants ORDER BY name");
    console.table(all.rows);
    process.exit(0);
  }

  const now = new Date();
  console.log(`\nFecha/hora servidor: ${now.toISOString()}  | getDay()=${now.getDay()} (0=domingo)\n`);

  for (const t of tenants.rows) {
    console.log("=".repeat(70));
    console.log(`TENANT: ${t.name}  (slug=${t.slug}, activo=${t.is_active}, tz=${t.timezone})`);
    console.log(`id=${t.id}`);
    const weekday = now.getDay();

    // 2. Prioridad de menú configurada
    const prio = await pool.query(
      `SELECT mp.weekday, mp.category_id, c.name AS category, mp.sort_order
         FROM menu_priority mp JOIN categories c ON c.id = mp.category_id
        WHERE mp.tenant_id = $1 ORDER BY mp.weekday, mp.sort_order`,
      [t.id],
    );
    console.log(`\n-- menu_priority (total filas: ${prio.rows.length}) --`);
    if (prio.rows.length) console.table(prio.rows);
    const prioHoy = prio.rows.filter((r) => r.weekday === weekday);
    console.log(`Categorías favoritas para HOY (weekday=${weekday}): ${
      prioHoy.length ? prioHoy.map((r) => r.category).join(", ") : "NINGUNA → se muestran todas"}`);

    // 3. Todos los productos con diagnóstico de visibilidad
    const diag = await pool.query(
      `SELECT p.id, p.code, p.name, p.is_active AS prod_activo, p.sale_price AS precio,
              p.is_inventariable AS invent, p.goes_to_kitchen AS a_cocina,
              c.name AS categoria, c.is_active AS cat_activa,
              EXISTS (SELECT 1 FROM menu_priority mp
                        WHERE mp.tenant_id = $1 AND mp.weekday = $2
                          AND mp.category_id = p.category_id) AS cat_en_prioridad_hoy,
              (SELECT count(*) FROM inventory_products ip
                 WHERE ip.product_id = p.id AND ip.type = 'consumible') AS consumibles_vinc,
              (SELECT COALESCE(sum(ip.stock),0) FROM inventory_products ip
                 WHERE ip.product_id = p.id AND ip.type = 'consumible') AS stock_consumible
         FROM products p JOIN categories c ON c.id = p.category_id
        WHERE p.tenant_id = $1
        ORDER BY p.created_at DESC NULLS LAST, p.id DESC`,
      [t.id, weekday],
    );

    console.log(`\n-- Productos del tenant (${diag.rows.length}) [más recientes primero] --`);
    const hayPrioHoy = prioHoy.length > 0;
    const rows = diag.rows.map((p) => {
      const razones = [];
      if (!p.prod_activo) razones.push("producto inactivo");
      if (Number(p.precio) <= 0) razones.push("precio<=0");
      if (!p.cat_activa) razones.push("categoría inactiva");
      if (hayPrioHoy && !p.cat_en_prioridad_hoy) razones.push("categoría NO está en prioridad de hoy");
      // stock: oculto si inventariable && !a_cocina && tiene consumibles vinculados && stock<=0 (sin overdraft)
      if (p.invent && !p.a_cocina && Number(p.consumibles_vinc) > 0 && Number(p.stock_consumible) <= 0)
        razones.push("inventariable sin stock");
      return {
        id: p.id, code: p.code, name: p.name, categoria: p.categoria,
        precio: p.precio, activo: p.prod_activo, cat_activa: p.cat_activa,
        en_prio_hoy: p.cat_en_prioridad_hoy, invent: p.invent,
        VISIBLE: razones.length === 0 ? "SÍ" : "NO",
        motivo_oculto: razones.join("; ") || "",
      };
    });
    console.table(rows);
  }
} catch (e) {
  console.error("ERROR de conexión/consulta:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
