import "dotenv/config";
import pg from "pg";
import net from "node:net";
import dns from "node:dns";
const r = new dns.Resolver(); r.setServers(["8.8.8.8", "1.1.1.1"]);
function customStream() {
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
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, stream: customStream });
try {
  console.log("== TODOS LOS TENANTS ==");
  console.table((await pool.query("SELECT id, name, slug, is_active FROM tenants ORDER BY name")).rows);

  console.log("\n== USUARIOS 'karen' ==");
  console.table((await pool.query(
    `SELECT u.username, u.full_name, u.is_active, t.name AS tenant, g.name AS grupo
       FROM users u LEFT JOIN tenants t ON t.id=u.tenant_id LEFT JOIN groups g ON g.id=u.group_id
      WHERE lower(u.username) LIKE '%karen%' OR lower(u.full_name) LIKE '%karen%'`)).rows);

  console.log("\n== PRODUCTO(S) del tenant '222' con fechas ==");
  console.table((await pool.query(
    `SELECT p.id, p.code, p.name, p.is_active, p.sale_price, c.name AS cat,
            p.created_at, p.updated_at
       FROM products p JOIN tenants t ON t.id=p.tenant_id JOIN categories c ON c.id=p.category_id
      WHERE t.name='222' OR t.slug='222' ORDER BY p.id`)).rows);

  console.log("\n== CATEGORÍAS del tenant '222' ==");
  console.table((await pool.query(
    `SELECT c.id, c.name, c.is_active FROM categories c JOIN tenants t ON t.id=c.tenant_id
      WHERE t.name='222' OR t.slug='222' ORDER BY c.id`)).rows);
} catch (e) { console.error("ERROR:", e.message); } finally { await pool.end(); }
