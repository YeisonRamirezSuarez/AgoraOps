/**
 * Configuración de parámetros — manual §1.8.1 (vive bajo Gestión de
 * Cajas como en Polaris Food). Réplica del flujo de Polaris
 * (blank_param_service): secciones Propina y, solo para Ecuador, % de
 * Servicio, más el sobregiro de inventario. Los datos del negocio
 * (nombre, NIT, dirección, logo) NO van aquí: se administran desde el
 * Super Admin, igual que Polaris no los muestra en esta pantalla.
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { Button, Input, Loader, useToast } from "./ui";

/** Interruptor tipo switch (réplica del "HABILITAR" de Polaris, tema hpos). */
function Switch({ checked, onChange, label }: {
  checked: boolean; onChange: (v: boolean) => void; label?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-white">
      {label && <span>{label}</span>}
      <button type="button" role="switch" aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition-colors ${
          checked ? "bg-accent-blue" : "bg-text-muted/40"
        }`}>
        <span className={`absolute top-0.5 grid h-5 w-5 place-items-center rounded-full bg-white text-[10px] transition-transform ${
          checked ? "translate-x-[22px] text-accent-blue" : "translate-x-0.5 text-text-muted"
        }`}>
          {checked ? "✓" : "✕"}
        </span>
      </button>
    </label>
  );
}

/** Encabezado de sección estilo Polaris (barra con título y, opcional,
 * el switch HABILITAR a la derecha). */
function SectionHeader({ title, children }: {
  title: string; children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between rounded-t-2xl bg-accent-blue px-4 py-2.5 text-white">
      <span className="font-semibold">{title}</span>
      {children}
    </div>
  );
}

export function ParametersForm() {
  const toast = useToast();
  const [s, setS] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Record<string, unknown>>("/api/settings").then(setS).catch(() => {});
  }, []);

  if (!s) return <Loader label="Cargando configuración" />;
  const isEC = s.country === "EC";

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/api/settings", {
        method: "PUT",
        body: {
          tip_enabled: !!s!.tip_enabled,
          tip_percentage: Number(s!.tip_percentage ?? 0),
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
    <form onSubmit={save} className="max-w-2xl space-y-5">
      {/* ── Propina (CO y EC) ── */}
      <div className="glass overflow-hidden rounded-2xl">
        <SectionHeader title="Propina">
          <Switch label="HABILITAR" checked={!!s.tip_enabled}
            onChange={(v) => set("tip_enabled", v)} />
        </SectionHeader>
        <div className="grid items-center gap-2 px-4 py-4 sm:grid-cols-[220px_1fr]">
          <span className="text-sm font-medium">Porcentaje de Propina</span>
          <div>
            <Input type="number" min={0} max={100} value={String(s.tip_percentage ?? 0)}
              onChange={(e) => set("tip_percentage", e.target.value)} />
            <p className="mt-1 text-xs text-text-muted">
              El porcentaje debe ser mínimo 0 y como máximo 100.
            </p>
          </div>
        </div>
      </div>

      {/* ── Servicio (solo Ecuador) ── */}
      {isEC && (
        <div className="glass overflow-hidden rounded-2xl">
          <SectionHeader title="Servicio">
            <Switch label="HABILITAR" checked={!!s.service_enabled}
              onChange={(v) => set("service_enabled", v)} />
          </SectionHeader>
          <div className="grid items-center gap-2 px-4 py-4 sm:grid-cols-[220px_1fr]">
            <span className="text-sm font-medium">Porcentaje de Servicio</span>
            <div>
              <Input type="number" min={0} max={100} value={String(s.service_percentage ?? 0)}
                onChange={(e) => set("service_percentage", e.target.value)} />
              <p className="mt-1 text-xs text-text-muted">
                El porcentaje debe ser mínimo 0 y como máximo 100.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Inventario ── */}
      <div className="glass overflow-hidden rounded-2xl">
        <SectionHeader title="Inventario" />
        <div className="flex items-center justify-between px-4 py-4">
          <span className="text-sm font-medium">Permitir sobregiro del inventario</span>
          <Switch checked={!!s.allow_overdraft}
            onChange={(v) => set("allow_overdraft", v)} />
        </div>
      </div>

      <Button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
    </form>
  );
}
