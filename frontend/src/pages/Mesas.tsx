/**
 * Mesas — manual §1.6.3, con el diseño de Polaris Food: tabs por sala,
 * tarjetas de OCUPACIÓN % y LIBRES, y cards de mesa con capacidad,
 * cronómetro en vivo (verde → amarillo 30 min → rojo 1 h), mesero,
 * barra de progreso y CUENTA. Tiempo real por SSE.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, Clock, Coffee, LayoutGrid, Lock, MessageSquare, UserRound, Users,
} from "lucide-react";
import { api, ApiError, subscribeEvents } from "../lib/api";
import { Badge, cop, PageHeader, useToast } from "../components/ui";
import { tableTimeColor } from "../shared/constants/orderStatus";

interface BoardCell {
  table_id: number;
  number: number;
  seats: number;
  room_id: number;
  room_name: string;
  order_id: number | null;
  order_number: string | null;
  opened_at: string | null;
  comment: string | null;
  customer_name: string | null;
  attended_by: string | null;
  total: string;
}

const TIME_STYLES = {
  fresh: { text: "text-accent-emerald", bar: "bg-accent-emerald" },
  warning: { text: "text-accent-amber", bar: "bg-accent-amber" },
  danger: { text: "text-accent-rose", bar: "bg-accent-rose" },
} as const;

function elapsed(iso: string): { label: string; minutes: number } {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { label: `${pad(h)}:${pad(m)}:${pad(s)}`, minutes: Math.floor(secs / 60) };
}

export default function Mesas() {
  const toast = useToast();
  const navigate = useNavigate();
  const [board, setBoard] = useState<BoardCell[]>([]);
  const [activeRoom, setActiveRoom] = useState<number | null>(null);
  // null = cargando; false = todas las cajas cerradas → no se abren mesas (§1.6.3)
  const [cashOpen, setCashOpen] = useState<boolean | null>(null);
  const [, tick] = useState(0);

  const load = useCallback(() => {
    api<BoardCell[]>("/api/orders/board").then(setBoard).catch(() => {});
    api<{ open: boolean }>("/api/orders/cash-status")
      .then((r) => setCashOpen(r.open)).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const unsub = subscribeEvents((e) => {
      if (e.table === "orders" || e.table === "order_items" || e.table === "cash_sessions") load();
    });
    // Cronómetro en vivo (Polaris muestra HH:MM:SS)
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => { unsub(); clearInterval(t); };
  }, [load]);

  const rooms = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of board) map.set(c.room_id, c.room_name);
    return [...map.entries()];
  }, [board]);

  const room = activeRoom ?? rooms[0]?.[0] ?? null;
  const cells = board.filter((c) => c.room_id === room);
  const occupied = cells.filter((c) => c.order_id).length;
  const free = cells.length - occupied;
  const occupancy = cells.length === 0 ? 0 : Math.round((occupied / cells.length) * 100);

  async function openTable(cell: BoardCell) {
    if (cell.order_id) {
      navigate(`/mesas/${cell.order_id}`);
      return;
    }
    if (cashOpen === false) {
      toast("error", "Todas las cajas están cerradas; no es posible abrir mesas.");
      return;
    }
    try {
      const order = await api<{ id: number }>("/api/orders/occupy", {
        method: "POST",
        body: { tableId: cell.table_id },
      });
      navigate(`/mesas/${order.id}`);
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "No fue posible abrir la mesa");
    }
  }

  return (
    <div className="fade-in-up">
      <PageHeader title="Mesas" subtitle="Restaurante" />

      {/* Sin caja abierta no se crean mesas (§1.6.3) */}
      {cashOpen === false && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-accent-rose/40 bg-accent-rose/10 px-4 py-3 text-sm text-accent-rose">
          <Lock size={16} className="shrink-0" />
          <span>
            <b>Todas las cajas están cerradas;</b> no es posible abrir mesas.
            Abra una caja en <b>Gestión de cajas</b> para comenzar a operar.
          </span>
        </div>
      )}

      {/* Tabs por sala, estilo Polaris (icono + nombre, subrayado activo) */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-border-subtle">
        {rooms.map(([id, name]) => (
          <button key={id} onClick={() => setActiveRoom(id)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm transition ${
              id === room
                ? "border-accent-blue font-medium text-accent-blue"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}>
            <LayoutGrid size={15} /> {name}
          </button>
        ))}
      </div>

      {/* Tarjetas de ocupación y libres */}
      <div className="mb-6 flex flex-wrap gap-3">
        <div className="glass flex items-center gap-3 rounded-2xl px-5 py-3.5">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-emerald/15 text-accent-emerald">
            <Users size={18} />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Ocupación
            </p>
            <p className="text-xl font-bold">{occupancy}%</p>
          </div>
        </div>
        <div className="glass flex items-center gap-3 rounded-2xl px-5 py-3.5">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-blue/15 text-accent-blue">
            <Coffee size={18} />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Libres
            </p>
            <p className="text-xl font-bold">{free}</p>
          </div>
        </div>
      </div>

      {/* Cards de mesa */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-4">
        {cells.map((cell) => {
          const isOccupied = !!cell.order_id;
          const blocked = !isOccupied && cashOpen === false;
          const time = cell.opened_at ? elapsed(cell.opened_at) : null;
          const tone = time ? tableTimeColor(time.minutes) : null;
          const style = tone ? TIME_STYLES[tone] : null;
          const progress = time ? Math.min((time.minutes / 60) * 100, 100) : 0;

          return (
            <button key={cell.table_id} onClick={() => openTable(cell)}
              className={`glass rounded-2xl border p-5 text-left transition ${
                blocked
                  ? "cursor-not-allowed opacity-55"
                  : "hover:-translate-y-0.5 hover:shadow-xl"
              } ${
                isOccupied
                  ? tone === "danger" ? "border-accent-rose/60"
                    : tone === "warning" ? "border-accent-amber/60"
                    : "border-accent-emerald/60"
                  : "border-border-subtle"
              }`}>
              <div className="mb-3 flex items-start justify-between">
                <h3 className="text-lg font-bold">Mesa {cell.number}</h3>
                {isOccupied
                  ? <Badge color={tone === "danger" ? "rose" : tone === "warning" ? "amber" : "emerald"}>Ocupada</Badge>
                  : <Badge color="gray">Libre</Badge>}
              </div>

              <p className="mb-3 flex items-center gap-1.5 text-sm text-text-secondary">
                <Users size={14} /> Capacidad: {cell.seats}p
              </p>

              {isOccupied && time && style ? (
                <>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className={`flex items-center gap-1.5 font-semibold tabular-nums ${style.text}`}>
                      <Clock size={14} /> {time.label}
                      {tone === "danger" && <AlertTriangle size={14} />}
                    </span>
                    <span className="flex items-center gap-1.5 text-text-secondary">
                      <UserRound size={14} /> {cell.attended_by ?? "—"}
                    </span>
                  </div>

                  {/* Barra de progreso de tiempo (60 min = 100%) */}
                  <div className="mb-4 h-1 overflow-hidden rounded-full bg-bg-tertiary">
                    <div className={`h-full rounded-full ${style.bar}`}
                      style={{ width: `${progress}%` }} />
                  </div>

                  <div className="flex items-end justify-between border-t border-border-subtle pt-3">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      Cuenta
                    </span>
                    <span className="text-xl font-bold">
                      {cop.format(Number(cell.total))}
                    </span>
                  </div>

                  {cell.comment && (
                    <p className="mt-2 flex items-center gap-1 truncate text-xs text-accent-amber">
                      <MessageSquare size={12} /> {cell.comment}
                    </p>
                  )}
                </>
              ) : blocked ? (
                <p className="flex items-center gap-1.5 pt-1 text-xs text-accent-rose">
                  <Lock size={12} /> Caja cerrada — no disponible
                </p>
              ) : (
                <p className="pt-1 text-xs text-text-muted">
                  Toque la mesa para ocuparla y crear la orden
                </p>
              )}
            </button>
          );
        })}
        {cells.length === 0 && (
          <p className="col-span-full py-12 text-center text-sm text-text-muted">
            No hay mesas activas en esta sala.
          </p>
        )}
      </div>
    </div>
  );
}
