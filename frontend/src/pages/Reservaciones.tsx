/**
 * Reservaciones — réplica del módulo de Polaris (grid/form_tb_reservations,
 * verificado en QA 2026-06-12) con tema AgoraOps:
 *  - Grilla agrupada por cliente (alfabético, colapsable), reservas por
 *    fecha descendente; búsqueda rápida SOLO por nombre de cliente;
 *    paginación 10/20/50 con [x a y de z].
 *  - Estado como celda de color sólido: Reservado #028303, Confirmado
 *    #CE1300, Cancelado #A4A2A2 (texto blanco en negrita).
 *  - Crear/Editar en vistas aparte con "Volver". Cancelado solo aparece
 *    al editar. Validaciones con modal y auto-corrección como Polaris:
 *    fecha pasada → "Reservas aceptadas a partir de hoy solamente" (resetea
 *    a hoy); hora pasada de hoy → mismo mensaje (resetea a la hora actual,
 *    regla corregida sin el bug AM/PM de Polaris); horas/personas fuera de
 *    1-12 → modal y ajuste al límite. Duplicado cliente+fecha+hora →
 *    "Este cliente ya reservó en esta fecha y hora."
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft, CalendarPlus, CheckCircle2, ChevronDown, ChevronUp,
  HelpCircle, Plus, Save, Search, SquarePen, Trash2, XCircle,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Button, Input, PageHeader, usePagination } from "../components/ui";

/* ───────────────────────── Tipos y constantes ───────────────────────── */

interface Reservation {
  id: number;
  stage_id: number;
  client_id: number | null;
  number_hours: number;
  people: number;
  reservation_date: string; // YYYY-MM-DD
  reservation_time: string; // HH:MM:SS
  client_name: string | null;
  client_phone: string | null;
}

interface Client { id: number; name: string; phone: string | null }

/** Etapas Polaris: 1 Reservado, 2 Confirmado, 3 Cancelado. */
const STAGES: Record<number, { label: string; bg: string }> = {
  1: { label: "Reservado", bg: "#028303" },
  2: { label: "Confirmado", bg: "#CE1300" },
  3: { label: "Cancelado", bg: "#A4A2A2" },
};

const MSG_PAST = "Reservas aceptadas a partir de hoy solamente";
const MSG_HOURS = "Mínimo 1 hora, máximo 12 horas";
const MSG_PEOPLE = "Mínimo 1 persona, máximo 12 personas por mesa";

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Hora actual redondeada hacia arriba a múltiplo de 5 minutos (HH:MM). */
function nowRounded(): string {
  const d = new Date(Date.now() + 4 * 60000); // que no quede ya vencida
  const m = Math.ceil(d.getMinutes() / 5) * 5;
  d.setMinutes(m >= 60 ? 0 : m);
  if (m >= 60) d.setHours(d.getHours() + 1);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const fmtDate = (iso: string) => iso.split("-").reverse().join("/");

/* ───────────────────── Modales estilo Polaris (SweetAlert) ───────────────────── */

type Alert =
  | { kind: "error" | "success"; lines: string[] }
  | { kind: "confirm"; lines: string[]; onAccept: () => void };

function PolarisAlert({ alert, onClose }: { alert: Alert; onClose: () => void }) {
  const Icon = alert.kind === "error" ? XCircle : alert.kind === "success" ? CheckCircle2 : HelpCircle;
  const iconCls =
    alert.kind === "error" ? "text-accent-rose" :
    alert.kind === "success" ? "text-accent-emerald" : "text-accent-blue";
  // Portal a <body>: el contenedor de página (fade-in-up) tiene transform y
  // atraparía el overlay `fixed`; desde body opaca toda la página, sidebar
  // incluido. Clic fuera del modal lo cierra (en confirmación = Cancelar).
  return createPortal(
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="glass fade-in-up w-full max-w-sm rounded-2xl p-6 text-center shadow-2xl">
        <Icon size={64} strokeWidth={1.2} className={`mx-auto mb-4 ${iconCls}`} />
        {alert.lines.map((l, i) => (
          <p key={i} className="text-sm leading-6">{l}</p>
        ))}
        <div className="mt-5 flex justify-center gap-2">
          {alert.kind === "confirm" ? (
            <>
              <Button onClick={() => { const fn = alert.onAccept; onClose(); fn(); }}>
                Aceptar
              </Button>
              <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            </>
          ) : (
            <Button onClick={onClose}>Aceptar</Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ───────────────── Spinner 1-12 (jQuery UI spinner de Polaris) ───────────────── */

function Spinner({ value, onChange, onOutOfRange }: {
  value: number;
  onChange: (n: number) => void;
  onOutOfRange: () => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = (raw: string) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 12) {
      const clamped = !Number.isInteger(n) || n < 1 ? 1 : 12;
      onOutOfRange();
      onChange(clamped);
      setText(String(clamped));
    } else {
      onChange(n);
    }
  };

  return (
    <div className="relative">
      <Input inputMode="numeric" value={text} className="!pr-9"
        onChange={(e) => setText(e.target.value.replace(/[^\d-]/g, ""))}
        onBlur={(e) => commit(e.target.value)} />
      <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 flex-col">
        <button type="button" tabIndex={-1} aria-label="Aumentar"
          className="rounded p-0.5 text-text-muted hover:text-text-primary"
          onClick={() => commit(String(Number(text || 0) + 1))}>
          <ChevronUp size={13} />
        </button>
        <button type="button" tabIndex={-1} aria-label="Disminuir"
          className="rounded p-0.5 text-text-muted hover:text-text-primary"
          onClick={() => commit(String(Number(text || 0) - 1))}>
          <ChevronDown size={13} />
        </button>
      </div>
    </div>
  );
}

/* ─────────── Timepicker de grilla (réplica del de Polaris) ───────────
   Panel "Hora" 00-23 en filas AM/PM y "Minutos" en pasos de 5. */

function TimeGridPicker({ value, onPick }: {
  value: string; // HH:MM
  onPick: (hhmm: string, done: boolean) => void;
}) {
  const [h, m] = value ? value.split(":") : ["", ""];
  const cell = (txt: string, selected: boolean, onClick: () => void) => (
    <button key={txt} type="button" onClick={onClick}
      className={`h-7 w-8 rounded text-xs transition ${
        selected ? "bg-accent-blue font-semibold text-white"
          : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
      }`}>
      {txt}
    </button>
  );
  const hourRow = (from: number) =>
    Array.from({ length: 6 }, (_, i) => String(from + i).padStart(2, "0"))
      .map((hh) => cell(hh, hh === h, () => onPick(`${hh}:${m || "00"}`, false)));

  return (
    <div className="glass absolute left-0 top-full z-30 mt-1 flex gap-3 rounded-xl p-3 shadow-2xl">
      <div>
        <p className="mb-1 text-center text-xs font-semibold">Hora</p>
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
          <span className="text-[10px] font-semibold text-text-muted">AM</span>
          <div className="flex gap-0.5">{hourRow(0)}</div>
          <span />
          <div className="flex gap-0.5">{hourRow(6)}</div>
          <span className="text-[10px] font-semibold text-text-muted">PM</span>
          <div className="flex gap-0.5">{hourRow(12)}</div>
          <span />
          <div className="flex gap-0.5">{hourRow(18)}</div>
        </div>
      </div>
      <div>
        <p className="mb-1 text-center text-xs font-semibold">Minutos</p>
        <div className="grid grid-cols-3 gap-0.5">
          {Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"))
            .map((mm) => cell(mm, mm === m, () => onPick(`${h || "00"}:${mm}`, true)))}
        </div>
      </div>
    </div>
  );
}

/* ───────────────── Combo de cliente con búsqueda (select2) ───────────────── */

function ClientCombo({ clients, value, onChange }: {
  clients: Client[];
  value: number | null;
  onChange: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) =>
      ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const label = (c: Client) => `${c.name} - ${c.phone ?? ""}`.replace(/ - $/, " -");
  const selected = clients.find((c) => c.id === value);
  const visible = clients.filter((c) =>
    label(c).toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-border-subtle bg-bg-tertiary px-3 py-2.5 text-left text-sm transition focus:border-accent-blue">
        <span className={selected ? "" : "text-text-muted"}>
          {selected ? label(selected) : "Seleccione una opción"}
        </span>
        <ChevronDown size={15} className="text-text-muted" />
      </button>
      {open && (
        <div className="glass absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl shadow-2xl">
          <div className="p-2">
            <Input autoFocus placeholder="Buscar…" value={q}
              onChange={(e) => setQ(e.target.value)} className="!py-1.5" />
          </div>
          <ul className="max-h-52 overflow-y-auto pb-1">
            {visible.map((c) => (
              <li key={c.id}>
                <button type="button"
                  onClick={() => { onChange(c.id); setOpen(false); setQ(""); }}
                  className={`w-full px-3 py-2 text-left text-sm transition hover:bg-bg-tertiary ${
                    c.id === value ? "bg-accent-blue/15 text-accent-blue" : ""
                  }`}>
                  {label(c)}
                </button>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="px-3 py-2 text-sm text-text-muted">Sin resultados</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Formulario crear/editar ───────────────────────── */

interface FormState {
  stage_id: number;
  reservation_date: string; // YYYY-MM-DD
  reservation_time: string; // HH:MM
  number_hours: number;
  client_id: number | null;
  people: number;
}

function ReservaForm({ editing, clients, onDone, onBack }: {
  editing: Reservation | null;
  clients: Client[];
  onDone: () => void;
  onBack: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => editing ? {
    stage_id: editing.stage_id,
    reservation_date: editing.reservation_date,
    reservation_time: editing.reservation_time.slice(0, 5),
    number_hours: editing.number_hours,
    client_id: editing.client_id,
    people: editing.people,
  } : {
    stage_id: 1, reservation_date: "", reservation_time: "",
    number_hours: 1, client_id: null, people: 1,
  });
  const [alert, setAlert] = useState<Alert | null>(null);
  const [timeOpen, setTimeOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const timeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) =>
      timeRef.current && !timeRef.current.contains(e.target as Node) && setTimeOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  /** Polaris: fecha pasada → modal y reset a hoy. */
  const checkDate = (date: string) => {
    if (date && date < todayISO()) {
      setAlert({ kind: "error", lines: [MSG_PAST] });
      set({ reservation_date: todayISO() });
    } else {
      set({ reservation_date: date });
    }
  };

  /** Regla corregida: hoy + hora ya pasada → modal y reset a la hora actual. */
  const checkTime = (time: string) => {
    if (time && form.reservation_date === todayISO() && time < nowHHMM()) {
      setAlert({ kind: "error", lines: [MSG_PAST] });
      set({ reservation_time: nowRounded() });
    } else {
      set({ reservation_time: time });
    }
  };

  const submit = async () => {
    // Réplica del modal de obligatorios de Polaris
    const missing: string[] = [];
    if (!form.reservation_date) missing.push("Fecha de reserva: Campo obligatorio");
    if (!form.reservation_time) missing.push("Hora de inicio: Campo obligatorio");
    if (!form.client_id) missing.push("Cliente: Campo obligatorio");
    if (missing.length > 0) {
      setAlert({ kind: "error", lines: missing });
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api(`/api/reservations/${editing.id}`, { method: "PUT", body: form });
      } else {
        await api("/api/reservations", { method: "POST", body: form });
      }
      onDone();
    } catch (err) {
      // Duplicado limpia la hora, como Polaris
      if (err instanceof ApiError && err.status === 409) set({ reservation_time: "" });
      setAlert({
        kind: "error",
        lines: [(err as Error).message || "Error en el servidor"],
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = () => setAlert({
    kind: "confirm",
    lines: ["¿Realmente desea eliminar el registro?"],
    onAccept: async () => {
      try {
        await api(`/api/reservations/${editing!.id}`, { method: "DELETE" });
        onDone();
      } catch (err) {
        setAlert({ kind: "error", lines: [(err as Error).message] });
      }
    },
  });

  // Cancelado (3) solo al editar, como Polaris
  const stages = editing ? [3, 2, 1] : [2, 1];

  return (
    <div className="fade-in-up">
      <PageHeader title={editing ? "Editar reserva" : "Agregar reserva"} subtitle="Restaurante" />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button onClick={submit} disabled={saving}>
                <span className="flex items-center gap-1.5"><Save size={15} /> Guardar</span>
              </Button>
              <Button variant="danger" onClick={remove}>
                <span className="flex items-center gap-1.5"><Trash2 size={15} /> Borrar</span>
              </Button>
            </>
          ) : (
            <Button onClick={submit} disabled={saving}>
              <span className="flex items-center gap-1.5"><Plus size={15} /> Añadir reserva</span>
            </Button>
          )}
        </div>
        <Button variant="ghost" onClick={onBack}>
          <span className="flex items-center gap-1.5"><ArrowLeft size={15} /> Volver</span>
        </Button>
      </div>

      <div className="glass mx-auto max-w-xl space-y-5 rounded-2xl p-6">
        <div>
          <p className="mb-1.5 text-sm font-semibold">Estado de la reserva</p>
          {stages.map((id) => (
            <label key={id} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
              <input type="radio" name="stage" className="accent-accent-blue"
                checked={form.stage_id === id} onChange={() => set({ stage_id: id })} />
              {STAGES[id].label}
            </label>
          ))}
        </div>

        {/* Al editar solo se cambia estado/horas/cliente/personas;
            fecha y hora quedan bloqueadas (grises, como Polaris) */}
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">
            Fecha de reserva<span className="text-accent-rose">*</span>
          </span>
          <Input type="date" value={form.reservation_date} disabled={!!editing}
            className={editing ? "cursor-not-allowed opacity-60" : ""}
            onChange={(e) => checkDate(e.target.value)} />
        </label>

        <div ref={timeRef} className="relative">
          <span className="mb-1.5 block text-sm font-semibold">
            Hora de inicio<span className="text-accent-rose">*</span>
          </span>
          <Input placeholder="hh:mm" value={form.reservation_time} readOnly
            disabled={!!editing}
            className={editing ? "cursor-not-allowed opacity-60" : ""}
            onFocus={() => !editing && setTimeOpen(true)}
            onClick={() => !editing && setTimeOpen(true)} />
          {timeOpen && !editing && (
            <TimeGridPicker value={form.reservation_time}
              onPick={(t, done) => { checkTime(t); if (done) setTimeOpen(false); }} />
          )}
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-semibold">Horas</span>
          <Spinner value={form.number_hours}
            onChange={(n) => set({ number_hours: n })}
            onOutOfRange={() => setAlert({ kind: "error", lines: [MSG_HOURS] })} />
          <p className="mt-1 text-xs text-text-muted">*Máximo 12 horas</p>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">
            Cliente<span className="text-accent-rose">*</span>
          </span>
          <ClientCombo clients={clients} value={form.client_id}
            onChange={(id) => set({ client_id: id })} />
        </label>

        <div>
          <span className="mb-1.5 block text-sm font-semibold">Personas</span>
          <Spinner value={form.people}
            onChange={(n) => set({ people: n })}
            onOutOfRange={() => setAlert({ kind: "error", lines: [MSG_PEOPLE] })} />
          <p className="mt-1 text-xs text-text-muted">*Máximo 12 personas por mesa</p>
        </div>
      </div>

      {alert && <PolarisAlert alert={alert} onClose={() => setAlert(null)} />}
    </div>
  );
}

/* ───────────────────────── Grilla agrupada por cliente ───────────────────────── */

// Todas las columnas siempre visibles; en pantallas angostas el contenedor
// (overflow-x-auto + min-w) genera scroll horizontal en vez de ocultarlas
const GRID_COLS =
  "grid grid-cols-[44px_1fr_1fr_64px_84px_1fr_140px] items-center";

export function ReservacionesPage() {
  const [rows, setRows] = useState<Reservation[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<{ mode: "grid" } | { mode: "form"; editing: Reservation | null }>(
    { mode: "grid" },
  );

  const load = () => {
    api<Reservation[]>("/api/reservations").then(setRows).catch(() => {});
  };
  useEffect(() => {
    load();
    api<Client[]>("/api/catalogs/clients").then(setClients).catch(() => {});
  }, []);

  // Búsqueda Rápida de Polaris: filtra SOLO por nombre de cliente
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.client_name ?? "").toLowerCase().includes(q));
  }, [rows, search]);

  const { slice, bar, resetPage } = usePagination(filtered);

  // Agrupar la página actual por cliente (el API ya ordena alfabético + fecha desc)
  const groups = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    for (const r of slice) {
      const key = r.client_name ?? "(Sin cliente)";
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.entries()];
  }, [slice]);

  if (view.mode === "form") {
    return (
      <ReservaForm editing={view.editing} clients={clients}
        onDone={() => { setView({ mode: "grid" }); load(); }}
        onBack={() => setView({ mode: "grid" })} />
    );
  }

  return (
    <div className="fade-in-up">
      <PageHeader title="Reservaciones" subtitle="Restaurante" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-xs flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input placeholder="Búsqueda Rápida" value={search} className="!pl-9"
            onChange={(e) => { setSearch(e.target.value); resetPage(); }} />
        </div>
        <Button onClick={() => setView({ mode: "form", editing: null })}>
          <span className="flex items-center gap-1.5"><CalendarPlus size={15} /> Nueva reserva</span>
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="glass grid place-items-center rounded-2xl py-14 text-text-muted">
          <p className="text-sm">No hay registros para mostrar</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(([client, list]) => (
            <div key={client} className="glass overflow-hidden rounded-2xl">
              <button type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [client]: !c[client] }))}
                className="flex w-full items-center gap-2 bg-[hsl(222_25%_15%)] px-4 py-2.5 text-left text-sm font-semibold text-white">
                <ChevronDown size={15}
                  className={`transition-transform ${collapsed[client] ? "-rotate-90" : ""}`} />
                Cliente : {client}
              </button>
              {!collapsed[client] && (
                <div className="overflow-x-auto">
                  <div className="min-w-[640px]">
                    <div className={`${GRID_COLS} border-b border-border-subtle bg-accent-amber/15 px-2 py-2 text-center text-xs font-semibold`}>
                      <span />
                      <span>Fecha de reserva</span>
                      <span>Hora de inicio</span>
                      <span>Horas</span>
                      <span>Personas</span>
                      <span>Teléfono</span>
                      <span>Estado de la reserva</span>
                    </div>
                    {list.map((r) => (
                      <div key={r.id}
                        className={`${GRID_COLS} border-b border-border-subtle/60 px-2 text-center text-sm last:border-0`}>
                        <button type="button" title="Editar este registro"
                          onClick={() => setView({ mode: "form", editing: r })}
                          className="mx-auto rounded-lg p-1.5 text-text-muted transition hover:bg-bg-tertiary hover:text-accent-blue">
                          <SquarePen size={15} />
                        </button>
                        <span className="py-2.5">{fmtDate(r.reservation_date)}</span>
                        <span className="py-2.5">{r.reservation_time}</span>
                        <span className="py-2.5">{r.number_hours}</span>
                        <span className="py-2.5">{r.people}</span>
                        <span className="py-2.5">{r.client_phone}</span>
                        <span className="grid h-full place-items-center self-stretch py-2.5 text-xs font-bold text-white"
                          style={{ backgroundColor: STAGES[r.stage_id]?.bg }}>
                          {STAGES[r.stage_id]?.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {bar}
    </div>
  );
}
