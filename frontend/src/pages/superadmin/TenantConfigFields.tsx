/**
 * Campos compartidos del formulario de establecimiento (Super Admin):
 * datos del establecimiento, datos del negocio, logo y personalización
 * con paleta de colores previsualizable. Los usa la página de creación
 * y la pestaña Configuración del detalle.
 */
import { useRef } from "react";
import { ImagePlus, Trash2, Check } from "lucide-react";
import { FormRow, Input, Select, useToast } from "../../components/ui";
import { PALETTES, getPalette } from "../../shared/constants/palettes";

export interface TenantConfig {
  name: string;
  slug: string;
  country: "CO" | "EC";
  timezone: string;
  phone: string;
  taxId: string;
  address: string;
  logoUrl: string;
  facebook: string;
  instagram: string;
  themePalette: string;
}

export const EMPTY_CONFIG: TenantConfig = {
  name: "",
  slug: "",
  country: "CO",
  timezone: "America/Bogota",
  phone: "",
  taxId: "",
  address: "",
  logoUrl: "",
  facebook: "",
  instagram: "",
  themePalette: "celeste",
};

const TIMEZONES = [
  "America/Bogota",
  "America/Guayaquil",
];

/** Slug a partir del nombre: sin tildes, minúsculas y guiones. */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 mt-2 border-b border-border-subtle pb-2 text-sm font-bold uppercase tracking-wide text-text-secondary">
      {children}
    </h2>
  );
}

/* ─────────────── Logo (archivo → data URL, máx 2MB) ─────────────── */

function LogoInput({ value, onChange }: {
  value: string;
  onChange: (dataUrl: string) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast("error", "El logo no puede superar 2MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex items-center gap-3">
      {value ? (
        <img src={value} alt="Logo"
          className="h-16 w-16 rounded-xl border border-border-subtle bg-white object-contain p-1" />
      ) : (
        <span className="grid h-16 w-16 place-items-center rounded-xl border border-dashed border-border-medium text-text-muted">
          <ImagePlus size={22} />
        </span>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={() => fileRef.current?.click()}
          className="rounded-lg border border-border-medium px-3 py-2 text-sm font-medium text-text-secondary transition hover:bg-bg-tertiary">
          {value ? "Cambiar logo" : "Subir logo"}
        </button>
        {value && (
          <button type="button" onClick={() => onChange("")}
            aria-label="Quitar logo"
            className="grid h-9 w-9 place-items-center rounded-lg border border-accent-rose/40 text-accent-rose transition hover:bg-accent-rose/10">
            <Trash2 size={16} />
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])} />
    </div>
  );
}

/* ─────────────── Paleta de colores con previsualización ─────────────── */

export function PalettePicker({ value, onChange }: {
  value: string;
  onChange: (key: string) => void;
}) {
  const selected = getPalette(value);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PALETTES.map((p) => (
          <button key={p.key} type="button" onClick={() => onChange(p.key)}
            className={`overflow-hidden rounded-xl border-2 text-left transition ${
              value === p.key
                ? "border-accent-blue shadow-[0_0_14px_var(--accent-glow)]"
                : "border-border-subtle hover:border-border-medium"
            }`}>
            <span className="block h-10"
              style={{
                background: `linear-gradient(90deg, ${p.sidebar[0]}, ${p.sidebar[1]}, ${p.sidebar[2]}, ${p.sidebar[3]})`,
              }} />
            <span className="flex items-center justify-between px-2.5 py-2 text-xs font-semibold">
              {p.label}
              {value === p.key && <Check size={14} className="text-accent-blue" />}
            </span>
          </button>
        ))}
      </div>

      {/* Previsualización en vivo de la app con la paleta elegida */}
      <div className="glass overflow-hidden rounded-xl">
        <p className="border-b border-border-subtle px-3 py-2 text-xs font-semibold text-text-muted">
          Previsualización
        </p>
        <div className="flex h-44">
          <div className="flex w-20 flex-col gap-2 p-2"
            style={{
              background: `linear-gradient(180deg, ${selected.sidebar[0]}, ${selected.sidebar[1]} 40%, ${selected.sidebar[2]} 75%, ${selected.sidebar[3]})`,
            }}>
            <span className="mx-auto mt-1 h-6 w-6 rounded-full bg-white/90" />
            {[3, 2, 3].map((w, i) => (
              <span key={i} className="h-2 rounded bg-white/60"
                style={{ width: `${w * 16}px` }} />
            ))}
          </div>
          <div className="flex-1 space-y-2 bg-bg-primary p-3">
            <span className="block h-2.5 w-24 rounded bg-text-primary/70" />
            <span className="block h-2 w-32 rounded bg-text-muted/50" />
            <span className="mt-2 inline-block rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
              style={{ background: selected.accent }}>
              Botón principal
            </span>
            <p className="text-sm font-bold" style={{ color: selected.cyan }}>
              $ 25.000
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Secciones de campos ─────────────── */

export function TenantFields({ value, onChange, slugLocked = false }: {
  value: TenantConfig;
  onChange: (next: TenantConfig) => void;
  /** En edición el slug es la identidad del tenant y no se cambia. */
  slugLocked?: boolean;
}) {
  const set = (patch: Partial<TenantConfig>) => onChange({ ...value, ...patch });

  return (
    <>
      <SectionTitle>Datos del establecimiento</SectionTitle>
      <div className="space-y-3">
        <FormRow label="Nombre" required>
          <Input value={value.name} required
            onChange={(e) => set(
              slugLocked
                ? { name: e.target.value }
                : { name: e.target.value, slug: slugify(e.target.value) },
            )} />
        </FormRow>
        <FormRow label="Slug (identificador)" required>
          <Input value={value.slug} disabled={slugLocked}
            onChange={(e) => set({ slug: slugify(e.target.value) })}
            placeholder="mi-restaurante" />
        </FormRow>
        <FormRow label="País" required>
          <Select value={value.country}
            onChange={(e) => {
              const country = e.target.value as "CO" | "EC";
              set({
                country,
                timezone: country === "EC" ? "America/Guayaquil" : "America/Bogota",
              });
            }}>
            <option value="CO">Colombia</option>
            <option value="EC">Ecuador</option>
          </Select>
        </FormRow>
        <FormRow label="Zona horaria">
          <Select value={value.timezone}
            onChange={(e) => set({ timezone: e.target.value })}>
            {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </Select>
        </FormRow>
      </div>

      <SectionTitle>Datos del negocio</SectionTitle>
      <div className="space-y-3">
        <FormRow label="Teléfono">
          <Input value={value.phone} onChange={(e) => set({ phone: e.target.value })} />
        </FormRow>
        <FormRow label={value.country === "EC" ? "RUC" : "NIT"}>
          <Input value={value.taxId} onChange={(e) => set({ taxId: e.target.value })} />
        </FormRow>
        <FormRow label="Dirección">
          <Input value={value.address} onChange={(e) => set({ address: e.target.value })} />
        </FormRow>
        <FormRow label="Facebook">
          <Input value={value.facebook} onChange={(e) => set({ facebook: e.target.value })} />
        </FormRow>
        <FormRow label="Instagram">
          <Input value={value.instagram} onChange={(e) => set({ instagram: e.target.value })} />
        </FormRow>
        <FormRow label="Logo">
          <LogoInput value={value.logoUrl} onChange={(logoUrl) => set({ logoUrl })} />
        </FormRow>
      </div>

      <SectionTitle>Personalización de colores</SectionTitle>
      <PalettePicker value={value.themePalette}
        onChange={(themePalette) => set({ themePalette })} />
    </>
  );
}
