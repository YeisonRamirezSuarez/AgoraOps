/**
 * Gestión de domicilios — réplica del "Centro de control unificado" de
 * Polaris (blank_gestion_domicilio, verificado en QA 2026-06-12) con
 * tema AgoraOps:
 *  - Dos paneles: Empresas aliadas (izquierda) y Personal (derecha) con
 *    un único buscador que filtra ambos. Una empresa también aparece si
 *    alguno de sus domiciliarios coincide. Clic en la tarjeta de empresa
 *    filtra su personal ("Personal: X"); otro clic deselecciona.
 *  - Empresas: modal Nueva/Editar (nombre obligatorio y en MAYÚSCULAS,
 *    teléfono solo dígitos, dirección, estado). Guardar en edición pide
 *    "¿Guardar cambios?". Eliminar pide confirmación y el servidor
 *    rechaza si tiene domiciliarios. Duplicados permitidos (Polaris).
 *  - Personal: vista Tarjeta/Tabla. Modal con empresa autocompletada
 *    por nombre (solo empresas ACTIVAS al crear; al editar incluye
 *    inactivas). Todos los campos obligatorios: "Completa todos los
 *    campos para continuar." (error inline en el modal, como Polaris).
 *  - Botón según estado: ACTIVO con pedidos → "Desactivar", sin pedidos
 *    → "Eliminar" (el servidor decide: con historial se desactiva);
 *    INACTIVO → "Activar". Toasts con los mensajes del servidor.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Building2, HelpCircle, LayoutGrid, Phone, Plus, Search, Table2, Users,
} from "lucide-react";
import { api } from "../lib/api";
import { Button, Input, PageHeader, Select, useToast } from "../components/ui";

/* ───────────────────────── Tipos (forma Polaris) ───────────────────────── */

interface Company {
  id: number;
  name: string;
  contact: string;
  address: string;
  status: "ACTIVO" | "INACTIVO";
}

interface Driver {
  id: number;
  first_name: string;
  last_name: string;
  name: string;
  phone: string;
  plate: string;
  status: "ACTIVO" | "INACTIVO";
  company_id: number;
  company_name: string;
  availability: string;
  initials: string;
  has_history: boolean;
}

const normalize = (t: string | null | undefined) =>
  (t ?? "").toString().toLowerCase().trim();

/* ───────────────── Confirmación estilo Polaris (SweetAlert) ───────────────── */

interface Confirm {
  title: string;
  text: string;
  confirmLabel: string;
  onAccept: () => void;
}

function ConfirmSwal({ confirm, onClose }: { confirm: Confirm; onClose: () => void }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="glass fade-in-up w-full max-w-sm rounded-2xl p-6 text-center shadow-2xl">
        <HelpCircle size={64} strokeWidth={1.2} className="mx-auto mb-4 text-accent-amber" />
        <h3 className="mb-1 text-base font-semibold">{confirm.title}</h3>
        <p className="text-sm leading-6 text-text-secondary">{confirm.text}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={() => { const fn = confirm.onAccept; onClose(); fn(); }}>
            {confirm.confirmLabel}
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ───────────────────────── Chip de estado ───────────────────────── */

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`rounded-lg px-2.5 py-1 text-[10px] font-bold tracking-wide ${
      status === "ACTIVO"
        ? "bg-accent-emerald/15 text-accent-emerald"
        : "bg-bg-tertiary text-text-muted"
    }`}>
      {status}
    </span>
  );
}

/* ───────────────────────── Modal Empresa ───────────────────────── */

interface CompanyForm {
  name: string;
  phone: string;
  address: string;
  status: string;
}

function CompanyModal({ editing, onSaved, onClose }: {
  editing: Company | null;
  onSaved: (msg: string) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<CompanyForm>(() => editing ? {
    name: editing.name,
    phone: editing.contact === "No definido" ? "" : editing.contact,
    address: editing.address === "No definido" ? "" : editing.address,
    status: editing.status,
  } : { name: "", phone: "", address: "", status: "ACTIVO" });
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.name.trim()) {
      setError("El nombre de la empresa es obligatorio.");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api(`/api/delivery/companies/${editing.id}`, { method: "PUT", body: form });
      } else {
        await api("/api/delivery/companies", { method: "POST", body: form });
      }
      onSaved(editing ? "Empresa actualizada" : "Empresa creada");
    } catch (err) {
      setError((err as Error).message || "No fue posible guardar la empresa.");
      setSaving(false);
    }
  };

  const submit = () => {
    if (!form.name.trim()) {
      setError("El nombre de la empresa es obligatorio.");
      return;
    }
    // Polaris confirma solo al editar
    if (editing) {
      setConfirm({
        title: "¿Guardar cambios?",
        text: "Se actualizará la información de la empresa seleccionada.",
        confirmLabel: "Sí, actualizar",
        onAccept: save,
      });
    } else {
      void save();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="glass fade-in-up w-full max-w-md space-y-4 rounded-2xl p-6 shadow-2xl">
        <h3 className="text-lg font-semibold">{editing ? "Editar Empresa" : "Nueva Empresa"}</h3>
        {error && (
          <p className="rounded-lg bg-accent-rose/10 px-3 py-2 text-sm text-accent-rose">{error}</p>
        )}
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Nombre de la empresa</span>
          <Input value={form.name} maxLength={150}
            onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase() })} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Teléfono</span>
          <Input value={form.phone} maxLength={50} inputMode="tel"
            onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Dirección</span>
          <Input value={form.address} maxLength={255}
            onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Estado</span>
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="ACTIVO">ACTIVO</option>
            <option value="INACTIVO">INACTIVO</option>
          </Select>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>
            {editing ? "Actualizar" : "Guardar"}
          </Button>
        </div>
      </div>
      {confirm && <ConfirmSwal confirm={confirm} onClose={() => setConfirm(null)} />}
    </div>,
    document.body,
  );
}

/* ───────────────────────── Modal Domiciliario ───────────────────────── */

interface DriverForm {
  first_name: string;
  last_name: string;
  phone: string;
  plate: string;
  status: string;
  company_lookup: string;
}

function DriverModal({ editing, companies, onSaved, onClose }: {
  editing: Driver | null;
  companies: Company[];
  onSaved: (msg: string) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<DriverForm>(() => editing ? {
    first_name: editing.first_name,
    last_name: editing.last_name,
    phone: editing.phone,
    plate: editing.plate,
    status: editing.status,
    company_lookup: editing.company_name,
  } : {
    first_name: "", last_name: "", phone: "", plate: "",
    status: "ACTIVO", company_lookup: "",
  });
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [saving, setSaving] = useState(false);

  // Polaris: al crear solo empresas ACTIVAS; al editar incluye inactivas
  const lookupCompanies = companies.filter(
    (c) => editing ? true : c.status === "ACTIVO",
  );
  const matched = lookupCompanies.find(
    (c) => normalize(c.name) === normalize(form.company_lookup),
  );

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        first_name: form.first_name,
        last_name: form.last_name,
        phone: form.phone,
        plate: form.plate,
        status: form.status,
        company_id: matched?.id ?? 0,
      };
      if (editing) {
        await api(`/api/delivery/personnel/${editing.id}`, { method: "PUT", body });
      } else {
        await api("/api/delivery/personnel", { method: "POST", body });
      }
      onSaved(editing ? "Domiciliario actualizado" : "Domiciliario creado");
    } catch (err) {
      setError((err as Error).message || "No fue posible guardar el domiciliario.");
      setSaving(false);
    }
  };

  const submit = () => {
    if (!form.first_name.trim() || !form.last_name.trim() || !form.phone.trim() ||
        !form.plate.trim() || !matched) {
      setError("Completa todos los campos para continuar.");
      return;
    }
    if (editing) {
      setConfirm({
        title: "¿Guardar cambios?",
        text: "Se actualizará la información del domiciliario seleccionado.",
        confirmLabel: "Sí, actualizar",
        onAccept: save,
      });
    } else {
      void save();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="glass fade-in-up w-full max-w-md space-y-4 rounded-2xl p-6 shadow-2xl">
        <h3 className="text-lg font-semibold">
          {editing ? "Editar Domiciliario" : "Nuevo Domiciliario"}
        </h3>
        {error && (
          <p className="rounded-lg bg-accent-rose/10 px-3 py-2 text-sm text-accent-rose">{error}</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Nombre</span>
            <Input value={form.first_name} maxLength={80}
              onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Apellido</span>
            <Input value={form.last_name} maxLength={80}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Teléfono</span>
            <Input value={form.phone} maxLength={20} inputMode="tel"
              onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Placa</span>
            <Input value={form.plate} maxLength={20}
              onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Estado del domiciliario</span>
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="ACTIVO">ACTIVO</option>
            <option value="INACTIVO">INACTIVO</option>
          </Select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Empresa</span>
          <Input value={form.company_lookup} list="companyLookupList"
            placeholder="Escribe para buscar la empresa" autoComplete="off"
            onChange={(e) => setForm({ ...form, company_lookup: e.target.value })} />
          <datalist id="companyLookupList">
            {lookupCompanies.map((c) => <option key={c.id} value={c.name} />)}
          </datalist>
          <span className="mt-1 block text-xs text-text-muted">
            Debes seleccionar una empresa activa. El sistema autocompleta por nombre.
          </span>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>
            {editing ? "Actualizar" : "Guardar"}
          </Button>
        </div>
      </div>
      {confirm && <ConfirmSwal confirm={confirm} onClose={() => setConfirm(null)} />}
    </div>,
    document.body,
  );
}

/* ───────────────────────── Página principal ───────────────────────── */

export function DomiciliosPage() {
  const toast = useToast();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [query, setQuery] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"card" | "table">("card");
  const [companyModal, setCompanyModal] = useState<{ editing: Company | null } | null>(null);
  const [driverModal, setDriverModal] = useState<{ editing: Driver | null } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const load = () => {
    api<{ companies: Company[]; drivers: Driver[] }>("/api/delivery")
      .then((d) => { setCompanies(d.companies); setDrivers(d.drivers); })
      .catch(() => {});
  };
  useEffect(load, []);

  const countByCompany = (companyId: number) =>
    drivers.filter((d) => d.company_id === companyId).length;

  // Búsqueda de Polaris: un solo término filtra ambos paneles
  const q = normalize(query);
  const matchDriver = (d: Driver) =>
    !q || [d.name, d.phone, d.plate, d.status, d.company_name, d.availability]
      .join(" ").toLowerCase().includes(q);
  const matchCompany = (c: Company) =>
    !q || [c.name, c.contact, c.status, `${countByCompany(c.id)} domiciliarios`]
      .join(" ").toLowerCase().includes(q);

  // Una empresa también aparece si alguno de sus domiciliarios coincide
  const visibleCompanies = companies.filter((c) =>
    matchCompany(c) || drivers.some((d) => d.company_id === c.id && matchDriver(d)),
  );
  const visibleDrivers = drivers.filter((d) =>
    (selectedCompanyId === null || d.company_id === selectedCompanyId) && matchDriver(d),
  );

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId);
  const sectionTitle = selectedCompany ? `Personal: ${selectedCompany.name}` : "Todo el Personal";

  /* ───────── Acciones ───────── */

  const deleteCompany = (companyId: number) => setConfirm({
    title: "Eliminar empresa",
    text: "¿Deseas eliminar esta empresa? Esta acción no se puede deshacer.",
    confirmLabel: "Eliminar",
    onAccept: async () => {
      try {
        await api(`/api/delivery/companies/${companyId}`, { method: "DELETE" });
        if (selectedCompanyId === companyId) setSelectedCompanyId(null);
        toast("success", "Empresa eliminada correctamente");
        load();
      } catch (err) {
        toast("error", (err as Error).message || "No fue posible eliminar la empresa.");
      }
    },
  });

  const deleteDriver = (driverId: number) => setConfirm({
    title: "Eliminar domiciliario",
    text: "¿Deseas eliminar este domiciliario? Si tiene pedidos asociados, será desactivado automáticamente para conservar el historial.",
    confirmLabel: "Continuar",
    onAccept: async () => {
      try {
        const res = await api<{ message: string; action_taken: string }>(
          `/api/delivery/personnel/${driverId}`, { method: "DELETE" });
        toast(res.action_taken === "deactivated" ? "warning" : "success", res.message);
        load();
      } catch (err) {
        toast("error", (err as Error).message || "No fue posible eliminar el domiciliario.");
      }
    },
  });

  const activateDriver = async (driverId: number) => {
    try {
      const res = await api<{ message: string }>(
        `/api/delivery/personnel/${driverId}/activate`, { method: "POST" });
      toast("success", res.message);
      load();
    } catch (err) {
      toast("error", (err as Error).message || "No fue posible reactivar el domiciliario.");
    }
  };

  /* ───────── Botón de acción según estado e historial (Polaris) ───────── */

  const driverActionButton = (d: Driver) =>
    d.status === "ACTIVO" ? (
      <button type="button" onClick={() => deleteDriver(d.id)}
        className="rounded-lg border border-accent-rose/40 bg-accent-rose/10 px-2.5 py-1 text-xs font-semibold text-accent-rose transition hover:bg-accent-rose/20">
        {d.has_history ? "Desactivar" : "Eliminar"}
      </button>
    ) : (
      <button type="button" onClick={() => activateDriver(d.id)}
        className="rounded-lg border border-accent-emerald/40 bg-accent-emerald/10 px-2.5 py-1 text-xs font-semibold text-accent-emerald transition hover:bg-accent-emerald/20">
        Activar
      </button>
    );

  const miniEdit = (onClick: () => void) => (
    <button type="button" onClick={onClick}
      className="rounded-lg border border-border-subtle px-2.5 py-1 text-xs font-semibold text-text-secondary transition hover:bg-bg-tertiary hover:text-accent-blue">
      Editar
    </button>
  );

  return (
    <div className="fade-in-up">
      <PageHeader title="Gestión de domicilios" subtitle="Centro de control unificado" />

      <div className="mb-4 max-w-md">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input placeholder="Buscar personal o empresa..." value={query} className="!pl-9"
            onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* ───────── Panel Empresas ───────── */}
        <section className="glass rounded-2xl">
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold">Empresas</h2>
              <span className="grid h-6 min-w-6 place-items-center rounded-full bg-accent-blue/15 px-1.5 text-xs font-bold text-accent-blue">
                {companies.length}
              </span>
            </div>
            <Button size="sm" title="Abrir formulario"
              onClick={() => setCompanyModal({ editing: null })}>
              <Plus size={15} />
            </Button>
          </div>
          <div className="space-y-3 p-3">
            {visibleCompanies.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-text-muted">
                No hay empresas que coincidan con la búsqueda.
              </p>
            )}
            {visibleCompanies.map((c) => (
              <article key={c.id}
                onClick={() => setSelectedCompanyId(selectedCompanyId === c.id ? null : c.id)}
                className={`cursor-pointer rounded-xl border p-3 transition hover:-translate-y-px hover:shadow-md ${
                  selectedCompanyId === c.id
                    ? "border-accent-blue shadow-[0_0_16px_hsl(199_89%_48%/0.2)]"
                    : "border-border-subtle"
                }`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="truncate text-sm font-bold">{c.name}</h3>
                  <div className="flex shrink-0 items-center gap-1.5"
                    onClick={(e) => e.stopPropagation()}>
                    {miniEdit(() => setCompanyModal({ editing: c }))}
                    <button type="button" onClick={() => deleteCompany(c.id)}
                      className="rounded-lg border border-accent-rose/40 bg-accent-rose/10 px-2.5 py-1 text-xs font-semibold text-accent-rose transition hover:bg-accent-rose/20">
                      Eliminar
                    </button>
                    <StatusChip status={c.status} />
                  </div>
                </div>
                <div className="space-y-1 text-sm text-text-secondary">
                  <p className="flex items-center gap-2">
                    <Phone size={13} className="text-text-muted" /> {c.contact}
                  </p>
                  <p className="flex items-center gap-2">
                    <Users size={13} className="text-text-muted" /> {countByCompany(c.id)} domiciliarios
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ───────── Panel Personal ───────── */}
        <section className="glass rounded-2xl">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold">{sectionTitle}</h2>
              <span className="grid h-6 min-w-6 place-items-center rounded-full bg-accent-blue/15 px-1.5 text-xs font-bold text-accent-blue">
                {visibleDrivers.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div role="group" aria-label="Modo de vista"
                className="flex overflow-hidden rounded-lg border border-border-subtle">
                {([["card", "Tarjeta", LayoutGrid], ["table", "Tabla", Table2]] as const).map(
                  ([mode, label, Icon]) => (
                    <button key={mode} type="button"
                      onClick={() => setViewMode(mode)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition ${
                        viewMode === mode
                          ? "bg-accent-blue text-white"
                          : "text-text-secondary hover:bg-bg-tertiary"
                      }`}>
                      <Icon size={13} /> {label}
                    </button>
                  ),
                )}
              </div>
              <Button size="sm" onClick={() => setDriverModal({ editing: null })}>
                <span className="flex items-center gap-1"><Plus size={14} /> Añadir Domiciliario</span>
              </Button>
            </div>
          </div>

          <div className="p-3">
            {visibleDrivers.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-text-muted">
                No hay domiciliarios registrados.
              </p>
            ) : viewMode === "table" ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                      {["Nombre", "Teléfono", "Placa", "Empresa", "Estado", "Acciones"].map((h) => (
                        <th key={h} className="px-3 py-2.5 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle/60">
                    {visibleDrivers.map((d) => (
                      <tr key={d.id} className="transition hover:bg-bg-tertiary">
                        <td className="px-3 py-2.5 font-semibold">{d.name}</td>
                        <td className="px-3 py-2.5">{d.phone}</td>
                        <td className="px-3 py-2.5">{d.plate}</td>
                        <td className="px-3 py-2.5">{d.company_name}</td>
                        <td className="px-3 py-2.5"><StatusChip status={d.status} /></td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            {miniEdit(() => setDriverModal({ editing: d }))}
                            {driverActionButton(d)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {visibleDrivers.map((d) => (
                  <article key={d.id} className="rounded-xl border border-border-subtle p-3">
                    <div className="flex items-start gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-blue/15 text-base font-extrabold text-accent-blue">
                        {d.initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-bold">{d.name}</h3>
                        <p className="text-xs text-text-secondary">Teléfono: {d.phone}</p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                        {miniEdit(() => setDriverModal({ editing: d }))}
                        {driverActionButton(d)}
                        <StatusChip status={d.status} />
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between rounded-lg bg-bg-tertiary px-3 py-2">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
                        Placa / ID
                      </span>
                      <span className="text-sm font-bold">{d.plate}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between px-1 text-xs">
                      <span className="text-text-muted">Empresa Aliada</span>
                      <strong className="flex items-center gap-1.5">
                        <Building2 size={13} className="text-text-muted" /> {d.company_name}
                      </strong>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {companyModal && (
        <CompanyModal editing={companyModal.editing}
          onSaved={(msg) => { setCompanyModal(null); toast("success", msg); load(); }}
          onClose={() => setCompanyModal(null)} />
      )}
      {driverModal && (
        <DriverModal editing={driverModal.editing} companies={companies}
          onSaved={(msg) => { setDriverModal(null); toast("success", msg); load(); }}
          onClose={() => setDriverModal(null)} />
      )}
      {confirm && <ConfirmSwal confirm={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}
