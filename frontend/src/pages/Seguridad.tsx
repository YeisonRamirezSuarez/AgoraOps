/**
 * Seguridad — manual §1.13–1.16: usuarios (con sugerencia de nombres
 * duplicados y clave por defecto), grupos (roles dinámicos) y
 * grupos/usuarios (búsqueda por rol).
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { CrudPage } from "../components/CrudPage";
import { useTabParam } from "../lib/useTab";
import {
  Badge, Button, ConfirmDialog, Field, FormRow, Input, Modal, PageHeader, Select,
  Table, usePagination, useToast,
} from "../components/ui";

interface UserRow {
  id: string; username: string; email: string; full_name: string;
  phone: string | null; group_id: number; group_name: string | null;
  role_type: string | null; is_worker: boolean; is_locked: boolean; is_active: boolean;
}
interface Group { id: number; name: string; role_type: string }

const TABS = ["Usuarios", "Grupos", "Grupos / Usuarios"];

export default function Seguridad() {
  const [tab, setTab] = useTabParam(TABS);
  return (
    <div className="fade-in-up">
      <PageHeader title={tab} subtitle="Seguridad" />
      {tab === "Usuarios" && <UsersTab />}
      {tab === "Grupos" && (
        <CrudPage title="grupo" endpoint="/api/catalogs/groups"
          fields={[
            { name: "name", label: "Nombre", required: true, immutable: true },
            {
              name: "role_type", label: "Rol", type: "select", required: true,
              options: [
                { value: "administrador", label: "Administrador" },
                { value: "empleado", label: "Empleado" },
              ],
              render: (r) => (
                <Badge color={r.role_type === "administrador" ? "blue" : "gray"}>
                  {String(r.role_type)}
                </Badge>
              ),
            },
          ]} />
      )}
      {tab === "Grupos / Usuarios" && <GroupUsersTab />}
    </div>
  );
}

/* ───────── Usuarios (§1.13) ───────── */
function UsersTab() {
  const toast = useToast();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [editing, setEditing] = useState<Partial<UserRow> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [deleting, setDeleting] = useState<UserRow | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [created, setCreated] = useState<{ username: string; defaultPassword: string; workerReminder: string | null } | null>(null);

  const load = useCallback(() => {
    api<UserRow[]>("/api/users").then(setRows).catch(() => {});
    api<Group[]>("/api/catalogs/groups").then(setGroups).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    setSuggestions([]);
    try {
      if (isNew) {
        const r = await api<{ username: string; defaultPassword: string; workerReminder: string | null }>(
          "/api/users",
          {
            method: "POST",
            body: {
              username: editing.username, email: editing.email,
              fullName: editing.full_name, phone: editing.phone || undefined,
              groupId: Number(editing.group_id), isWorker: !!editing.is_worker,
            },
          },
        );
        setCreated(r);
      } else {
        await api(`/api/users/${editing.id}`, {
          method: "PUT",
          body: {
            email: editing.email, fullName: editing.full_name,
            phone: editing.phone || undefined, groupId: Number(editing.group_id),
            isWorker: !!editing.is_worker, isLocked: !!editing.is_locked,
            isActive: editing.is_active !== false,
          },
        });
        toast("success", "Usuario actualizado correctamente");
      }
      setEditing(null);
      load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // §1.13: nombre duplicado → sugerencias con botón Copiar
        const payload = err.payload as { suggestions?: string[] };
        setSuggestions(payload.suggestions ?? []);
        toast("error", err.message);
      } else {
        toast("error", err instanceof ApiError ? err.message : "Error al guardar");
      }
    }
  }

  async function remove() {
    if (!deleting) return;
    try {
      await api(`/api/users/${deleting.id}`, { method: "DELETE" });
      toast("success", "Usuario eliminado");
      load();
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "No se pudo eliminar");
    } finally {
      setDeleting(null);
    }
  }

  const { slice, bar } = usePagination(rows);

  // Registro tipo página (estilo Polaris), reemplaza al modal
  if (editing) {
    return (
      <form onSubmit={save} className="fade-in-up">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {isNew ? "Agregar nuevo usuario" : "Editar usuario"}
          </h2>
          <div className="flex gap-2">
            <Button type="submit">
              <Plus size={15} className="-mt-0.5 mr-1 inline" /> {isNew ? "Agregar" : "Guardar"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              <ArrowLeft size={15} className="-mt-0.5 mr-1 inline" /> Volver
            </Button>
          </div>
        </div>

        <div className="glass max-w-3xl space-y-4 rounded-2xl p-6">
          <FormRow label={`Usuario ${!isNew ? "(no editable)" : "(distingue mayúsculas)"}`} required>
            <Input required disabled={!isNew} autoCapitalize="none" spellCheck={false}
              value={editing.username ?? ""}
              onChange={(e) => setEditing({ ...editing, username: e.target.value })} />
          </FormRow>
          {/* Sugerencias de nombres disponibles (§1.13) */}
          {suggestions.length > 0 && (
            <div className="rounded-xl border border-accent-amber/40 bg-accent-amber/10 p-3 text-sm">
              <p className="mb-2 text-accent-amber">Nombres disponibles:</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button key={s} type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(s).catch(() => {});
                      setEditing({ ...editing, username: s });
                      toast("success", `"${s}" copiado y aplicado`);
                    }}
                    className="flex items-center gap-1 rounded-full bg-bg-tertiary px-3 py-1 text-xs hover:text-accent-blue">
                    <Copy size={11} /> {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          <FormRow label="Nombre completo" required>
            <Input required value={editing.full_name ?? ""}
              onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} />
          </FormRow>
          <FormRow label="Correo" required>
            <Input type="email" required value={editing.email ?? ""}
              onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
          </FormRow>
          <FormRow label="Teléfono">
            <Input value={editing.phone ?? ""}
              onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
          </FormRow>
          <FormRow label="Grupo (rol)" required>
            <Select required value={String(editing.group_id ?? "")}
              onChange={(e) => setEditing({ ...editing, group_id: Number(e.target.value) })}>
              <option value="">— Seleccione una opción —</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          </FormRow>
          <FormRow label="Es trabajador">
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input type="checkbox" checked={!!editing.is_worker}
                onChange={(e) => setEditing({ ...editing, is_worker: e.target.checked })}
                className="h-4 w-4 accent-[hsl(199_89%_48%)]" />
              Requiere horario asignado (§1.13)
            </label>
          </FormRow>
          {!isNew && (
            <FormRow label="Usuario bloqueado">
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <input type="checkbox" checked={!!editing.is_locked}
                  onChange={(e) => setEditing({ ...editing, is_locked: e.target.checked })}
                  className="h-4 w-4 accent-[hsl(347_77%_50%)]" />
                No podrá iniciar sesión
              </label>
            </FormRow>
          )}
        </div>
        <p className="mt-2 text-xs font-medium text-accent-rose">* Campos obligatorios</p>
      </form>
    );
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => {
          setEditing({ username: "", email: "", full_name: "", phone: "", is_worker: false });
          setIsNew(true); setSuggestions([]);
        }}>
          <Plus size={15} className="-mt-0.5 mr-1 inline" /> Agregar usuario
        </Button>
      </div>

      <Table headers={["Usuario", "Nombre", "Correo", "Grupo", "Trabajador", "Estado", "Acciones"]}
        empty={rows.length === 0}>
        {slice.map((u) => (
          <tr key={u.id}>
            <td className="px-4 py-2 font-mono text-xs">{u.username}</td>
            <td className="px-4 py-2">{u.full_name}</td>
            <td className="px-4 py-2">{u.email}</td>
            <td className="px-4 py-2">{u.group_name ?? "—"}</td>
            <td className="px-4 py-2">{u.is_worker ? "Sí" : "No"}</td>
            <td className="px-4 py-2">
              {u.is_locked
                ? <Badge color="rose">Bloqueado</Badge>
                : u.is_active ? <Badge color="emerald">Activo</Badge> : <Badge color="gray">Inactivo</Badge>}
            </td>
            <td className="px-4 py-2">
              <div className="flex gap-1">
                <button onClick={() => { setEditing({ ...u }); setIsNew(false); setSuggestions([]); }}
                  className="rounded-lg p-1.5 text-text-muted hover:bg-accent-blue/15 hover:text-accent-blue">
                  <Pencil size={15} />
                </button>
                <button onClick={() => setDeleting(u)}
                  className="rounded-lg p-1.5 text-text-muted hover:bg-accent-rose/15 hover:text-accent-rose">
                  <Trash2 size={15} />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </Table>

      {bar}

      {/* Usuario creado: mostrar clave por defecto (concepto PHP) */}
      <Modal open={!!created} title="Usuario creado correctamente" onClose={() => setCreated(null)}>
        {created && (
          <div className="space-y-3 text-sm">
            <p>
              Usuario <span className="font-mono font-bold">{created.username}</span> creado con la
              contraseña temporal{" "}
              <span className="rounded bg-bg-tertiary px-2 py-0.5 font-mono font-bold text-accent-amber">
                {created.defaultPassword}
              </span>
            </p>
            <p className="text-text-secondary">Deberá cambiarla en su primer inicio de sesión.</p>
            {created.workerReminder && (
              <p className="rounded-xl border border-accent-amber/40 bg-accent-amber/10 p-3 text-accent-amber">
                {created.workerReminder}
              </p>
            )}
            <div className="flex justify-end">
              <Button onClick={() => setCreated(null)}>Entendido</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleting} title="Eliminar usuario"
        message={`¿Desea eliminar al usuario "${deleting?.full_name}"?`}
        confirmLabel="Eliminar" onConfirm={remove} onCancel={() => setDeleting(null)} />
    </>
  );
}

/* ───────── Grupos / Usuarios (§1.15) ───────── */
function GroupUsersTab() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState("");
  const [users, setUsers] = useState<{ id: string; username: string; full_name: string; email: string }[]>([]);

  useEffect(() => {
    api<Group[]>("/api/catalogs/groups").then(setGroups).catch(() => {});
  }, []);

  async function search() {
    if (!groupId) return;
    setUsers(await api(`/api/users/by-group/${groupId}`));
  }

  return (
    <div className="max-w-xl">
      <div className="mb-4 flex items-end gap-2">
        <Field label="Grupo">
          <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">— Seleccione —</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        </Field>
        <Button onClick={search}>Buscar</Button>
      </div>
      <Table headers={["Usuario", "Nombre", "Correo"]} empty={users.length === 0}>
        {users.map((u) => (
          <tr key={u.id}>
            <td className="px-4 py-2 font-mono text-xs">{u.username}</td>
            <td className="px-4 py-2">{u.full_name}</td>
            <td className="px-4 py-2">{u.email}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
