/**
 * Establecimientos (Super Admin): listado con búsqueda, estado, consumo
 * rápido (usuarios, última conexión, última orden) y acciones de
 * habilitar/inhabilitar. La creación y el detalle viven en sus rutas.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Settings2 } from "lucide-react";
import { api } from "../../lib/api";
import {
  Badge, Button, ConfirmDialog, Input, Loader, PageHeader, Table,
  fmtDateTime, usePagination, useToast,
} from "../../components/ui";

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  country: string;
  timezone: string;
  is_active: boolean;
  created_at: string;
  business_name: string | null;
  logo_url: string | null;
  theme_palette: string | null;
  users_count: number;
  last_login_at: string | null;
  last_order_at: string | null;
}

export default function Establecimientos() {
  const toast = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [toToggle, setToToggle] = useState<TenantRow | null>(null);

  const load = useCallback(() => {
    api<TenantRow[]>("/api/superadmin/tenants")
      .then(setRows)
      .catch((e) => toast("error", e.message))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(load, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const { slice, bar } = usePagination(filtered);

  async function toggleStatus(t: TenantRow) {
    try {
      await api(`/api/superadmin/tenants/${t.id}/status`, {
        method: "PATCH",
        body: { isActive: !t.is_active },
      });
      toast("success", t.is_active
        ? `${t.name} fue inhabilitado: sus usuarios ya no pueden ingresar.`
        : `${t.name} fue habilitado nuevamente.`);
      load();
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setToToggle(null);
    }
  }

  return (
    <div className="fade-in-up">
      <PageHeader
        title="Establecimientos"
        subtitle="Crear, configurar, habilitar o inhabilitar los comercios de la plataforma"
        actions={
          <Button onClick={() => navigate("/superadmin/establecimientos/nuevo")}>
            <span className="flex items-center gap-2">
              <Plus size={16} /> Crear establecimiento
            </span>
          </Button>
        }
      />

      <div className="relative mb-4 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o slug…" className="!pl-9" />
      </div>

      {loading ? (
        <Loader label="Cargando establecimientos" />
      ) : (
        <>
          <Table
            empty={filtered.length === 0}
            headers={[
              "Establecimiento", "Slug", "País", "Usuarios",
              "Última conexión", "Última orden", "Estado", "Acciones",
            ]}>
            {slice.map((t) => (
              <tr key={t.id} className="transition hover:bg-bg-tertiary/40">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {t.logo_url ? (
                      <img src={t.logo_url} alt=""
                        className="h-9 w-9 rounded-lg border border-border-subtle bg-white object-contain" />
                    ) : (
                      <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-blue/12 text-sm font-bold text-accent-blue">
                        {t.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div>
                      <p className="font-semibold">{t.name}</p>
                      <p className="text-xs text-text-muted">
                        creado {fmtDateTime(t.created_at)}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{t.slug}</td>
                <td className="px-4 py-3">{t.country === "EC" ? "Ecuador" : "Colombia"}</td>
                <td className="px-4 py-3">{t.users_count}</td>
                <td className="px-4 py-3 text-xs">{fmtDateTime(t.last_login_at, "nunca")}</td>
                <td className="px-4 py-3 text-xs">{fmtDateTime(t.last_order_at, "nunca")}</td>
                <td className="px-4 py-3">
                  {t.is_active
                    ? <Badge color="emerald">Activo</Badge>
                    : <Badge color="rose">Inactivo</Badge>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost"
                      onClick={() => navigate(`/superadmin/establecimientos/${t.id}`)}>
                      <span className="flex items-center gap-1.5">
                        <Settings2 size={14} /> Gestionar
                      </span>
                    </Button>
                    <Button size="sm" variant={t.is_active ? "danger" : "success"}
                      onClick={() => setToToggle(t)}>
                      {t.is_active ? "Inhabilitar" : "Habilitar"}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
          {bar}
        </>
      )}

      <ConfirmDialog
        open={toToggle !== null}
        title={toToggle?.is_active ? "Inhabilitar establecimiento" : "Habilitar establecimiento"}
        message={
          toToggle?.is_active
            ? `Al inhabilitar "${toToggle?.name}", ningún usuario del establecimiento podrá iniciar sesión hasta que lo habilites de nuevo. ¿Continuar?`
            : `"${toToggle?.name}" volverá a estar operativo y sus usuarios podrán ingresar. ¿Continuar?`
        }
        confirmLabel={toToggle?.is_active ? "Inhabilitar" : "Habilitar"}
        onConfirm={() => toToggle && toggleStatus(toToggle)}
        onCancel={() => setToToggle(null)}
      />
    </div>
  );
}
