/**
 * Login — manual §1.3: usuario case-sensitive, mensajes específicos
 * (credenciales inválidas / restaurante inactivo / usuario bloqueado),
 * toggle de contraseña y redirección si debe cambiar la clave.
 */
import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import { applyPalette, DEFAULT_PALETTE } from "../shared/constants/palettes";
import { LogoMark } from "../components/Logo";

const TAGLINE = "Soluciones de Gestión Integral";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // El login es compartido por todos los tenants: restaurar la paleta base
  useEffect(() => applyPalette(DEFAULT_PALETTE), []);

  // Eslogan "escribiéndose" letra a letra, tras armarse la marca (~1.3s).
  // Respeta prefers-reduced-motion: si está activo, se muestra completo.
  const [typed, setTyped] = useState("");
  const doneTyping = typed === TAGLINE;
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setTyped(TAGLINE);
      return;
    }
    let i = 0;
    let interval: ReturnType<typeof setInterval>;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        i += 1;
        setTyped(TAGLINE.slice(0, i));
        if (i >= TAGLINE.length) clearInterval(interval);
      }, 48);
    }, 1300);
    return () => {
      clearTimeout(start);
      clearInterval(interval);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { mustChangePassword, isSuperAdmin } = await login(username, password);
      navigate(
        mustChangePassword
          ? "/primer-ingreso"
          : isSuperAdmin
            ? "/superadmin"
            : "/dashboard",
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "No fue posible iniciar sesión.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="h-dvh overflow-y-auto">
      <div className="grid min-h-full place-items-center p-4">
        <div className="glass fade-in-up w-full max-w-sm rounded-2xl p-8 shadow-2xl">
          <div className="mb-8 flex flex-col items-center text-center">
            <LogoMark tone="color" animated className="mb-3 h-16 w-auto drop-shadow-sm" />
            <h1 className="word-reveal text-3xl font-extrabold tracking-[-0.01em]">
              <span className="text-[#22303f]">Agora</span>
              <span className="text-[#099dd7]">Ops</span>
            </h1>
            <p className="mt-1 min-h-[1.25rem] text-sm text-text-secondary">
              {typed}
              {!doneTyping && <span className="type-caret">|</span>}
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-accent-rose bg-accent-rose/10 px-4 py-3 text-sm text-accent-rose">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="animate-stagger-1">
              <label htmlFor="username" className="mb-1.5 block text-sm text-text-secondary">
                Usuario
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                spellCheck={false}
                required
                className="w-full rounded-lg border border-border-subtle bg-bg-tertiary px-4 py-3 outline-none transition focus:border-accent-blue focus:shadow-[0_0_20px_var(--accent-glow)]"
              />
            </div>

            <div className="animate-stagger-2">
              <label htmlFor="password" className="mb-1.5 block text-sm text-text-secondary">
                Contraseña
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-lg border border-border-subtle bg-bg-tertiary px-4 py-3 pr-11 outline-none transition focus:border-accent-blue focus:shadow-[0_0_20px_var(--accent-glow)]"
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
                >
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-gradient-to-br from-[var(--color-primary-strong)] to-[var(--color-primary-strong-2)] py-3 font-semibold text-white shadow-[0_0_20px_var(--accent-glow)] transition hover:scale-[1.02] hover:brightness-110 disabled:cursor-wait disabled:opacity-60 animate-stagger-3"
            >
              {loading ? "Iniciando sesión…" : "Iniciar sesión"}
            </button>
          </form>

          <div className="animate-stagger-4">
            <Link
              to="/recuperar"
              className="mt-5 block text-center text-sm text-accent-blue hover:underline"
            >
              ¿Restablecer contraseña?
            </Link>

            <p className="mt-4 text-center text-xs text-text-muted">
              El campo USUARIO distingue entre mayúsculas y minúsculas.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
