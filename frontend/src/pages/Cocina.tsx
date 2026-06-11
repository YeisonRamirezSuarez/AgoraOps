/**
 * Monitor de cocina — manual §1.6.4, layout Polaris Food: cards con
 * cabecera de color "Mesa #N / SALA / Pedido: X", filas con checkbox
 * "1x PRODUCTO" + punto y etiqueta de estado a la derecha, y los tres
 * botones REQUERIDO / EN PREPARACIÓN / LISTO (aplican a los productos
 * marcados, o a toda la mesa si no hay marcados). Sonido + SSE.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChefHat } from "lucide-react";
import { api, ApiError, subscribeEvents } from "../lib/api";
import { PageHeader, useToast } from "../components/ui";

interface KitchenItem {
  ids: number[];
  product_name: string;
  notes: string | null;
  toppings: string;
  quantity: number;
  kitchen_status: "requerido" | "en_preparacion";
}
interface KitchenOrder {
  order_id: number;
  order_number: string;
  table_number: number | null;
  room_name: string | null;
  opened_at: string;
  items: KitchenItem[];
}

const STATUS_DOT = {
  requerido: { dot: "bg-accent-rose", label: "REQUERIDO", text: "text-accent-rose" },
  en_preparacion: { dot: "bg-accent-amber", label: "EN PREPARACIÓN", text: "text-accent-amber" },
} as const;

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(); osc.stop(ctx.currentTime + 0.4);
  } catch { /* sin audio */ }
}

export default function Cocina() {
  const toast = useToast();
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [checked, setChecked] = useState<number[]>([]);
  const prevCount = useRef(0);

  const load = useCallback(() => {
    api<KitchenOrder[]>("/api/kitchen/board").then((data) => {
      const count = data.reduce((s, o) => s + o.items.length, 0);
      if (count > prevCount.current && prevCount.current > 0) beep();
      prevCount.current = count;
      setOrders(data);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    return subscribeEvents((e) => {
      if (e.table === "order_items" || e.table === "orders") load();
    });
  }, [load]);

  function toggle(ids: number[]) {
    const all = ids.every((id) => checked.includes(id));
    setChecked(all
      ? checked.filter((id) => !ids.includes(id))
      : [...new Set([...checked, ...ids])]);
  }

  /** Botones de la mesa: aplican a los marcados de esa mesa, o a toda la mesa. */
  async function setStatus(order: KitchenOrder, status: string) {
    const orderIds = order.items.flatMap((i) => i.ids);
    const selectedInOrder = orderIds.filter((id) => checked.includes(id));
    const target = selectedInOrder.length > 0 ? selectedInOrder : orderIds;
    try {
      await api("/api/kitchen/status", { method: "POST", body: { itemIds: target, status } });
      if (status === "listo") beep();
      setChecked(checked.filter((id) => !target.includes(id)));
      load();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Error al actualizar el estado");
    }
  }

  return (
    <div className="fade-in-up">
      <PageHeader title="Monitor de cocina" subtitle="Restaurante" />

      {orders.length === 0 && (
        <div className="glass grid place-items-center rounded-2xl py-20 text-text-muted">
          <ChefHat size={40} className="mb-3 opacity-50" />
          <p>No hay pedidos pendientes en cocina</p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {orders.map((order) => (
          <div key={order.order_id} className="glass overflow-hidden rounded-2xl">
            {/* Cabecera de color estilo Polaris */}
            <div className="bg-gradient-to-r from-accent-blue to-accent-cyan px-4 py-2.5 text-sm font-bold text-white">
              Mesa #{order.table_number ?? "—"} / {(order.room_name ?? "—").toUpperCase()} / Pedido: {order.order_number}
            </div>

            {/* Filas de productos con checkbox + estado */}
            <ul className="divide-y divide-border-subtle/60 px-4 py-2">
              {order.items.map((item, idx) => {
                const isChecked = item.ids.every((id) => checked.includes(id));
                const st = STATUS_DOT[item.kitchen_status];
                return (
                  <li key={idx}>
                    <label className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition ${
                      isChecked ? "bg-accent-blue/10" : "hover:bg-bg-tertiary/40"
                    }`}>
                      <span className="flex min-w-0 items-center gap-3">
                        <input type="checkbox" checked={isChecked}
                          onChange={() => toggle(item.ids)}
                          className="h-4 w-4 shrink-0 accent-[hsl(199_89%_48%)]" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold uppercase">
                            {item.quantity}x {item.product_name}
                          </span>
                          {item.toppings && (
                            <span className="block truncate text-xs text-accent-orange">{item.toppings}</span>
                          )}
                          {item.notes && (
                            <span className="block truncate text-xs italic text-text-muted">{item.notes}</span>
                          )}
                        </span>
                      </span>
                      <span className={`flex shrink-0 items-center gap-1.5 text-xs font-bold ${st.text}`}>
                        <span className={`h-2 w-2 rounded-full ${st.dot}`} />
                        {st.label}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            {/* Botones de estado (marcados o toda la mesa, §1.6.4) */}
            <div className="flex flex-wrap justify-center gap-2 border-t border-border-subtle px-4 py-3">
              <StatusBtn color="rose" onClick={() => setStatus(order, "requerido")}>
                REQUERIDO
              </StatusBtn>
              <StatusBtn color="amber" onClick={() => setStatus(order, "en_preparacion")}>
                EN PREPARACIÓN
              </StatusBtn>
              <StatusBtn color="emerald" onClick={() => setStatus(order, "listo")}>
                LISTO
              </StatusBtn>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBtn({ color, onClick, children }: {
  color: "rose" | "amber" | "emerald"; onClick: () => void; children: React.ReactNode;
}) {
  const map = {
    rose: "bg-accent-rose hover:brightness-110",
    amber: "bg-accent-amber hover:brightness-110",
    emerald: "bg-accent-emerald hover:brightness-110",
  };
  return (
    <button onClick={onClick}
      className={`rounded-lg px-4 py-2 text-xs font-bold text-white shadow-md transition active:scale-95 ${map[color]}`}>
      {children}
    </button>
  );
}
