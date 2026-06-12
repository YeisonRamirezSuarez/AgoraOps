/**
 * E2E del flujo de cobro vía API (lo mismo que hace la UI):
 * cash-status → payment-options → ocupar mesa → agregar producto →
 * confirmar → Listo en cocina → pagar con Caja de Pago elegida.
 * Usa un token firmado con el JWT_SECRET local (no requiere contraseña).
 * Crea una orden de prueba pagada (cliente del seed).
 */
import pg from "pg";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

const BASE = process.env.API_URL ?? "http://localhost:4000";
const url = process.env.DATABASE_URL;
const db = new pg.Client({
  connectionString: url,
  ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
});
await db.connect();
const { rows: [u] } = await db.query(
  `SELECT u.id, u.tenant_id, u.username, u.full_name, g.name AS group_name,
          g.role_type, u.is_super_admin
   FROM users u LEFT JOIN groups g ON g.id = u.group_id
   WHERE u.username = 'admin'`);
await db.end();

const token = jwt.sign({
  id: u.id, tenantId: u.tenant_id, username: u.username, fullName: u.full_name,
  groupName: u.group_name, roleType: u.role_type, isSuperAdmin: u.is_super_admin,
}, process.env.JWT_SECRET, { expiresIn: "10m" });

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data.error ?? JSON.stringify(data)}`);
  return data;
}
const ok = (m) => console.log(`  ✓ ${m}`);

try {
  const cash = await call("GET", "/api/orders/cash-status");
  if (!cash.open) throw new Error("cash-status dice que no hay caja abierta");
  ok("cash-status: hay caja abierta");

  const options = await call("GET", "/api/orders/payment-options");
  if (!options.sessions?.length) throw new Error("payment-options sin sesiones");
  ok(`payment-options: cajas abiertas = ${options.sessions.map((s) => s.name).join(", ")}`);

  const board = await call("GET", "/api/orders/board");
  const freeTable = board.find((c) => !c.order_id);
  if (!freeTable) throw new Error("No hay mesas libres para la prueba");
  const order = await call("POST", "/api/orders/occupy", { tableId: freeTable.table_id });
  ok(`Mesa ${freeTable.number} ocupada (orden ${order.order_number})`);

  const menu = await call("GET", "/api/products/menu/list");
  const item = await call("POST", `/api/orders/${order.id}/items`, {
    productId: menu[0].id, quantity: 1,
  });
  await call("POST", `/api/orders/${order.id}/confirm`, { itemIds: [item.id] });
  ok(`Producto "${menu[0].name}" agregado y confirmado`);

  // Bloqueo esperado si quedó en cocina (Requerido)
  const detail = await call("GET", `/api/orders/${order.id}`);
  const st = detail.items[0].kitchen_status;
  const amount = Number(detail.items[0].subtotal);
  const clients = await call("GET", "/api/catalogs/clients");
  const sessionId = options.sessions[0].id;
  const payBody = {
    clientId: clients[0].id, tip: 0, sessionId,
    payments: [{ method_id: options.methods.find((m) => m.name === "EFECTIVO").id, amount, tip_included: 0, change_given: 0 }],
  };

  if (st !== "listo") {
    try {
      await call("POST", `/api/orders/${order.id}/pay`, payBody);
      throw new Error("NO bloqueó el cobro con producto en " + st);
    } catch (e) {
      if (!/en preparación/.test(e.message)) throw e;
      ok(`Cobro bloqueado mientras está "${st}" (correcto)`);
    }
    await call("POST", "/api/kitchen/status", { itemIds: [item.id], status: "listo" });
    ok("Producto marcado Listo en el Monitor de Cocina");
  }

  const paid = await call("POST", `/api/orders/${order.id}/pay`, payBody);
  if (!paid.payments?.length) throw new Error("El pago no devolvió vouchers");
  ok(`Pago registrado: voucher ${paid.payments[0].voucher_number} por ${paid.payments[0].amount}`);

  const after = await call("GET", `/api/orders/${order.id}`);
  if (after.status !== "pagada") throw new Error(`La orden quedó "${after.status}"`);
  if (Number(after.cash_session_id) !== sessionId) {
    throw new Error(`Caja registrada ${after.cash_session_id} ≠ elegida ${sessionId}`);
  }
  ok(`Orden cerrada (pagada) en la caja elegida (sesión ${sessionId})`);

  console.log("TODO OK — el flujo Cobrar funciona de punta a punta");
} catch (e) {
  console.error(`✗ FALLO: ${e.message}`);
  process.exitCode = 1;
}
