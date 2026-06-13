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
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft, Download, FileSpreadsheet, History, Pencil, Plus, Save,
  Search, Trash2,
} from "lucide-react";
import { api } from "../lib/api";
import { Button, Input, PageHeader, Table, usePagination } from "../components/ui";
import {
  type Alert, type ClientRow, type FormState, type Geo,
  ClienteFormFields, DOCUMENT_TYPES, emptyForm, formFromRow, fullName,
  PERSON_TYPES, PolarisAlert, validateClientForm,
} from "../components/ClienteForm";

/* ───────────────────────── Tipos del historial ───────────────────────── */

interface AuditRow {
  id: number;
  created_at: string; // DD/MM/YYYY HH:MM:SS
  user_name: string;
  client_name: string;
  action: "create" | "update" | "delete";
  detail: { label: string; value: string }[] | null;
}

const ACTIONS: Record<AuditRow["action"], string> = {
  create: "Creación",
  update: "Actualización",
  delete: "Eliminación",
};

/* ───────────────────────── Formulario Agregar/Editar ───────────────────────── */

function ClienteForm({ editing, geo, onDone, onBack }: {
  editing: ClientRow | null;
  geo: Geo;
  onDone: () => void;
  onBack: () => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    editing ? formFromRow(editing) : emptyForm(geo));
  const [alert, setAlert] = useState<Alert | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    const missing = validateClientForm(form);
    if (missing.length > 0) {
      setAlert({ kind: "error", lines: missing });
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

      <div className="glass mx-auto max-w-2xl rounded-2xl p-6">
        <ClienteFormFields form={form} set={set} geo={geo} />
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
