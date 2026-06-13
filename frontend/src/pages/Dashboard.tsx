/**
 * Dashboard "Resumen Ejecutivo" — manual §1.5, réplica funcional del
 * dashboard_blank de Polaris con el tema AgoraOps: KPIs facturado vs
 * objetivos, desempeño de meseros, card de marca, desempeño por usuario
 * (rankings, dona de participación y tendencia operativa con filtro de
 * fecha específica), productos top, distribución de pagos/propinas y
 * paneles laterales de ALERTAS (stock bajo) y SOBREGIRO.
 *
 * Comportamiento Polaris: los toggles Día/Semana/Mes filtran en cliente
 * sobre los buckets ya cargados; solo el filtro de usuario y "Fecha
 * específica → Aplicar" recargan (GET /api/dashboard/user-ranking).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, ArrowUpDown, Award, Banknote, Bell, Calendar, CreditCard,
  DollarSign, Info, Package, Smartphone, Target, TrendingUp, UtensilsCrossed, X, ChevronRight,
} from "lucide-react";
import { api } from "../lib/api";
import { Loader } from "../components/ui";

/* ───────────────────────── Formatos (es-CO, COP — como Polaris) ───────── */

const fmtMoney = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const fmtQty = new Intl.NumberFormat("es-CO");

/** Polaris formatNumberDynamic: 1.234.567,89 (siempre 2 decimales). */
function fmtNumber(num: number, decimals = 2): string {
  const fixed = (Number.isFinite(num) ? num : 0).toFixed(decimals);
  const [int, dec] = fixed.split(".");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

/** 2026-06-12 → 12-06-2026 (rótulos "Mostrando registros…"). */
function ddmmyyyy(iso: string): string {
  return iso.split("-").reverse().join("-");
}

/* ───────────────────────── Tipos del payload ──────────────────────────── */

type PeriodKey = "day" | "week" | "month" | "custom";

interface RankingOrdersRow {
  user: string; user_login: string; user_name: string; count: number; sales: number;
}
interface RankingPaymentsRow {
  user: string; user_login: string; user_name: string; count: number; amount: number;
}
interface PeriodKPIs {
  total_orders: number; total_payments: number; total_sales: string; avg_ticket: number;
}
interface TrendRow { label: string; orders: number; payments: number; amount: number }
interface CustomFilter {
  type: string; day: number; month: number; year: number;
  start: string; end: string; label: string; actor_login: string;
}

interface UserRankingSlice {
  userRankingOrders: Record<PeriodKey, RankingOrdersRow[]>;
  userRankingPayments: Record<PeriodKey, RankingPaymentsRow[]>;
  userKPIs: Record<PeriodKey, PeriodKPIs>;
  userTrendData: Record<PeriodKey, TrendRow[]>;
  userCustomFilter: CustomFilter;
  userActorSelected: string;
}

interface DashboardData extends UserRankingSlice {
  dates: { today: string; weekStart: string; weekEnd: string; monthStart: string; monthEnd: string };
  objectives: {
    daily_goal: number; daily_date: string | null;
    weekly_goal: number; week_start: string | null; week_end: string | null;
    monthly_goal: number; month_start: string | null; month_end: string | null;
  };
  billed: { day: number; week: number; month: number };
  waiters: Record<"day" | "week" | "month", { name: string; value: number }[]>;
  payments: Record<"day" | "week" | "month", { method: string; count: number; tip: number }[]>;
  topProducts: { name: string; qty: number }[];
  lowStock: { id: number; name: string; stock: string; min_stock: string; unit: string }[];
  overdrafts: { id: number; name: string; stock: string; unit: string }[];
  business: { name: string; logoUrl: string | null };
}

/* ───────────────────────── Utilidades compartidas ─────────────────────── */

const PERIOD_LABEL: Record<string, string> = {
  day: "Vista Diaria",
  week: "Vista Semana",
  month: "Vista Mensual",
};

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** Colores por método de pago (misma semántica que Polaris getColorJS). */
function methodColor(method: string) {
  const m = (method || "").toUpperCase();
  if (m.includes("EFECTIVO") || m.includes("CASH"))
    return { main: "#10b981", tip: "#6ee7b7", Icon: Banknote };
  if (m.includes("TARJETA") || m.includes("CARD") || m.includes("VISA") ||
      m.includes("MASTER") || m.includes("CREDITO"))
    return { main: "#2563eb", tip: "#60a5fa", Icon: CreditCard };
  if (m.includes("TRANSFER") || m.includes("NEQUI") || m.includes("DAVIPLATA") || m.includes("QR"))
    return { main: "#a855f7", tip: "#d8b4fe", Icon: Smartphone };
  if (m.includes("RAPPI") || m.includes("UBER") || m.includes("DOMICILIO"))
    return { main: "#f59e0b", tip: "#fbbf24", Icon: Info };
  return { main: "#64748b", tip: "#cbd5e1", Icon: Info };
}

function methodSortIndex(method: string): number {
  const m = (method || "").toUpperCase();
  if (m.includes("EFECTIVO")) return 0;
  if (m.includes("TARJETA") || m.includes("VISA") || m.includes("MASTER")) return 1;
  if (m.includes("TRANSFER") || m.includes("NEQUI") || m.includes("DAVIPLATA")) return 2;
  if (m.includes("COBRAR")) return 3;
  return 99;
}

/** Paleta de la dona (tema AgoraOps; en Polaris eran naranjas). */
const DONUT_PALETTE = ["#0ea5e9", "#2563eb", "#38bdf8", "#06b6d4", "#7dd3fc", "#f43f5e"];

/** Count-up con easeOutExpo, igual que Polaris (2 s). */
function useCountUp(target: number, duration = 2000): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!(target > 0)) { setVal(0); return; }
    let raf = 0;
    let start: number | null = null;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      setVal(p < 1 ? Math.floor(eased * target) : target);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

/* ───────────────────────── Página ─────────────────────────────────────── */

type AlertsTab = "low-stock" | "overdraft" | null;

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [alertsOpen, setAlertsOpen] = useState<AlertsTab>(null);

  useEffect(() => {
    api<DashboardData>("/api/dashboard").then(setData).catch(() => {});
  }, []);

  const applyUserRanking = useCallback((slice: UserRankingSlice) => {
    setData((prev) => (prev ? { ...prev, ...slice } : prev));
  }, []);

  if (!data) {
    return (
      <div className="fade-in-up p-6">
        <h1 className="text-2xl font-bold">Resumen Ejecutivo</h1>
        <Loader label="Cargando métricas" />
      </div>
    );
  }

  return (
    <div className="flex items-start">
      <div className="fade-in-up min-w-0 flex-1 p-6">
        <div className="mb-6">
        <h1 className="text-2xl font-bold">Resumen Ejecutivo</h1>
        <p className="mt-0.5 text-sm text-text-secondary">
          Monitoreo de métricas clave y rendimiento en tiempo real.
        </p>
      </div>

      {/* Chips de alertas (solo móvil) */}
      <div className="mb-4 flex gap-2 md:hidden">
        <AlertChip
          label="Alertas"
          count={data.lowStock.length}
          Icon={Package}
          onClick={() => setAlertsOpen("low-stock")}
        />
        <AlertChip
          label="Sobregiro"
          count={data.overdrafts.length}
          Icon={ArrowUpDown}
          onClick={() => setAlertsOpen("overdraft")}
        />
      </div>

      {/* KPIs facturado vs objetivo */}
      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard
          Icon={DollarSign}
          title={`Facturado del día: ${data.objectives.daily_date ?? data.dates.today}`}
          value={data.billed.day}
          goal={data.objectives.daily_goal}
        />
        <KpiCard
          Icon={TrendingUp}
          title="Facturado Semana"
          value={data.billed.week}
          goal={data.objectives.weekly_goal}
        />
        <KpiCard
          Icon={Calendar}
          title="Acumulado del Mes"
          value={data.billed.month}
          goal={data.objectives.monthly_goal}
        />
      </div>

      {/* Meseros + marca */}
      <div className="mt-6 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <WaiterCard waiters={data.waiters} dates={data.dates} />
        <BrandCard business={data.business} />
      </div>

      {/* Desempeño por usuario */}
      <div className="mt-6">
        <UserRankingCard data={data} onReload={applyUserRanking} />
      </div>

      {/* Productos top */}
      <div className="mt-6">
        <TopProductsCard products={data.topProducts} />
      </div>

      {/* Distribución de pagos y propinas */}
      <div className="mt-6">
        <PaymentsCard payments={data.payments} dates={data.dates} />
      </div>
      </div>

      {/* Riel de alertas (tablet/desktop): sticky, integrado al layout */}
      <AlertsRail
        lowStockCount={data.lowStock.length}
        overdraftCount={data.overdrafts.length}
        onOpen={setAlertsOpen}
      />

      {/* Detalle: panel lateral en desktop, bottom sheet en móvil */}
      <AlertsPanel
        open={alertsOpen}
        onClose={() => setAlertsOpen(null)}
        lowStock={data.lowStock}
        overdrafts={data.overdrafts}
      />
    </div>
  );
}

/* ───────────────────────── KPI cards ──────────────────────────────────── */

function KpiCard({ Icon, title, value, goal }: {
  Icon: typeof DollarSign; title: string; value: number; goal: number;
}) {
  const animated = useCountUp(value);
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-accent-blue/10 p-2.5 text-accent-blue">
          <Icon size={22} />
        </div>
        <p className="text-xs font-bold uppercase tracking-wide text-text-secondary">
          {title}
        </p>
      </div>
      <p className="mt-3 text-3xl font-extrabold">${fmtNumber(animated)}</p>
      <div className="mt-3">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-accent-amber/10 px-3 py-1.5 text-xs font-semibold text-accent-amber">
          <Target size={14} />
          Objetivo: ${fmtNumber(goal)}
        </span>
      </div>
    </div>
  );
}

/* ───────────────────────── Toggle Día/Semana/Mes ──────────────────────── */

function PeriodToggle({ options, active, onChange }: {
  options: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex rounded-lg border border-border-subtle bg-bg-tertiary p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
            active === o.key
              ? "bg-bg-secondary text-accent-blue shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function RangeNote({ period, dates, custom }: {
  period: string;
  dates: DashboardData["dates"];
  custom?: CustomFilter;
}) {
  let text = "";
  if (period === "day") text = `Mostrando registros del dia ${ddmmyyyy(dates.today)}`;
  else if (period === "week")
    text = `Mostrando registros desde ${ddmmyyyy(dates.weekStart)} hasta ${ddmmyyyy(dates.weekEnd)}`;
  else if (period === "month")
    text = `Mostrando registros desde ${ddmmyyyy(dates.monthStart)} hasta ${ddmmyyyy(dates.monthEnd)}`;
  else if (custom)
    text = custom.start === custom.end
      ? `Mostrando registros del dia ${ddmmyyyy(custom.start)}`
      : `Mostrando registros desde ${ddmmyyyy(custom.start)} hasta ${ddmmyyyy(custom.end)}`;
  return <span className="text-xs italic text-text-muted">{text}</span>;
}

/* ───────────────────────── Desempeño de Meseros ───────────────────────── */

function WaiterCard({ waiters, dates }: {
  waiters: DashboardData["waiters"];
  dates: DashboardData["dates"];
}) {
  const [period, setPeriod] = useState<"day" | "week" | "month">("week");
  const data = waiters[period] ?? [];
  const maxVal = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold">Desempeño de Meseros</h3>
          <p className="text-xs text-text-secondary">
            Ventas por personal - {PERIOD_LABEL[period]}
          </p>
        </div>
        <PeriodToggle
          options={[
            { key: "day", label: "Día" },
            { key: "week", label: "Semana" },
            { key: "month", label: "Mes" },
          ]}
          active={period}
          onChange={(k) => setPeriod(k as "day" | "week" | "month")}
        />
      </div>
      <div className="mt-1 text-center">
        <RangeNote period={period} dates={dates} />
      </div>

      <div className="mt-4 flex h-56 items-end justify-around gap-4 overflow-x-auto px-2">
        {data.length === 0 ? (
          <div className="self-center text-center text-sm italic text-text-muted">
            Sin datos para este periodo
          </div>
        ) : (
          data.map((w) => (
            <div key={`${period}-${w.name}`} className="flex h-full w-16 flex-col items-center">
              <div className="flex h-full w-full items-end justify-center">
                <div
                  className="group grow-bar-v relative w-10 rounded-t-lg bg-gradient-to-t from-accent-blue-hover to-accent-blue"
                  style={{ height: `${(w.value / maxVal) * 80}%` }}
                >
                  <div className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-text-primary px-2 py-0.5 text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
                    {fmtMoney.format(w.value)}
                  </div>
                </div>
              </div>
              <span className="mt-1.5 max-w-full truncate text-xs font-medium" title={w.name}>
                {w.name}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Card de marca ──────────────────────────────── */

function BrandCard({ business }: { business: DashboardData["business"] }) {
  return (
    <div className="glass flex flex-col items-center justify-center rounded-2xl p-8">
      {business.logoUrl ? (
        <img
          src={business.logoUrl}
          alt={`Logo ${business.name}`}
          className="max-h-44 max-w-full object-contain"
        />
      ) : (
        <UtensilsCrossed size={96} strokeWidth={1.2} className="text-accent-blue" />
      )}
      <span className="mt-4 text-lg font-bold text-text-secondary">{business.name}</span>
    </div>
  );
}

/* ───────────────────────── Desempeño por Usuario ──────────────────────── */

function customPeriodText(f: CustomFilter): string {
  if (f.type === "month") return `Mes específico (${f.start} a ${f.end})`;
  if (f.type === "year") return `Año específico (${f.start} a ${f.end})`;
  return `Día específico (${f.start})`;
}

function periodLabel(period: PeriodKey, custom: CustomFilter): string {
  return period === "custom" ? customPeriodText(custom) : PERIOD_LABEL[period];
}

function UserRankingCard({ data, onReload }: {
  data: DashboardData;
  onReload: (slice: UserRankingSlice) => void;
}) {
  const [period, setPeriod] = useState<PeriodKey>("week");
  const [view, setView] = useState<"orders" | "payments">("orders");
  const [metric, setMetric] = useState<"amount" | "orders" | "payments">("amount");
  const [actor, setActor] = useState(data.userActorSelected || "all");
  const [loading, setLoading] = useState(false);

  // Filtro "Fecha específica" (se envía solo al pulsar Aplicar — Polaris)
  const [customType, setCustomType] = useState(data.userCustomFilter.type);
  const [customDay, setCustomDay] = useState(data.userCustomFilter.day);
  const [customMonth, setCustomMonth] = useState(data.userCustomFilter.month);
  const [customYear, setCustomYear] = useState(data.userCustomFilter.year);

  const rawRanking: (RankingOrdersRow | RankingPaymentsRow)[] =
    view === "orders"
      ? data.userRankingOrders[period] ?? []
      : data.userRankingPayments[period] ?? [];

  const metricOf = useCallback(
    (item: RankingOrdersRow | RankingPaymentsRow) =>
      view === "orders"
        ? Number((item as RankingOrdersRow).count || 0)
        : Number((item as RankingPaymentsRow).amount || 0),
    [view],
  );

  // Opciones del select de usuario: quienes tienen actividad en la vista
  const actorOptions = useMemo(() => {
    const seen = new Set<string>();
    return rawRanking.filter((item) => {
      const login = (item.user_login || "").trim();
      if (!login || seen.has(login) || metricOf(item) <= 0) return false;
      seen.add(login);
      return true;
    });
  }, [rawRanking, metricOf]);

  const filtered = actor === "all"
    ? rawRanking
    : rawRanking.filter((i) => (i.user_login || "").trim() === actor);

  // KPIs: con filtro activo se recalculan desde el ranking (Polaris)
  const kpis = data.userKPIs[period];
  let kpiOrders = kpis?.total_orders ?? 0;
  let kpiPayments = kpis?.total_payments ?? 0;
  let kpiTicket = kpis?.avg_ticket ?? 0;
  if (actor !== "all") {
    const ordersData = data.userRankingOrders[period] ?? [];
    const paymentsData = data.userRankingPayments[period] ?? [];
    kpiOrders = ordersData
      .filter((i) => i.user_login.trim() === actor)
      .reduce((acc, i) => acc + Number(i.count || 0), 0);
    kpiPayments = paymentsData
      .filter((i) => i.user_login.trim() === actor)
      .reduce((acc, i) => acc + Number(i.count || 0), 0);
    const sales = ordersData
      .filter((i) => i.user_login.trim() === actor)
      .reduce((acc, i) => acc + Number(i.sales || 0), 0);
    kpiTicket = kpiOrders > 0 ? sales / kpiOrders : 0;
  }

  const reload = useCallback(
    async (targetPeriod: PeriodKey, actorLogin: string, custom: {
      type: string; day: number; month: number; year: number;
    }) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          period: targetPeriod,
          custom_type: custom.type,
          custom_day: String(custom.day),
          custom_month: String(custom.month),
          custom_year: String(custom.year),
        });
        if (actorLogin !== "all") params.set("actor_login", actorLogin);
        const payload = await api<UserRankingSlice>(
          `/api/dashboard/user-ranking?${params.toString()}`,
        );
        onReload(payload);
      } catch {
        /* la card conserva los datos previos */
      } finally {
        setLoading(false);
      }
    },
    [onReload],
  );

  const onActorChange = (login: string) => {
    setActor(login);
    void reload(period, login, {
      type: customType, day: customDay, month: customMonth, year: customYear,
    });
  };

  const onApplyCustom = () => {
    const day = Math.min(Math.max(customDay || 1, 1), 31);
    const month = Math.min(Math.max(customMonth || 1, 1), 12);
    const year = customYear >= 2000 && customYear <= 2100
      ? customYear
      : new Date().getFullYear();
    setCustomDay(day);
    setCustomMonth(month);
    setCustomYear(year);
    setPeriod("custom");
    void reload("custom", actor, { type: customType, day, month, year });
  };

  const viewLabel = view === "orders" ? "Pedidos Gestionados" : "Pagos Procesados";

  return (
    <div
      className="glass rounded-2xl p-5 transition-opacity"
      style={loading ? { opacity: 0.65, pointerEvents: "none" } : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold">Desempeño por Usuario</h3>
          <p className="text-xs text-text-secondary">
            {viewLabel} - {periodLabel(period, data.userCustomFilter)}
          </p>
        </div>
        <PeriodToggle
          options={[
            { key: "day", label: "Día" },
            { key: "week", label: "Semana" },
            { key: "month", label: "Mes" },
            { key: "custom", label: "Fecha específica" },
          ]}
          active={period}
          onChange={(k) => setPeriod(k as PeriodKey)}
        />
      </div>

      {/* Fila del filtro personalizado */}
      {period === "custom" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={customType}
            onChange={(e) => setCustomType(e.target.value)}
            className="rounded-lg border border-border-subtle bg-bg-tertiary px-2.5 py-1.5 text-xs outline-none"
          >
            <option value="day">Día</option>
            <option value="month">Mes</option>
            <option value="year">Año</option>
          </select>
          {customType === "day" && (
            <input
              type="number" min={1} max={31} placeholder="Día" value={customDay}
              onChange={(e) => setCustomDay(parseInt(e.target.value, 10) || 1)}
              className="w-20 rounded-lg border border-border-subtle bg-bg-tertiary px-2.5 py-1.5 text-xs outline-none"
            />
          )}
          {customType !== "year" && (
            <select
              value={customMonth}
              onChange={(e) => setCustomMonth(parseInt(e.target.value, 10) || 1)}
              className="rounded-lg border border-border-subtle bg-bg-tertiary px-2.5 py-1.5 text-xs outline-none"
            >
              {MESES.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          )}
          <input
            type="number" min={2000} max={2100} placeholder="Año" value={customYear}
            onChange={(e) => setCustomYear(parseInt(e.target.value, 10) || new Date().getFullYear())}
            className="w-24 rounded-lg border border-border-subtle bg-bg-tertiary px-2.5 py-1.5 text-xs outline-none"
          />
          <button
            onClick={onApplyCustom}
            className="rounded-lg bg-gradient-to-br from-accent-blue to-accent-blue-hover px-4 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 active:scale-95"
          >
            Aplicar
          </button>
        </div>
      )}

      {/* Filtro por usuario */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase text-text-secondary">Usuario</span>
        <select
          value={actor}
          onChange={(e) => onActorChange(e.target.value)}
          className="rounded-lg border border-border-subtle bg-bg-tertiary px-2.5 py-1.5 text-xs outline-none"
        >
          <option value="all">Todos con actividad</option>
          {actorOptions.map((u) => (
            <option key={u.user_login} value={u.user_login}>{u.user}</option>
          ))}
        </select>
      </div>

      {/* KPIs */}
      <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4">
        <div className="rounded-xl border-l-4 border-accent-blue bg-accent-blue/10 p-4">
          <p className="text-xs font-bold uppercase text-accent-blue">Pedidos Totales</p>
          <p className="mt-2 text-2xl font-extrabold">{fmtQty.format(kpiOrders)}</p>
        </div>
        <div className="rounded-xl border-l-4 border-accent-cyan bg-accent-blue/10 p-4">
          <p className="text-xs font-bold uppercase text-accent-blue">Pagos Procesados</p>
          <p className="mt-2 text-2xl font-extrabold">{fmtQty.format(kpiPayments)}</p>
        </div>
        <div className="rounded-xl border-l-4 border-accent-rose bg-accent-blue/10 p-4">
          <p className="text-xs font-bold uppercase text-accent-rose">Ticket Promedio</p>
          <p className="mt-2 text-2xl font-extrabold">{fmtMoney.format(kpiTicket)}</p>
        </div>
      </div>

      {/* Selector de vista */}
      <div className="mt-5 flex gap-3">
        <button
          onClick={() => setView("orders")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
            view === "orders"
              ? "bg-accent-blue/10 text-accent-blue"
              : "text-text-secondary hover:bg-bg-tertiary"
          }`}
        >
          <Package size={15} /> Ranking por Pedidos
        </button>
        <button
          onClick={() => setView("payments")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
            view === "payments"
              ? "bg-accent-blue/10 text-accent-blue"
              : "text-text-secondary hover:bg-bg-tertiary"
          }`}
        >
          <CreditCard size={15} /> Ranking por Pagos
        </button>
      </div>

      {/* Ranking + dona */}
      <div className="mt-4 grid gap-6 border-t border-border-subtle pt-5 lg:grid-cols-[3fr_2fr]">
        <RankingList rows={filtered} view={view} metricOf={metricOf} />
        <DonutPanel rows={filtered} view={view} />
      </div>

      {/* Tendencia operativa */}
      <TrendPanel
        rows={data.userTrendData[period] ?? []}
        metric={metric}
        onMetric={setMetric}
        periodText={periodLabel(period, data.userCustomFilter)}
      />
    </div>
  );
}

function RankingList({ rows, view, metricOf }: {
  rows: (RankingOrdersRow | RankingPaymentsRow)[];
  view: "orders" | "payments";
  metricOf: (i: RankingOrdersRow | RankingPaymentsRow) => number;
}) {
  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-sm italic text-text-muted">
        Sin datos para este periodo
      </div>
    );
  }
  const maxVal = Math.max(...rows.map(metricOf), 1);

  return (
    <div className={`space-y-4 ${rows.length >= 4 ? "max-h-80 overflow-y-auto pr-2" : ""}`}>
      {rows.map((item, index) => {
        const value = metricOf(item);
        const amount = view === "orders"
          ? Number((item as RankingOrdersRow).sales || 0)
          : Number((item as RankingPaymentsRow).amount || 0);
        return (
          <div key={item.user_login}>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span className="min-w-[30px] font-bold text-accent-blue">#{index + 1}</span>
                <span>{item.user}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="rounded-full bg-accent-blue/15 px-2.5 py-0.5 text-xs font-semibold text-accent-blue">
                  {view === "orders"
                    ? `${fmtQty.format(value)} pedidos`
                    : fmtMoney.format(value)}
                </span>
                {view === "payments" && (
                  <span className="whitespace-nowrap text-xs font-semibold text-text-muted">
                    {fmtQty.format(Number(item.count || 0))} pagos
                  </span>
                )}
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-bg-tertiary">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent-blue to-accent-blue-hover transition-all"
                style={{ width: `${(value / maxVal) * 100}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-xs text-text-muted">
              <span>{view === "orders" ? "Ventas Generadas" : "Pagos Procesados"}</span>
              <span className="font-semibold text-accent-blue">
                {view === "orders"
                  ? fmtMoney.format(amount)
                  : fmtQty.format(Number(item.count || 0))}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DonutPanel({ rows, view }: {
  rows: (RankingOrdersRow | RankingPaymentsRow)[];
  view: "orders" | "payments";
}) {
  const [hover, setHover] = useState<number | null>(null);

  const slices = rows.map((item, index) => ({
    user: item.user || "Sin usuario",
    value: view === "orders"
      ? Number((item as RankingOrdersRow).sales || 0)
      : Number((item as RankingPaymentsRow).amount || 0),
    color: DONUT_PALETTE[index % DONUT_PALETTE.length],
  }));
  const total = slices.reduce((acc, s) => acc + s.value, 0);

  let gradient = "conic-gradient(#e2e8f0 0% 100%)";
  if (total > 0) {
    let acc = 0;
    const parts = slices.map((s) => {
      const start = acc;
      acc += (s.value / total) * 100;
      return `${s.color} ${start.toFixed(2)}% ${acc.toFixed(2)}%`;
    });
    if (acc < 100) parts.push(`#e2e8f0 ${acc.toFixed(2)}% 100%`);
    gradient = `conic-gradient(${parts.join(", ")})`;
  }

  const center = hover !== null && slices[hover]
    ? { label: slices[hover].user, value: slices[hover].value }
    : { label: total > 0 ? "Total periodo" : "Sin datos", value: total };

  return (
    <div>
      <p className="text-center text-xs font-bold uppercase text-text-secondary">
        {view === "orders" ? "Participación en ventas" : "Participación en cobros"}
      </p>
      <div className="mt-3 flex flex-col items-center gap-4">
        <div
          className="grid h-44 w-44 place-items-center rounded-full"
          style={{ background: gradient }}
        >
          <div className="grid h-32 w-32 place-items-center rounded-full bg-bg-secondary text-center">
            <div className="px-2">
              <p className="max-w-[7.5rem] truncate text-[11px] text-text-muted">{center.label}</p>
              <p className="text-sm font-extrabold">{fmtMoney.format(center.value)}</p>
            </div>
          </div>
        </div>
        <div className={`w-full space-y-1.5 ${slices.length >= 5 ? "max-h-36 overflow-y-auto pr-1" : ""}`}>
          {total <= 0 ? (
            <p className="py-1 text-center text-xs text-text-muted">
              No hay distribución para mostrar
            </p>
          ) : (
            slices.map((s, i) => (
              <div
                key={s.user}
                className="flex cursor-default items-center justify-between rounded-md px-1.5 py-0.5 text-xs hover:bg-bg-tertiary"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="truncate">{s.user}</span>
                </span>
                <span className="font-semibold">{((s.value / total) * 100).toFixed(1)}%</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Tendencia operativa (canvas) ───────────────── */

const TREND_CONFIG = {
  amount: { title: "Ventas cobradas", color: "#0ea5e9", fmt: (v: number) => fmtMoney.format(v) },
  orders: { title: "Pedidos gestionados", color: "#2563eb", fmt: (v: number) => fmtQty.format(Math.round(v)) },
  payments: { title: "Pagos procesados", color: "#10b981", fmt: (v: number) => fmtQty.format(Math.round(v)) },
} as const;

function TrendPanel({ rows, metric, onMetric, periodText }: {
  rows: TrendRow[];
  metric: keyof typeof TREND_CONFIG;
  onMetric: (m: keyof typeof TREND_CONFIG) => void;
  periodText: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const config = TREND_CONFIG[metric];
  const total = rows.reduce((acc, r) => acc + Number(r[metric] || 0), 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => drawTrend(canvas, rows, metric, config.color, config.fmt);
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [rows, metric, config]);

  return (
    <div className="mt-6 rounded-xl border border-border-subtle bg-bg-primary/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold">Tendencia Operativa</p>
          <p className="text-xs text-text-secondary">{config.title} - {periodText}</p>
        </div>
        <PeriodToggle
          options={[
            { key: "amount", label: "Ventas" },
            { key: "orders", label: "Pedidos" },
            { key: "payments", label: "Pagos" },
          ]}
          active={metric}
          onChange={(k) => onMetric(k as keyof typeof TREND_CONFIG)}
        />
      </div>
      <div className="mt-3 h-60 w-full">
        <canvas ref={canvasRef} className="h-full w-full" />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-text-secondary">
        <span>Periodo: {periodText}</span>
        <span className="font-bold text-text-primary">Total: {config.fmt(total)}</span>
      </div>
    </div>
  );
}

/** Línea con área degradada — port directo del canvas de Polaris. */
function drawTrend(
  canvas: HTMLCanvasElement,
  rows: TrendRow[],
  metric: "amount" | "orders" | "payments",
  lineColor: string,
  fmt: (v: number) => string,
) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(Math.floor(rect.width), 320);
  const height = Math.max(Math.floor(rect.height), 220);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  if (rows.length === 0) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "600 12px 'Nunito Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Sin datos para este periodo", width / 2, height / 2);
    return;
  }

  const values = rows.map((r) => Number(r[metric] || 0));
  const maxValue = Math.max(...values, 0) || 1;
  const pad = { top: 18, right: 16, bottom: 34, left: 80 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 11px 'Nunito Sans', sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const ratio = i / 4;
    const y = pad.top + plotH * ratio;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(fmt(maxValue * (1 - ratio)), pad.left - 6, y + 4);
  }

  const points = rows.map((row, idx) => ({
    x: pad.left + (rows.length === 1 ? plotW / 2 : (idx * plotW) / (rows.length - 1)),
    y: pad.top + (1 - Number(row[metric] || 0) / maxValue) * plotH,
    label: row.label || "",
  }));

  const area = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
  area.addColorStop(0, `${lineColor}55`);
  area.addColorStop(1, `${lineColor}00`);
  ctx.beginPath();
  ctx.moveTo(points[0].x, pad.top + plotH);
  points.forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, pad.top + plotH);
  ctx.closePath();
  ctx.fillStyle = area;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  points.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  ctx.fillStyle = "#64748b";
  ctx.textAlign = "center";
  ctx.font = "600 11px 'Nunito Sans', sans-serif";
  const step = Math.max(1, Math.ceil(rows.length / 8));
  points.forEach((p, idx) => {
    if (idx === 0 || idx === points.length - 1 || idx % step === 0) {
      ctx.fillText(p.label, p.x, height - 11);
    }
  });
}

/* ───────────────────────── Productos Top Ranking ──────────────────────── */

function TopProductsCard({ products }: { products: { name: string; qty: number }[] }) {
  const maxQty = Math.max(...products.map((p) => p.qty), 1);
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold">Productos Top Ranking</h3>
          <p className="text-xs text-text-secondary">
            Basado en cantidad de ventas (Últimos 30 días)
          </p>
        </div>
        <span className="rounded-lg bg-accent-amber/10 p-2 text-accent-amber">
          <Award size={18} />
        </span>
      </div>
      <div className="mt-4 space-y-4">
        {products.length === 0 ? (
          <p className="py-4 text-center text-sm italic text-text-muted">
            Sin ventas registradas en los últimos 30 días
          </p>
        ) : (
          products.map((p) => (
            <div key={p.name}>
              <div className="flex items-center justify-between text-sm">
                <span>{p.name}</span>
                <span className="rounded-full bg-accent-blue/15 px-2.5 py-0.5 text-xs font-semibold text-accent-blue">
                  {fmtQty.format(p.qty)} Unid.
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-bg-tertiary">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent-blue to-accent-blue-hover"
                  style={{ width: `${(p.qty / maxQty) * 100}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Distribución de Pagos y Propinas ───────────── */

function PaymentsCard({ payments, dates }: {
  payments: DashboardData["payments"];
  dates: DashboardData["dates"];
}) {
  const [period, setPeriod] = useState<"day" | "week" | "month">("day");
  const data = [...(payments[period] ?? [])].sort(
    (a, b) => methodSortIndex(a.method) - methodSortIndex(b.method),
  );
  const totalCount = data.reduce((acc, d) => acc + Number(d.count || 0), 0);
  const totalTips = data.reduce((acc, d) => acc + Number(d.tip || 0), 0);
  const maxTip = Math.max(...data.map((d) => Number(d.tip || 0)), 0);
  const scaleMax = maxTip > 0 ? maxTip * 1.2 : 10000;

  return (
    <div className="glass rounded-2xl p-5">
      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border-l-4 border-[#3b82f6] bg-bg-primary p-4">
          <p className="text-xs font-bold uppercase text-text-secondary">
            Total de Pagos (Cantidad)
          </p>
          <p className="mt-2 text-2xl font-extrabold">{fmtQty.format(totalCount)}</p>
        </div>
        <div className="rounded-xl border-l-4 border-[#10b981] bg-bg-primary p-4">
          <p className="text-xs font-bold uppercase text-text-secondary">
            Total Propinas Recaudadas
          </p>
          <p className="mt-2 text-2xl font-extrabold">{fmtMoney.format(totalTips)}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold">Distribución de Pagos y Propinas</h3>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-text-secondary">
            <span className="h-2.5 w-2.5 rounded-full bg-[#6ee7b7]" /> Propina
          </div>
        </div>
        <PeriodToggle
          options={[
            { key: "day", label: "Día" },
            { key: "week", label: "Semana" },
            { key: "month", label: "Mes" },
          ]}
          active={period}
          onChange={(k) => setPeriod(k as "day" | "week" | "month")}
        />
      </div>
      <div className="mt-1 text-right">
        <RangeNote period={period} dates={dates} />
      </div>

      {/* Gráfico */}
      <div className="mt-4 pl-20">
        <div className="relative flex h-64 items-end justify-around gap-6">
          {/* Líneas de la cuadrícula */}
          {[1, 0.75, 0.5, 0.25, 0].map((tick) => (
            <div
              key={tick}
              className="pointer-events-none absolute inset-x-0 border-t border-border-subtle"
              style={{ bottom: `${tick * 100}%` }}
            >
              <span className="absolute -left-20 -top-2 w-16 text-right text-[10px] text-text-muted">
                ${fmtNumber(scaleMax * tick)}
              </span>
            </div>
          ))}

          {data.length === 0 ? (
            <div className="self-center text-center text-sm italic text-text-muted">
              Sin movimientos
            </div>
          ) : (
            data.map((d) => {
              const { main, tip: tipColor, Icon } = methodColor(d.method);
              return (
                <div
                  key={`${period}-${d.method}`}
                  className="group relative flex h-full w-20 flex-col items-center justify-end"
                >
                  <div className="pointer-events-none absolute -top-2 z-10 w-44 rounded-lg bg-text-primary p-2 text-[11px] text-white opacity-0 shadow-lg transition group-hover:opacity-100">
                    <p className="font-bold">{d.method}</p>
                    <p className="mt-0.5 flex justify-between">
                      <span>Pagos:</span> <strong>{d.count}</strong>
                    </p>
                    <p className="flex justify-between" style={{ color: tipColor }}>
                      <span>Propina:</span> <span>{fmtMoney.format(Number(d.tip))}</span>
                    </p>
                  </div>
                  <div
                    className="w-12 rounded-t-md transition-all duration-500"
                    style={{
                      height: `${(Number(d.tip) / scaleMax) * 100}%`,
                      backgroundColor: tipColor,
                    }}
                  />
                  <div className="mt-1.5 flex w-full flex-col items-center" style={{ color: main }}>
                    <Icon size={16} />
                    <span className="w-full truncate text-center text-[10px] font-medium text-text-secondary">
                      {d.method}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      <p className="mt-4 text-[11px] italic text-text-muted">
        * Valores basados en transacciones cerradas y válidas.
      </p>
    </div>
  );
}

/* ───────────────────────── Paneles ALERTAS / SOBREGIRO ────────────────── */

/** Punto rojo pulsante cuando hay alertas pendientes. */
function PingDot() {
  return (
    <span className="absolute -right-1 -top-1 flex h-3 w-3">
      <span className="ping-dot absolute inline-flex h-full w-full rounded-full bg-accent-rose opacity-75" />
      <span className="relative inline-flex h-3 w-3 rounded-full bg-accent-rose" />
    </span>
  );
}

/** Chip compacto para móvil (sustituye al riel vertical en < md). */
function AlertChip({ label, count, Icon, onClick }: {
  label: string; count: number; Icon: typeof Package; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="glass flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-text-secondary transition active:scale-95"
    >
      <span className="relative">
        <Icon size={16} />
        {count > 0 && <PingDot />}
      </span>
      {label}
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
          count > 0 ? "bg-accent-rose text-white" : "bg-bg-tertiary text-text-muted"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

/** Riel vertical sticky (tablet/desktop): barra completa de arriba a abajo
 * como el menú (estilo Polaris), integrada al layout sin flotar sobre la
 * barra de scroll. h = viewport menos la barra superior del Layout (h-14). */
function AlertsRail({ lowStockCount, overdraftCount, onOpen }: {
  lowStockCount: number;
  overdraftCount: number;
  onOpen: (tab: AlertsTab) => void;
}) {
  return (
    <div className="glass sticky top-0 hidden h-[calc(100dvh-3.5rem)] w-14 shrink-0 flex-col items-center gap-4 rounded-none border-y-0 border-r-0 py-5 shadow-[-2px_0_12px_rgba(0,0,0,0.05)] md:flex">
      <button
        onClick={() => onOpen("low-stock")}
        className="flex flex-col items-center gap-2 text-text-secondary transition hover:text-accent-blue"
        title="Alertas de stock bajo"
      >
        <span className="relative">
          <Package size={22} />
          {lowStockCount > 0 && <PingDot />}
        </span>
        <span className="vertical-text text-[10px] font-bold">ALERTAS</span>
      </button>
      <div className="h-px w-6 bg-border-subtle" />
      <button
        onClick={() => onOpen("overdraft")}
        className="flex flex-col items-center gap-2 text-text-secondary transition hover:text-accent-blue"
        title="Sobregiros de inventario"
      >
        <span className="relative">
          <ArrowUpDown size={20} />
          {overdraftCount > 0 && <PingDot />}
        </span>
        <span className="vertical-text text-[10px] font-bold">SOBREGIRO</span>
      </button>
    </div>
  );
}

/** Detalle de notificaciones: panel lateral derecho en md+, bottom sheet
 * en móvil. Portal a <body> (el transform de .fade-in-up rompería el
 * position:fixed) con fondo oscuro que cierra al tocar fuera. */
function AlertsPanel({ open, onClose, lowStock, overdrafts }: {
  open: AlertsTab;
  onClose: () => void;
  lowStock: DashboardData["lowStock"];
  overdrafts: DashboardData["overdrafts"];
}) {
  if (!open) return null;
  const items = open === "low-stock" ? lowStock : overdrafts;

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="glass slide-up-mobile fixed inset-x-0 bottom-0 z-50 max-h-[75dvh] overflow-y-auto rounded-t-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl md:inset-x-auto md:inset-y-0 md:right-0 md:max-h-none md:w-80 md:rounded-l-2xl md:rounded-tr-none md:pb-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-bold">
              Notificaciones
              {items.length > 0 && (
                <span className="rounded-full bg-accent-rose/10 px-2 py-0.5 text-xs font-bold text-accent-rose">
                  {items.length}
                </span>
              )}
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              {open === "low-stock" ? "Bajo Stock detectado" : "Stock Negativo Detectado"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar notificaciones"
            className="rounded-lg p-1.5 text-text-secondary transition hover:bg-bg-tertiary"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="mt-5 pb-4">
          {items.length === 0 ? (
            <div className="my-10 text-center text-text-muted">
              <Bell size={48} strokeWidth={1} className="mx-auto mb-4" />
              <p className="text-sm">
                {open === "low-stock" ? "Sin alertas de stock" : "Sin alertas de sobregiro"}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-3">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-rose" />
                  <a
                    href="/inventario?tab=Movimientos&new=true"
                    className="min-w-0 flex-1 rounded-xl border border-border-subtle bg-bg-secondary p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <h3 className="mb-2 truncate text-[13px] font-bold text-text-primary uppercase">{item.name}</h3>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-rose/20 bg-accent-rose/10 px-2 py-0.5 text-[10px] font-bold uppercase text-accent-rose">
                      <Bell size={10} strokeWidth={2.5} />
                      Quedan {fmtNumber(Number(item.stock))} {item.unit}
                    </span>
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
