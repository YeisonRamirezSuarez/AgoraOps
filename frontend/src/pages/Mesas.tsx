/**
 * Mesas — réplica de Polaris blank_room_tables (docs/polaris-restaurante-mesas-spec.md)
 * con el tema hpos. Comportamientos de Polaris:
 *  · KPIs Ocupación/Libres son filtros clicables (2º clic o "Borrar" los quita)
 *  · Barra de progreso con ancho FIJO por estado: 30% / 66% / 100%
 *  · Caja cerrada → toast al hacer clic (las cards no se bloquean)
 *  · Móvil: tabs colapsables con la sala activa visible y botón "Ver salas"
 *  · Estado "Reservada" (reservación vigente sobre mesa libre)
 *  · Comentario como burbuja flotante con tooltip al pasar el mouse
 *  · Estados vacíos según filtro y botón flotante "volver arriba" en móvil
 * Diferencia acordada: el refresco es por SSE (no polling de 10 s).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, ArrowUp, ChefHat, ChevronDown, Clock, Coffee, LayoutGrid,
  MapPin, MessageSquare, UserRoundX, Users, XCircle,
} from "lucide-react";
import { api, ApiError, subscribeEvents } from "../lib/api";
import { cop, PageHeader, useToast } from "../components/ui";
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
  is_reserved: boolean;
}

type Filter = "all" | "occupied" | "free";

/* Estilos por tono de tiempo (Polaris: occupied-normal/medium/long).
   La barra usa anchos fijos 30/66/100 como Polaris, no proporcionales. */
const TIME_STYLES = {
  fresh: {
    text: "text-accent-emerald", bar: "bg-accent-emerald", barWidth: "30%",
    card: "border-accent-emerald/50 bg-accent-emerald/5",
    badge: "bg-accent-emerald/15 text-accent-emerald",
  },
  warning: {
    text: "text-accent-amber", bar: "bg-accent-amber", barWidth: "66%",
    card: "border-accent-amber/50 bg-accent-amber/5",
    badge: "bg-accent-amber/15 text-accent-amber",
  },
  danger: {
    text: "text-accent-rose", bar: "bg-accent-rose", barWidth: "100%",
    card: "border-accent-rose/50 bg-accent-rose/5",
    badge: "bg-accent-rose/15 text-accent-rose",
  },
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
  const [filter, setFilter] = useState<Filter>("all");
  const [tabsExpanded, setTabsExpanded] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  // null = cargando; false = todas las cajas cerradas (Polaris: CASH_REGISTER_STATUS)
  const [cashOpen, setCashOpen] = useState<boolean | null>(null);
  const [, tick] = useState(0);
  const redirecting = useRef(false); // Polaris: redireccionEnProceso

  const load = useCallback(() => {
    api<BoardCell[]>("/api/orders/board").then(setBoard).catch(() => {});
    api<{ open: boolean }>("/api/orders/cash-status")
      .then((r) => setCashOpen(r.open)).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const unsub = subscribeEvents((e) => {
      if (e.table === "orders" || e.table === "order_items" ||
          e.table === "cash_sessions" || e.table === "reservations") load();
    });
    // Cronómetro en vivo HH:MM:SS (Polaris: tick de 1 s)
    const t = setInterval(() => tick((n) => n + 1), 1000);
    const onScroll = () => setShowScrollTop(window.scrollY > 200);
    window.addEventListener("scroll", onScroll);
    return () => { unsub(); clearInterval(t); window.removeEventListener("scroll", onScroll); };
  }, [load]);

  const rooms = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of board) map.set(c.room_id, c.room_name);
    return [...map.entries()];
  }, [board]);

  const room = activeRoom ?? rooms[0]?.[0] ?? null;
  const roomName = rooms.find(([id]) => id === room)?.[1] ?? "";
  const cells = board.filter((c) => c.room_id === room);

  type CellStatus = "occupied" | "free" | "reserved";
  const statusOf = (c: BoardCell): CellStatus =>
    c.order_id ? "occupied" : c.is_reserved ? "reserved" : "free";

  // Polaris stats: ocupación = ocupadas/total; libres = solo status free
  const occupied = cells.filter((c) => statusOf(c) === "occupied").length;
  const free = cells.filter((c) => statusOf(c) === "free").length;
  const occupancy = cells.length === 0 ? 0 : Math.round((occupied / cells.length) * 100);

  const filtered = filter === "all"
    ? cells
    : cells.filter((c) => statusOf(c) === filter);

  // Polaris setFilter: clic en el filtro activo lo limpia
  const toggleFilter = (f: Filter) => setFilter((cur) => (cur === f ? "all" : f));

  function switchRoom(id: number) {
    if (id === room) return;
    setActiveRoom(id);
    // Polaris: en móvil, cambiar de sala colapsa las tabs
    if (window.innerWidth <= 768) setTabsExpanded(false);
  }

  async function openTable(cell: BoardCell) {
    // Polaris handleTableClick: caja cerrada → toast y no navega
    if (cashOpen === false) {
      toast("error", "¡La caja está cerrada!");
      return;
    }
    if (redirecting.current) return;
    redirecting.current = true;
    try {
      if (cell.order_id) {
        navigate(`/mesas/${cell.order_id}`);
        return;
      }
      // Mesa libre/reservada → Polaris crea la orden de inmediato
      const order = await api<{ id: number }>("/api/orders/occupy", {
        method: "POST",
        body: { tableId: cell.table_id },
      });
      navigate(`/mesas/${order.id}`);
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "No fue posible abrir la mesa");
    } finally {
      redirecting.current = false;
    }
  }

  const emptyState = {
    occupied: {
      icon: <UserRoundX size={56} className="mx-auto opacity-40" />,
      title: "No hay mesas ocupadas",
      desc: "Todas las mesas están disponibles en este momento.",
    },
    free: {
      icon: <Coffee size={56} className="mx-auto opacity-40" />,
      title: "No hay mesas libres",
      desc: "Todas las mesas están ocupadas en este momento.",
    },
    all: {
      icon: <AlertTriangle size={56} className="mx-auto opacity-40" />,
      title: "No hay mesas",
      desc: "No se encontraron mesas en esta sala.",
    },
  }[filter];

  return (
    <div className="fade-in-up">
      <PageHeader title="Mesas" subtitle="Restaurante" />

      {/* ══ Tabs por sala ══ Móvil: header con sala activa + "Ver salas" (Polaris) */}
      <div className="mb-5 border-b border-border-subtle">
        <div className="flex items-center justify-between gap-3 py-2 md:hidden">
          <span className="flex items-center gap-2 text-xl font-bold text-accent-rose">
            <MapPin size={16} /> {roomName}
          </span>
          <button onClick={() => setTabsExpanded((v) => !v)}
            className="glass flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-text-secondary">
            {tabsExpanded ? "Ocultar salas" : "Ver salas"}
            <ChevronDown size={15} className={`transition-transform ${tabsExpanded ? "rotate-180" : ""}`} />
          </button>
        </div>
        <div className={`${tabsExpanded ? "flex" : "hidden"} flex-wrap gap-1 pb-1 md:flex md:gap-4 md:overflow-x-auto`}>
          {rooms.map(([id, name]) => (
            <button key={id} onClick={() => switchRoom(id)}
              className={`-mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-2 py-2 text-sm transition ${
                id === room
                  ? "border-accent-blue font-medium text-accent-blue"
                  : "border-transparent text-text-secondary hover:border-border-medium hover:text-text-primary"
              }`}>
              <LayoutGrid size={15} /> {name}
            </button>
          ))}
        </div>
      </div>

      {/* ══ KPI-filtros clicables (Polaris filters-bar) ══ */}
      <div className="mb-6 flex flex-wrap gap-3">
        <button onClick={() => toggleFilter("occupied")}
          className={`glass flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition sm:px-5 ${
            filter === "occupied" ? "ring-2 ring-accent-emerald/60" : ""
          }`}>
          <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-emerald/15 text-accent-emerald">
            <Users size={18} />
          </span>
          <span>
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Ocupación
            </span>
            <span className="block text-xl font-bold">{occupancy}%</span>
          </span>
        </button>
        <button onClick={() => toggleFilter("free")}
          className={`glass flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition sm:px-5 ${
            filter === "free" ? "ring-2 ring-accent-blue/60" : ""
          }`}>
          <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-blue/15 text-accent-blue">
            <Coffee size={18} />
          </span>
          <span>
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Libres
            </span>
            <span className="block text-xl font-bold">{free}</span>
          </span>
        </button>
        {filter !== "all" && (
          <button onClick={() => setFilter("all")}
            className="flex items-center gap-2 rounded-2xl border border-accent-rose/30 bg-accent-rose/10 px-4 py-3 text-sm font-semibold text-accent-rose transition hover:bg-accent-rose/20">
            <XCircle size={16} /> Borrar
          </button>
        )}
      </div>

      {/* ══ Grid de mesas ══ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(250px,1fr))] sm:gap-5">
        {filtered.map((cell) => {
          const status = statusOf(cell);
          const time = cell.opened_at ? elapsed(cell.opened_at) : null;
          const tone = time ? tableTimeColor(time.minutes) : null;
          const style = tone ? TIME_STYLES[tone] : null;

          return (
            <button key={cell.table_id} onClick={() => openTable(cell)}
              className={`glass relative flex min-h-44 flex-col justify-between rounded-2xl border-2 p-3.5 text-left transition hover:shadow-xl sm:p-5 ${
                status === "occupied" && style ? style.card
                  : status === "reserved" ? "border-accent-orange/50 bg-accent-orange/5"
                  : "border-border-subtle hover:border-accent-emerald/60"
              }`}>

              {/* Burbuja de comentario con tooltip (Polaris has-comment-indicator) */}
              {cell.comment?.trim() && (
                <span className="group absolute -right-1.5 -top-1.5 z-10">
                  <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-bg-primary bg-accent-amber text-white shadow">
                    <MessageSquare size={15} />
                  </span>
                  <span className="pointer-events-none absolute right-0 top-9 z-20 hidden w-52 rounded-lg bg-bg-tertiary p-2 text-xs text-text-primary shadow-xl group-hover:block">
                    {cell.comment}
                  </span>
                </span>
              )}

              <div>
                <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                  <h3 className="text-lg font-bold">Mesa {cell.number}</h3>
                  <span className={`rounded px-2 py-0.5 text-xs font-bold ${
                    status === "occupied" && style ? style.badge
                      : status === "reserved" ? "bg-accent-orange/15 text-accent-orange"
                      : "bg-accent-emerald/15 text-accent-emerald"
                  }`}>
                    {status === "occupied" ? "Ocupada" : status === "reserved" ? "Reservada" : "Libre"}
                  </span>
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-text-secondary">
                  <Users size={12} /> Capacidad: {cell.seats}p
                </p>
              </div>

              {status === "occupied" && time && style ? (
                <div className="mt-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-sm">
                    <span className={`flex items-center gap-1.5 font-bold tabular-nums ${style.text}`}>
                      <Clock size={14} /> {time.label}
                      {time.minutes > 60 && (
                        <AlertTriangle size={15} className="animate-pulse text-accent-rose" />
                      )}
                    </span>
                    <span className="flex max-w-full items-center gap-1.5 truncate text-text-secondary">
                      <ChefHat size={14} className="shrink-0" /> {cell.attended_by ?? "—"}
                    </span>
                  </div>

                  {/* Barra con ancho fijo por estado (Polaris fill-normal/medium/long) */}
                  <div className="h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                    <div className={`h-full rounded-full ${style.bar}`}
                      style={{ width: style.barWidth }} />
                  </div>

                  <div className="mt-3 flex flex-wrap items-end justify-between gap-x-2 border-t border-border-subtle pt-3">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      Cuenta
                    </span>
                    <span className="text-lg font-bold">
                      {cop.format(Number(cell.total))}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="mt-4 grid min-h-20 flex-1 place-items-center rounded-lg border border-dashed border-border-medium bg-bg-secondary/40 text-center transition group-hover:border-accent-emerald">
                  <span>
                    <span className="block text-sm font-bold text-text-muted">
                      {status === "reserved" ? "Reservada" : "Disponible"}
                    </span>
                    <span className="block text-xs text-text-muted">Click para abrir</span>
                  </span>
                </div>
              )}
            </button>
          );
        })}

        {/* Estado vacío según filtro (Polaris empty-state) */}
        {filtered.length === 0 && (
          <div className="col-span-full py-14 text-center text-text-muted">
            {emptyState.icon}
            <h3 className="mt-3 text-lg font-bold text-text-secondary">{emptyState.title}</h3>
            <p className="mt-1 text-sm">{emptyState.desc}</p>
          </div>
        )}
      </div>

      {/* Botón volver arriba — solo móvil (Polaris scroll-to-top) */}
      {showScrollTop && (
        <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Volver arriba"
          className="fixed bottom-24 right-4 z-40 grid h-11 w-11 place-items-center rounded-full bg-accent-blue text-white shadow-lg transition active:scale-95 md:hidden">
          <ArrowUp size={20} />
        </button>
      )}
    </div>
  );
}
