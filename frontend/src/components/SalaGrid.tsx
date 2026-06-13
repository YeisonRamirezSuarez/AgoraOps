/**
 * Sala del restaurante (Configuración §1.7.1) — réplica EXACTA del módulo
 * de Polaris Food (form_tb_restaurant_room).
 *
 * Comportamiento idéntico a Polaris:
 *  - Grilla 100% editable: TODAS las filas muestran siempre su input de
 *    descripción y sus radios Sí/No, cada una con su propio botón Guardar
 *    (y Eliminar). El guardado es por fila.
 *  - "Nuevo" agrega una fila vacía al final con Activo = No por defecto y
 *    botones Guardar / Cancelar.
 *  - La sala de sistema DOMICILIO está protegida: descripción bloqueada,
 *    sin Eliminar; solo se puede activar/desactivar.
 *  - Validación vacío → modal "Descripción de la habitación: Campo obligatorio".
 *  - Eliminar → modal "¿Realmente desea eliminar el registro?".
 *  - Guardado inline silencioso (sin toast de éxito).
 *  - Búsqueda Rápida + paginación (Ver 10/20/50 · [x a y de z]).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Inbox, Plus, Save, Search, Trash2, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Button, Input, Modal, Select, useToast } from "./ui";

interface Room {
  id: number;
  name: string;
  is_active: boolean;
  is_system: boolean;
}

interface NewRow {
  key: number;
  name: string;
  is_active: boolean;
}

const ENDPOINT = "/api/catalogs/rooms";
const PAGE_SIZES = [10, 20, 50];

export function SalaGrid() {
  const toast = useToast();
  const [rows, setRows] = useState<Room[]>([]);
  // Valores editables por fila existente (Polaris mantiene toda fila editable).
  const [draft, setDraft] = useState<Record<number, { name: string; is_active: boolean }>>({});
  const [news, setNews] = useState<NewRow[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [deleting, setDeleting] = useState<Room | null>(null);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Room[]>(ENDPOINT)
      .then((data) => {
        setRows(data);
        setDraft(
          Object.fromEntries(data.map((r) => [r.id, { name: r.name, is_active: r.is_active }])),
        );
      })
      .catch((e) => toast("error", e instanceof ApiError ? e.message : "Error al cargar"));
  }, [toast]);

  useEffect(load, [load]);

  // Búsqueda Rápida (§1.4): coincidencia por descripción.
  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const fromN = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const toN = Math.min(safePage * pageSize, filtered.length);

  function setRowName(id: number, name: string) {
    setDraft((d) => ({ ...d, [id]: { ...d[id], name } }));
  }
  function setRowActive(id: number, is_active: boolean) {
    setDraft((d) => ({ ...d, [id]: { ...d[id], is_active } }));
  }

  async function saveRow(r: Room) {
    const d = draft[r.id];
    if (!r.is_system && !d.name.trim()) {
      setAlertMsg("Descripción de la habitación: Campo obligatorio");
      return;
    }
    // La sala de sistema solo cambia su estado (descripción inmutable).
    const body = r.is_system
      ? { is_active: d.is_active }
      : { name: d.name.trim(), is_active: d.is_active };
    try {
      await api(`${ENDPOINT}/${r.id}`, { method: "PUT", body });
      load();
    } catch (e) {
      setAlertMsg(e instanceof ApiError ? e.message : "Error al guardar");
    }
  }

  function addNew() {
    setNews((n) => [...n, { key: Date.now() + Math.random(), name: "", is_active: false }]);
  }
  function setNewName(key: number, name: string) {
    setNews((n) => n.map((x) => (x.key === key ? { ...x, name } : x)));
  }
  function setNewActive(key: number, is_active: boolean) {
    setNews((n) => n.map((x) => (x.key === key ? { ...x, is_active } : x)));
  }
  function cancelNew(key: number) {
    setNews((n) => n.filter((x) => x.key !== key));
  }

  async function saveNew(row: NewRow) {
    if (!row.name.trim()) {
      setAlertMsg("Descripción de la habitación: Campo obligatorio");
      return;
    }
    try {
      await api(ENDPOINT, { method: "POST", body: { name: row.name.trim(), is_active: row.is_active } });
      setNews((n) => n.filter((x) => x.key !== row.key));
      load();
    } catch (e) {
      setAlertMsg(e instanceof ApiError ? e.message : "Error al guardar");
    }
  }

  async function remove() {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    try {
      await api(`${ENDPOINT}/${target.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setAlertMsg(e instanceof ApiError ? e.message : "No se pudo eliminar");
    }
  }

  const hasRows = filtered.length > 0 || news.length > 0;

  return (
    <div className="fade-in-up">
      {/* Búsqueda Rápida + Nuevo (layout Polaris) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input placeholder="Búsqueda Rápida" value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="!w-64 !pl-9" />
        </div>
        <Button onClick={addNew}>
          <Plus size={15} className="-mt-0.5 mr-1 inline" /> Nuevo
        </Button>
      </div>

      {!hasRows ? (
        <div className="glass grid place-items-center rounded-2xl py-14 text-text-muted">
          <Inbox size={32} className="mb-2 opacity-60" />
          <p className="text-sm">No hay registros para mostrar</p>
        </div>
      ) : (
        <div className="glass overflow-x-auto rounded-2xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-medium bg-bg-tertiary/60 text-left text-xs uppercase tracking-wide text-text-secondary">
                <th className="w-24 px-4 py-3 font-medium"></th>
                <th className="px-4 py-3 font-medium">
                  Descripción de la habitación<span className="text-accent-rose"> *</span>
                </th>
                <th className="w-40 px-4 py-3 font-medium">Activo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle/60">
              {pageRows.map((r) => {
                const d = draft[r.id] ?? { name: r.name, is_active: r.is_active };
                return (
                  <tr key={r.id} className="transition hover:bg-bg-tertiary/40">
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        {!r.is_system && (
                          <button onClick={() => setDeleting(r)} aria-label="Eliminar registro"
                            className="rounded-lg p-1.5 text-text-muted transition hover:bg-accent-rose/15 hover:text-accent-rose">
                            <Trash2 size={15} />
                          </button>
                        )}
                        <button onClick={() => saveRow(r)} aria-label="Guardar registro"
                          className="rounded-lg p-1.5 text-text-muted transition hover:bg-accent-blue/15 hover:text-accent-blue">
                          <Save size={15} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <Input value={d.name} disabled={r.is_system}
                        onChange={(e) => setRowName(r.id, e.target.value)}
                        className={`!w-full !py-1.5 ${r.is_system ? "opacity-60" : ""}`} />
                    </td>
                    <td className="px-4 py-2">
                      <SiNo value={d.is_active} onChange={(v) => setRowActive(r.id, v)} />
                    </td>
                  </tr>
                );
              })}

              {/* Filas nuevas (Polaris las agrega al final con Activo = No) */}
              {news.map((n) => (
                <tr key={n.key} className="bg-accent-blue/5">
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      <button onClick={() => saveNew(n)} aria-label="Guardar registro"
                        className="rounded-lg p-1.5 text-accent-emerald transition hover:bg-accent-emerald/15">
                        <Check size={16} />
                      </button>
                      <button onClick={() => cancelNew(n.key)} aria-label="Cancelar"
                        className="rounded-lg p-1.5 text-text-muted transition hover:bg-accent-rose/15 hover:text-accent-rose">
                        <X size={16} />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <Input value={n.name} autoFocus
                      onChange={(e) => setNewName(n.key, e.target.value)}
                      className="!w-full !py-1.5" />
                  </td>
                  <td className="px-4 py-2">
                    <SiNo value={n.is_active} onChange={(v) => setNewActive(n.key, v)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginación estilo Polaris: Ver N ▾ · « ‹ › » · [x a y de z] */}
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

      {/* Confirmación de borrado (texto idéntico a Polaris) */}
      <Modal open={!!deleting} title="" onClose={() => setDeleting(null)}>
        <p className="mb-5 text-center text-sm text-text-secondary">
          ¿Realmente desea eliminar el registro?
        </p>
        <div className="flex justify-center gap-2">
          <Button onClick={remove}>Aceptar</Button>
          <Button variant="ghost" onClick={() => setDeleting(null)}>Cancelar</Button>
        </div>
      </Modal>

      {/* Alerta de validación/error (un solo botón Aceptar, como Polaris) */}
      <Modal open={!!alertMsg} title="" onClose={() => setAlertMsg(null)}>
        <p className="mb-5 text-center text-sm text-text-secondary">{alertMsg}</p>
        <div className="flex justify-center">
          <Button onClick={() => setAlertMsg(null)}>Aceptar</Button>
        </div>
      </Modal>
    </div>
  );
}

/** Radios Sí / No como en Polaris (columna Activo). */
function SiNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <span className="flex items-center gap-3 text-sm">
      <label className="flex items-center gap-1">
        <input type="radio" checked={value}
          onChange={() => onChange(true)}
          className="h-3.5 w-3.5 accent-[hsl(199_89%_48%)]" />
        Sí
      </label>
      <label className="flex items-center gap-1">
        <input type="radio" checked={!value}
          onChange={() => onChange(false)}
          className="h-3.5 w-3.5 accent-[hsl(199_89%_48%)]" />
        No
      </label>
    </span>
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
