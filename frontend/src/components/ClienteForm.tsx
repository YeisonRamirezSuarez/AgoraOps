/**
 * Formulario de cliente compartido — réplica del form_tb_customers de Polaris.
 * Se usa tanto en el módulo Clientes (página completa) como en el registro de
 * cliente del flujo de Domicilio en Mesas ("Registrar Cliente", idéntico a
 * abrirModalRegistroClienteDomicilio de Polaris). Concentra catálogos, tipos,
 * validación y los campos del formulario para que ambos lugares queden iguales.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, ChevronDown, HelpCircle, XCircle } from "lucide-react";
import { Button, Input, Select, TextArea } from "./ui";

/* ───────────────────────── Tipos y catálogos (códigos Polaris/DIAN) ───────────────────────── */

export interface ClientRow {
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

export interface Geo {
  countries: string[];
  departments: { id: number; name: string }[];
  cities: { id: number; department_id: number; name: string }[];
}

export interface FormState {
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

export const PERSON_TYPES: Record<number, string> = {
  2: "Persona Natural",
  1: "Persona Jurídica",
};

// "Ciudadania" sin tilde, igual que Polaris
export const DOCUMENT_TYPES: Record<string, string> = {
  CC: "Cédula de Ciudadania",
  NIT: "NIT",
};

export const FISCAL_RESPONSIBILITIES: [string, string][] = [
  ["R-99-PN", "No responsable"],
  ["O-47", "Régimen simple de tributación"],
  ["O-23", "Agente de retención IVA"],
  ["O-15", "Autorretenedor"],
  ["O-13", "Gran contribuyente"],
];

export const TAX_REGIMES: [string, string][] = [
  ["49", "No Responsable de IVA"],
  ["48", "Responsable de IVA"],
];

export const fullName = (c: { name: string; last_name?: string | null }) =>
  [c.name, c.last_name].filter(Boolean).join(" ");

/* ───────────────────── Estado inicial / mapeos ───────────────────── */

/** Primera ciudad del departamento (Polaris arranca en el primer dep/ciudad). */
export const firstCityOf = (geo: Geo, dep: number | null) =>
  geo.cities.find((c) => c.department_id === dep)?.id ?? null;

export function emptyForm(geo: Geo): FormState {
  const firstDep = geo.departments[0]?.id ?? null;
  return {
    person_type: 2, document_id: "", document_type: "CC",
    fiscal_responsibility: "R-99-PN", tax_regime: "49",
    name: "", last_name: "", department_id: firstDep,
    city_id: firstCityOf(geo, firstDep), gender: "Masculino", birthday: "",
    verification_code: "", email: "", phone: "", phone2: "", address: "",
    notes: "",
  };
}

export function formFromRow(r: ClientRow): FormState {
  return {
    person_type: r.person_type,
    document_id: r.document_id ?? "",
    document_type: r.document_type,
    fiscal_responsibility: r.fiscal_responsibility,
    tax_regime: r.tax_regime,
    name: r.name ?? "",
    last_name: r.last_name ?? "",
    department_id: r.department_id,
    city_id: r.city_id,
    gender: r.gender,
    birthday: r.birthday ?? "",
    verification_code: r.verification_code ?? "",
    email: r.email ?? "",
    phone: r.phone ?? "",
    phone2: r.phone2 ?? "",
    address: r.address ?? "",
    notes: r.notes ?? "",
  };
}

/** Modal de obligatorios de Polaris (mismo orden); Apellidos NO se valida. */
export function validateClientForm(form: FormState): string[] {
  const missing: string[] = [];
  if (!form.email.trim()) missing.push("Email: Campo obligatorio");
  if (!form.name.trim()) missing.push("Nombre completo: Campo obligatorio");
  if (!form.document_id.trim()) missing.push("Número de documento: Campo obligatorio");
  if (missing.length > 0) return missing;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    return ["Email: Datos inválidos"];
  }
  return [];
}

/* ───────────────────── Modal estilo Polaris (SweetAlert) ───────────────────── */

export type Alert =
  | { kind: "error" | "success"; lines: string[] }
  | { kind: "confirm"; lines: string[]; onAccept: () => void };

export function PolarisAlert({ alert, onClose }: { alert: Alert; onClose: () => void }) {
  const Icon = alert.kind === "error" ? XCircle : alert.kind === "success" ? CheckCircle2 : HelpCircle;
  const iconCls =
    alert.kind === "error" ? "text-accent-rose" :
    alert.kind === "success" ? "text-accent-emerald" : "text-accent-blue";
  return createPortal(
    <div
      className="fixed inset-0 z-[95] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
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

export function SearchCombo({ options, value, onChange }: {
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

/* ───────────────────────── Campos del formulario ───────────────────────── */

/** Fila etiqueta-izquierda / control-derecha, como el formulario Polaris. */
export function Row({ label, required, children }: {
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

// Filtros de caracteres del formulario Polaris (allowedChars)
const docChars = (s: string) => s.replace(/[^a-zA-Z0-9-]/g, "");
const phoneChars = (s: string) => s.replace(/[^0-9+]/g, "");

/**
 * Campos del formulario (sin contenedor): el llamador decide el envoltorio
 * (tarjeta en la página de Clientes, cuerpo de modal en Domicilio).
 */
export function ClienteFormFields({ form, set, geo }: {
  form: FormState;
  set: (patch: Partial<FormState>) => void;
  geo: Geo;
}) {
  const juridica = form.person_type === 1;
  const cityOptions = geo.cities.filter((c) => c.department_id === form.department_id);

  return (
    <div className="space-y-4">
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
          onChange={(id) => set({ department_id: id, city_id: firstCityOf(geo, id) })} />
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
  );
}
