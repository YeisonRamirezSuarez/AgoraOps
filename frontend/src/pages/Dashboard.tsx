/**
 * Dashboard — manual §1.5: ventas, objetivos, top de productos, paneles
 * de Alertas (stock bajo) y Sobregiros. Origen PHP: inicio.php.
 */
import { useEffect, useState } from "react";
import { api, subscribeEvents } from "../lib/api";
import { useAuth } from "../lib/auth";

interface Stats {
  sales_today: number;
  orders_today: number;
  tables_occupied: number;
  low_stock: { id: number; name: string; stock: number; min_stock: number }[];
  overdrafts: { id: number; name: string; stock: number }[];
  top_products: { product_name: string; qty: number; total: number }[];
}

const cop = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);

  function load() {
    api<Stats>("/api/dashboard").then(setStats).catch(() => {});
  }

  useEffect(() => {
    load();
    // Refresca al llegar eventos de órdenes o stock (SSE)
    return subscribeEvents(() => load());
  }, []);

  const cards = [
    { label: "Ventas de hoy", value: cop.format(stats?.sales_today ?? 0) },
    { label: "Órdenes de hoy", value: String(stats?.orders_today ?? 0) },
    { label: "Mesas ocupadas", value: String(stats?.tables_occupied ?? 0) },
    {
      label: "Alertas de stock",
      value: String(stats?.low_stock?.length ?? 0),
      accent: (stats?.low_stock?.length ?? 0) > 0 ? "text-accent-amber" : "",
    },
    {
      label: "Sobregiros",
      value: String(stats?.overdrafts?.length ?? 0),
      accent: (stats?.overdrafts?.length ?? 0) > 0 ? "text-accent-rose" : "",
    },
  ];

  return (
    <div className="fade-in-up">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mb-6 text-text-secondary">Bienvenido, {user?.fullName}</p>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        {cards.map((card) => (
          <div key={card.label} className="glass rounded-2xl p-5 shadow-lg">
            <p className="text-sm text-text-secondary">{card.label}</p>
            <p className={`mt-1 text-3xl font-bold ${card.accent ?? ""}`}>
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {stats && stats.top_products.length > 0 && (
        <div className="glass mt-6 rounded-2xl p-5">
          <h2 className="mb-3 font-semibold">Top productos más vendidos</h2>
          <ul className="space-y-2">
            {stats.top_products.map((p) => (
              <li
                key={p.product_name}
                className="flex justify-between border-b border-border-subtle pb-2 text-sm last:border-0"
              >
                <span>
                  {p.product_name}
                  <span className="ml-2 text-text-muted">x{p.qty}</span>
                </span>
                <span className="font-medium">{cop.format(p.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
