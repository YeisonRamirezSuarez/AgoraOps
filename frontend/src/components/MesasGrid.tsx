/**
 * Mesas del restaurante (Configuración §1.7.2) — réplica EXACTA del módulo
 * de Polaris Food (grid_tb_restaurant_tables + form_add_tables +
 * form_public_tb_restaurant_tables).
 *
 * Comportamiento idéntico a Polaris:
 *  - GRID de lectura (no inline): columnas Número de mesa · Asientos ·
 *    Ubicación (sala) · Activa; ordenable por Número; Búsqueda Rápida +
 *    "Nuevo"; paginación. Cada fila solo tiene "Editar este registro".
 *  - Página "Crear mesa": Número de mesa*, Asientos*, Ubicación* (salas
 *    activas), Activa (Si/No, default Si). Botones Agregar / Volver.
 *  - Página "Editar mesa": Número de mesa de SOLO LECTURA (inmutable),
 *    Asientos / Ubicación / Activa editables. Botones Guardar / Borrar /
 *    Volver.
 *  - Validación: modal que lista TODOS los campos obligatorios faltantes.
 *  - Número único por sala → "Ya existe una mesa con ese número en: {SALA}".
 *  - Borrar → "¿Realmente desea eliminar el registro?".
 *  - Sin toast de éxito: tras Agregar/Guardar/Borrar regresa al grid.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpDown, Inbox, Pencil, Plus, Save, Search, Trash2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Button, Input, Modal, Select, useToast } from "./ui";

interface Mesa {
  id: number;
  room_id: number;
  number: number;
  seats: number;
  is_active: boolean;
}
interface Room {
  id: number;
  name: string;
  is_active: boolean;
}

const TABLES = "/api/catalogs/tables";
const ROOMS = "/api/catalogs/rooms";
const PAGE_SIZES = [10, 20, 50];

type View =
  | { mode: "list" }
  | { mode: "create" }
  | { mode: "edit"; mesa: Mesa };

interface Draft {
  number: string;
  seats: string;
  room_id: string;
  is_active: boolean;
}

export function MesasGrid() {
  const toast = useToast();
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [view, setView] = useState<View>({ mode: "list" });

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortAsc, setSortAsc] = useState(true);

  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [deleting, setDeleting] = useState(false);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([api<Mesa[]>(TABLES), api<Room[]>(ROOMS)])
      .then(([t, r]) => { setMesas(t); setRooms(r); })
      .catch((e) => toast("error", e instanceof ApiError ? e.message : "Error al cargar"));
  }, [toast]);
  useEffect(load, [load]);

  const roomName = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of rooms) m.set(r.id, r.name);
    return m;
  }, [rooms]);

  // Ubicación: solo salas activas (Polaris). Al editar, conserva la sala
  // actual aunque estuviera inactiva, para no perderla silenciosamente.
  function roomOptions(currentId?: number): Room[] {
    const active = rooms.filter((r) => r.is_active);
    if (currentId != null && !active.some((r) => r.id === currentId)) {
      const cur = rooms.find((r) => r.id === currentId);
      if (cur) return [cur, ...active];
    }
    return active;
  }

  /* ───────── Grid ───────── */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? mesas.filter((m) =>
          String(m.number).includes(q) ||
          String(m.seats).includes(q) ||
          (roomName.get(m.room_id) ?? "").toLowerCase().includes(q) ||
          (m.is_active ? "si" : "no").includes(q))
      : mesas;
    return [...rows].sort((a, b) => (sortAsc ? a.number - b.number : b.number - a.number));
  }, [mesas, search, roomName, sortAsc]);

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
  function startEdit(mesa: Mesa) {
    setDraft({
      number: String(mesa.number),
      seats: String(mesa.seats),
      room_id: String(mesa.room_id),
      is_active: mesa.is_active,
    });
    setView({ mode: "edit", mesa });
  }

  function missingFields(forEdit: boolean): string[] {
    const miss: string[] = [];
    if (!forEdit && !draft.number.trim()) miss.push("Número de mesa: Campo obligatorio");
    if (!draft.seats.trim()) miss.push("Asientos: Campo obligatorio");
    if (!draft.room_id) miss.push("Ubicación: Campo obligatorio");
    return miss;
  }

  async function create() {
    const miss = missingFields(false);
    if (miss.length) { setAlertMsg(miss.join("\n")); return; }
    try {
      await api(TABLES, {
        method: "POST",
        body: {
          number: Number(draft.number),
          seats: Number(draft.seats),
          room_id: Number(draft.room_id),
          is_active: draft.is_active,
        },
      });
      setView({ mode: "list" });
      load();
    } catch (e) {
      setAlertMsg(e instanceof ApiError ? e.message : "Error al guardar");
    }
  }

  async function saveEdit(mesa: Mesa) {
    const miss = missingFields(true);
    if (miss.length) { setAlertMsg(miss.join("\n")); return; }
    try {
      await api(`${TABLES}/${mesa.id}`, {
        method: "PUT",
        body: {
          seats: Number(draft.seats),
          room_id: Number(draft.room_id),
          is_active: draft.is_active,
        },
      });
      setView({ mode: "list" });
      load();
    } catch (e) {
      setAlertMsg(e instanceof ApiError ? e.message : "Error al guardar");
    }
  }

  async function remove(mesa: Mesa) {
    setDeleting(false);
    try {
      await api(`${TABLES}/${mesa.id}`, { method: "DELETE" });
      setView({ mode: "list" });
      load();
    } catch (e) {
      setAlertMsg(e instanceof ApiError ? e.message : "No se pudo eliminar");
    }
  }

  /* ───────── Render: formularios Crear / Editar ───────── */
  if (view.mode === "create" || view.mode === "edit") {
    const isEdit = view.mode === "edit";
    const mesa = isEdit ? view.mesa : null;
    return (
      <div className="fade-in-up">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{isEdit ? "Editar mesa" : "Crear mesa"}</h2>
          <div className="flex gap-2">
            <Button onClick={() => (isEdit ? saveEdit(mesa!) : create())}>
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
          <FieldRow label="Número de mesa" required>
            {isEdit ? (
              <span className="font-semibold text-accent-blue">{mesa!.number}</span>
            ) : (
              <Input type="number" value={draft.number} step="1" min="1"
                onChange={(e) => setDraft({ ...draft, number: e.target.value })}
                className="!w-48" />
            )}
          </FieldRow>
          <FieldRow label="Asientos" required>
            <Input type="number" value={draft.seats} step="1" min="1"
              onChange={(e) => setDraft({ ...draft, seats: e.target.value })}
              className="!w-48" />
          </FieldRow>
          <FieldRow label="Ubicación" required>
            <Select value={draft.room_id}
              onChange={(e) => setDraft({ ...draft, room_id: e.target.value })}
              className="!w-64">
              <option value="">Seleccione una opción</option>
              {roomOptions(mesa?.room_id).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </Select>
          </FieldRow>
          <FieldRow label="Activa">
            <SiNo value={draft.is_active} onChange={(v) => setDraft({ ...draft, is_active: v })} />
          </FieldRow>
        </div>
        <p className="mt-2 text-xs font-medium text-accent-rose">* Campos obligatorios</p>

        {isEdit && (
          <Modal open={deleting} title="" onClose={() => setDeleting(false)}>
            <p className="mb-5 text-center text-sm text-text-secondary">
              ¿Realmente desea eliminar el registro?
            </p>
            <div className="flex justify-center gap-2">
              <Button onClick={() => remove(view.mesa)}>Aceptar</Button>
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
                <th className="w-20 px-4 py-3 font-medium"></th>
                <th className="px-4 py-3 font-medium">
                  <button onClick={() => setSortAsc((s) => !s)}
                    className="inline-flex items-center gap-1 hover:text-text-primary">
                    Número de mesa <ArrowUpDown size={12} />
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">Asientos</th>
                <th className="px-4 py-3 font-medium">Ubicación</th>
                <th className="px-4 py-3 font-medium">Activa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle/60">
              {pageRows.map((m) => (
                <tr key={m.id} className="transition hover:bg-bg-tertiary/40">
                  <td className="px-4 py-2">
                    <button onClick={() => startEdit(m)} aria-label="Editar este registro"
                      className="rounded-lg p-1.5 text-text-muted transition hover:bg-accent-blue/15 hover:text-accent-blue">
                      <Pencil size={15} />
                    </button>
                  </td>
                  <td className="px-4 py-2">{m.number}</td>
                  <td className="px-4 py-2">{m.seats}</td>
                  <td className="px-4 py-2">{roomName.get(m.room_id) ?? "—"}</td>
                  <td className="px-4 py-2">{m.is_active ? "Si" : "No"}</td>
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
  return { number: "", seats: "", room_id: "", is_active: true };
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

function SiNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <span className="flex items-center gap-3 text-sm">
      <label className="flex items-center gap-1">
        <input type="radio" checked={value} onChange={() => onChange(true)}
          className="h-3.5 w-3.5 accent-[hsl(199_89%_48%)]" />
        Si
      </label>
      <label className="flex items-center gap-1">
        <input type="radio" checked={!value} onChange={() => onChange(false)}
          className="h-3.5 w-3.5 accent-[hsl(199_89%_48%)]" />
        No
      </label>
    </span>
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
