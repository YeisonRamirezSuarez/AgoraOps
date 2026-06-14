/**
 * Recuperar contraseña (paso 1): el usuario ingresa su usuario y el backend
 * envía un correo con el enlace de restablecimiento. Mismo diseño y animación
 * que el login (marca que se arma + wordmark). Respuesta genérica: no revela
 * si el usuario existe.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, User, MailCheck } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { applyPalette, DEFAULT_PALETTE } from "../shared/constants/palettes";
import { LogoMark } from "../components/Logo";

export default function Recuperar() {
  const [username, setUsername] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Pantalla pre-sesión compartida por todos los tenants: paleta base celeste.
  useEffect(() => applyPalette(DEFAULT_PALETTE), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ ok: boolean; message: string }>(
        "/api/auth/forgot-password",
        { method: "POST", body: { username } },
      );
      setMessage(res.message);
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "No fue posible enviar el correo.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="h-dvh overflow-y-auto">
      <div className="grid min-h-full place-items-center p-4">
        <div className="glass fade-in-up relative w-full max-w-sm rounded-2xl p-8 shadow-2xl">
          {/* Botón volver (círculo celeste, sobre la esquina de la tarjeta) */}
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

          {sent ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-accent-emerald/15 text-accent-emerald">
                <MailCheck size={28} />
              </span>
              <p className="text-sm text-text-secondary">{message}</p>
              <Link
                to="/login"
                className="mt-2 text-sm font-semibold text-accent-blue hover:underline"
              >
                Volver al inicio de sesión
              </Link>
            </div>
          ) : (
            <>
              <p className="mb-5 text-center text-sm font-semibold text-text-primary">
                Ingrese el usuario para recuperar la contraseña
              </p>

              {error && (
                <div className="mb-4 rounded-lg border border-accent-rose bg-accent-rose/10 px-4 py-3 text-sm text-accent-rose">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="relative">
                  <User
                    size={18}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                  />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Usuario"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    className="w-full rounded-lg border border-border-subtle bg-bg-tertiary py-3 pl-10 pr-4 outline-none transition focus:border-accent-blue focus:shadow-[0_0_20px_var(--accent-glow)]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-gradient-to-br from-[var(--color-primary-strong)] to-[var(--color-primary-strong-2)] py-3 font-semibold text-white shadow-[0_0_20px_var(--accent-glow)] transition hover:scale-[1.02] hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
                >
                  {loading ? "Enviando…" : "Enviar correo de recuperación"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
