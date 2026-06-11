/**
 * Cambiar contraseña — manual §1.16: requiere la anterior, confirmación,
 * y rechaza contraseñas usadas anteriormente (historial). Si llegó con
 * ?forzado=1 (clave por defecto, concepto PHP "cambia") no deja salir
 * sin cambiarla.
 */
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Button, Field, Input, PageHeader, useToast } from "../components/ui";

export default function CambiarContrasena() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const forced = params.get("forzado") === "1";

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (next !== confirm) {
      toast("error", "La nueva contraseña y su confirmación no coinciden.");
      return;
    }
    setSaving(true);
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: { currentPassword: current, newPassword: next, confirmPassword: confirm },
      });
      toast("success", "Contraseña cambiada correctamente");
      navigate("/dashboard");
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "No fue posible cambiar la contraseña");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fade-in-up mx-auto max-w-md">
      <PageHeader title="Cambiar contraseña" />
      {forced && (
        <p className="mb-4 rounded-xl border border-accent-amber/40 bg-accent-amber/10 p-3 text-sm text-accent-amber">
          Está usando una contraseña temporal. Debe cambiarla para continuar.
        </p>
      )}
      <form onSubmit={submit} className="glass space-y-4 rounded-2xl p-6">
        <Field label="Contraseña anterior">
          <Input type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="Contraseña nueva (mínimo 8 caracteres)">
          <Input type="password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Confirmar contraseña nueva">
          <Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <p className="text-xs text-text-muted">
          La nueva contraseña no puede haber sido utilizada anteriormente.
        </p>
        <Button type="submit" className="w-full" disabled={saving}>
          <KeyRound size={15} className="-mt-0.5 mr-1.5 inline" />
          {saving ? "Cambiando…" : "Aceptar"}
        </Button>
      </form>
    </div>
  );
}
