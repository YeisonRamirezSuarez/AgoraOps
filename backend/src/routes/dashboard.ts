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

/** Pedidos gestionados por usuario (toda orden no cancelada del rango). */
async function rankingOrders(tenant: string | null, r: Range): Promise<RankingOrdersRow[]> {
  const rows = await query<{ user_login: string; user_name: string; count: number; sales: string }>(
    `SELECT u.username AS user_login, u.full_name AS user_name,
            COUNT(DISTINCT o.id)::int AS count,
            COALESCE(SUM(oi.subtotal), 0) AS sales
     FROM orders o
     JOIN users u ON u.id = o.user_id
     LEFT JOIN order_items oi ON oi.order_id = o.id
       AND oi.kitchen_status <> 'cancelado'
     WHERE o.tenant_id = $1 AND o.status <> 'cancelada'
       AND ${dateRange("o.created_at", 2, 3)}
     GROUP BY u.username, u.full_name
     ORDER BY count DESC, sales DESC`,
    [tenant, r.from, r.to],
  );
  return rows.map((row) => ({
    user: `${row.user_login} - ${row.user_name}`,
    user_login: row.user_login,
    user_name: row.user_name,
    count: row.count,
    sales: Number(row.sales),
  }));
}

/** Pagos procesados por usuario (cobros netos, propina incluida). */
async function rankingPayments(tenant: string | null, r: Range): Promise<RankingPaymentsRow[]> {
  const rows = await query<{ user_login: string; user_name: string; count: number; amount: string }>(
    `SELECT u.username AS user_login, u.full_name AS user_name,
            COUNT(op.id)::int AS count,
            COALESCE(SUM(op.amount - op.change_given), 0) AS amount
     FROM order_payments op
     JOIN orders o ON o.id = op.order_id
     JOIN users u ON u.id = op.user_id
     WHERE o.tenant_id = $1 AND o.status <> 'cancelada'
       AND ${dateRange("op.created_at", 2, 3)}
     GROUP BY u.username, u.full_name
     ORDER BY amount DESC, count DESC`,
    [tenant, r.from, r.to],
  );
  return rows.map((row) => ({
    user: `${row.user_login} - ${row.user_name}`,
    user_login: row.user_login,
    user_name: row.user_name,
    count: row.count,
    amount: Number(row.amount),
  }));
}

/** KPIs del periodo: solo órdenes pagadas; ventas sin propina. */
async function periodKPIs(tenant: string | null, r: Range) {
  const orders = await queryOne<{ total_orders: number; total_sales: string }>(
    `SELECT COUNT(*)::int AS total_orders,
            COALESCE(SUM(o.total - o.tip - o.delivery_fee), 0) AS total_sales
     FROM orders o
     WHERE o.tenant_id = $1 AND o.status = 'pagada'
       AND ${dateRange("o.created_at", 2, 3)}`,
    [tenant, r.from, r.to],
  );
  const payments = await queryOne<{ total_payments: number }>(
    `SELECT COUNT(op.id)::int AS total_payments
     FROM order_payments op
     JOIN orders o ON o.id = op.order_id
     WHERE o.tenant_id = $1 AND o.status = 'pagada'
       AND ${dateRange("op.created_at", 2, 3)}`,
    [tenant, r.from, r.to],
  );
  const totalOrders = orders?.total_orders ?? 0;
  const totalSales = Number(orders?.total_sales ?? 0);
  return {
    total_orders: totalOrders,
    total_payments: payments?.total_payments ?? 0,
    total_sales: totalSales.toFixed(2),
    avg_ticket: totalOrders > 0 ? totalSales / totalOrders : 0,
  };
}

/** Tendencia operativa por bucket (hora/día/mes), filtrable por usuario. */
async function trendData(
  tenant: string | null,
  r: Range,
  bucket: TrendBucket,
  actorLogin: string | null,
) {
  const fmt = bucket === "hour" ? "HH24:00" : bucket === "month" ? "MM/YYYY" : "DD/MM";

  const orderRows = await query<{ label: string; orders: number }>(
    `SELECT to_char(o.created_at AT TIME ZONE '${TZ}', '${fmt}') AS label,
            COUNT(*)::int AS orders
     FROM orders o
     JOIN users u ON u.id = o.user_id
     WHERE o.tenant_id = $1 AND o.status = 'pagada'
       AND ${dateRange("o.created_at", 2, 3)}
       AND ($4::text IS NULL OR u.username = $4)
     GROUP BY 1`,
    [tenant, r.from, r.to, actorLogin],
  );
  const paymentRows = await query<{ label: string; payments: number; amount: string }>(
    `SELECT to_char(op.created_at AT TIME ZONE '${TZ}', '${fmt}') AS label,
            COUNT(op.id)::int AS payments,
            COALESCE(SUM(op.amount - op.change_given), 0) AS amount
     FROM order_payments op
     JOIN orders o ON o.id = op.order_id
     JOIN users u ON u.id = op.user_id
     WHERE o.tenant_id = $1 AND o.status <> 'cancelada'
       AND ${dateRange("op.created_at", 2, 3)}
       AND ($4::text IS NULL OR u.username = $4)
     GROUP BY 1`,
    [tenant, r.from, r.to, actorLogin],
  );

  const byOrders = new Map(orderRows.map((row) => [row.label, row.orders]));
  const byPayments = new Map(paymentRows.map((row) => [row.label, row]));
  return trendLabels(r, bucket).map((label) => ({
    label,
    orders: byOrders.get(label) ?? 0,
    payments: byPayments.get(label)?.payments ?? 0,
    amount: Number(byPayments.get(label)?.amount ?? 0),
  }));
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

  const periods = [
    { key: "day", range: ranges.day, bucket: "hour" as TrendBucket },
    { key: "week", range: ranges.week, bucket: "day" as TrendBucket },
    { key: "month", range: ranges.month, bucket: "day" as TrendBucket },
    { key: "custom", range: custom.range, bucket: custom.bucket },
  ];

  const userRankingOrders: Record<string, RankingOrdersRow[]> = {};
  const userRankingPayments: Record<string, RankingPaymentsRow[]> = {};
  const userKPIs: Record<string, unknown> = {};
  const userTrendData: Record<string, unknown> = {};

  await Promise.all(
    periods.map(async (p) => {
      const [orders, payments, kpis, trend] = await Promise.all([
        rankingOrders(tenant, p.range),
        rankingPayments(tenant, p.range),
        periodKPIs(tenant, p.range),
        trendData(tenant, p.range, p.bucket, actor),
      ]);
      userRankingOrders[p.key] = orders;
      userRankingPayments[p.key] = payments;
      userKPIs[p.key] = kpis;
      userTrendData[p.key] = trend;
    }),
  );

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
  }>(
    `SELECT daily_goal, daily_date::text, weekly_goal, week_start::text,
            week_end::text, monthly_goal, month_start::text, month_end::text
     FROM objectives WHERE tenant_id = $1`,
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

  async function billedIn(r: Range): Promise<number> {
    const row = await queryOne<{ billed: string }>(
      `SELECT COALESCE(SUM(o.total - o.tip - o.delivery_fee), 0) AS billed
       FROM orders o
       WHERE o.tenant_id = $1 AND o.status = 'pagada'
         AND ${dateRange("o.created_at", 2, 3)}`,
      [tenant, r.from, r.to],
    );
    return Number(row?.billed ?? 0);
  }

  async function waitersIn(r: Range) {
    const rows = await query<{ name: string; value: string }>(
      `SELECT u.username AS name, COALESCE(SUM(o.total - o.tip - o.delivery_fee), 0) AS value
       FROM orders o
       JOIN users u ON u.id = o.user_id
       WHERE o.tenant_id = $1 AND o.status = 'pagada'
         AND ${dateRange("o.created_at", 2, 3)}
       GROUP BY u.username
       ORDER BY value DESC`,
      [tenant, r.from, r.to],
    );
    return rows.map((row) => ({ name: row.name, value: Number(row.value) }));
  }

  async function paymentsIn(r: Range) {
    const rows = await query<{ method: string; count: number; tip: string }>(
      `SELECT pm.name AS method, COUNT(op.id)::int AS count,
              COALESCE(SUM(op.tip_included), 0) AS tip
       FROM order_payments op
       JOIN orders o ON o.id = op.order_id
       JOIN payment_methods pm ON pm.id = op.payment_method_id
       WHERE o.tenant_id = $1 AND o.status <> 'cancelada'
         AND ${dateRange("op.created_at", 2, 3)}
       GROUP BY pm.name`,
      [tenant, r.from, r.to],
    );
    return rows.map((row) => ({
      method: row.method,
      count: row.count,
      tip: Number(row.tip),
    }));
  }

  const [
    billedDay, billedWeek, billedMonth,
    waitersDay, waitersWeek, waitersMonth,
    paymentsDay, paymentsWeek, paymentsMonth,
    topProducts, lowStock, overdrafts, business, userRanking,
  ] = await Promise.all([
    billedIn(billedRanges.day), billedIn(billedRanges.week), billedIn(billedRanges.month),
    waitersIn(ranges.day), waitersIn(ranges.week), waitersIn(ranges.month),
    paymentsIn(ranges.day), paymentsIn(ranges.week), paymentsIn(ranges.month),
    query<{ name: string; qty: number }>(
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
    ),
    query(
      `SELECT id, name, stock, min_stock, unit FROM inventory_products
       WHERE tenant_id = $1 AND is_active AND stock <= min_stock AND stock >= 0
       ORDER BY stock ASC`,
      [tenant],
    ),
    query(
      `SELECT id, name, stock, unit FROM inventory_products
       WHERE tenant_id = $1 AND is_active AND stock < 0
       ORDER BY stock ASC`,
      [tenant],
    ),
    queryOne<{ business_name: string; logo_url: string | null }>(
      `SELECT business_name, logo_url FROM business_settings WHERE tenant_id = $1`,
      [tenant],
    ),
    userRankingPayload(tenant, parseCustomParams(req.query as Record<string, unknown>)),
  ]);

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
