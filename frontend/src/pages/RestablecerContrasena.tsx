/**
 * Restablecer contraseña (paso 2): página que abre el enlace del correo
 * (/restablecer?token=…). Valida el token contra el backend y actualiza la
 * contraseña en BD. Mismo diseño y animación que el login.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { applyPalette, DEFAULT_PALETTE } from "../shared/constants/palettes";
import { LogoMark } from "../components/Logo";
import { PasswordInput, useToast } from "../components/ui";

export default function RestablecerContrasena() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const toast = useToast();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => applyPalette(DEFAULT_PALETTE), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("La nueva contraseña y su confirmación no coinciden.");
      return;
    }
    setLoading(true);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: { token, newPassword: password, confirmPassword: confirm },
      });
      toast("success", "Contraseña restablecida. Inicia sesión con tu nueva clave.");
      navigate("/login");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "No fue posible restablecer la contraseña.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="h-dvh overflow-y-auto">
      <div className="grid min-h-full place-items-center p-4">
        <div className="glass fade-in-up relative w-full max-w-sm rounded-2xl p-8 shadow-2xl">
          <Link
            to="/login"
            aria-label="Volver al inicio de sesión"
            className="absolute -left-3 -top-3 grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-[var(--color-primary-strong)] to-[var(--color-primary-strong-2)] text-white shadow-lg transition hover:scale-105"
          >
            <ArrowLeft size={20} />
          </Link>

          <div className="mb-6 flex flex-col items-center text-center">
            <LogoMark tone="color" animated className="mb-3 h-16 w-auto drop-shadow-sm" />
            <h1 className="word-reveal text-2xl font-extrabold tracking-[-0.01em]">
              <span className="text-[#22303f]">Agora</span>
              <span className="text-[#099dd7]">Ops</span>
            </h1>
          </div>

          {!token ? (
            <div className="text-center">
              <p className="mb-4 rounded-lg border border-accent-rose bg-accent-rose/10 px-4 py-3 text-sm text-accent-rose">
                El enlace no es válido o está incompleto. Solicita uno nuevo.
              </p>
              <Link
                to="/recuperar"
                className="text-sm font-semibold text-accent-blue hover:underline"
              >
                Solicitar un nuevo enlace
              </Link>
            </div>
          ) : (
            <>
              <p className="mb-5 text-center text-sm font-semibold text-text-primary">
                Crea tu nueva contraseña
              </p>

              {error && (
                <div className="mb-4 rounded-lg border border-accent-rose bg-accent-rose/10 px-4 py-3 text-sm text-accent-rose">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="mb-1.5 block text-sm text-text-secondary">
                    Nueva contraseña (mínimo 8 caracteres)
                  </label>
                  <PasswordInput
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm text-text-secondary">
                    Confirmar nueva contraseña
                  </label>
                  <PasswordInput
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-gradient-to-br from-[var(--color-primary-strong)] to-[var(--color-primary-strong-2)] py-3 font-semibold text-white shadow-[0_0_20px_var(--accent-glow)] transition hover:scale-[1.02] hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
                >
                  {loading ? "Restableciendo…" : "Restablecer contraseña"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
