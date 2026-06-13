/**
 * Cajas (Gestión de cajas §1.8.2) — réplica EXACTA de Polaris Food
 * (grid_public_cash_registers + form_public_cash_registers).
 *
 * Comportamiento idéntico a Polaris:
 *  - GRID de lectura: columnas Nombre de la caja · Nombre del restaurante ·
 *    Estado · Nota · Creado por · Fecha de creación · Actualizado por ·
 *    Fecha de actualización. Búsqueda Rápida + "Nuevo"; paginación. Cada
 *    fila solo tiene "Editar este registro" (sin eliminar en el grid).
 *  - Página "Creación de cajas": Nombre de la caja* (máx 50), Estado
 *    (FUNCIONANDO/FALLANDO, default FUNCIONANDO), Nota* (máx 250).
 *    Botones Agregar / Volver.
 *  - Página "Actualización de cajas": Nombre de SOLO LECTURA (inmutable),
 *    Estado / Nota editables. Botones Guardar / Borrar / Volver.
 *  - Validación: modal que lista los campos obligatorios faltantes.
 *  - Borrar → "¿Realmente desea eliminar el registro?" (lo bloquea la BD si
 *    la caja ya fue abierta; el estado no cambia con caja abierta).
 *  - Sin toast de éxito: tras Agregar/Guardar/Borrar regresa al grid.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Inbox, Pencil, Plus, Save, Search, Trash2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Button, fmtDateTime, Input, Modal, Select, TextArea, useToast } from "./ui";

type Status = "FUNCIONANDO" | "FALLANDO";

interface Caja {
  id: number;
  name: string;
  status: Status;
  note: string | null;
  restaurant_name: string | null;
  created_at: string | null;
  updated_at: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
}

const REGISTERS = "/api/cash/registers";
const PAGE_SIZES = [10, 20, 50];

type View =
  | { mode: "list" }
  | { mode: "create" }
  | { mode: "edit"; caja: Caja };

interface Draft {
  name: string;
  status: Status;
  note: string;
}

export function CajasGrid() {
  const toast = useToast();
  const [rows, setRows] = useState<Caja[]>([]);
  const [view, setView] = useState<View>({ mode: "list" });

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [deleting, setDeleting] = useState(false);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Caja[]>(REGISTERS)
      .then(setRows)
      .catch((e) => toast("error", e instanceof ApiError ? e.message : "Error al cargar"));
  }, [toast]);
  useEffect(load, [load]);

  /* ───────── Grid (búsqueda rápida sobre las columnas visibles) ───────── */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.name.toLowerCase().includes(q) ||
      (r.restaurant_name ?? "").toLowerCase().includes(q) ||
      r.status.toLowerCase().includes(q) ||
      (r.note ?? "").toLowerCase().includes(q) ||
      (r.created_by_name ?? "").toLowerCase().includes(q) ||
      (r.updated_by_name ?? "").toLowerCase().includes(q));
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const fromN = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const toN = Math.min(safePage * pageSize, filtered.length);

  /* ───────── Acciones ───────── */
  function startCreate() {
    setDraft(blankDraft());
    setView({ mode: "create" });
  }
  function startEdit(caja: Caja) {
    setDraft({ name: caja.name, status: caja.status, note: caja.note ?? "" });
    setView({ mode: "edit", caja });
  }

  function missingFields(): string[] {
    const miss: string[] = [];
    if (!draft.name.trim()) miss.push("Nombre de la caja: Campo obligatorio");
    if (!draft.note.trim()) miss.push("Nota: Campo obligatorio");
    return miss;
  }

  async function create() {
    const miss = missingFields();
    if (miss.length) { setAlertMsg(miss.join("\n")); return; }
    try {
      await api(REGISTERS, {
        method: "POST",
        body: { name: draft.name.trim(), status: draft.status, note: draft.note.trim() },
      });
      setView({ mode: "list" });
      load();
    } catch (e) {
      setAlertMsg(e instanceof ApiError ? e.message : "Error al guardar");
    }
  }

  async function saveEdit(caja: Caja) {
    if (!draft.note.trim()) { setAlertMsg("Nota: Campo obligatorio"); return; }
    try {
      await api(`${REGISTERS}/${caja.id}`, {
        method: "PUT",
        body: { status: draft.status, note: draft.note.trim() },
      });
      setView({ mode: "list" });
      load();
    } catch (e) {
      setAlertMsg(e instanceof ApiError ? e.message : "Error al guardar");
    }
  }

  async function remove(caja: Caja) {
    setDeleting(false);
    try {
      await api(`${REGISTERS}/${caja.id}`, { method: "DELETE" });
      setView({ mode: "list" });
      load();
    } catch (e) {
      setAlertMsg(e instanceof ApiError ? e.message : "No se pudo eliminar");
    }
  }

  /* ───────── Render: páginas Creación / Actualización ───────── */
  if (view.mode === "create" || view.mode === "edit") {
    const isEdit = view.mode === "edit";
    const caja = isEdit ? view.caja : null;
    return (
      <div className="fade-in-up">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {isEdit ? "Actualización de cajas" : "Creación de cajas"}
          </h2>
          <div className="flex gap-2">
            <Button onClick={() => (isEdit ? saveEdit(caja!) : create())}>
              {isEdit ? <Save size={15} className="-mt-0.5 mr-1 inline" />
                : <Plus size={15} className="-mt-0.5 mr-1 inline" />}
              {isEdit ? "Guardar" : "Agregar"}
            </Button>
            {isEdit && (
              <Button variant="danger" onClick={() => setDeleting(true)}>
                <Trash2 size={15} className="-mt-0.5 mr-1 inline" /> Borrar
              </Button>
            )}
            <Button variant="ghost" onClick={() => setView({ mode: "list" })}>
              <ArrowLeft size={15} className="-mt-0.5 mr-1 inline" /> Volver
            </Button>
          </div>
        </div>

        <div className="glass max-w-2xl space-y-4 rounded-2xl p-6">
          <FieldRow label="Nombre de la caja" required>
            {isEdit ? (
              <span className="font-semibold text-accent-blue">{caja!.name}</span>
            ) : (
              <Input value={draft.name} maxLength={50}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="!w-72" />
            )}
          </FieldRow>
          <FieldRow label="Estado">
            <Select value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })}
              className="!w-56">
              <option value="FUNCIONANDO">FUNCIONANDO</option>
              <option value="FALLANDO">FALLANDO</option>
            </Select>
          </FieldRow>
          <FieldRow label="Nota" required>
            <TextArea rows={3} value={draft.note} maxLength={250}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              className="!w-full" />
          </FieldRow>
        </div>
        <p className="mt-2 text-xs font-medium text-accent-rose">* Campos obligatorios</p>

        {isEdit && (
          <Modal open={deleting} title="" onClose={() => setDeleting(false)}>
            <p className="mb-5 text-center text-sm text-text-secondary">
              ¿Realmente desea eliminar el registro?
            </p>
            <div className="flex justify-center gap-2">
              <Button onClick={() => remove(view.caja)}>Aceptar</Button>
              <Button variant="ghost" onClick={() => setDeleting(false)}>Cancelar</Button>
            </div>
          </Modal>
        )}
        <AlertModal msg={alertMsg} onClose={() => setAlertMsg(null)} />
      </div>
    );
  }

  /* ───────── Render: grid ───────── */
  return (
    <div className="fade-in-up">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input placeholder="Búsqueda Rápida" value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="!w-64 !pl-9" />
        </div>
        <Button onClick={startCreate}>
          <Plus size={15} className="-mt-0.5 mr-1 inline" /> Nuevo
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="glass grid place-items-center rounded-2xl py-14 text-text-muted">
          <Inbox size={32} className="mb-2 opacity-60" />
          <p className="text-sm">No hay registros para mostrar</p>
        </div>
      ) : (
        <div className="glass overflow-x-auto rounded-2xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-medium bg-bg-tertiary/60 text-left text-xs uppercase tracking-wide text-text-secondary">
                <th className="w-16 px-4 py-3 font-medium"></th>
                <th className="px-4 py-3 font-medium">Nombre de la caja</th>
                <th className="px-4 py-3 font-medium">Nombre del restaurante</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Nota</th>
                <th className="px-4 py-3 font-medium">Creado por</th>
                <th className="px-4 py-3 font-medium">Fecha de creación</th>
                <th className="px-4 py-3 font-medium">Actualizado por</th>
                <th className="px-4 py-3 font-medium">Fecha de actualización</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle/60">
              {pageRows.map((c) => (
                <tr key={c.id} className="transition hover:bg-bg-tertiary/40">
                  <td className="px-4 py-2">
                    <button onClick={() => startEdit(c)} aria-label="Editar este registro"
                      className="rounded-lg p-1.5 text-text-muted transition hover:bg-accent-blue/15 hover:text-accent-blue">
                      <Pencil size={15} />
                    </button>
                  </td>
                  <td className="px-4 py-2 font-medium">{c.name}</td>
                  <td className="px-4 py-2">{c.restaurant_name ?? "—"}</td>
                  <td className="px-4 py-2">{c.status}</td>
                  <td className="px-4 py-2">{c.note ?? "—"}</td>
                  <td className="px-4 py-2">{c.created_by_name ?? "—"}</td>
                  <td className="px-4 py-2">{fmtDateTime(c.created_at)}</td>
                  <td className="px-4 py-2">{c.updated_by_name ?? "—"}</td>
                  <td className="px-4 py-2">{fmtDateTime(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
          <span className="text-xs">[{fromN} a {toN} de {filtered.length}]</span>
        </div>
      )}

      <AlertModal msg={alertMsg} onClose={() => setAlertMsg(null)} />
    </div>
  );
}

function blankDraft(): Draft {
  return { name: "", status: "FUNCIONANDO", note: "" };
}

function FieldRow({ label, required, children }: {
  label: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[160px_1fr]">
      <span className="text-sm font-semibold">
        {label} {required && <span className="text-accent-rose">*</span>}
      </span>
      {children}
    </div>
  );
}

function AlertModal({ msg, onClose }: { msg: string | null; onClose: () => void }) {
  return (
    <Modal open={!!msg} title="" onClose={onClose}>
      <p className="mb-5 whitespace-pre-line text-center text-sm text-text-secondary">{msg}</p>
      <div className="flex justify-center">
        <Button onClick={onClose}>Aceptar</Button>
      </div>
    </Modal>
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
