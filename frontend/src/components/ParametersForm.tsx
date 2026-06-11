/**
 * Configuración de parámetros — manual §1.8.1 (vive bajo Gestión de
 * Cajas como en Polaris Food): datos del negocio, propina (CO/EC),
 * % de servicio (EC) y sobregiro de inventario.
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { Button, Field, Input, useToast } from "./ui";

export function ParametersForm() {
  const toast = useToast();
  const [s, setS] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Record<string, unknown>>("/api/settings").then(setS).catch(() => {});
  }, []);

  if (!s) return <p className="text-text-muted">Cargando…</p>;
  const isEC = s.country === "EC";

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/api/settings", {
        method: "PUT",
        body: {
          business_name: s!.business_name, phone: s!.phone, tax_id: s!.tax_id,
          address: s!.address, facebook: s!.facebook, instagram: s!.instagram,
          tip_enabled: !!s!.tip_enabled, tip_percentage: Number(s!.tip_percentage ?? 0),
          service_enabled: !!s!.service_enabled,
          service_percentage: Number(s!.service_percentage ?? 0),
          allow_overdraft: !!s!.allow_overdraft,
        },
      });
      toast("success", "Parámetros guardados correctamente");
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  const set = (k: string, v: unknown) => setS({ ...s, [k]: v });

  return (
    <form onSubmit={save} className="max-w-xl space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre del negocio">
          <Input value={String(s.business_name ?? "")} onChange={(e) => set("business_name", e.target.value)} required />
        </Field>
        <Field label="Teléfono">
          <Input value={String(s.phone ?? "")} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label={isEC ? "RUC" : "NIT"}>
          <Input value={String(s.tax_id ?? "")} onChange={(e) => set("tax_id", e.target.value)} />
        </Field>
        <Field label="Dirección">
          <Input value={String(s.address ?? "")} onChange={(e) => set("address", e.target.value)} />
        </Field>
      </div>

      <div className="glass space-y-3 rounded-2xl p-4">
        <label className="flex items-center justify-between text-sm">
          <span>Propina habilitada</span>
          <input type="checkbox" checked={!!s.tip_enabled}
            onChange={(e) => set("tip_enabled", e.target.checked)}
            className="h-4 w-4 accent-[hsl(217_91%_60%)]" />
        </label>
        {!!s.tip_enabled && (
          <Field label="Porcentaje de propina (%)">
            <Input type="number" min={0} max={100} value={String(s.tip_percentage ?? 0)}
              onChange={(e) => set("tip_percentage", e.target.value)} />
          </Field>
        )}
        {isEC && (
          <>
            <label className="flex items-center justify-between text-sm">
              <span>% de servicio (Ecuador)</span>
              <input type="checkbox" checked={!!s.service_enabled}
                onChange={(e) => set("service_enabled", e.target.checked)}
                className="h-4 w-4 accent-[hsl(217_91%_60%)]" />
            </label>
            {!!s.service_enabled && (
              <Field label="Porcentaje de servicio (%)">
                <Input type="number" min={0} max={100} value={String(s.service_percentage ?? 0)}
                  onChange={(e) => set("service_percentage", e.target.value)} />
              </Field>
            )}
          </>
        )}
        <label className="flex items-center justify-between text-sm">
          <span>
            Permitir sobregiro del inventario
            <span className="block text-xs text-text-muted">
              Permite vender sin validar existencias (el stock puede quedar negativo) — §1.8.1
            </span>
          </span>
          <input type="checkbox" checked={!!s.allow_overdraft}
            onChange={(e) => set("allow_overdraft", e.target.checked)}
            className="h-4 w-4 accent-[hsl(217_91%_60%)]" />
        </label>
      </div>

      <Button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
    </form>
  );
}
