/**
 * Dashboard "Resumen Ejecutivo" — manual §1.5, réplica del dashboard_blank
 * de Polaris: KPIs facturado/objetivos (sobre las fechas configuradas en
 * objectives), desempeño de meseros, desempeño por usuario (ranking de
 * pedidos/pagos + tendencia operativa con filtro de fecha específica),
 * productos top (últimos 30 días), distribución de pagos y propinas, y
 * alertas de stock bajo / sobregiro.
 *
 * Semántica (verificada contra el QA de Polaris):
 *  - "Facturado" y "Ventas" excluyen propina Y domicilio
 *    (total - tip - delivery_fee de órdenes pagadas).
 *  - Ranking por Pedidos = pedidos gestionados (toda orden no cancelada).
 *  - Ranking por Pagos y tendencia "amount" = cobros netos (amount - cambio),
 *    propina incluida, atribuidos al usuario que procesó el pago.
 *  - KPIs (Pedidos/Pagos/Ticket) solo cuentan órdenes pagadas.
 */
import { Router } from "express";
import { query, queryOne } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

/** Zona horaria del negocio (Polaris opera en hora local de Colombia). */
const TZ = "America/Bogota";

/**
 * Fragmento WHERE *sargable* para "created_at cae en el rango de días locales
 * [$fromParam, $toParam]". Compara la columna timestamptz cruda contra límites
 * constantes para que el planificador use el índice (orders.created_at /
 * order_payments.created_at) en lugar de un Seq Scan: el patrón anterior
 * `(created_at AT TIME ZONE TZ)::date BETWEEN …` aplicaba una función sobre la
 * columna y descartaba el índice, forzando escaneo completo en cada request.
 * Colombia no observa DST, así que el corte por medianoche local es exacto.
 * Cota superior exclusiva (< día siguiente) para incluir el día `to` completo.
 */
function dateRange(col: string, fromParam: number, toParam: number): string {
  return `${col} >= ($${fromParam}::date::timestamp AT TIME ZONE '${TZ}')
      AND ${col} <  (($${toParam}::date + 1)::timestamp AT TIME ZONE '${TZ}')`;
}

type Range = { from: string; to: string };
type TrendBucket = "hour" | "day" | "month";
type PeriodSpec = { key: string; range: Range; bucket: TrendBucket };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Fecha actual (YYYY-MM-DD) en la zona horaria del negocio. */
function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

function toISO(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Rangos actuales: día, semana (lunes-domingo) y mes — como Polaris. */
function currentRanges(): { day: Range; week: Range; month: Range } {
  const today = todayLocal();
  const d = new Date(`${today}T00:00:00Z`);

  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // lunes=1 … domingo=7
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (dow - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const monthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));

  return {
    day: { from: today, to: today },
    week: { from: toISO(monday), to: toISO(sunday) },
    month: { from: toISO(monthStart), to: toISO(monthEnd) },
  };
}

/** Filtro "Fecha específica" del Desempeño por Usuario (día/mes/año). */
function customRange(type: string, day: number, month: number, year: number): {
  range: Range;
  bucket: TrendBucket;
  label: string;
} {
  if (type === "month") {
    const end = new Date(Date.UTC(year, month, 0));
    return {
      range: { from: `${year}-${pad(month)}-01`, to: toISO(end) },
      bucket: "day",
      label: `Mes especifico: ${year}-${pad(month)}`,
    };
  }
  if (type === "year") {
    return {
      range: { from: `${year}-01-01`, to: `${year}-12-31` },
      bucket: "month",
      label: `Año especifico: ${year}`,
    };
  }
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const safeDay = Math.min(day, maxDay);
  const date = `${year}-${pad(month)}-${pad(safeDay)}`;
  return {
    range: { from: date, to: date },
    bucket: "hour",
    label: `Dia especifico: ${date}`,
  };
}

/** Etiquetas de la tendencia operativa, idénticas a Polaris. */
function trendLabels(range: Range, bucket: TrendBucket): string[] {
  if (bucket === "hour") {
    return Array.from({ length: 24 }, (_, h) => `${pad(h)}:00`);
  }
  if (bucket === "month") {
    const year = range.from.slice(0, 4);
    return Array.from({ length: 12 }, (_, m) => `${pad(m + 1)}/${year}`);
  }
  const labels: string[] = [];
  const cursor = new Date(`${range.from}T00:00:00Z`);
  const end = new Date(`${range.to}T00:00:00Z`);
  while (cursor <= end) {
    labels.push(`${pad(cursor.getUTCDate())}/${pad(cursor.getUTCMonth() + 1)}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return labels;
}

interface RankingOrdersRow {
  user: string;
  user_login: string;
  user_name: string;
  count: number;
  sales: number;
}

interface RankingPaymentsRow {
  user: string;
  user_login: string;
  user_name: string;
  count: number;
  amount: number;
}

/** Desempeño por usuario (pedidos + pagos) de TODOS los periodos en UNA sola
 * consulta: cada rama UNION ALL es la consulta por-periodo original etiquetada,
 * así pasamos de 4 round-trips a 1 sin alterar los números por periodo. */
async function allUserRankings(
  tenant: string | null,
  periods: PeriodSpec[],
): Promise<{
  orders: Record<string, RankingOrdersRow[]>;
  payments: Record<string, RankingPaymentsRow[]>;
}> {
  const branches = periods.map((p, i) => {
    const f = 2 + i * 2, t = 3 + i * 2;
    return `SELECT '${p.key}' AS period, q.* FROM (
       SELECT COALESCE(ord.user_login, pay.user_login) AS user_login,
              COALESCE(ord.user_name, pay.user_name) AS user_name,
              COALESCE(ord.orders_count, 0)::int AS orders_count,
              COALESCE(ord.sales, 0) AS sales,
              COALESCE(pay.payments_count, 0)::int AS payments_count,
              COALESCE(pay.amount, 0) AS amount
       FROM (
         SELECT u.username AS user_login, u.full_name AS user_name,
                COUNT(DISTINCT o.id)::int AS orders_count,
                COALESCE(SUM(oi.subtotal), 0) AS sales
         FROM orders o
         JOIN users u ON u.id = o.user_id
         LEFT JOIN order_items oi ON oi.order_id = o.id
           AND oi.kitchen_status <> 'cancelado'
         WHERE o.tenant_id = $1 AND o.status <> 'cancelada'
           AND ${dateRange("o.created_at", f, t)}
         GROUP BY u.username, u.full_name
       ) ord
       FULL OUTER JOIN (
         SELECT u.username AS user_login, u.full_name AS user_name,
                COUNT(op.id)::int AS payments_count,
                COALESCE(SUM(op.amount - op.change_given), 0) AS amount
         FROM order_payments op
         JOIN orders o ON o.id = op.order_id
         JOIN users u ON u.id = op.user_id
         WHERE o.tenant_id = $1 AND o.status <> 'cancelada'
           AND ${dateRange("op.created_at", f, t)}
         GROUP BY u.username, u.full_name
       ) pay ON ord.user_login = pay.user_login
     ) q`;
  });
  const rows = await query<{
    period: string;
    user_login: string;
    user_name: string;
    orders_count: number;
    sales: string;
    payments_count: number;
    amount: string;
  }>(
    branches.join("\nUNION ALL\n"),
    [tenant, ...periods.flatMap((p) => [p.range.from, p.range.to])],
  );

  const orders: Record<string, RankingOrdersRow[]> = {};
  const payments: Record<string, RankingPaymentsRow[]> = {};
  for (const p of periods) {
    const rs = rows.filter((row) => row.period === p.key);
    orders[p.key] = rs
      .map((row) => ({
        user: `${row.user_login} - ${row.user_name}`,
        user_login: row.user_login,
        user_name: row.user_name,
        count: row.orders_count,
        sales: Number(row.sales),
      }))
      .filter((o) => o.count > 0)
      .sort((a, b) => b.count - a.count || b.sales - a.sales);
    payments[p.key] = rs
      .map((row) => ({
        user: `${row.user_login} - ${row.user_name}`,
        user_login: row.user_login,
        user_name: row.user_name,
        count: row.payments_count,
        amount: Number(row.amount),
      }))
      .filter((pay) => pay.count > 0)
      .sort((a, b) => b.amount - a.amount || b.count - a.count);
  }
  return { orders, payments };
}

/** KPIs (pedidos/ventas/pagos) de TODOS los periodos en UNA consulta (UNION
 * ALL de las ramas por-periodo). Solo órdenes pagadas; ventas sin propina. */
async function allPeriodKPIs(tenant: string | null, periods: PeriodSpec[]) {
  const branches = periods.map((p, i) => {
    const f = 2 + i * 2, t = 3 + i * 2;
    return `SELECT '${p.key}' AS period,
       (SELECT COUNT(*)::int FROM orders o WHERE o.tenant_id = $1 AND o.status = 'pagada' AND ${dateRange("o.created_at", f, t)}) AS total_orders,
       (SELECT COALESCE(SUM(o.total - o.tip - o.delivery_fee), 0) FROM orders o WHERE o.tenant_id = $1 AND o.status = 'pagada' AND ${dateRange("o.created_at", f, t)}) AS total_sales,
       (SELECT COUNT(op.id)::int FROM order_payments op JOIN orders o ON o.id = op.order_id WHERE o.tenant_id = $1 AND o.status = 'pagada' AND ${dateRange("op.created_at", f, t)}) AS total_payments`;
  });
  const rows = await query<{
    period: string; total_orders: number; total_sales: string; total_payments: number;
  }>(
    branches.join("\nUNION ALL\n"),
    [tenant, ...periods.flatMap((p) => [p.range.from, p.range.to])],
  );
  const out: Record<string, {
    total_orders: number; total_payments: number; total_sales: string; avg_ticket: number;
  }> = {};
  for (const row of rows) {
    const totalOrders = row.total_orders ?? 0;
    const totalSales = Number(row.total_sales ?? 0);
    out[row.period] = {
      total_orders: totalOrders,
      total_payments: row.total_payments ?? 0,
      total_sales: totalSales.toFixed(2),
      avg_ticket: totalOrders > 0 ? totalSales / totalOrders : 0,
    };
  }
  return out;
}

/** Tendencia operativa de TODOS los periodos en UNA consulta (UNION ALL). El
 * bucket/formato de cada periodo se fija por rama (es server-side, no entrada
 * del usuario); el filtro por usuario va en un único parámetro compartido. */
async function allTrendData(
  tenant: string | null,
  periods: PeriodSpec[],
  actorLogin: string | null,
): Promise<Record<string, { label: string; orders: number; payments: number; amount: number }[]>> {
  const actorParam = 2 + periods.length * 2; // tras tenant ($1) + los pares de rango
  const branches = periods.map((p, i) => {
    const f = 2 + i * 2, t = 3 + i * 2;
    const fmt = p.bucket === "hour" ? "HH24:00" : p.bucket === "month" ? "MM/YYYY" : "DD/MM";
    return `SELECT '${p.key}' AS period, q.* FROM (
       SELECT COALESCE(o.label, pp.label) AS label,
              COALESCE(o.orders, 0)::int AS orders,
              COALESCE(pp.payments, 0)::int AS payments,
              COALESCE(pp.amount, 0) AS amount
       FROM (
         SELECT to_char(o.created_at AT TIME ZONE '${TZ}', '${fmt}') AS label,
                COUNT(*)::int AS orders
         FROM orders o
         JOIN users u ON u.id = o.user_id
         WHERE o.tenant_id = $1 AND o.status = 'pagada'
           AND ${dateRange("o.created_at", f, t)}
           AND ($${actorParam}::text IS NULL OR u.username = $${actorParam})
         GROUP BY 1
       ) o
       FULL OUTER JOIN (
         SELECT to_char(op.created_at AT TIME ZONE '${TZ}', '${fmt}') AS label,
                COUNT(op.id)::int AS payments,
                COALESCE(SUM(op.amount - op.change_given), 0) AS amount
         FROM order_payments op
         JOIN orders o ON o.id = op.order_id
         JOIN users u ON u.id = op.user_id
         WHERE o.tenant_id = $1 AND o.status <> 'cancelada'
           AND ${dateRange("op.created_at", f, t)}
           AND ($${actorParam}::text IS NULL OR u.username = $${actorParam})
         GROUP BY 1
       ) pp ON o.label = pp.label
     ) q`;
  });
  const rows = await query<{ period: string; label: string; orders: number; payments: number; amount: string }>(
    branches.join("\nUNION ALL\n"),
    [tenant, ...periods.flatMap((p) => [p.range.from, p.range.to]), actorLogin],
  );

  const out: Record<string, { label: string; orders: number; payments: number; amount: number }[]> = {};
  for (const p of periods) {
    const byLabel = new Map(
      rows.filter((row) => row.period === p.key).map((row) => [row.label, row]),
    );
    out[p.key] = trendLabels(p.range, p.bucket).map((label) => {
      const row = byLabel.get(label);
      return {
        label,
        orders: row?.orders ?? 0,
        payments: row?.payments ?? 0,
        amount: Number(row?.amount ?? 0),
      };
    });
  }
  return out;
}

interface CustomParams {
  type: string;
  day: number;
  month: number;
  year: number;
  actorLogin: string;
}

function parseCustomParams(q: Record<string, unknown>): CustomParams {
  const today = todayLocal();
  const [y, m, d] = today.split("-").map(Number);
  const type = ["day", "month", "year"].includes(String(q.custom_type))
    ? String(q.custom_type)
    : "day";
  const day = Math.min(Math.max(parseInt(String(q.custom_day), 10) || d, 1), 31);
  const month = Math.min(Math.max(parseInt(String(q.custom_month), 10) || m, 1), 12);
  const yearRaw = parseInt(String(q.custom_year), 10) || y;
  const year = yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : y;
  const actorLogin = String(q.actor_login || "all").trim() || "all";
  return { type, day, month, year, actorLogin };
}

/** Payload del Desempeño por Usuario (carga inicial y AJAX de Polaris). */
async function userRankingPayload(tenant: string | null, params: CustomParams) {
  const ranges = currentRanges();
  const custom = customRange(params.type, params.day, params.month, params.year);
  const actor = params.actorLogin !== "all" ? params.actorLogin : null;

  const periods: PeriodSpec[] = [
    { key: "day", range: ranges.day, bucket: "hour" as TrendBucket },
    { key: "week", range: ranges.week, bucket: "day" as TrendBucket },
    { key: "month", range: ranges.month, bucket: "day" as TrendBucket },
    { key: "custom", range: custom.range, bucket: custom.bucket },
  ];

  const userRankingOrders: Record<string, RankingOrdersRow[]> = {};
  const userRankingPayments: Record<string, RankingPaymentsRow[]> = {};
  const userKPIs: Record<string, unknown> = {};
  const userTrendData: Record<string, unknown> = {};

  // Los 4 periodos en 3 consultas (UNION ALL) en vez de 12 round-trips,
  // ejecutadas en serie para no abrir varias conexiones a la vez (pool=5).
  const rankings = await allUserRankings(tenant, periods);
  const kpis = await allPeriodKPIs(tenant, periods);
  const trend = await allTrendData(tenant, periods, actor);
  for (const p of periods) {
    userRankingOrders[p.key] = rankings.orders[p.key] ?? [];
    userRankingPayments[p.key] = rankings.payments[p.key] ?? [];
    userKPIs[p.key] = kpis[p.key];
    userTrendData[p.key] = trend[p.key] ?? [];
  }

  return {
    userRankingOrders,
    userRankingPayments,
    userKPIs,
    userTrendData,
    userCustomFilter: {
      type: params.type,
      day: params.day,
      month: params.month,
      year: params.year,
      start: custom.range.from,
      end: custom.range.to,
      label: custom.label,
      actor_login: params.actorLogin,
    },
    userActorSelected: params.actorLogin,
  };
}

/** Carga inicial: todo el Resumen Ejecutivo en un solo payload. */
dashboardRouter.get("/", async (req, res) => {
  const tenant = req.user!.tenantId;
  const ranges = currentRanges();

  const objectives = await queryOne<{
    daily_goal: string; daily_date: string | null;
    weekly_goal: string; week_start: string | null; week_end: string | null;
    monthly_goal: string; month_start: string | null; month_end: string | null;
    business_name: string | null; logo_url: string | null;
  }>(
    `SELECT 
       (SELECT daily_goal FROM objectives WHERE tenant_id = $1) AS daily_goal,
       (SELECT daily_date::text FROM objectives WHERE tenant_id = $1) AS daily_date,
       (SELECT weekly_goal FROM objectives WHERE tenant_id = $1) AS weekly_goal,
       (SELECT week_start::text FROM objectives WHERE tenant_id = $1) AS week_start,
       (SELECT week_end::text FROM objectives WHERE tenant_id = $1) AS week_end,
       (SELECT monthly_goal FROM objectives WHERE tenant_id = $1) AS monthly_goal,
       (SELECT month_start::text FROM objectives WHERE tenant_id = $1) AS month_start,
       (SELECT month_end::text FROM objectives WHERE tenant_id = $1) AS month_end,
       (SELECT business_name FROM business_settings WHERE tenant_id = $1) AS business_name,
       (SELECT logo_url FROM business_settings WHERE tenant_id = $1) AS logo_url`,
    [tenant],
  );

  // Polaris: el facturado de cada card usa las fechas del objetivo
  // configurado; sin objetivo, el rango actual.
  const billedRanges = {
    day: objectives?.daily_date
      ? { from: objectives.daily_date, to: objectives.daily_date }
      : ranges.day,
    week: objectives?.week_start && objectives?.week_end
      ? { from: objectives.week_start, to: objectives.week_end }
      : ranges.week,
    month: objectives?.month_start && objectives?.month_end
      ? { from: objectives.month_start, to: objectives.month_end }
      : ranges.month,
  };

  const billedRow = await queryOne<{ day_val: string; week_val: string; month_val: string }>(
    `SELECT 
       COALESCE(SUM(CASE WHEN ${dateRange("o.created_at", 2, 3)} THEN o.total - o.tip - o.delivery_fee ELSE 0 END), 0) AS day_val,
       COALESCE(SUM(CASE WHEN ${dateRange("o.created_at", 4, 5)} THEN o.total - o.tip - o.delivery_fee ELSE 0 END), 0) AS week_val,
       COALESCE(SUM(CASE WHEN ${dateRange("o.created_at", 6, 7)} THEN o.total - o.tip - o.delivery_fee ELSE 0 END), 0) AS month_val
     FROM orders o
     WHERE o.tenant_id = $1 AND o.status = 'pagada'`,
    [
      tenant,
      billedRanges.day.from, billedRanges.day.to,
      billedRanges.week.from, billedRanges.week.to,
      billedRanges.month.from, billedRanges.month.to,
    ],
  );
  const billedDay = Number(billedRow?.day_val ?? 0);
  const billedWeek = Number(billedRow?.week_val ?? 0);
  const billedMonth = Number(billedRow?.month_val ?? 0);

  const waitersRows = await query<{ name: string; day_val: string; week_val: string; month_val: string }>(
    `SELECT u.username AS name,
       COALESCE(SUM(CASE WHEN ${dateRange("o.created_at", 2, 3)} THEN o.total - o.tip - o.delivery_fee ELSE 0 END), 0) AS day_val,
       COALESCE(SUM(CASE WHEN ${dateRange("o.created_at", 4, 5)} THEN o.total - o.tip - o.delivery_fee ELSE 0 END), 0) AS week_val,
       COALESCE(SUM(CASE WHEN ${dateRange("o.created_at", 6, 7)} THEN o.total - o.tip - o.delivery_fee ELSE 0 END), 0) AS month_val
     FROM orders o
     JOIN users u ON u.id = o.user_id
     WHERE o.tenant_id = $1 AND o.status = 'pagada'
     GROUP BY u.username`,
    [
      tenant,
      ranges.day.from, ranges.day.to,
      ranges.week.from, ranges.week.to,
      ranges.month.from, ranges.month.to,
    ],
  );
  const waitersDay = waitersRows.map((r) => ({ name: r.name, value: Number(r.day_val) })).filter((w) => w.value > 0).sort((a, b) => b.value - a.value);
  const waitersWeek = waitersRows.map((r) => ({ name: r.name, value: Number(r.week_val) })).filter((w) => w.value > 0).sort((a, b) => b.value - a.value);
  const waitersMonth = waitersRows.map((r) => ({ name: r.name, value: Number(r.month_val) })).filter((w) => w.value > 0).sort((a, b) => b.value - a.value);

  const paymentsRows = await query<{
    method: string;
    day_count: number; day_tip: string;
    week_count: number; week_tip: string;
    month_count: number; month_tip: string;
  }>(
    `SELECT pm.name AS method,
       COUNT(CASE WHEN ${dateRange("op.created_at", 2, 3)} THEN op.id ELSE NULL END)::int AS day_count,
       COALESCE(SUM(CASE WHEN ${dateRange("op.created_at", 2, 3)} THEN op.tip_included ELSE 0 END), 0) AS day_tip,
       COUNT(CASE WHEN ${dateRange("op.created_at", 4, 5)} THEN op.id ELSE NULL END)::int AS week_count,
       COALESCE(SUM(CASE WHEN ${dateRange("op.created_at", 4, 5)} THEN op.tip_included ELSE 0 END), 0) AS week_tip,
       COUNT(CASE WHEN ${dateRange("op.created_at", 6, 7)} THEN op.id ELSE NULL END)::int AS month_count,
       COALESCE(SUM(CASE WHEN ${dateRange("op.created_at", 6, 7)} THEN op.tip_included ELSE 0 END), 0) AS month_tip
     FROM order_payments op
     JOIN orders o ON o.id = op.order_id
     JOIN payment_methods pm ON pm.id = op.payment_method_id
     WHERE o.tenant_id = $1 AND o.status <> 'cancelada'
     GROUP BY pm.name`,
    [
      tenant,
      ranges.day.from, ranges.day.to,
      ranges.week.from, ranges.week.to,
      ranges.month.from, ranges.month.to,
    ],
  );
  const paymentsDay = paymentsRows.map((r) => ({ method: r.method, count: r.day_count, tip: Number(r.day_tip) })).filter((p) => p.count > 0);
  const paymentsWeek = paymentsRows.map((r) => ({ method: r.method, count: r.week_count, tip: Number(r.week_tip) })).filter((p) => p.count > 0);
  const paymentsMonth = paymentsRows.map((r) => ({ method: r.method, count: r.month_count, tip: Number(r.month_tip) })).filter((p) => p.count > 0);

  const topProducts = await query<{ name: string; qty: number }>(
    `SELECT oi.product_name AS name, SUM(oi.quantity)::int AS qty
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.tenant_id = $1 AND o.status = 'pagada'
       AND oi.kitchen_status <> 'cancelado'
       AND o.created_at >= (($2::date - 30)::timestamp AT TIME ZONE '${TZ}')
     GROUP BY oi.product_name
     ORDER BY qty DESC
     LIMIT 10`,
    [tenant, todayLocal()],
  );

  const stockItems = await query<{ id: number; name: string; stock: string; min_stock: string; unit: string }>(
    `SELECT id, name, stock, min_stock, unit FROM inventory_products
     WHERE tenant_id = $1 AND is_active AND (stock <= min_stock OR stock < 0)
     ORDER BY stock ASC`,
    [tenant],
  );

  const lowStock = stockItems.filter(
    (item) => Number(item.stock) >= 0 && Number(item.stock) <= Number(item.min_stock)
  );

  const overdrafts = stockItems
    .filter((item) => Number(item.stock) < 0)
    .map((item) => ({
      id: item.id,
      name: item.name,
      stock: item.stock,
      unit: item.unit,
    }));

  const business = objectives;

  const userRanking = await userRankingPayload(tenant, parseCustomParams(req.query as Record<string, unknown>));

  res.json({
    dates: {
      today: ranges.day.from,
      weekStart: ranges.week.from,
      weekEnd: ranges.week.to,
      monthStart: ranges.month.from,
      monthEnd: ranges.month.to,
    },
    objectives: {
      daily_goal: Number(objectives?.daily_goal ?? 0),
      daily_date: objectives?.daily_date ?? null,
      weekly_goal: Number(objectives?.weekly_goal ?? 0),
      week_start: objectives?.week_start ?? null,
      week_end: objectives?.week_end ?? null,
      monthly_goal: Number(objectives?.monthly_goal ?? 0),
      month_start: objectives?.month_start ?? null,
      month_end: objectives?.month_end ?? null,
    },
    billed: { day: billedDay, week: billedWeek, month: billedMonth },
    waiters: { day: waitersDay, week: waitersWeek, month: waitersMonth },
    payments: { day: paymentsDay, week: paymentsWeek, month: paymentsMonth },
    topProducts,
    lowStock,
    overdrafts,
    business: {
      name: business?.business_name ?? "",
      logoUrl: business?.logo_url ?? null,
    },
    ...userRanking,
  });
});

/** AJAX del Desempeño por Usuario (equivale a dashboard_ajax=user-ranking). */
dashboardRouter.get("/user-ranking", async (req, res) => {
  const payload = await userRankingPayload(
    req.user!.tenantId,
    parseCustomParams(req.query as Record<string, unknown>),
  );
  const period = ["day", "week", "month", "custom"].includes(String(req.query.period))
    ? String(req.query.period)
    : "week";
  res.json({ ...payload, currentPeriod: period });
});
