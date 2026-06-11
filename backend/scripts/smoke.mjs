/**
 * Smoke test E2E del flujo completo del POS contra el API real.
 * Uso: node scripts/smoke.mjs  (con el API corriendo en :4000)
 */
const BASE = process.env.API_URL ?? "http://localhost:4000";
let token = "";

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data.error ?? JSON.stringify(data)}`);
  return data;
}

const ok = (msg) => console.log(`  ✓ ${msg}`);

try {
  // 1. Login
  const login = await call("POST", "/api/auth/login", { username: "admin", password: "admin1234" });
  token = login.token;
  ok(`Login: ${login.user.fullName} (${login.user.groupName})`);

  // 2. Caja abierta (requisito para abrir mesas §1.6.3)
  const sessions = await call("GET", "/api/cash/sessions");
  let session = sessions.find((s) => s.session_id);
  if (!session) {
    await call("POST", "/api/cash/sessions", { cashRegisterId: sessions[0].cash_register_id, openingAmount: 50000 });
    session = (await call("GET", "/api/cash/sessions")).find((s) => s.session_id);
  }
  ok(`Caja abierta: ${session.name} (sesión ${session.session_id})`);

  // 3. Catálogo: categoría + producto
  const cats = await call("GET", "/api/catalogs/categories");
  const cat = cats.find((c) => c.name === "Smoke Cat") ??
    await call("POST", "/api/catalogs/categories", { name: "Smoke Cat", is_active: true });
  const prods = await call("GET", "/api/products");
  const prod = prods.find((p) => p.code === "SMK-1") ??
    await call("POST", "/api/products", {
      category_id: cat.id, code: "SMK-1", name: "Hamburguesa Smoke",
      product_type: "NORMAL", sale_price: 25000, cost_price: 9000,
      goes_to_kitchen: true, is_inventariable: false, is_active: true,
    });
  ok(`Producto: ${prod.name} (${prod.code})`);

  // 4. Menú visible
  const menu = await call("GET", "/api/products/menu/list");
  if (!menu.some((m) => m.id === prod.id)) throw new Error("El producto no aparece en el menú");
  ok(`Menú: ${menu.length} productos visibles`);

  // 5. Ocupar mesa
  const board = await call("GET", "/api/orders/board");
  const freeTable = board.find((c) => !c.order_id);
  if (!freeTable) throw new Error("No hay mesas libres");
  const order = await call("POST", "/api/orders/occupy", { tableId: freeTable.table_id });
  ok(`Mesa ${freeTable.number} ocupada → orden #${order.order_number ?? order.id}`);

  // 6. Agregar producto + confirmar (→ Requerido en cocina)
  const item = await call("POST", `/api/orders/${order.id}/items`, { productId: prod.id, quantity: 2, notes: "sin cebolla" });
  await call("POST", `/api/orders/${order.id}/confirm`, { itemIds: [item.id] });
  ok("Producto agregado y confirmado (comanda)");

  // 7. Monitor de cocina: Requerido → Listo (descuenta receta si la hay)
  const kboard = await call("GET", "/api/kitchen/board");
  const kOrder = kboard.find((o) => o.order_id === order.id);
  if (!kOrder) throw new Error("La orden no llegó al monitor de cocina");
  await call("POST", "/api/kitchen/status", { itemIds: kOrder.items[0].ids, status: "listo" });
  ok("Cocina: producto marcado Listo (+ notificación)");

  // 8. Cliente + pago en efectivo con propina 0
  const clients = await call("GET", "/api/catalogs/clients");
  const client = clients[0] ?? await call("POST", "/api/catalogs/clients", { name: "Cliente Smoke", document_id: "999" });
  const options = await call("GET", "/api/orders/payment-options");
  const cash = options.methods.find((m) => m.name === "EFECTIVO");
  await call("POST", `/api/orders/${order.id}/pay`, {
    clientId: client.id, tip: 0,
    payments: [{ method_id: cash.id, amount: 50000, change_given: 0, tip_included: 0 }],
  });
  ok("Pago registrado (EFECTIVO 50.000)");

  // 9. Reportes y cierre de caja
  const sales = await call("GET", "/api/reports/sales");
  if (!sales.some((s) => s.id === order.id)) throw new Error("La venta no aparece en el reporte");
  ok(`Reporte de ventas: ${sales.length} ventas hoy`);

  const summary = await call("GET", `/api/cash/sessions/${session.session_id}/summary`);
  ok(`Resumen de caja: ${summary.byMethod.map((m) => `${m.name}=${m.total}`).join(", ") || "sin ventas previas"}`);

  await call("POST", `/api/cash/sessions/${session.session_id}/transactions`, {
    type: "ENTRADA", reason: "Base adicional smoke", amount: 10000,
  });
  ok("Entrada de caja registrada");

  const dash = await call("GET", "/api/dashboard");
  ok(`Dashboard: ventas hoy = ${dash.sales_today}`);

  console.log("\n★ SMOKE TEST COMPLETO: todos los flujos núcleo funcionan.");
  process.exit(0);
} catch (err) {
  console.error(`\n✗ FALLO: ${err.message}`);
  process.exit(1);
}
