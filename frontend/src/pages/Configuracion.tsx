/**
 * Configuración Restaurante — manual §1.7, con los submódulos del menú
 * de Polaris Food: salas, mesas, etapas de reserva (solo visual),
 * horarios, objetivos, prioridad del menú, métodos de pago (estado +
 * bancos), denominación de moneda, bancos y catálogo de impuestos.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronUp,
  Target, XCircle,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { CrudPage } from "../components/CrudPage";
import { SalaGrid } from "../components/SalaGrid";
import { MesasGrid } from "../components/MesasGrid";
import { HorariosCalendar } from "../components/HorariosCalendar";
import { EnConstruccion } from "../components/EnConstruccion";
import { useTabParam } from "../lib/useTab";
import {
  Badge, Button, FormRow, Input, Loader, Modal, MoneyInput, PageHeader,
  Table, useToast,
} from "../components/ui";

const TABS = [
  "Sala del restaurante", "Mesas del restaurante", "Etapas de reserva",
  "Horarios", "Objetivos", "Prioridad del menú", "Métodos de pago",
  "Denominación de moneda", "Bancos para transferencia", "Catálogo de impuestos",
];

export default function Configuracion() {
  const [tab, setTab] = useTabParam(TABS);

  return (
    <div className="fade-in-up">
      <PageHeader title={tab} subtitle="Configuración restaurante" />

      {tab === "Sala del restaurante" && <SalaGrid />}

      {tab === "Mesas del restaurante" && <MesasGrid />}

      {/* §1.7.3: catálogo únicamente visual, no permite acciones */}
      {tab === "Etapas de reserva" && (
        <div className="max-w-md">
          <p className="mb-3 text-sm text-text-muted">
            Etapas por las que puede pasar una reserva. Este submódulo es únicamente visual.
          </p>
          <Table headers={["Etapa"]} empty={false}>
            {["Reservado", "Confirmado", "Cancelado"].map((e) => (
              <tr key={e}>
                <td className="px-4 py-2.5">
                  <Badge color={e === "Reservado" ? "amber" : e === "Confirmado" ? "emerald" : "rose"}>
                    {e}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {tab === "Horarios" && <HorariosCalendar />}
      {tab === "Objetivos" && <ObjetivosTab />}
      {tab === "Prioridad del menú" && <PrioridadMenuTab />}

      {tab === "Métodos de pago" && <PaymentMethodsTab />}

      {tab === "Denominación de moneda" && (
        <CrudPage title="denominación" endpoint="/api/catalogs/denominations"
          fields={[
            { name: "value", label: "Valor", type: "money", required: true },
            { name: "is_active", label: "Estado", type: "checkbox" },
          ]} />
      )}

      {tab === "Bancos para transferencia" && (
        <CrudPage title="banco" endpoint="/api/catalogs/banks"
          fields={[
            { name: "name", label: "Nombre", required: true },
            { name: "is_active", label: "Estado", type: "checkbox" },
          ]} />
      )}

      {tab === "Catálogo de impuestos" && (
        <EnConstruccion titulo="Catálogo de impuestos"
          nota="Submódulo nuevo (no documentado en el manual v18) — pendiente de definición de requisitos." />
      )}
    </div>
  );
}

/* ───────── Objetivos (§1.7.5) — réplica de Polaris form_tb_objetive ─────────
   Registro único por establecimiento con las metas y fechas diaria, semanal
   y mensual. El Dashboard usa estas fechas como rango de facturado. Las
   validaciones replican Polaris (mensajes corregidos):
     · los 8 campos son obligatorios;
     · la fecha del día no puede ser menor a la fecha actual;
     · la fecha fin de semana/mes no puede ser menor a su fecha inicio. */
interface ObjForm {
  daily_date: string; daily_goal: string;
  week_start: string; week_end: string; weekly_goal: string;
  month_start: string; month_end: string; monthly_goal: string;
}

const OBJ_EMPTY: ObjForm = {
  daily_date: "", daily_goal: "",
  week_start: "", week_end: "", weekly_goal: "",
  month_start: "", month_end: "", monthly_goal: "",
};

const OBJ_LABELS: Record<keyof ObjForm, string> = {
  daily_date: "Fecha del día",
  daily_goal: "Objetivo del día",
  week_start: "Fecha inicio de semana",
  week_end: "Fecha fin de semana",
  weekly_goal: "Objetivo de la semana",
  month_start: "Fecha inicio de mes",
  month_end: "Fecha fin de mes",
  monthly_goal: "Objetivo del mes",
};

function ObjSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass overflow-hidden rounded-2xl">
      <div className="flex items-center gap-2 border-b border-border-subtle bg-bg-tertiary px-4 py-3">
        <Target size={16} className="text-accent-blue" />
        <h3 className="text-sm font-bold text-accent-blue">{title}</h3>
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </div>
  );
}

function ObjetivosTab() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ObjForm>(OBJ_EMPTY);
  const [errors, setErrors] = useState<string[]>([]);
  const set = (patch: Partial<ObjForm>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    api<{
      daily_goal: number; daily_date: string | null; weekly_goal: number;
      week_start: string | null; week_end: string | null;
      monthly_goal: number; month_start: string | null; month_end: string | null;
    }>("/api/settings/objectives")
      .then((o) => setForm({
        daily_date: o.daily_date ?? "",
        daily_goal: o.daily_goal ? String(o.daily_goal) : "",
        week_start: o.week_start ?? "",
        week_end: o.week_end ?? "",
        weekly_goal: o.weekly_goal ? String(o.weekly_goal) : "",
        month_start: o.month_start ?? "",
        month_end: o.month_end ?? "",
        monthly_goal: o.monthly_goal ? String(o.monthly_goal) : "",
      }))
      .catch((e) => toast("error", e instanceof ApiError ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }, [toast]);

  function validate(): string[] {
    const errs: string[] = [];
    const missing = (Object.keys(OBJ_LABELS) as (keyof ObjForm)[])
      .filter((k) => form[k] === "" || form[k] == null);
    if (missing.length) {
      errs.push("Los valores deben ser diligenciados correctamente.");
      for (const k of missing) errs.push(`${OBJ_LABELS[k]}: campo obligatorio.`);
    }
    const todayISO = new Date().toLocaleDateString("en-CA"); // yyyy-mm-dd local
    if (form.daily_date && form.daily_date < todayISO) {
      errs.push("La fecha del día no puede ser menor a la fecha actual.");
    }
    if (form.week_start && form.week_end && form.week_end < form.week_start) {
      errs.push("La fecha fin de semana no puede ser menor a la fecha inicio.");
    }
    if (form.month_start && form.month_end && form.month_end < form.month_start) {
      errs.push("La fecha fin de mes no puede ser menor a la fecha inicio.");
    }
    return errs;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (errs.length) { setErrors(errs); return; }
    setSaving(true);
    try {
      await api("/api/settings/objectives", {
        method: "PUT",
        body: {
          daily_date: form.daily_date,
          daily_goal: Number(form.daily_goal),
          week_start: form.week_start,
          week_end: form.week_end,
          weekly_goal: Number(form.weekly_goal),
          month_start: form.month_start,
          month_end: form.month_end,
          monthly_goal: Number(form.monthly_goal),
        },
      });
      toast("success", "Objetivos guardados correctamente.");
    } catch (err) {
      const payload = err instanceof ApiError ? (err.payload as { errors?: string[] }) : null;
      if (payload && Array.isArray(payload.errors)) {
        setErrors(payload.errors);
      } else {
        toast("error", err instanceof ApiError ? err.message : "Error al guardar");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loader label="Cargando objetivos" />;

  return (
    <form onSubmit={save} className="max-w-3xl space-y-5">
      <ObjSection title="Objetivo diario">
        <FormRow label="Fecha del día" required>
          <Input type="date" value={form.daily_date}
            onChange={(e) => set({ daily_date: e.target.value })} />
        </FormRow>
        <FormRow label="Objetivo del día" required>
          <MoneyInput value={form.daily_goal}
            onValueChange={(v) => set({ daily_goal: v })} />
        </FormRow>
      </ObjSection>

      <ObjSection title="Objetivo semanal">
        <FormRow label="Fecha inicio de semana" required>
          <Input type="date" value={form.week_start}
            onChange={(e) => set({ week_start: e.target.value })} />
        </FormRow>
        <FormRow label="Fecha fin de semana" required>
          <Input type="date" value={form.week_end}
            onChange={(e) => set({ week_end: e.target.value })} />
        </FormRow>
        <FormRow label="Objetivo de la semana" required>
          <MoneyInput value={form.weekly_goal}
            onValueChange={(v) => set({ weekly_goal: v })} />
        </FormRow>
      </ObjSection>

      <ObjSection title="Objetivo mensual">
        <FormRow label="Fecha inicio de mes" required>
          <Input type="date" value={form.month_start}
            onChange={(e) => set({ month_start: e.target.value })} />
        </FormRow>
        <FormRow label="Fecha fin de mes" required>
          <Input type="date" value={form.month_end}
            onChange={(e) => set({ month_end: e.target.value })} />
        </FormRow>
        <FormRow label="Objetivo del mes" required>
          <MoneyInput value={form.monthly_goal}
            onValueChange={(v) => set({ monthly_goal: v })} />
        </FormRow>
      </ObjSection>

      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">
          <span className="text-accent-rose">*</span> Campos obligatorios
        </p>
        <Button type="submit" disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>

      {/* Diálogo de validación (réplica del de Polaris, mensajes corregidos) */}
      <Modal open={errors.length > 0} title="Revise los datos"
        onClose={() => setErrors([])}>
        <div className="mb-5 flex flex-col items-center text-center">
          <XCircle size={48} className="mb-3 text-accent-rose" />
          <div className="space-y-1 text-sm text-text-secondary">
            {errors.map((msg, i) => <p key={i}>{msg}</p>)}
          </div>
        </div>
        <div className="flex justify-center">
          <Button onClick={() => setErrors([])}>Aceptar</Button>
        </div>
      </Modal>
    </form>
  );
}

/* ───────── Prioridad del menú (§1.7.6) ─────────
   Flujo Polaris: (1) tabla de días con checkboxes → "Seleccionar";
   (2) doble lista Disponibles ↔ Favoritas con flechas → "Guardar".
   Si un día tiene categorías favoritas, el menú de ese día solo muestra
   esas categorías; si no tiene ninguna, muestra todas. */
const WEEKDAYS = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" }, // 0 = domingo (Date.getDay)
];

interface Categoria { id: number; name: string }

function PrioridadMenuTab() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Categoria[]>([]);
  // Mapa día (0-6) → category_ids favoritas en orden
  const [priority, setPriority] = useState<Record<number, number[]>>({});

  const [step, setStep] = useState<"days" | "categories">("days");
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [favoritas, setFavoritas] = useState<number[]>([]); // category_ids, en orden
  const [availSel, setAvailSel] = useState<number | null>(null);
  const [favSel, setFavSel] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      api<Categoria[]>("/api/catalogs/categories"),
      api<Record<number, number[]>>("/api/settings/menu-priority"),
    ])
      .then(([cats, prio]) => { setCategories(cats); setPriority(prio); })
      .catch((e) => toast("error", e instanceof ApiError ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }, [toast]);
  useEffect(load, [load]);

  const catName = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);

  function toggleDay(day: number) {
    setSelectedDays((d) => d.includes(day) ? d.filter((x) => x !== day) : [...d, day]);
  }
  function toggleAll() {
    setSelectedDays((d) => d.length === WEEKDAYS.length ? [] : WEEKDAYS.map((w) => w.value));
  }

  function goToCategories() {
    if (selectedDays.length === 0) {
      toast("error", "Seleccione al menos un día de la semana.");
      return;
    }
    // Prefill: favoritas comunes a TODOS los días seleccionados (intersección),
    // conservando el orden del primer día que las tenga. Con un solo día =
    // sus favoritas; con varios días distintos = vacío (asignación nueva).
    const ordered = selectedDays
      .map((d) => priority[d] ?? [])
      .find((arr) => arr.length > 0) ?? [];
    const common = ordered.filter((catId) =>
      selectedDays.every((d) => (priority[d] ?? []).includes(catId)));
    setFavoritas(common);
    setAvailSel(null);
    setFavSel(null);
    setStep("categories");
  }

  // Disponibles = categorías que no están en favoritas, en orden alfabético del catálogo
  const disponibles = useMemo(
    () => categories.filter((c) => !favoritas.includes(c.id)),
    [categories, favoritas],
  );

  function moveToFav(ids: number[]) {
    setFavoritas((f) => [...f, ...ids.filter((id) => !f.includes(id))]);
    setAvailSel(null);
  }
  function moveToAvail(ids: number[]) {
    setFavoritas((f) => f.filter((id) => !ids.includes(id)));
    setFavSel(null);
  }
  function move(delta: -1 | 1) {
    if (favSel == null) return;
    setFavoritas((f) => {
      const i = f.indexOf(favSel);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= f.length) return f;
      const next = [...f];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      await api("/api/settings/menu-priority", {
        method: "PUT",
        body: { weekdays: selectedDays, categoryIds: favoritas },
      });
      // Refleja el cambio en el mapa local sin recargar
      setPriority((p) => {
        const next = { ...p };
        for (const d of selectedDays) {
          if (favoritas.length) next[d] = favoritas; else delete next[d];
        }
        return next;
      });
      toast("success", "Prioridad del menú guardada correctamente");
      setStep("days");
      setSelectedDays([]);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loader label="Cargando prioridad del menú" />;

  if (step === "categories") {
    const daysLabel = WEEKDAYS.filter((w) => selectedDays.includes(w.value))
      .map((w) => w.label).join(" ");
    return (
      <div className="fade-in-up max-w-4xl">
        <div className="glass mb-4 rounded-xl px-4 py-3 text-sm font-medium text-text-secondary">
          {daysLabel}
        </div>
        <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
          <DualList title="Categorías disponibles" items={disponibles}
            selected={availSel} onSelect={setAvailSel}
            onDouble={(id) => moveToFav([id])} />

          <div className="flex flex-row justify-center gap-2 md:flex-col">
            <ArrowBtn label="Subir" onClick={() => move(-1)} disabled={favSel == null}>
              <ChevronUp size={18} />
            </ArrowBtn>
            <ArrowBtn label="Mover todas a favoritas"
              onClick={() => moveToFav(disponibles.map((c) => c.id))}
              disabled={disponibles.length === 0}>
              <ChevronsRight size={18} />
            </ArrowBtn>
            <ArrowBtn label="Mover a favoritas" onClick={() => availSel != null && moveToFav([availSel])}
              disabled={availSel == null}>
              <ChevronRight size={18} />
            </ArrowBtn>
            <ArrowBtn label="Quitar de favoritas" onClick={() => favSel != null && moveToAvail([favSel])}
              disabled={favSel == null}>
              <ChevronLeft size={18} />
            </ArrowBtn>
            <ArrowBtn label="Quitar todas"
              onClick={() => moveToAvail(favoritas)} disabled={favoritas.length === 0}>
              <ChevronsLeft size={18} />
            </ArrowBtn>
            <ArrowBtn label="Bajar" onClick={() => move(1)} disabled={favSel == null}>
              <ChevronDown size={18} />
            </ArrowBtn>
          </div>

          <DualList title="Categorías favoritas" items={favoritas.map((id) => ({ id, name: catName.get(id) ?? String(id) }))}
            selected={favSel} onSelect={setFavSel}
            onDouble={(id) => moveToAvail([id])} ordered />
        </div>

        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
          <Button variant="ghost" onClick={() => setStep("days")}>← Volver</Button>
        </div>
      </div>
    );
  }

  // Paso 1: tabla de días con checkboxes
  const allChecked = selectedDays.length === WEEKDAYS.length;
  return (
    <div className="fade-in-up max-w-3xl">
      <div className="mb-4 flex justify-center">
        <Button onClick={goToCategories}>Seleccionar</Button>
      </div>
      <div className="glass overflow-hidden rounded-2xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-medium bg-bg-tertiary/60 text-left text-xs uppercase tracking-wide text-text-secondary">
              <th className="w-12 px-4 py-3">
                <input type="checkbox" checked={allChecked} onChange={toggleAll}
                  aria-label="Seleccionar todos"
                  className="h-4 w-4 accent-[var(--color-accent-blue)]" />
              </th>
              <th className="px-4 py-3 font-medium">Día de la semana</th>
              <th className="px-4 py-3 font-medium">Categorías favoritas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle/60">
            {WEEKDAYS.map((w) => {
              const favs = priority[w.value] ?? [];
              return (
                <tr key={w.value} className="transition hover:bg-bg-tertiary/40">
                  <td className="px-4 py-2.5">
                    <input type="checkbox" checked={selectedDays.includes(w.value)}
                      onChange={() => toggleDay(w.value)} aria-label={w.label}
                      className="h-4 w-4 accent-[var(--color-accent-blue)]" />
                  </td>
                  <td className="px-4 py-2.5 font-medium">{w.label}</td>
                  <td className="px-4 py-2.5">
                    {favs.length === 0 ? (
                      <span className="text-text-muted">Todas las categorías</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {favs.map((id) => (
                          <Badge key={id} color="blue">{catName.get(id) ?? id}</Badge>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Una de las dos columnas del selector de categorías. */
function DualList({ title, items, selected, onSelect, onDouble, ordered }: {
  title: string;
  items: Categoria[];
  selected: number | null;
  onSelect: (id: number) => void;
  onDouble: (id: number) => void;
  ordered?: boolean;
}) {
  return (
    <div className="glass overflow-hidden rounded-xl">
      <div className="bg-bg-tertiary/60 px-4 py-2.5 text-sm font-semibold text-text-secondary">
        {title}
      </div>
      <ul className="h-72 overflow-y-auto p-1">
        {items.map((c) => (
          <li key={c.id}>
            <button
              onClick={() => onSelect(c.id)}
              onDoubleClick={() => onDouble(c.id)}
              className={`w-full truncate rounded-lg px-3 py-1.5 text-left text-sm transition ${
                selected === c.id
                  ? "bg-accent-blue/25 font-medium text-accent-blue"
                  : "hover:bg-bg-tertiary text-text-primary"
              }`}>
              {c.name}
            </button>
          </li>
        ))}
        {items.length === 0 && (
          <li className="px-3 py-4 text-center text-xs text-text-muted">
            {ordered ? "Sin categorías favoritas" : "Sin categorías"}
          </li>
        )}
      </ul>
    </div>
  );
}

function ArrowBtn({ label, onClick, disabled, children }: {
  label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="grid h-9 w-9 place-items-center rounded-lg border border-border-subtle text-text-secondary transition hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-40">
      {children}
    </button>
  );
}

/* ───────── Métodos de pago (§1.7.7): solo estado + bancos ───────── */
function PaymentMethodsTab() {
  const toast = useToast();
  const [methods, setMethods] = useState<{
    id: number; name: string; is_active: boolean; is_legacy: boolean; bank_ids: number[];
  }[]>([]);
  const [banks, setBanks] = useState<{ id: number; name: string }[]>([]);

  const load = useCallback(() => {
    api<typeof methods>("/api/settings/payment-methods").then(setMethods).catch(() => {});
    api<typeof banks>("/api/catalogs/banks").then(setBanks).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function save(m: (typeof methods)[number], changes: Partial<(typeof methods)[number]>) {
    try {
      await api(`/api/settings/payment-methods/${m.id}`, {
        method: "PUT",
        body: {
          is_active: changes.is_active ?? m.is_active,
          bank_ids: changes.bank_ids ?? m.bank_ids,
        },
      });
      toast("success", "Método de pago actualizado correctamente");
      load();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Error al actualizar");
    }
  }

  return (
    <div className="max-w-2xl space-y-3">
      {methods.map((m) => (
        <div key={m.id} className="glass rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{m.name}</p>
              {m.is_legacy && <Badge color="gray">Fase 4 (no documentado en el manual)</Badge>}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={m.is_active}
                onChange={(e) => save(m, { is_active: e.target.checked })}
                className="h-4 w-4 accent-[var(--color-accent-blue)]" />
              {m.is_active ? "Activo" : "Inactivo"}
            </label>
          </div>
          {m.name === "TRANSFERENCIA" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {banks.map((b) => {
                const assoc = m.bank_ids.includes(b.id);
                return (
                  <button key={b.id}
                    onClick={() => save(m, {
                      bank_ids: assoc
                        ? m.bank_ids.filter((x) => x !== b.id)
                        : [...m.bank_ids, b.id],
                    })}
                    className={`rounded-full px-3 py-1 text-xs transition ${
                      assoc ? "bg-accent-blue/25 font-medium text-accent-blue"
                        : "bg-bg-tertiary text-text-secondary hover:text-text-primary"
                    }`}>
                    {b.name}
                  </button>
                );
              })}
              {banks.length === 0 && (
                <p className="text-xs text-text-muted">
                  Cree bancos en la pestaña "Bancos para transferencia".
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
