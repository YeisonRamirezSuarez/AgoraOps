/**
 * Crear establecimiento (Super Admin): formulario con datos del negocio,
 * personalización (logo + paleta de colores previsualizable), provisión
 * inicial (sala/mesas/caja) y administrador del establecimiento. Al crear
 * se muestran las credenciales temporales del administrador (una sola vez).
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardCopy } from "lucide-react";
import { api } from "../../lib/api";
import {
  Button, FormRow, Input, Modal, PageHeader, useToast,
} from "../../components/ui";
import {
  EMPTY_CONFIG, SectionTitle, TenantFields, type TenantConfig,
} from "./TenantConfigFields";

interface CreatedCredentials {
  username: string;
  email: string;
  tempPassword: string;
}

export default function EstablecimientoNuevo() {
  const toast = useToast();
  const navigate = useNavigate();
  const [config, setConfig] = useState<TenantConfig>(EMPTY_CONFIG);
  const [roomName, setRoomName] = useState("Sala Principal");
  const [tablesCount, setTablesCount] = useState(5);
  const [cashRegisterName, setCashRegisterName] = useState("Caja Principal");
  const [admin, setAdmin] = useState({
    fullName: "", email: "", phone: "",
  });
  const [saving, setSaving] = useState(false);
  const [credentials, setCredentials] = useState<CreatedCredentials | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api<{ adminCredentials: CreatedCredentials }>(
        "/api/superadmin/tenants",
        {
          method: "POST",
          body: {
            name: config.name,
            slug: config.slug,
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
            roomName,
            tablesCount,
            cashRegisterName,
            admin: {
              fullName: admin.fullName,
              email: admin.email,
              phone: admin.phone || null,
            },
          },
        },
      );
      setCredentials(res.adminCredentials);
    } catch (err) {
      toast("error", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text)
      .then(() => toast("success", "Copiado al portapapeles"));
  }

  return (
    <div className="fade-in-up mx-auto max-w-3xl">
      <PageHeader
        title="Crear establecimiento"
        subtitle="Queda provisionado y listo para operar: grupos, administrador, métodos de pago, sala, mesas y caja"
      />

      <form onSubmit={handleSubmit} className="glass space-y-3 rounded-2xl p-6">
        <TenantFields value={config} onChange={setConfig} />

        <SectionTitle>Provisión inicial</SectionTitle>
        <div className="space-y-3">
          <FormRow label="Nombre de la sala" required>
            <Input value={roomName} required
              onChange={(e) => setRoomName(e.target.value)} />
          </FormRow>
          <FormRow label="Mesas iniciales" required>
            <Input type="number" min={0} max={200} value={tablesCount} required
              onChange={(e) => setTablesCount(Number(e.target.value))} />
          </FormRow>
          <FormRow label="Nombre de la caja" required>
            <Input value={cashRegisterName} required
              onChange={(e) => setCashRegisterName(e.target.value)} />
          </FormRow>
        </div>

        <SectionTitle>Administrador del establecimiento</SectionTitle>
        <p className="-mt-1 mb-1 text-xs text-text-muted">
          El usuario y la contraseña temporal se generan automáticamente y se
          envían por correo al administrador con el paso a paso de configuración.
        </p>
        <div className="space-y-3">
          <FormRow label="Nombre completo" required>
            <Input value={admin.fullName} required
              onChange={(e) => setAdmin({ ...admin, fullName: e.target.value })} />
          </FormRow>
          <FormRow label="Correo" required>
            <Input type="email" value={admin.email} required
              onChange={(e) => setAdmin({ ...admin, email: e.target.value })} />
          </FormRow>
          <FormRow label="Teléfono">
            <Input value={admin.phone}
              onChange={(e) => setAdmin({ ...admin, phone: e.target.value })} />
          </FormRow>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="ghost"
            onClick={() => navigate("/superadmin/establecimientos")}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Creando…" : "Crear establecimiento"}
          </Button>
        </div>
      </form>

      {/* Credenciales temporales: se muestran una sola vez */}
      <Modal
        open={credentials !== null}
        title="Establecimiento creado"
        onClose={() => navigate("/superadmin/establecimientos")}
      >
        <p className="mb-4 text-sm text-text-secondary">
          Se enviaron al correo del administrador junto con el paso a paso de
          configuración. La contraseña es temporal y el sistema le pedirá
          cambiarla en su primer ingreso. <strong>No se volverá a mostrar aquí.</strong>
        </p>
        <div className="space-y-2">
          {credentials && (
            [
              ["Usuario", credentials.username],
              ["Correo", credentials.email],
              ["Contraseña temporal", credentials.tempPassword],
            ] as const
          ).map(([label, value]) => (
            <div key={label}
              className="flex items-center justify-between rounded-lg bg-bg-tertiary px-3 py-2.5">
              <div>
                <p className="text-xs text-text-muted">{label}</p>
                <p className="font-mono text-sm font-semibold">{value}</p>
              </div>
              <button type="button" onClick={() => copy(value)}
                aria-label={`Copiar ${label}`}
                className="rounded-lg p-2 text-text-muted transition hover:bg-bg-secondary hover:text-text-primary">
                <ClipboardCopy size={16} />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={() => navigate("/superadmin/establecimientos")}>
            Ir al listado
          </Button>
        </div>
      </Modal>
    </div>
  );
}
