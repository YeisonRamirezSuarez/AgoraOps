/**
 * Dashboard global del Super Admin (Multicomercio): KPIs de la plataforma,
 * ranking de establecimientos por movimientos (órdenes/ventas del rango,
 * para decidir a quién dar ofertas o mejoras) y tendencia diaria global.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Store, ReceiptText, TrendingUp, MoonStar } from "lucide-react";
import { api } from "../../lib/api";
import { Badge, Loader, PageHeader, Select, cop, fmtDateTime, useToast } from "../../components/ui";

interface RankingRow {
  id: string;
  name: string;
  slug: string;
  country: string;
  is_active: boolean;
  logo_url: string | null;
  orders_count: number;
  sales: number;
  payments_count: number;
  last_order_at: string | null;
  users_count: number;
  last_login_at: string | null;
}

interface Overview {
  days: number;
  tenants: { total: number; active: number; inactive: number };
  totals: { orders: number; sales: number; withoutActivity: number };
  ranking: RankingRow[];
  series: { day: string; orders: number; sales: number }[];
}

const RANGES = [
  { value: 7, label: "Últimos 7 días" },
  { value: 30, label: "Últimos 30 días" },
  { value: 90, label: "Últimos 90 días" },
];

function KpiCard({ icon: Icon, label, value, hint }: {
  icon: typeof Store; label: string; value: string; hint?: string;
}) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-blue/12 text-accent-blue">
          <Icon size={20} />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
            {label}
          </p>
          <p className="truncate text-xl font-bold">{value}</p>
          {hint && <p className="text-xs text-text-secondary">{hint}</p>}
        </div>
      </div>
    </div>
  );
}

export default function SuperDashboard() {
  const toast = useToast();
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    api<Overview>(`/api/superadmin/overview?days=${days}`)
      .then(setData)
      .catch((e) => toast("error", e.message));
  }, [days, toast]);

  if (!data) {
    return <Loader label="Cargando dashboard" />;
  }

  const maxOrders = Math.max(1, ...data.ranking.map((r) => r.orders_count));
  const maxSeries = Math.max(1, ...data.series.map((s) => s.orders));

  return (
    <div className="fade-in-up">
      <PageHeader
        title="Dashboard global"
        subtitle="Movimiento de todos los establecimientos de la plataforma"
        actions={
          <Select value={days} className="!w-44"
            onChange={(e) => setDays(Number(e.target.value))}>
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </Select>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Store} label="Establecimientos"
          value={`${data.tenants.active} activos`}
          hint={`${data.tenants.total} en total · ${data.tenants.inactive} inactivos`} />
        <KpiCard icon={ReceiptText} label={`Órdenes (${days} días)`}
          value={String(data.totals.orders)} />
        <KpiCard icon={TrendingUp} label={`Ventas (${days} días)`}
          value={cop.format(data.totals.sales)} />
        <KpiCard icon={MoonStar} label="Sin actividad"
          value={String(data.totals.withoutActivity)}
          hint="Establecimientos sin órdenes en el rango" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        {/* Ranking de movimientos */}
        <section className="glass rounded-2xl p-5">
          <h2 className="mb-4 text-base font-bold">
            Ranking de movimientos
            <span className="ml-2 text-xs font-normal text-text-muted">
              órdenes y ventas del rango — los primeros son candidatos a ofertas
            </span>
          </h2>
          {data.ranking.length === 0 && (
            <p className="py-8 text-center text-sm text-text-muted">
              No hay establecimientos registrados.
            </p>
          )}
          <ul className="space-y-3">
            {data.ranking.map((r, i) => (
              <li key={r.id}>
                <button
                  onClick={() => navigate(`/superadmin/establecimientos/${r.id}`)}
                  className="w-full rounded-xl border border-border-subtle p-3 text-left transition hover:border-accent-blue/50 hover:bg-bg-tertiary/50">
                  <div className="flex items-center gap-3">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${
                      i === 0 ? "bg-accent-amber/20 text-accent-amber"
                        : i === 1 ? "bg-bg-tertiary text-text-secondary"
                        : "bg-bg-tertiary text-text-muted"
                    }`}>
                      {i + 1}
                    </span>
                    {r.logo_url ? (
                      <img src={r.logo_url} alt=""
                        className="h-9 w-9 shrink-0 rounded-lg border border-border-subtle bg-white object-contain" />
                    ) : (
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-blue/12 text-sm font-bold text-accent-blue">
                        {r.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate font-semibold">
                        {r.name}
                        {!r.is_active && <Badge color="rose">Inactivo</Badge>}
                      </p>
                      <p className="text-xs text-text-muted">
                        {r.orders_count} órdenes · {cop.format(r.sales)} ·
                        última orden {fmtDateTime(r.last_order_at, "nunca")}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-bold text-accent-cyan">
                      {cop.format(r.sales)}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                    <div className="h-full rounded-full bg-gradient-to-r from-accent-blue to-accent-cyan"
                      style={{ width: `${(r.orders_count / maxOrders) * 100}%` }} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Tendencia diaria global */}
        <section className="glass h-fit rounded-2xl p-5">
          <h2 className="mb-4 text-base font-bold">
            Órdenes por día
            <span className="ml-2 text-xs font-normal text-text-muted">
              todos los establecimientos
            </span>
          </h2>
          {data.series.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">
              Sin órdenes en el rango seleccionado.
            </p>
          ) : (
            <div className="flex h-44 items-end gap-[3px]">
              {data.series.map((s) => (
                <div key={s.day} className="group relative flex-1"
                  title={`${s.day}: ${s.orders} órdenes · ${cop.format(s.sales)}`}>
                  <div className="grow-bar-v w-full rounded-t bg-gradient-to-t from-accent-blue to-accent-cyan/70"
                    style={{ height: `${(s.orders / maxSeries) * 168}px`, minHeight: s.orders > 0 ? 4 : 1 }} />
                </div>
              ))}
            </div>
          )}
          {data.series.length > 0 && (
            <div className="mt-2 flex justify-between text-[10px] text-text-muted">
              <span>{data.series[0].day}</span>
              <span>{data.series[data.series.length - 1].day}</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
