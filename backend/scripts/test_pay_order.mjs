/**
 * Test transaccional de pay_order (00022): bloqueo por estado de cocina
 * y Caja de Pago elegida. Todo dentro de una transacción con ROLLBACK —
 * no deja datos en la BD.
 */
import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const url = process.env.DATABASE_URL;
const client = new pg.Client({
  connectionString: url,
  ssl: url.includes("localhost") || url.includes("127.0.0.1")
    ? undefined : { rejectUnauthorized: false },
});
const ok = (m) => console.log(`  ✓ ${m}`);

try {
  await client.connect();
  await client.query("BEGIN");

  const { rows: [tenant] } = await client.query("SELECT id FROM tenants LIMIT 1");
  const { rows: [user] } = await client.query("SELECT id FROM users LIMIT 1");
  const { rows: [table] } = await client.query(
    "SELECT id, room_id FROM tables WHERE tenant_id = $1 LIMIT 1", [tenant.id]);
  const { rows: [method] } = await client.query(
    "SELECT id FROM payment_methods WHERE tenant_id = $1 AND name = 'EFECTIVO'", [tenant.id]);
  const { rows: [clientRow] } = await client.query(
    "SELECT id FROM clients WHERE tenant_id = $1 LIMIT 1", [tenant.id]);
  // Dos cajas temporales abiertas para probar la elección explícita
  // (uq_cash_sessions_open: una sola sesión abierta por caja)
  const { rows: [regA] } = await client.query(
    `INSERT INTO cash_registers (tenant_id, name) VALUES ($1, 'TEST CAJA A') RETURNING id`, [tenant.id]);
  const { rows: [regB] } = await client.query(
    `INSERT INTO cash_registers (tenant_id, name) VALUES ($1, 'TEST CAJA B') RETURNING id`, [tenant.id]);
  const { rows: [sesA] } = await client.query(
    `INSERT INTO cash_sessions (tenant_id, cash_register_id, user_id, user_name, opening_amount)
     VALUES ($1, $2, $3, 'test', 1000) RETURNING id`, [tenant.id, regA.id, user.id]);
  const { rows: [sesB] } = await client.query(
    `INSERT INTO cash_sessions (tenant_id, cash_register_id, user_id, user_name, opening_amount)
     VALUES ($1, $2, $3, 'test', 1000) RETURNING id`, [tenant.id, regB.id, user.id]);

  const { rows: [order] } = await client.query(
    `INSERT INTO orders (tenant_id, order_number, table_id, room_id, user_id, attended_by)
     VALUES ($1, 'TESTPAY1', $2, $3, $4, 'test') RETURNING id`,
    [tenant.id, table.id, table.room_id, user.id]);
  const { rows: [prod] } = await client.query(
    "SELECT id, name, sale_price FROM products WHERE tenant_id = $1 LIMIT 1", [tenant.id]);
  const { rows: [item] } = await client.query(
    `INSERT INTO order_items (order_id, product_id, product_name, quantity,
       unit_price, cost_price, subtotal, unique_code, kitchen_status)
     VALUES ($1, $2, $3, 1, 5000, 0, 5000, 'TESTPAY1X', 'en_preparacion') RETURNING id`,
    [order.id, prod.id, prod.name]);

  const pays = JSON.stringify([{ method_id: method.id, amount: 5000, tip_included: 0, change_given: 0 }]);

  // 1) Con producto en preparación → debe bloquear
  try {
    await client.query("SAVEPOINT sp1");
    await client.query("SELECT pay_order($1, $2, 0, $3, $4)", [order.id, clientRow.id, pays, sesB.id]);
    throw new Error("NO bloqueó el cobro con producto en preparación");
  } catch (e) {
    if (!/en preparación/.test(e.message)) throw e;
    await client.query("ROLLBACK TO sp1");
    ok(`Bloqueo correcto: "${e.message.trim()}"`);
  }

  // 2) Caja inexistente/cerrada → debe rechazar
  await client.query("UPDATE order_items SET kitchen_status = 'listo' WHERE id = $1", [item.id]);
  try {
    await client.query("SAVEPOINT sp2");
    await client.query("SELECT pay_order($1, $2, 0, $3, -1)", [order.id, clientRow.id, pays]);
    throw new Error("NO validó la caja elegida");
  } catch (e) {
    if (!/caja seleccionada/.test(e.message)) throw e;
    await client.query("ROLLBACK TO sp2");
    ok(`Caja inválida rechazada: "${e.message.trim()}"`);
  }

  // 3) Todo listo + caja B elegida → paga, cierra la orden y registra la caja
  await client.query("SELECT pay_order($1, $2, 0, $3, $4)", [order.id, clientRow.id, pays, sesB.id]);
  const { rows: [paid] } = await client.query(
    "SELECT status, cash_session_id, total FROM orders WHERE id = $1", [order.id]);
  if (paid.status !== "pagada") throw new Error(`Orden no cerrada: ${paid.status}`);
  if (paid.cash_session_id !== sesB.id) throw new Error(`Caja incorrecta: ${paid.cash_session_id} ≠ ${sesB.id}`);
  ok(`Pago OK: orden pagada en la caja elegida (sesión ${sesB.id}, no la ${sesA.id}), total ${paid.total}`);

  // 4) Sin caja explícita → usa la última abierta (compatibilidad 4 args)
  const { rows: [order2] } = await client.query(
    `INSERT INTO orders (tenant_id, order_number, table_id, room_id, user_id, attended_by)
     VALUES ($1, 'TESTPAY2', $2, $3, $4, 'test') RETURNING id`,
    [tenant.id, table.id, table.room_id, user.id]);
  await client.query(
    `INSERT INTO order_items (order_id, product_id, product_name, quantity,
       unit_price, cost_price, subtotal, unique_code, kitchen_status)
     VALUES ($1, $2, $3, 1, 5000, 0, 5000, 'TESTPAY2X', 'listo')`,
    [order2.id, prod.id, prod.name]);
  await client.query("SELECT pay_order($1, $2, 0, $3)", [order2.id, clientRow.id, pays]);
  const { rows: [paid2] } = await client.query(
    "SELECT status, cash_session_id FROM orders WHERE id = $1", [order2.id]);
  if (paid2.status !== "pagada") throw new Error("Orden 2 no cerrada");
  ok(`Sin sessionId usa la última caja abierta (sesión ${paid2.cash_session_id})`);

  const { rows: vouchers } = await client.query(
    "SELECT voucher_number, amount FROM order_payments WHERE order_id = $1", [order.id]);
  ok(`Voucher generado: ${vouchers[0].voucher_number} por ${vouchers[0].amount}`);

  console.log("TODO OK");
} catch (e) {
  console.error(`✗ FALLO: ${e.message}`);
  process.exitCode = 1;
} finally {
  try { await client.query("ROLLBACK"); } catch { /* sin transacción activa */ }
  await client.end();
}
