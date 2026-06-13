/**
 * Detalle de establecimiento (Super Admin), en pestañas:
 *  - Consumo: actividad de negocio del rango, últimas conexiones y
 *    almacenamiento ocupado en la base de datos (registros y tamaño).
 *  - Configuración: mismos campos de la creación (datos, logo, paleta).
 *  - Usuarios: listado con último acceso y restablecimiento de clave.
 * Incluye habilitar/inhabilitar desde la cabecera.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ClipboardCopy, KeyRound } from "lucide-react";
import { api } from "../../lib/api";
import {
  Badge, Button, ConfirmDialog, Loader, Modal, PageHeader, Table, Tabs,
  cop, fmtDateTime, useToast,
} from "../../components/ui";
import { EMPTY_CONFIG, TenantFields, type TenantConfig } from "./TenantConfigFields";

interface TenantUser {
  id: string;
  username: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_locked: boolean;
  last_login_at: string | null;
  group_name: string | null;
  role_type: string | null;
}

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  country: "CO" | "EC";
  timezone: string;
  is_active: boolean;
  created_at: string;
  business_name: string | null;
  phone: string | null;
  tax_id: string | null;
  address: string | null;
  logo_url: string | null;
  facebook: string | null;
  instagram: string | null;
  theme_palette: string | null;
  currency_code: string | null;
  currency_symbol: string | null;
  currency_decimals: number | null;
  users: TenantUser[];
}

interface Usage {
  days: number;
  activity: {
    orders: number; sales: number; cancelled: number; payments: number;
    reservations: number; clients: number; products: number;
    activeUsers: number; lastOrderAt: string | null; lastLoginAt: string | null;
  };
  series: { day: string; orders: number; sales: number }[];
  storage: {
    tables: { table: string; rows: number; bytes: number }[];
    totalRows: number;
    totalBytes: number;
  };
}

const TABS = ["Consumo", "Configuración", "Usuarios"];

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass rounded-xl p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
      {hint && <p className="text-xs text-text-secondary">{hint}</p>}
    </div>
  );
}

export default function EstablecimientoDetalle() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const navigate = useNavigate();

  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState(TABS[0]);
  const [config, setConfig] = useState<TenantConfig>(EMPTY_CONFIG);
  const [saving, setSaving] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(false);
  const [resetUser, setResetUser] = useState<TenantUser | null>(null);
  const [newPassword, setNewPassword] = useState<string | null>(null);

  const load = useCallback(() => {
    api<TenantDetail>(`/api/superadmin/tenants/${id}`)
      .then((t) => {
        setTenant(t);
        setConfig({
          name: t.business_name ?? t.name,
          slug: t.slug,
          country: t.country,
          timezone: t.timezone ?? "America/Bogota",
          phone: t.phone ?? "",
          taxId: t.tax_id ?? "",
          address: t.address ?? "",
          logoUrl: t.logo_url ?? "",
          facebook: t.facebook ?? "",
          instagram: t.instagram ?? "",
          themePalette: t.theme_palette ?? "celeste",
          currencyCode: t.currency_code ?? "COP",
          currencySymbol: t.currency_symbol ?? "$",
          currencyDecimals: (t.currency_decimals === 2 ? 2 : 0),
        });
      })
      .catch((e) => toast("error", e.message));
  }, [id, toast]);

  useEffect(load, [load]);

  useEffect(() => {
    api<Usage>(`/api/superadmin/tenants/${id}/usage?days=${days}`)
      .then(setUsage)
      .catch((e) => toast("error", e.message));
  }, [id, days, toast]);

  if (!tenant) {
    return <Loader label="Cargando establecimiento" />;
  }

  async function toggleStatus() {
    if (!tenant) return;
    try {
      await api(`/api/superadmin/tenants/${tenant.id}/status`, {
        method: "PATCH",
        body: { isActive: !tenant.is_active },
      });
      toast("success", tenant.is_active
        ? "Establecimiento inhabilitado: sus usuarios no podrán ingresar."
        : "Establecimiento habilitado nuevamente.");
      load();
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setConfirmToggle(false);
    }
  }

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api(`/api/superadmin/tenants/${tenant!.id}`, {
        method: "PUT",
        body: {
          name: config.name,
          country: config.country,
          timezone: config.timezone,
          phone: config.phone || null,
          taxId: config.taxId || null,
          address: config.address || null,
          logoUrl: config.logoUrl || null,
          facebook: config.facebook || null,
          instagram: config.instagram || null,
          themePalette: config.themePalette,
          currencyCode: config.currencyCode,
          currencySymbol: config.currencySymbol,
          currencyDecimals: config.currencyDecimals,
        },
      });
      toast("success", "Configuración guardada.");
      load();
    } catch (err) {
      toast("error", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword() {
    if (!resetUser) return;
    try {
      const res = await api<{ tempPassword: string }>(
        `/api/superadmin/tenants/${tenant!.id}/users/${resetUser.id}/reset-password`,
        { method: "POST" },
      );
      setNewPassword(res.tempPassword);
    } catch (e) {
      toast("error", (e as Error).message);
      setResetUser(null);
    }
  }

  const maxSeries = usage ? Math.max(1, ...usage.series.map((s) => s.orders)) : 1;

  return (
    <div className="fade-in-up">
      <button onClick={() => navigate("/superadmin/establecimientos")}
        className="mb-3 flex items-center gap-1.5 text-sm text-accent-blue hover:underline">
        <ArrowLeft size={15} /> Volver al listado
      </button>

      <PageHeader
        title={tenant.name}
        subtitle={`${tenant.slug} · ${tenant.country === "EC" ? "Ecuador" : "Colombia"} · creado ${fmtDateTime(tenant.created_at)}`}
        actions={
          <div className="flex items-center gap-3">
            {tenant.is_active
              ? <Badge color="emerald">Activo</Badge>
              : <Badge color="rose">Inactivo</Badge>}
            <Button variant={tenant.is_active ? "danger" : "success"}
              onClick={() => setConfirmToggle(true)}>
              {tenant.is_active ? "Inhabilitar" : "Habilitar"}
            </Button>
          </div>
        }
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {/* ───────────── Consumo ───────────── */}
      {tab === "Consumo" && (
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-secondary">Rango:</span>
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setDays(d)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  days === d
                    ? "bg-accent-blue text-white"
                    : "border border-border-subtle text-text-secondary hover:bg-bg-tertiary"
                }`}>
                {d} días
              </button>
            ))}
          </div>

          {!usage ? (
            <Loader label="Calculando consumo" />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label={`Órdenes (${days}d)`} value={String(usage.activity.orders)}
                  hint={`${usage.activity.cancelled} canceladas`} />
                <Stat label={`Ventas (${days}d)`} value={cop.format(usage.activity.sales)} />
                <Stat label={`Pagos (${days}d)`} value={String(usage.activity.payments)} />
                <Stat label="Usuarios activos" value={String(usage.activity.activeUsers)} />
                <Stat label="Clientes" value={String(usage.activity.clients)} />
                <Stat label="Productos" value={String(usage.activity.products)} />
                <Stat label="Reservaciones" value={String(usage.activity.reservations)} />
                <Stat label="Última conexión"
                  value={fmtDateTime(usage.activity.lastLoginAt, "nunca")}
                  hint={`última orden ${fmtDateTime(usage.activity.lastOrderAt, "nunca")}`} />
              </div>

              <section className="glass rounded-2xl p-5">
                <h2 className="mb-3 text-base font-bold">Órdenes por día</h2>
                {usage.series.length === 0 ? (
                  <p className="py-6 text-center text-sm text-text-muted">
                    Sin órdenes en el rango.
                  </p>
                ) : (
                  <div className="flex h-36 items-end gap-[3px]">
                    {usage.series.map((s) => (
                      <div key={s.day} className="flex-1"
                        title={`${s.day}: ${s.orders} órdenes · ${cop.format(s.sales)}`}>
                        <div className="grow-bar-v w-full rounded-t bg-gradient-to-t from-accent-blue to-accent-cyan/70"
                          style={{ height: `${(s.orders / maxSeries) * 132}px`, minHeight: s.orders > 0 ? 4 : 1 }} />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="glass rounded-2xl p-5">
                <h2 className="mb-1 text-base font-bold">Almacenamiento en base de datos</h2>
                <p className="mb-4 text-sm text-text-secondary">
                  {usage.storage.totalRows.toLocaleString("es-CO")} registros ·
                  {" "}{fmtBytes(usage.storage.totalBytes)} ocupados (estimado por fila)
                </p>
                <Table empty={usage.storage.tables.length === 0}
                  headers={["Tabla", "Registros", "Tamaño", "% del total"]}>
                  {usage.storage.tables.map((t) => (
                    <tr key={t.table}>
                      <td className="px-4 py-2.5 font-mono text-xs">{t.table}</td>
                      <td className="px-4 py-2.5">{t.rows.toLocaleString("es-CO")}</td>
                      <td className="px-4 py-2.5">{fmtBytes(t.bytes)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-bg-tertiary">
                            <div className="h-full rounded-full bg-accent-blue"
                              style={{ width: `${usage.storage.totalBytes > 0 ? (t.bytes / usage.storage.totalBytes) * 100 : 0}%` }} />
                          </div>
                          <span className="text-xs text-text-muted">
                            {usage.storage.totalBytes > 0
                              ? ((t.bytes / usage.storage.totalBytes) * 100).toFixed(1)
                              : "0"}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </Table>
              </section>
            </>
          )}
        </div>
      )}

      {/* ───────────── Configuración ───────────── */}
      {tab === "Configuración" && (
        <form onSubmit={saveConfig} className="glass mx-auto max-w-3xl space-y-3 rounded-2xl p-6">
          <TenantFields value={config} onChange={setConfig} slugLocked />
          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={saving}>
              {saving ? "Guardando…" : "Guardar configuración"}
            </Button>
          </div>
        </form>
      )}

      {/* ───────────── Usuarios ───────────── */}
      {tab === "Usuarios" && (
        <Table empty={tenant.users.length === 0}
          headers={["Usuario", "Nombre", "Grupo", "Último acceso", "Estado", "Acciones"]}>
          {tenant.users.map((u) => (
            <tr key={u.id}>
              <td className="px-4 py-3">
                <p className="font-semibold">{u.username}</p>
                <p className="text-xs text-text-muted">{u.email}</p>
              </td>
              <td className="px-4 py-3">{u.full_name}</td>
              <td className="px-4 py-3">{u.group_name ?? "—"}</td>
              <td className="px-4 py-3 text-xs">{fmtDateTime(u.last_login_at, "nunca")}</td>
              <td className="px-4 py-3">
                {!u.is_active ? <Badge color="gray">Inactivo</Badge>
                  : u.is_locked ? <Badge color="amber">Bloqueado</Badge>
                  : <Badge color="emerald">Activo</Badge>}
              </td>
              <td className="px-4 py-3">
                <Button size="sm" variant="ghost" onClick={() => setResetUser(u)}>
                  <span className="flex items-center gap-1.5">
                    <KeyRound size={14} /> Restablecer clave
                  </span>
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <ConfirmDialog
        open={confirmToggle}
        title={tenant.is_active ? "Inhabilitar establecimiento" : "Habilitar establecimiento"}
        message={
          tenant.is_active
            ? `Ningún usuario de "${tenant.name}" podrá iniciar sesión hasta habilitarlo de nuevo. ¿Continuar?`
            : `"${tenant.name}" volverá a estar operativo. ¿Continuar?`
        }
        confirmLabel={tenant.is_active ? "Inhabilitar" : "Habilitar"}
        onConfirm={toggleStatus}
        onCancel={() => setConfirmToggle(false)}
      />

      <ConfirmDialog
        open={resetUser !== null && newPassword === null}
        title="Restablecer contraseña"
        message={`Se generará una contraseña temporal para "${resetUser?.username}" y deberá cambiarla en su próximo ingreso. ¿Continuar?`}
        confirmLabel="Restablecer"
        onConfirm={resetPassword}
        onCancel={() => setResetUser(null)}
      />

      <Modal
        open={newPassword !== null}
        title="Contraseña temporal generada"
        onClose={() => { setNewPassword(null); setResetUser(null); }}
      >
        <p className="mb-4 text-sm text-text-secondary">
          Entrega esta contraseña a <strong>{resetUser?.username}</strong>.
          No se volverá a mostrar.
        </p>
        <div className="flex items-center justify-between rounded-lg bg-bg-tertiary px-3 py-2.5">
          <p className="font-mono text-sm font-semibold">{newPassword}</p>
          <button type="button"
            onClick={() => newPassword && navigator.clipboard.writeText(newPassword)
              .then(() => toast("success", "Copiada al portapapeles"))}
            aria-label="Copiar contraseña"
            className="rounded-lg p-2 text-text-muted transition hover:bg-bg-secondary hover:text-text-primary">
            <ClipboardCopy size={16} />
          </button>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={() => { setNewPassword(null); setResetUser(null); }}>
            Entendido
          </Button>
        </div>
      </Modal>
    </div>
  );
}
