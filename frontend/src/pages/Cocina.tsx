/**
 * Monitor de Cocina — manual §1.6.4.
 * Cards por mesa con productos confirmados "A cocina"; productos idénticos
 * agrupados; estados Requerido → En preparación → Listo; actualización
 * individual (clic en el producto) o masiva; sonido al marcar Listo;
 * timer por orden; tiempo real por SSE.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChefHat, Clock } from "lucide-react";
import { api, ApiError, subscribeEvents } from "../lib/api";
import { Badge, Button, PageHeader, useToast } from "../components/ui";

interface KitchenItem {
  ids: number[];
  product_name: string;
  notes: string | null;
  toppings: string;
  quantity: number;
  kitchen_status: "requerido" | "en_preparacion" | "listo";
}
interface KitchenOrder {
  order_id: number;
  order_number: string;
  table_number: number | null;
  room_name: string | null;
  opened_at: string;
  items: KitchenItem[];
}

const NEXT: Record<string, { label: string; status: string }[]> = {
  requerido: [
    { label: "En preparación", status: "en_preparacion" },
    { label: "Listo", status: "listo" },
  ],
  en_preparacion: [{ label: "Listo", status: "listo" }],
};

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
  const [selected, setSelected] = useState<number[]>([]);
  const prevCount = useRef(0);
  const [, tickStat] = useState(0);

  const load = useCallback(() => {
    api<KitchenOrder[]>("/api/kitchen/board").then((data) => {
      // Sonido cuando llega un pedido nuevo a cocina
      const count = data.reduce((s, o) => s + o.items.length, 0);
      if (count > prevCount.current && prevCount.current > 0) beep();
      prevCount.current = count;
      setOrders(data);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const unsub = subscribeEvents((e) => {
      if (e.table === "order_items" || e.table === "orders") load();
    });
    const t = setInterval(() => tickStat((n) => n + 1), 30000);
    return () => { unsub(); clearInterval(t); };
  }, [load]);

  async function setStatus(itemIds: number[], status: string) {
    try {
      await api("/api/kitchen/status", { method: "POST", body: { itemIds, status } });
      if (status === "listo") beep();
      setSelected([]);
      load();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Error al actualizar el estado");
    }
  }

  function toggle(ids: number[]) {
    const all = ids.every((id) => selected.includes(id));
    setSelected(all
      ? selected.filter((id) => !ids.includes(id))
      : [...new Set([...selected, ...ids])]);
  }

  return (
    <div className="fade-in-up">
      <PageHeader
        title="Monitor de Cocina"
        subtitle="Pedidos confirmados que requieren preparación"
        actions={selected.length > 0 ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setStatus(selected, "en_preparacion")}>
              En preparación ({selected.length})
            </Button>
            <Button size="sm" variant="success" onClick={() => setStatus(selected, "listo")}>
              Listo ({selected.length})
            </Button>
          </>
        ) : undefined}
      />

      {orders.length === 0 && (
        <div className="glass grid place-items-center rounded-2xl py-20 text-text-muted">
          <ChefHat size={40} className="mb-3 opacity-50" />
          <p>No hay pedidos pendientes en cocina</p>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-4">
        {orders.map((order) => {
          const minutes = Math.floor((Date.now() - new Date(order.opened_at).getTime()) / 60000);
          const timerColor =
            minutes >= 60 ? "text-accent-rose" : minutes >= 30 ? "text-accent-amber" : "text-accent-emerald";
          const allIds = order.items.flatMap((i) => i.ids);
          return (
            <div key={order.order_id} className="glass rounded-2xl p-4">
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <p className="font-bold">
                    Mesa {order.table_number ?? "—"}
                    <span className="ml-2 text-xs font-normal text-text-muted">{order.room_name}</span>
                  </p>
                  <p className="text-xs text-text-muted">#{order.order_number}</p>
                </div>
                <span className={`flex items-center gap-1 text-sm font-semibold ${timerColor}`}>
                  <Clock size={14} /> {minutes}m
                </span>
              </div>

              <ul className="space-y-2">
                {order.items.map((item, idx) => {
                  const isSel = item.ids.every((id) => selected.includes(id));
                  return (
                    <li key={idx}>
                      <button
                        onClick={() => toggle(item.ids)}
                        className={`w-full rounded-xl border p-2.5 text-left transition ${
                          isSel
                            ? "border-accent-blue bg-accent-blue/10"
                            : "border-border-subtle hover:border-border-medium"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            {item.product_name} <span className="text-accent-cyan">×{item.quantity}</span>
                          </span>
                          <Badge color={item.kitchen_status === "requerido" ? "amber" : "cyan"}>
                            {item.kitchen_status === "requerido" ? "Requerido" : "En preparación"}
                          </Badge>
                        </div>
                        {item.toppings && <p className="mt-0.5 text-xs text-accent-orange">{item.toppings}</p>}
                        {item.notes && <p className="text-xs italic text-text-muted">{item.notes}</p>}
                      </button>
                      <div className="mt-1 flex gap-1">
                        {(NEXT[item.kitchen_status] ?? []).map((n) => (
                          <Button key={n.status} size="sm"
                            variant={n.status === "listo" ? "success" : "ghost"}
                            onClick={() => setStatus(item.ids, n.status)}>
                            {n.label}
                          </Button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Actualización masiva de la mesa (§1.6.4) */}
              <div className="mt-3 border-t border-border-subtle pt-2">
                <Button size="sm" variant="success" className="w-full"
                  onClick={() => setStatus(allIds, "listo")}>
                  ✓ Toda la mesa Lista
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
