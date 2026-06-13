/**
 * Cambiar contraseña — manual §1.16: requiere la anterior, confirmación,
 * y rechaza contraseñas usadas anteriormente (historial).
 *
 * Modo `forzado` (primer ingreso con clave temporal): se renderiza a
 * pantalla completa SIN menús ni layout, y no hay forma de continuar sin
 * cambiar la clave (el backend además bloquea todo el API). La única
 * salida alternativa es cerrar sesión.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, LogOut } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Field, PageHeader, PasswordInput, useToast } from "../components/ui";

export default function CambiarContrasena({ forzado = false }: { forzado?: boolean }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { user, logout, completePasswordChange } = useAuth();

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
      const res = await api<{ ok: boolean; token?: string }>(
        "/api/auth/change-password",
        {
          method: "POST",
          body: { currentPassword: current, newPassword: next, confirmPassword: confirm },
        },
      );
      completePasswordChange(res.token ?? null);
      toast("success", "Contraseña cambiada correctamente");
      navigate(user?.isSuperAdmin ? "/superadmin" : "/dashboard");
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "No fue posible cambiar la contraseña");
    } finally {
      setSaving(false);
    }
  }

  const form = (
    <form onSubmit={submit} className="glass space-y-4 rounded-2xl p-6">
      <Field label="Contraseña anterior">
        <PasswordInput required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="Contraseña nueva (mínimo 8 caracteres)">
        <PasswordInput required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label="Confirmar contraseña nueva">
        <PasswordInput required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <p className="text-xs text-text-muted">
        La nueva contraseña no puede haber sido utilizada anteriormente.
      </p>
      <Button type="submit" className="w-full" disabled={saving}>
        <KeyRound size={15} className="-mt-0.5 mr-1.5 inline" />
        {saving ? "Cambiando…" : "Aceptar"}
      </Button>
    </form>
  );

  if (!forzado) {
    return (
      <div className="fade-in-up mx-auto max-w-md">
        <PageHeader title="Cambiar contraseña" />
        {form}
      </div>
    );
  }

  // Primer ingreso: pantalla completa, sin menús ni navegación
  return (
    <main className="grid min-h-[100dvh] place-items-center p-4">
      <div className="fade-in-up w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="bg-gradient-to-br from-accent-blue to-accent-cyan bg-clip-text text-2xl font-bold text-transparent">
            AgoraOps
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Hola, {user?.fullName ?? user?.username}
          </p>
        </div>
        <p className="mb-4 rounded-xl border border-accent-amber/40 bg-accent-amber/10 p-3 text-sm text-accent-amber">
          Está usando una contraseña temporal. Por seguridad debe cambiarla
          para poder usar el sistema.
        </p>
        {form}
        <button type="button" onClick={logout}
          className="mx-auto mt-5 flex items-center gap-1.5 text-sm text-text-muted transition hover:text-text-primary">
          <LogOut size={14} /> Cerrar sesión
        </button>
      </div>
    </main>
  );
}
