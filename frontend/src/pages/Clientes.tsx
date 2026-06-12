/**
 * Clientes — réplica del módulo de Polaris (grid/form_tb_customers +
 * Historial, verificado en QA 2026-06-12) con tema AgoraOps:
 *  - Grilla: Nombre completo, Tipo de documento, Número de documento,
 *    Teléfono, Tipo de persona, Correo; editar por fila; búsqueda rápida
 *    SOLO por nombre completo, número de documento, tipo de persona y
 *    correo (Polaris NO busca por teléfono ni tipo de documento);
 *    paginación 10/20/50 con [x a y de z]; "Exportar" (XLS) se oculta
 *    cuando no hay registros.
 *  - Formulario: Persona Natural (apellidos, género, fecha de
 *    nacimiento) vs Persona Jurídica (responsable IVA, código de
 *    verificación); selects dependientes País → Departamento → Ciudad;
 *    documento solo alfanumérico y guión (máx 20), teléfonos solo
 *    dígitos y + (máx 12), dirección máx 30, email máx 50.
 *  - Validaciones con modal, mensajes y orden de Polaris: "Email: Campo
 *    obligatorio", "Nombre completo: Campo obligatorio", "Número de
 *    documento: Campo obligatorio", "Email: Datos inválidos", "El
 *    número de documento ya existe." Apellidos lleva * pero Polaris no
 *    lo valida (replicado).
 *  - Eliminar (solo al editar): "¿Desea eliminar todos los datos
 *    relacionados con el cliente?"; bloqueado si tiene ventas/reservas.
 *  - Historial: Fecha, Usuario, Cliente, Acción (Creación =
 *    registro completo, Actualización = solo campos cambiados,
 *    Eliminación = sin detalle), con valores legibles.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft, CheckCircle2, ChevronDown, Download, FileSpreadsheet,
  HelpCircle, History, Pencil, Plus, Save, Search, Trash2, XCircle,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import {
  Button, Input, PageHeader, Select, Table, TextArea, usePagination,
} from "../components/ui";

/* ───────────────────────── Tipos y catálogos (códigos Polaris/DIAN) ───────────────────────── */

interface ClientRow {
  id: number;
  person_type: number; // 2 Natural / 1 Jurídica (códigos Polaris)
  document_id: string;
  document_type: string; // CC / NIT
  fiscal_responsibility: string;
  tax_regime: string; // 49 No responsable IVA / 48 Responsable (DIAN)
  name: string;
  last_name: string | null;
  country: string;
  department_id: number | null;
  city_id: number | null;
  gender: string;
  birthday: string | null; // YYYY-MM-DD
  verification_code: string | null;
  email: string;
  phone: string | null;
  phone2: string | null;
  address: string | null;
  notes: string | null;
  department_name: string | null;
  city_name: string | null;
}

interface Geo {
  countries: string[];
  departments: { id: number; name: string }[];
  cities: { id: number; department_id: number; name: string }[];
}

interface AuditRow {
  id: number;
  created_at: string; // DD/MM/YYYY HH:MM:SS
  user_name: string;
  client_name: string;
  action: "create" | "update" | "delete";
  detail: { label: string; value: string }[] | null;
}

const PERSON_TYPES: Record<number, string> = {
  2: "Persona Natural",
  1: "Persona Jurídica",
};

// "Ciudadania" sin tilde, igual que Polaris
const DOCUMENT_TYPES: Record<string, string> = {
  CC: "Cédula de Ciudadania",
  NIT: "NIT",
};

const FISCAL_RESPONSIBILITIES: [string, string][] = [
  ["R-99-PN", "No responsable"],
  ["O-47", "Régimen simple de tributación"],
  ["O-23", "Agente de retención IVA"],
  ["O-15", "Autorretenedor"],
  ["O-13", "Gran contribuyente"],
];

const TAX_REGIMES: [string, string][] = [
  ["49", "No Responsable de IVA"],
  ["48", "Responsable de IVA"],
];

const ACTIONS: Record<AuditRow["action"], string> = {
  create: "Creación",
  update: "Actualización",
  delete: "Eliminación",
};

const fullName = (c: { name: string; last_name?: string | null }) =>
  [c.name, c.last_name].filter(Boolean).join(" ");

/* ───────────────────── Modal estilo Polaris (SweetAlert) ───────────────────── */

type Alert =
  | { kind: "error" | "success"; lines: string[] }
  | { kind: "confirm"; lines: string[]; onAccept: () => void };

function PolarisAlert({ alert, onClose }: { alert: Alert; onClose: () => void }) {
  const Icon = alert.kind === "error" ? XCircle : alert.kind === "success" ? CheckCircle2 : HelpCircle;
  const iconCls =
    alert.kind === "error" ? "text-accent-rose" :
    alert.kind === "success" ? "text-accent-emerald" : "text-accent-blue";
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

/* ───────────────── Combo con búsqueda (select2 de Polaris) ───────────────── */

function SearchCombo({ options, value, onChange }: {
  options: { id: number; name: string }[];
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

  const selected = options.find((o) => o.id === value);
  const visible = options.filter((o) =>
    o.name.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-border-subtle bg-bg-tertiary px-3 py-2.5 text-left text-sm transition focus:border-accent-blue">
        <span className={selected ? "" : "text-text-muted"}>
          {selected ? selected.name : "Seleccione una opción"}
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
            {visible.map((o) => (
              <li key={o.id}>
                <button type="button"
                  onClick={() => { onChange(o.id); setOpen(false); setQ(""); }}
                  className={`w-full px-3 py-2 text-left text-sm transition hover:bg-bg-tertiary ${
                    o.id === value ? "bg-accent-blue/15 text-accent-blue" : ""
                  }`}>
                  {o.name}
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

/* ───────────────────────── Formulario Agregar/Editar ───────────────────────── */

interface FormState {
  person_type: number;
  document_id: string;
  document_type: string;
  fiscal_responsibility: string;
  tax_regime: string;
  name: string;
  last_name: string;
  department_id: number | null;
  city_id: number | null;
  gender: string;
  birthday: string;
  verification_code: string;
  email: string;
  phone: string;
  phone2: string;
  address: string;
  notes: string;
}

/** Fila etiqueta-izquierda / control-derecha, como el formulario Polaris. */
function Row({ label, required, children }: {
  label: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[220px_1fr]">
      <span className="text-sm font-semibold">
        {label}{required && <span className="text-accent-rose"> *</span>}
      </span>
      {children}
    </div>
  );
}

function ClienteForm({ editing, geo, onDone, onBack }: {
  editing: ClientRow | null;
  geo: Geo;
  onDone: () => void;
  onBack: () => void;
}) {
  // Polaris inicia en el primer departamento (AMAZONAS) y su primera ciudad
  const firstDep = geo.departments[0]?.id ?? null;
  const firstCity = (dep: number | null) =>
    geo.cities.find((c) => c.department_id === dep)?.id ?? null;

  const [form, setForm] = useState<FormState>(() => editing ? {
    person_type: editing.person_type,
    document_id: editing.document_id ?? "",
    document_type: editing.document_type,
    fiscal_responsibility: editing.fiscal_responsibility,
    tax_regime: editing.tax_regime,
    name: editing.name ?? "",
    last_name: editing.last_name ?? "",
    department_id: editing.department_id,
    city_id: editing.city_id,
    gender: editing.gender,
    birthday: editing.birthday ?? "",
    verification_code: editing.verification_code ?? "",
    email: editing.email ?? "",
    phone: editing.phone ?? "",
    phone2: editing.phone2 ?? "",
    address: editing.address ?? "",
    notes: editing.notes ?? "",
  } : {
    person_type: 2, document_id: "", document_type: "CC",
    fiscal_responsibility: "R-99-PN", tax_regime: "49",
    name: "", last_name: "", department_id: firstDep,
    city_id: firstCity(firstDep), gender: "Masculino", birthday: "",
    verification_code: "", email: "", phone: "", phone2: "", address: "",
    notes: "",
  });
  const [alert, setAlert] = useState<Alert | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const juridica = form.person_type === 1;

  const cityOptions = geo.cities.filter((c) => c.department_id === form.department_id);

  const submit = async () => {
    // Modal de obligatorios de Polaris (mismo orden); Apellidos no se valida
    const missing: string[] = [];
    if (!form.email.trim()) missing.push("Email: Campo obligatorio");
    if (!form.name.trim()) missing.push("Nombre completo: Campo obligatorio");
    if (!form.document_id.trim()) missing.push("Número de documento: Campo obligatorio");
    if (missing.length > 0) {
      setAlert({ kind: "error", lines: missing });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setAlert({ kind: "error", lines: ["Email: Datos inválidos"] });
      return;
    }
    setSaving(true);
    try {
      const body = { ...form, birthday: form.birthday || null };
      if (editing) {
        await api(`/api/clients/${editing.id}`, { method: "PUT", body });
      } else {
        await api("/api/clients", { method: "POST", body });
      }
      onDone();
    } catch (err) {
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
    lines: ["¿Desea eliminar todos los datos relacionados con el cliente?"],
    onAccept: async () => {
      try {
        await api(`/api/clients/${editing!.id}`, { method: "DELETE" });
        onDone();
      } catch (err) {
        // 409: cliente con ventas/reservas asociadas
        setAlert({ kind: "error", lines: [(err as Error).message] });
      }
    },
  });

  // Filtros de caracteres del formulario Polaris (allowedChars)
  const docChars = (s: string) => s.replace(/[^a-zA-Z0-9-]/g, "");
  const phoneChars = (s: string) => s.replace(/[^0-9+]/g, "");

  return (
    <div className="fade-in-up">
      <PageHeader title={editing ? "Editar cliente" : "Agregar cliente"} subtitle="Restaurante" />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button onClick={submit} disabled={saving}>
          <span className="flex items-center gap-1.5">
            {editing ? <Save size={15} /> : <Plus size={15} />}
            {editing ? "Guardar" : "Agregar"}
          </span>
        </Button>
        {editing && (
          <Button variant="danger" onClick={remove}>
            <span className="flex items-center gap-1.5"><Trash2 size={15} /> Eliminar</span>
          </Button>
        )}
        <Button variant="ghost" onClick={onBack}>
          <span className="flex items-center gap-1.5">
            <ArrowLeft size={15} /> {editing ? "Volver" : "Cancelar"}
          </span>
        </Button>
      </div>

      <div className="glass mx-auto max-w-2xl space-y-4 rounded-2xl p-6">
        <Row label="Tipo de persona">
          <Select value={form.person_type}
            onChange={(e) => {
              const pt = Number(e.target.value);
              // Jurídica oculta apellidos/género/nacimiento; Natural oculta IVA/verificación
              set(pt === 1
                ? { person_type: pt, last_name: "", birthday: "", gender: "Masculino" }
                : { person_type: pt, tax_regime: "49", verification_code: "" });
            }}>
            <option value={2}>Persona Natural</option>
            <option value={1}>Persona Jurídica</option>
          </Select>
        </Row>

        <Row label="Número de documento" required>
          <Input value={form.document_id} maxLength={20}
            onChange={(e) => set({ document_id: docChars(e.target.value) })} />
        </Row>

        <Row label="Tipo de documento" required>
          <Select value={form.document_type}
            onChange={(e) => set({ document_type: e.target.value })}>
            {Object.entries(DOCUMENT_TYPES).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </Row>

        <Row label="Responsable fiscal">
          <Select value={form.fiscal_responsibility}
            onChange={(e) => set({ fiscal_responsibility: e.target.value })}>
            {FISCAL_RESPONSIBILITIES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </Row>

        {juridica && (
          <Row label="Responsable IVA">
            <Select value={form.tax_regime}
              onChange={(e) => set({ tax_regime: e.target.value })}>
              {TAX_REGIMES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Row>
        )}

        <Row label="Nombre" required>
          <Input value={form.name} maxLength={100}
            onChange={(e) => set({ name: e.target.value })} />
        </Row>

        {!juridica && (
          <Row label="Apellidos" required>
            <Input value={form.last_name} maxLength={255}
              onChange={(e) => set({ last_name: e.target.value })} />
          </Row>
        )}

        <Row label="País" required>
          <Select value="COLOMBIA" onChange={() => {}}>
            <option value="COLOMBIA">COLOMBIA</option>
          </Select>
        </Row>

        <Row label="Departamento" required>
          <SearchCombo options={geo.departments} value={form.department_id}
            onChange={(id) => set({ department_id: id, city_id: firstCity(id) })} />
        </Row>

        <Row label="Ciudad" required>
          <SearchCombo options={cityOptions} value={form.city_id}
            onChange={(id) => set({ city_id: id })} />
        </Row>

        {!juridica && (
          <>
            <Row label="Género">
              <div className="flex gap-5">
                {["Masculino", "Femenino"].map((g) => (
                  <label key={g} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" name="gender" className="accent-accent-blue"
                      checked={form.gender === g} onChange={() => set({ gender: g })} />
                    {g}
                  </label>
                ))}
              </div>
            </Row>

            <Row label="Fecha de nacimiento">
              <Input type="date" value={form.birthday}
                onChange={(e) => set({ birthday: e.target.value })} />
            </Row>
          </>
        )}

        {juridica && (
          <Row label="Código de verificación">
            <Input value={form.verification_code} maxLength={255}
              onChange={(e) => set({ verification_code: e.target.value })} />
          </Row>
        )}

        <Row label="Email" required>
          <Input value={form.email} maxLength={50}
            onChange={(e) => set({ email: e.target.value })} />
        </Row>

        <Row label="Teléfono 1">
          <Input value={form.phone} maxLength={12} inputMode="tel"
            onChange={(e) => set({ phone: phoneChars(e.target.value) })} />
        </Row>

        <Row label="Teléfono 2">
          <Input value={form.phone2} maxLength={12} inputMode="tel"
            onChange={(e) => set({ phone2: phoneChars(e.target.value) })} />
        </Row>

        <Row label="Dirección">
          <Input value={form.address} maxLength={30}
            onChange={(e) => set({ address: e.target.value })} />
        </Row>

        <Row label="Notas">
          <TextArea rows={2} value={form.notes}
            onChange={(e) => set({ notes: e.target.value })} />
        </Row>

        <p className="text-xs text-text-muted">* Campos obligatorios</p>
      </div>

      {alert && <PolarisAlert alert={alert} onClose={() => setAlert(null)} />}
    </div>
  );
}

/* ───────────────────────── Historial ───────────────────────── */

function HistorialView({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<AuditRow[]>([]);

  useEffect(() => {
    api<AuditRow[]>("/api/clients/audit").then(setRows).catch(() => {});
  }, []);

  const { slice, bar } = usePagination(rows);

  return (
    <div className="fade-in-up">
      <PageHeader title="Historial de clientes" subtitle="Restaurante" />

      <div className="mb-5">
        <Button variant="ghost" onClick={onBack}>
          <span className="flex items-center gap-1.5"><ArrowLeft size={15} /> Volver</span>
        </Button>
      </div>

      <Table headers={["Fecha", "Usuario", "Cliente", "Acción", "Descripción"]}
        empty={rows.length === 0}>
        {slice.map((r) => (
          <tr key={r.id} className="align-top transition hover:bg-bg-tertiary">
            <td className="whitespace-nowrap px-4 py-3">{r.created_at}</td>
            <td className="px-4 py-3">{r.user_name}</td>
            <td className="px-4 py-3">{r.client_name}</td>
            <td className="px-4 py-3">{ACTIONS[r.action]}</td>
            <td className="px-4 py-3">
              {r.detail && (
                <dl className="grid gap-x-4 gap-y-0.5 sm:grid-cols-[auto_1fr]">
                  {r.detail.map((d) => (
                    <div key={d.label} className="sm:contents">
                      <dt className="text-[11px] font-bold uppercase tracking-wide text-text-muted">
                        {d.label}
                      </dt>
                      <dd className="text-xs">{d.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {bar}
    </div>
  );
}

/* ───────────────────────── Grilla principal ───────────────────────── */

export function ClientesPage() {
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [geo, setGeo] = useState<Geo>({ countries: [], departments: [], cities: [] });
  const [search, setSearch] = useState("");
  const [exportAlert, setExportAlert] = useState(false);
  const [view, setView] = useState<
    { mode: "grid" } | { mode: "form"; editing: ClientRow | null } | { mode: "historial" }
  >({ mode: "grid" });

  const load = () => {
    api<ClientRow[]>("/api/clients").then(setRows).catch(() => {});
  };
  useEffect(() => {
    load();
    api<Geo>("/api/clients/geo").then(setGeo).catch(() => {});
  }, []);

  // Búsqueda Rápida de Polaris: nombre completo, número de documento,
  // tipo de persona y correo (NO teléfono, NO tipo de documento)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      fullName(r).toLowerCase().includes(q) ||
      (r.document_id ?? "").toLowerCase().includes(q) ||
      PERSON_TYPES[r.person_type].toLowerCase().includes(q) ||
      (r.email ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const { slice, bar, resetPage } = usePagination(filtered);

  /** Exportar XLS: tabla HTML compatible con Excel (columnas de la grilla). */
  const exportXls = () => {
    const esc = (s: string | null | undefined) =>
      String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const headers = ["Nombre completo", "Tipo de documento", "Número de documento",
      "Teléfono", "Tipo de persona", "Correo"];
    const body = filtered.map((r) => [
      fullName(r), DOCUMENT_TYPES[r.document_type] ?? "", r.document_id,
      r.phone ?? "", PERSON_TYPES[r.person_type], r.email,
    ]);
    const html =
      `<html><head><meta charset="utf-8"></head><body><table border="1">` +
      `<tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>` +
      body.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("") +
      `</table></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "application/vnd.ms-excel" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "clientes.xls";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (view.mode === "form") {
    return (
      <ClienteForm editing={view.editing} geo={geo}
        onDone={() => { setView({ mode: "grid" }); load(); }}
        onBack={() => setView({ mode: "grid" })} />
    );
  }
  if (view.mode === "historial") {
    return <HistorialView onBack={() => setView({ mode: "grid" })} />;
  }

  return (
    <div className="fade-in-up">
      <PageHeader title="Clientes" subtitle="Restaurante" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-xs flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input placeholder="Búsqueda Rápida" value={search} className="!pl-9"
            onChange={(e) => { setSearch(e.target.value); resetPage(); }} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setView({ mode: "form", editing: null })}>
            <span className="flex items-center gap-1.5"><Plus size={15} /> Nuevo</span>
          </Button>
          {/* Polaris oculta Exportar cuando no hay registros */}
          {filtered.length > 0 && (
            <Button variant="ghost" onClick={() => setExportAlert(true)}>
              <span className="flex items-center gap-1.5">
                <FileSpreadsheet size={15} /> Exportar
              </span>
            </Button>
          )}
          <Button variant="ghost" onClick={() => setView({ mode: "historial" })}>
            <span className="flex items-center gap-1.5"><History size={15} /> Historial</span>
          </Button>
        </div>
      </div>

      <Table
        headers={["", "Nombre completo", "Tipo de documento", "Número de documento",
          "Teléfono", "Tipo de persona", "Correo"]}
        empty={filtered.length === 0}>
        {slice.map((r) => (
          <tr key={r.id} className="transition hover:bg-bg-tertiary">
            <td className="px-4 py-2.5">
              <button type="button" title="Editar este registro"
                onClick={() => setView({ mode: "form", editing: r })}
                className="rounded-lg p-1.5 text-text-muted transition hover:bg-bg-tertiary hover:text-accent-blue">
                <Pencil size={15} />
              </button>
            </td>
            <td className="px-4 py-2.5">{fullName(r)}</td>
            <td className="px-4 py-2.5">{DOCUMENT_TYPES[r.document_type] ?? ""}</td>
            <td className="px-4 py-2.5">{r.document_id}</td>
            <td className="px-4 py-2.5">{r.phone ?? ""}</td>
            <td className="px-4 py-2.5">{PERSON_TYPES[r.person_type]}</td>
            <td className="px-4 py-2.5">{r.email}</td>
          </tr>
        ))}
      </Table>
      {bar}

      {/* Réplica del flujo Exportar de Polaris: generar → Descargar */}
      {exportAlert && createPortal(
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          onMouseDown={(e) => e.target === e.currentTarget && setExportAlert(false)}>
          <div className="glass fade-in-up w-full max-w-sm rounded-2xl p-6 text-center shadow-2xl">
            <FileSpreadsheet size={64} strokeWidth={1.2} className="mx-auto mb-4 text-accent-emerald" />
            <p className="text-sm leading-6">Archivo generado con éxito</p>
            <div className="mt-5 flex justify-center gap-2">
              <Button onClick={() => { exportXls(); setExportAlert(false); }}>
                <span className="flex items-center gap-1.5"><Download size={15} /> Descargar</span>
              </Button>
              <Button variant="ghost" onClick={() => setExportAlert(false)}>Volver</Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
