/**
 * Horarios (Malla de Horarios) — réplica de Polaris (Configuración
 * restaurante → Horarios, verificado en QA 2026-06-13) con el tema hpos.
 *  · Calendario con vistas Mes / Semana / Día, navegación ‹ Hoy › y título.
 *  · Celdas con "pills" HH:MM + empleado, coloreadas por cargo.
 *  · Clic en un día (hoy/futuro) → panel lateral "Programación del Día":
 *    Horario Base + Empleado → Guardar Turno; lista de turnos del día con
 *    editar/eliminar. Días pasados: solo lectura.
 *  · "Horarios Base": modal para crear/eliminar turnos (nombre autogenerado
 *    "Turno (HH:MM - HH:MM)"; eliminar arrastra en cascada las asignaciones).
 *  · "Exportar Excel" del rango visible.
 *  · Validaciones con los mensajes exactos de Polaris (duplicado / cruce).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft, ChevronRight, Clock, Download, Pencil, Plus, Settings,
  Trash2, X,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Button, Input, Loader, Modal, Select, useToast } from "./ui";
import { type Alert, PolarisAlert } from "./ClienteForm";

interface Preset { id: number; start_time: string; end_time: string }
interface Employee { id: string; full_name: string; username: string; role: string }
interface Schedule {
  id: number; date: string; template_id: number; user_id: string;
  start_time: string; end_time: string; user_name: string; username: string; role: string;
}

type View = "month" | "week" | "day";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const WEEKDAYS = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const presetLabel = (p: Preset) => `Turno (${p.start_time} - ${p.end_time})`;

// Paleta de colores por cargo (estable según el nombre del cargo)
const ROLE_PALETTE = [
  "bg-accent-blue/15 text-accent-blue border-accent-blue/30",
  "bg-accent-cyan/15 text-accent-cyan border-accent-cyan/30",
  "bg-accent-emerald/15 text-accent-emerald border-accent-emerald/30",
  "bg-accent-orange/15 text-accent-orange border-accent-orange/30",
  "bg-accent-rose/15 text-accent-rose border-accent-rose/30",
  "bg-accent-amber/15 text-accent-amber border-accent-amber/30",
];

export function HorariosCalendar() {
  const toast = useToast();
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const todayStr = ymd(today);

  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState<Date>(today);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [alert, setAlert] = useState<Alert | null>(null);

  /* ── Rango visible según la vista ── */
  const range = useMemo(() => {
    if (view === "day") return { from: ymd(cursor), to: ymd(cursor) };
    if (view === "week") {
      const start = addDays(cursor, -cursor.getDay());
      return { from: ymd(start), to: ymd(addDays(start, 6)) };
    }
    // month: rejilla desde el domingo de la semana del día 1 hasta completar 6 semanas
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = addDays(first, -first.getDay());
    return { from: ymd(gridStart), to: ymd(addDays(gridStart, 41)) };
  }, [view, cursor]);

  const loadCatalogs = useCallback(() => {
    Promise.all([
      api<Preset[]>("/api/schedules/presets"),
      api<Employee[]>("/api/schedules/employees"),
    ]).then(([p, e]) => { setPresets(p); setEmployees(e); }).catch(() => {});
  }, []);

  const loadSchedules = useCallback(() => {
    setLoading(true);
    api<Schedule[]>(`/api/schedules?from=${range.from}&to=${range.to}`)
      .then(setSchedules)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [range.from, range.to]);

  useEffect(loadCatalogs, [loadCatalogs]);
  useEffect(loadSchedules, [loadSchedules]);

  /* ── Color estable por cargo ── */
  const roleColor = useMemo(() => {
    const roles = [...new Set([...employees.map((e) => e.role), ...schedules.map((s) => s.role)])].sort();
    const map = new Map<string, string>();
    roles.forEach((r, i) => map.set(r, ROLE_PALETTE[i % ROLE_PALETTE.length]));
    return (role: string) => map.get(role) ?? ROLE_PALETTE[0];
  }, [employees, schedules]);

  const byDate = useMemo(() => {
    const m = new Map<string, Schedule[]>();
    for (const s of schedules) m.set(s.date, [...(m.get(s.date) ?? []), s]);
    return m;
  }, [schedules]);

  /* ── Título y navegación ── */
  const title = useMemo(() => {
    if (view === "day") return `${cursor.getDate()} de ${MONTHS[cursor.getMonth()]} de ${cursor.getFullYear()}`;
    if (view === "week") {
      const s = addDays(cursor, -cursor.getDay());
      const e = addDays(s, 6);
      return `${s.getDate()} de ${MONTHS[s.getMonth()]} - ${e.getDate()} de ${MONTHS[e.getMonth()]} de ${e.getFullYear()}`;
    }
    return `${MONTHS[cursor.getMonth()]} de ${cursor.getFullYear()}`;
  }, [view, cursor]);

  const navigate = (dir: -1 | 1) => {
    if (view === "day") setCursor((c) => addDays(c, dir));
    else if (view === "week") setCursor((c) => addDays(c, dir * 7));
    else setCursor((c) => new Date(c.getFullYear(), c.getMonth() + dir, 1));
  };

  /* ── Días a renderizar ── */
  const days = useMemo(() => {
    const from = parseYmd(range.from);
    const count = view === "day" ? 1 : view === "week" ? 7 : 42;
    return Array.from({ length: count }, (_, i) => addDays(from, i));
  }, [range.from, view]);

  /* ── Exportar Excel (turnos del rango visible) ── */
  function exportXls() {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const headers = ["Fecha", "Día", "Horario", "Empleado", "Cargo"];
    const rows = [...schedules]
      .sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time))
      .map((s) => {
        const [y, m, d] = s.date.split("-");
        return [`${d}/${m}/${y}`, WEEKDAYS[parseYmd(s.date).getDay()],
          `${s.start_time} - ${s.end_time}`, s.user_name, s.role];
      });
    const html = `<html><head><meta charset="utf-8"></head><body><table border="1">` +
      `<tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>` +
      rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("") +
      `</table></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "application/vnd.ms-excel" }));
    const a = document.createElement("a");
    a.href = url; a.download = "horarios.xls"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fade-in-up">
      {/* ── Cabecera ── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} aria-label="Anterior"
            className="glass grid h-9 w-9 place-items-center rounded-lg text-text-secondary transition hover:text-accent-blue">
            <ChevronLeft size={18} />
          </button>
          <Button variant="ghost" onClick={() => setCursor(today)}>Hoy</Button>
          <button onClick={() => navigate(1)} aria-label="Siguiente"
            className="glass grid h-9 w-9 place-items-center rounded-lg text-text-secondary transition hover:text-accent-blue">
            <ChevronRight size={18} />
          </button>
          <h2 className="ml-1 text-lg font-bold capitalize">{title}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="glass flex overflow-hidden rounded-lg p-0.5">
            {(["month", "week", "day"] as View[]).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                  view === v ? "bg-accent-blue text-white" : "text-text-secondary hover:text-text-primary"
                }`}>
                {v === "month" ? "Mes" : v === "week" ? "Semana" : "Día"}
              </button>
            ))}
          </div>
          <Button variant="ghost" onClick={exportXls}>
            <Download size={15} className="-mt-0.5 mr-1.5 inline" /> Exportar Excel
          </Button>
          <Button variant="ghost" onClick={() => setPresetsOpen(true)}>
            <Settings size={15} className="-mt-0.5 mr-1.5 inline" /> Horarios Base
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* ── Calendario ── */}
        <div className="min-w-0 flex-1">
          {view !== "day" && (
            <div className="mb-1 grid grid-cols-7 gap-1">
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-1 text-center text-[11px] font-bold uppercase tracking-wide text-text-muted">
                  {w}
                </div>
              ))}
            </div>
          )}
          <div className={view === "day" ? "" : "grid grid-cols-7 gap-1"}>
            {days.map((d) => {
              const ds = ymd(d);
              const inMonth = view !== "month" || d.getMonth() === cursor.getMonth();
              const isToday = ds === todayStr;
              const isPast = ds < todayStr;
              const list = byDate.get(ds) ?? [];
              return (
                <button key={ds} onClick={() => setSelectedDate(ds)}
                  className={`glass flex flex-col rounded-xl p-2 text-left align-top transition hover:border-accent-blue/50 ${
                    view === "day" ? "min-h-[60vh]" : view === "week" ? "min-h-44" : "min-h-24"
                  } ${selectedDate === ds ? "border-accent-blue ring-1 ring-accent-blue" : ""} ${
                    inMonth ? "" : "opacity-40"
                  } ${isPast ? "bg-bg-tertiary/30" : ""}`}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs font-bold ${
                      isToday ? "bg-accent-blue text-white" : "text-text-secondary"
                    }`}>
                      {d.getDate()}
                    </span>
                    {list.length > 0 && (
                      <span className="rounded-full bg-bg-tertiary px-1.5 text-[10px] font-bold text-text-muted">
                        {list.length}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 overflow-hidden">
                    {list.map((s) => (
                      <span key={s.id} title={`${s.user_name} (${s.role}): ${s.start_time} - ${s.end_time}`}
                        className={`truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${roleColor(s.role)}`}>
                        <span className="font-bold">{s.start_time}</span> {s.user_name}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
          {loading && <p className="mt-3 text-center text-xs text-text-muted">Cargando…</p>}
        </div>

        {/* ── Panel de programación del día ── */}
        {selectedDate && (
          <DayPanel date={selectedDate} isPast={selectedDate < todayStr}
            presets={presets} employees={employees}
            shifts={(byDate.get(selectedDate) ?? [])}
            roleColor={roleColor}
            onClose={() => setSelectedDate(null)}
            onChanged={loadSchedules} setAlert={setAlert} toast={toast} />
        )}
      </div>

      {/* ── Modal Horarios Base ── */}
      <PresetsModal open={presetsOpen} presets={presets}
        onClose={() => setPresetsOpen(false)}
        onChanged={() => { loadCatalogs(); loadSchedules(); }}
        setAlert={setAlert} toast={toast} />

      {alert && <PolarisAlert alert={alert} onClose={() => setAlert(null)} />}
    </div>
  );
}

/* ───────────────────────── Panel del día ───────────────────────── */
function DayPanel({ date, isPast, presets, employees, shifts, roleColor, onClose, onChanged, setAlert, toast }: {
  date: string; isPast: boolean; presets: Preset[]; employees: Employee[];
  shifts: Schedule[]; roleColor: (r: string) => string;
  onClose: () => void; onChanged: () => void;
  setAlert: (a: Alert) => void; toast: ReturnType<typeof useToast>;
}) {
  const [templateId, setTemplateId] = useState("");
  const [userId, setUserId] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Al cambiar de día, limpiar el formulario
  useEffect(() => { setTemplateId(""); setUserId(""); setEditingId(null); }, [date]);

  const [y, m, d] = date.split("-");
  const subtitle = `${d}/${m}/${y}`;

  async function save() {
    if (!templateId || !userId) {
      toast("error", "Selecciona el horario base y el empleado.");
      return;
    }
    setSaving(true);
    try {
      const body = { userId, templateId: Number(templateId), date };
      if (editingId) await api(`/api/schedules/${editingId}`, { method: "PUT", body });
      else await api("/api/schedules", { method: "POST", body });
      toast("success", editingId ? "Turno actualizado correctamente" : "Turno guardado correctamente");
      setTemplateId(""); setUserId(""); setEditingId(null);
      onChanged();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "No se pudo guardar la asignación laboral";
      // Mensajes multilínea (cruce de horarios) → alerta con líneas
      setAlert({ kind: "error", lines: msg.split("\n") });
    } finally {
      setSaving(false);
    }
  }

  function startEdit(s: Schedule) {
    setEditingId(s.id);
    setTemplateId(String(s.template_id));
    setUserId(s.user_id);
  }

  function removeShift(s: Schedule) {
    setAlert({
      kind: "confirm",
      lines: ["¿Eliminar turno?", `Se quitará la asignación de ${s.user_name} en este horario.`],
      onAccept: async () => {
        try {
          await api(`/api/schedules/${s.id}`, { method: "DELETE" });
          toast("success", "Turno eliminado correctamente");
          if (editingId === s.id) { setEditingId(null); setTemplateId(""); setUserId(""); }
          onChanged();
        } catch (e) {
          toast("error", e instanceof ApiError ? e.message : "No fue posible eliminar el turno");
        }
      },
    });
  }

  return (
    <aside className="glass w-full shrink-0 rounded-2xl p-4 lg:w-80">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="font-bold">Programación del Día</h3>
          <p className="text-sm text-text-secondary">{subtitle}</p>
        </div>
        <button onClick={onClose} aria-label="Cerrar"
          className="rounded-lg p-1.5 text-text-muted transition hover:bg-bg-tertiary hover:text-text-primary">
          <X size={18} />
        </button>
      </div>

      {/* Formulario de asignación (solo hoy/futuro) */}
      {isPast ? (
        <p className="mb-4 rounded-lg bg-bg-tertiary/40 p-3 text-xs text-text-muted">
          Día pasado: solo lectura.
        </p>
      ) : (
        <div className="mb-4 space-y-2 border-b border-border-subtle pb-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted">
            {editingId ? "Editar turno" : "Asignar a este día"}
          </p>
          <Select value={templateId} aria-label="Horario base"
            onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">— Selecciona un horario —</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{presetLabel(p)}</option>
            ))}
          </Select>
          <Select value={userId} aria-label="Empleado"
            onChange={(e) => setUserId(e.target.value)}>
            <option value="">— Selecciona un empleado —</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.full_name} - {emp.role}</option>
            ))}
          </Select>
          <Button className="w-full" onClick={save} disabled={saving || !templateId || !userId}>
            {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Guardar Turno"}
          </Button>
          {editingId && (
            <Button variant="ghost" className="w-full"
              onClick={() => { setEditingId(null); setTemplateId(""); setUserId(""); }}>
              Cancelar edición
            </Button>
          )}
        </div>
      )}

      {/* Turnos del día */}
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-text-muted">
        Turnos en selección
      </p>
      <div className="space-y-2">
        {shifts.map((s) => (
          <div key={s.id} className={`rounded-xl border p-2.5 ${roleColor(s.role)}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">{s.start_time} - {s.end_time}</span>
              {!isPast && (
                <div className="flex gap-1">
                  <button onClick={() => startEdit(s)} aria-label="Editar turno"
                    className="rounded-md p-1 text-text-secondary transition hover:bg-white/40">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => removeShift(s)} aria-label="Eliminar turno"
                    className="rounded-md p-1 text-text-secondary transition hover:bg-white/40">
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
            <div className="mt-0.5 flex items-center justify-between text-xs">
              <span className="font-medium text-text-secondary">{s.user_name}</span>
              <span className="font-bold uppercase tracking-wide opacity-80">{s.role}</span>
            </div>
          </div>
        ))}
        {shifts.length === 0 && (
          <p className="py-3 text-center text-xs text-text-muted">Sin turnos para este día.</p>
        )}
      </div>
    </aside>
  );
}

/* ───────────────────────── Modal Horarios Base ───────────────────────── */
function PresetsModal({ open, presets, onClose, onChanged, setAlert, toast }: {
  open: boolean; presets: Preset[]; onClose: () => void; onChanged: () => void;
  setAlert: (a: Alert) => void; toast: ReturnType<typeof useToast>;
}) {
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("16:00");
  const [saving, setSaving] = useState(false);

  async function add() {
    setSaving(true);
    try {
      await api("/api/schedules/presets", { method: "POST", body: { startTime, endTime } });
      toast("success", "Horario base creado correctamente");
      onChanged();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No fue posible crear el horario base");
    } finally {
      setSaving(false);
    }
  }

  function remove(p: Preset) {
    setAlert({
      kind: "confirm",
      lines: ["¿Eliminar horario base?",
        "Esto removerá permanentemente este turno del catálogo y TODAS las asignaciones vinculadas en el calendario."],
      onAccept: async () => {
        try {
          await api(`/api/schedules/presets/${p.id}`, { method: "DELETE" });
          toast("success", "Horario base eliminado correctamente");
          onChanged();
        } catch (e) {
          toast("error", e instanceof ApiError ? e.message : "No fue posible eliminar el horario base");
        }
      },
    });
  }

  return (
    <Modal open={open} title="Configuración de Horarios Base" onClose={onClose}>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-text-muted">
        Añadir nuevo horario
      </p>
      <div className="mb-2 grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-text-muted">Hora Inicio</span>
          <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </label>
        <span className="pb-2.5 text-text-muted">–</span>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-text-muted">Hora Fin</span>
          <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </label>
      </div>
      {/* Nombre autogenerado (solo lectura, como Polaris) */}
      <p className="mb-3 text-xs text-text-muted">
        Nombre: <span className="font-semibold text-text-secondary">Turno ({startTime} - {endTime})</span>
      </p>
      <Button className="mb-5 w-full" onClick={add} disabled={saving}>
        <Plus size={15} className="-mt-0.5 mr-1.5 inline" /> Guardar horario base
      </Button>

      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-text-muted">
        Horarios disponibles
      </p>
      <div className="max-h-72 space-y-2 overflow-y-auto">
        {presets.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-xl border border-border-subtle p-3">
            <span className="flex items-center gap-2 text-sm">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-blue/15 text-accent-blue">
                <Clock size={15} />
              </span>
              <span>
                <span className="block font-semibold">{presetLabel(p)}</span>
                <span className="text-xs text-text-muted">{p.start_time} - {p.end_time}</span>
              </span>
            </span>
            <button onClick={() => remove(p)} aria-label="Eliminar horario base"
              className="rounded-lg p-1.5 text-text-muted transition hover:bg-accent-rose/15 hover:text-accent-rose">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {presets.length === 0 && (
          <p className="py-4 text-center text-sm text-text-muted">No hay horarios base.</p>
        )}
      </div>
    </Modal>
  );
}
