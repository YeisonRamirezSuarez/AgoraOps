/**
 * CRUD estilo Polaris Food: búsqueda rápida (§1.4) + botón "+ Nuevo" +
 * tabla con edición INLINE (los campos se editan en la propia fila, con
 * radios Sí/No para estados y los iconos de acción a la izquierda) +
 * paginación ("Ver 10 ▾ … [1 a 5 de 5]").
 * Para formularios complejos (muchos campos) usar `modal` y se edita en
 * una ventana modal.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Inbox, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import {
  Button, ConfirmDialog, cop, FormRow, Input, MoneyInput, Select, useToast,
} from "./ui";

export interface CrudField {
  name: string;
  label: string;
  /** "money": se formatea en COP en la tabla y mientras se escribe. */
  type?: "text" | "number" | "money" | "select" | "checkbox" | "datetime-local";
  options?: { value: string | number; label: string }[];
  required?: boolean;
  /** No editable después de crear (ej. número de mesa §1.7.2). */
  immutable?: boolean;
  /** Mostrar en la tabla (default true). */
  inTable?: boolean;
  /** Visibilidad condicional en el formulario según el borrador
   * (ej. IP/Puerto solo si Tipo de conexión = ETHERNET). El requerido
   * solo aplica cuando el campo está visible; oculto se guarda null. */
  visible?: (draft: Record<string, unknown>) => boolean;
  render?: (row: Record<string, unknown>) => React.ReactNode;
}

type Row = Record<string, unknown>;

const PAGE_SIZES = [10, 20, 50];

export function CrudPage({
  endpoint,
  fields,
  title,
  canDelete = true,
  canCreate = true,
  modal = false,
}: {
  endpoint: string;
  fields: CrudField[];
  title: string;
  canDelete?: boolean;
  canCreate?: boolean;
  /** true = crear/editar en modal (formularios grandes); false = inline. */
  modal?: boolean;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [editing, setEditing] = useState<Row | null>(null); // borrador en edición
  const [isNew, setIsNew] = useState(false);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<Row[]>(endpoint)
      .then(setRows)
      .catch((e) => toast("error", e instanceof ApiError ? e.message : "Error al cargar"));
  }, [endpoint, toast]);

  useEffect(load, [load]);

  // Búsqueda rápida (§1.4): coincidencias en todos los campos relevantes
  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      fields.some((f) => String(r[f.name] ?? "").toLowerCase().includes(q)),
    );
  }, [rows, search, fields]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const fromN = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const toN = Math.min(safePage * pageSize, filtered.length);

  const tableFields = fields.filter((f) => f.inTable !== false);
  // En inline se editan también los campos que no caben en la tabla? No:
  // inline edita los visibles; los ocultos (inTable:false) van al modal.
  const hasHiddenFields = fields.some((f) => f.inTable === false);
  const useModal = modal || hasHiddenFields;

  function blankDraft(): Row {
    const d: Row = {};
    for (const f of fields) d[f.name] = f.type === "checkbox" ? true : "";
    return d;
  }

  function startNew() {
    setEditing(blankDraft());
    setIsNew(true);
  }

  function startEdit(row: Row) {
    setEditing({ ...row });
    setIsNew(false);
  }

  async function save() {
    if (!editing) return;
    // Validación de requeridos (solo campos visibles)
    for (const f of fields) {
      if (f.visible && !f.visible(editing)) continue;
      if (f.required && (editing[f.name] === "" || editing[f.name] == null)) {
        toast("error", `El campo "${f.label}" es obligatorio.`);
        return;
      }
    }
    setSaving(true);
    const body: Row = {};
    for (const f of fields) {
      if (!isNew && f.immutable) continue;
      // Campo oculto por condición → se limpia (ej. IP al cambiar a USB)
      if (f.visible && !f.visible(editing)) {
        body[f.name] = null;
        continue;
      }
      let v = editing[f.name];
      if ((f.type === "number" || f.type === "money") && v !== "" && v != null) v = Number(v);
      if (f.type === "select" && v !== "" && v != null && f.options?.every((o) => typeof o.value === "number")) {
        v = Number(v);
      }
      if (v !== undefined && v !== "") body[f.name] = v;
      else if (v === "" && !f.required) body[f.name] = null;
    }
    try {
      if (isNew) {
        await api(endpoint, { method: "POST", body });
        toast("success", "Registro agregado correctamente");
      } else {
        await api(`${endpoint}/${editing.id}`, { method: "PUT", body });
        toast("success", "Registro actualizado correctamente");
      }
      setEditing(null);
      load();
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    try {
      await api(`${endpoint}/${deleting.id}`, { method: "DELETE" });
      toast("success", "Registro eliminado correctamente");
      load();
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "No se pudo eliminar");
    } finally {
      setDeleting(null);
    }
  }

  function displayCell(row: Row, f: CrudField) {
    if (f.render) return f.render(row);
    const v = row[f.name];
    if (f.type === "checkbox") {
      return (
        <span className={v ? "font-medium text-accent-emerald" : "text-text-muted"}>
          {v ? "Sí" : "No"}
        </span>
      );
    }
    if (f.type === "select" && f.options) {
      return f.options.find((o) => String(o.value) === String(v))?.label ?? String(v ?? "—");
    }
    if (f.type === "money") {
      return v == null || v === "" ? "—" : cop.format(Number(v));
    }
    return String(v ?? "—");
  }

  /** Campo editable inline dentro de la fila. */
  function editCell(f: CrudField) {
    if (f.visible && !f.visible(editing!)) {
      return <span className="text-text-muted">—</span>;
    }
    const disabled = !isNew && f.immutable;
    const v = editing![f.name];
    if (f.type === "checkbox") {
      // Radios Sí / No como en Polaris
      return (
        <span className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="radio" checked={!!v} disabled={disabled}
              onChange={() => setEditing({ ...editing!, [f.name]: true })}
              className="h-3.5 w-3.5 accent-[hsl(199_89%_48%)]" />
            Sí
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={!v} disabled={disabled}
              onChange={() => setEditing({ ...editing!, [f.name]: false })}
              className="h-3.5 w-3.5 accent-[hsl(199_89%_48%)]" />
            No
          </label>
        </span>
      );
    }
    if (f.type === "select") {
      return (
        <Select value={String(v ?? "")} disabled={disabled}
          onChange={(e) => setEditing({ ...editing!, [f.name]: e.target.value })}
          className="!w-auto !min-w-36 !py-1.5">
          <option value="">— Seleccione —</option>
          {f.options?.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
          ))}
        </Select>
      );
    }
    if (f.type === "money") {
      return (
        <MoneyInput value={String(v ?? "")} disabled={disabled}
          onValueChange={(raw) => setEditing({ ...editing!, [f.name]: raw })}
          className="!w-auto !min-w-40 !py-1.5" />
      );
    }
    return (
      <Input type={f.type ?? "text"} value={String(v ?? "")} disabled={disabled}
        onChange={(e) => setEditing({ ...editing!, [f.name]: e.target.value })}
        className="!w-auto !min-w-40 !py-1.5"
        step={f.type === "number" ? "any" : undefined} />
    );
  }

  const inlineEditing = !useModal && editing;

  // Formularios grandes: registro tipo página (estilo Polaris
  // "Agregar nueva impresora"), reemplaza al modal en todos los CRUD.
  if (useModal && editing) {
    return (
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="fade-in-up">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {isNew ? `Agregar ${title}` : `Editar ${title}`}
          </h2>
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              <Plus size={15} className="-mt-0.5 mr-1 inline" />
              {saving ? "Guardando…" : isNew ? "Agregar" : "Guardar"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              <ArrowLeft size={15} className="-mt-0.5 mr-1 inline" /> Volver
            </Button>
          </div>
        </div>

        <div className="glass max-w-3xl space-y-4 rounded-2xl p-6">
          {fields.filter((f) => !f.visible || f.visible(editing)).map((f) => {
            const disabled = !isNew && f.immutable;
            return (
              <FormRow key={f.name} label={f.label + (disabled ? " (no editable)" : "")}
                required={f.required}>
                {f.type === "select" ? (
                  <Select value={String(editing[f.name] ?? "")} required={f.required}
                    disabled={disabled}
                    onChange={(e) => setEditing({ ...editing, [f.name]: e.target.value })}>
                    <option value="">— Seleccione una opción —</option>
                    {f.options?.map((o) => (
                      <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
                    ))}
                  </Select>
                ) : f.type === "checkbox" ? (
                  <input type="checkbox" checked={!!editing[f.name]} disabled={disabled}
                    onChange={(e) => setEditing({ ...editing, [f.name]: e.target.checked })}
                    className="h-4 w-4 accent-[hsl(199_89%_48%)]" />
                ) : f.type === "money" ? (
                  <MoneyInput value={String(editing[f.name] ?? "")}
                    required={f.required} disabled={disabled}
                    onValueChange={(raw) => setEditing({ ...editing, [f.name]: raw })} />
                ) : (
                  <Input type={f.type ?? "text"} value={String(editing[f.name] ?? "")}
                    required={f.required} disabled={disabled}
                    onChange={(e) => setEditing({ ...editing, [f.name]: e.target.value })}
                    step={f.type === "number" ? "any" : undefined} />
                )}
              </FormRow>
            );
          })}
        </div>
        <p className="mt-2 text-xs font-medium text-accent-rose">* Campos obligatorios</p>
      </form>
    );
  }

  return (
    <div className="fade-in-up">
      {/* Búsqueda rápida + Nuevo (layout Polaris) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input placeholder="Búsqueda rápida" value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="!w-64 !pl-9" />
        </div>
        {canCreate && (
          <Button onClick={startNew}>
            <Plus size={15} className="-mt-0.5 mr-1 inline" /> Nuevo
          </Button>
        )}
      </div>

      {/* Sin registros: no se muestra la tabla, solo el estado vacío */}
      {filtered.length === 0 && !editing ? (
        <div className="glass grid place-items-center rounded-2xl py-14 text-text-muted">
          <Inbox size={32} className="mb-2 opacity-60" />
          <p className="text-sm">No hay registros para mostrar</p>
        </div>
      ) : (
      <div className="glass overflow-x-auto rounded-2xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-medium bg-bg-tertiary/60 text-left text-xs uppercase tracking-wide text-text-secondary">
              <th className="w-24 px-4 py-3 font-medium">Acciones</th>
              {tableFields.map((f) => (
                <th key={f.name} className="px-4 py-3 font-medium">
                  {f.label}{f.required && <span className="text-accent-rose"> *</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle/60">
            {/* Fila nueva inline */}
            {inlineEditing && isNew && (
              <tr className="bg-accent-blue/5">
                <td className="px-4 py-2">
                  <RowActions onSave={save} onCancel={() => setEditing(null)} saving={saving} />
                </td>
                {tableFields.map((f) => (
                  <td key={f.name} className="px-4 py-2">{editCell(f)}</td>
                ))}
              </tr>
            )}

            {pageRows.map((row) => {
              const isEditingRow = inlineEditing && !isNew && editing!.id === row.id;
              return (
                <tr key={String(row.id)}
                  className={isEditingRow ? "bg-accent-blue/5" : "transition hover:bg-bg-tertiary/40"}>
                  <td className="px-4 py-2">
                    {isEditingRow ? (
                      <RowActions onSave={save} onCancel={() => setEditing(null)} saving={saving} />
                    ) : (
                      <div className="flex gap-1">
                        {canDelete && (
                          <button onClick={() => setDeleting(row)} aria-label="Eliminar"
                            className="rounded-lg p-1.5 text-text-muted transition hover:bg-accent-rose/15 hover:text-accent-rose">
                            <Trash2 size={15} />
                          </button>
                        )}
                        <button onClick={() => startEdit(row)} aria-label="Editar"
                          className="rounded-lg p-1.5 text-text-muted transition hover:bg-accent-blue/15 hover:text-accent-blue">
                          <Pencil size={15} />
                        </button>
                      </div>
                    )}
                  </td>
                  {tableFields.map((f) => (
                    <td key={f.name} className="px-4 py-2">
                      {isEditingRow ? editCell(f) : displayCell(row, f)}
                    </td>
                  ))}
                </tr>
              );
            })}

            {pageRows.length === 0 && !isNew && (
              <tr>
                <td colSpan={tableFields.length + 1}
                  className="px-4 py-10 text-center text-text-muted">
                  Sin registros
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {/* Paginación estilo Polaris: Ver N ▾ · ‹ › · [x a y de z] */}
      {filtered.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
          <label className="flex items-center gap-2">
            Ver
            <Select value={String(pageSize)}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="!w-auto !py-1">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </label>
          <div className="flex items-center gap-1">
            <PageBtn label="«" onClick={() => setPage(1)} disabled={safePage === 1} />
            <PageBtn label="‹" onClick={() => setPage(safePage - 1)} disabled={safePage === 1} />
            <span className="rounded-lg bg-accent-blue/20 px-3 py-1 font-medium text-accent-blue">
              {safePage}
            </span>
            <PageBtn label="›" onClick={() => setPage(safePage + 1)} disabled={safePage === totalPages} />
            <PageBtn label="»" onClick={() => setPage(totalPages)} disabled={safePage === totalPages} />
          </div>
          <span className="text-xs">
            [{fromN} a {toN} de {filtered.length}]
          </span>
        </div>
      )}

      <ConfirmDialog open={!!deleting} title="Confirmar eliminación"
        message="¿Desea eliminar este registro? Esta acción no se puede deshacer."
        confirmLabel="Eliminar" onConfirm={remove} onCancel={() => setDeleting(null)} />
    </div>
  );
}

function PageBtn({ label, onClick, disabled }: {
  label: string; onClick: () => void; disabled: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="rounded-lg border border-border-subtle px-2.5 py-1 transition hover:bg-bg-tertiary disabled:opacity-40">
      {label}
    </button>
  );
}

function RowActions({ onSave, onCancel, saving }: {
  onSave: () => void; onCancel: () => void; saving: boolean;
}) {
  return (
    <div className="flex gap-1">
      <button onClick={onSave} disabled={saving} aria-label="Guardar"
        className="rounded-lg p-1.5 text-accent-emerald transition hover:bg-accent-emerald/15">
        <Check size={16} />
      </button>
      <button onClick={onCancel} aria-label="Cancelar"
        className="rounded-lg p-1.5 text-text-muted transition hover:bg-accent-rose/15 hover:text-accent-rose">
        <X size={16} />
      </button>
    </div>
  );
}
