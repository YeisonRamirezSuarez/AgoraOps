/**
 * Campana de notificaciones — réplica de la campana del menú de Polaris
 * (app_menu, verificado en QA 2026-06-12):
 *  - Badge con el conteo de NO VISUALIZADAS; dropdown con cada pendiente
 *    como "PEDIDO LISTO - {PRODUCTO} / MESA #{mesa} ORDEN #{orden}."
 *    (solo productos Listo, igual que Polaris).
 *  - Clic en una notificación la marca vista: desaparece de la lista y
 *    el contador baja (en Polaris vía WebSocket mark_as_read; aquí POST
 *    + SSE mantiene sincronizadas las demás pestañas/usuarios).
 *  - Suena el timbre (notification.mp3, el mismo audio de Polaris) al
 *    llegar una notificación nueva en tiempo real.
 *  - Vacío: "No hay notificaciones".
 */
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { api, subscribeEvents } from "../lib/api";

interface PendingNotification {
  id: number;
  status: string;
  product_name: string | null;
  order_number: string | null;
  table_number: number | null;
}

export default function NotificationBell() {
  const [pending, setPending] = useState<PendingNotification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = () =>
    api<PendingNotification[]>("/api/kitchen/notifications?unviewed=1")
      .then((rows) => setPending(rows.filter((n) => n.status === "Listo")))
      .catch(() => {});

  useEffect(() => {
    load();
    return subscribeEvents((e) => {
      if (e.table !== "notifications") return;
      if (e.action === "INSERT") {
        // Timbre de Polaris al llegar una notificación nueva
        new Audio("/notification.mp3").play().catch(() => {});
      }
      load();
    });
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent) =>
      ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const view = async (n: PendingNotification) => {
    // Quitar de inmediato (como Polaris); el SSE reconcilia al resto
    setPending((p) => p.filter((x) => x.id !== n.id));
    try {
      await api(`/api/kitchen/notifications/${n.id}/view`, { method: "POST" });
    } catch {
      load();
    }
  };

  return (
    <div ref={ref} className="fixed right-4 top-3 z-40 md:right-6">
      <button type="button" onClick={() => setOpen((o) => !o)}
        aria-label="Notificaciones"
        className="glass relative grid h-11 w-11 place-items-center rounded-full text-text-secondary shadow-lg transition hover:text-accent-blue">
        <Bell size={20} />
        {pending.length > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-accent-rose px-1 text-[11px] font-bold text-white shadow">
            {pending.length}
          </span>
        )}
      </button>

      {open && (
        <div className="glass absolute right-0 top-full mt-2 max-h-96 w-80 overflow-y-auto rounded-2xl shadow-2xl">
          {pending.length === 0 ? (
            <div className="grid place-items-center gap-2 px-4 py-8 text-text-muted">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-bg-tertiary">
                <Bell size={24} />
              </span>
              <span className="text-sm">No hay notificaciones</span>
            </div>
          ) : (
            <ul className="divide-y divide-border-subtle/60">
              {pending.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => view(n)}
                    className="block w-full px-4 py-3 text-left text-sm transition hover:bg-bg-tertiary">
                    <span className="font-semibold">
                      PEDIDO LISTO - {n.product_name ?? ""}
                    </span>
                    <br />
                    <span className="text-text-secondary">
                      MESA #{n.table_number ?? "—"} ORDEN #{n.order_number ?? "—"}.
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
