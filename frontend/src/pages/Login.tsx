/**
 * Login — manual §1.3: usuario case-sensitive, mensajes específicos
 * (credenciales inválidas / restaurante inactivo / usuario bloqueado),
 * toggle de contraseña y redirección si debe cambiar la clave.
 */
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { mustChangePassword } = await login(username, password);
      navigate(mustChangePassword ? "/cambiar-contrasena?forzado=1" : "/dashboard");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "No fue posible iniciar sesión.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_top,hsl(222_47%_10%),hsl(222_47%_6%)_60%)] p-4">
      <div className="glass fade-in-up w-full max-w-sm rounded-2xl p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <h1 className="bg-gradient-to-br from-accent-blue to-accent-cyan bg-clip-text text-2xl font-bold text-transparent">
            AgoraOps
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Sistema POS para restaurantes y bares
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-accent-rose bg-accent-rose/10 px-4 py-3 text-sm text-accent-rose">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
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
              className="w-full rounded-lg border border-border-subtle bg-bg-tertiary px-4 py-3 outline-none transition focus:border-accent-blue focus:shadow-[0_0_20px_hsl(217_91%_60%/0.2)]"
            />
          </div>

          <div>
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
                className="w-full rounded-lg border border-border-subtle bg-bg-tertiary px-4 py-3 pr-11 outline-none transition focus:border-accent-blue focus:shadow-[0_0_20px_hsl(217_91%_60%/0.2)]"
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
            className="w-full rounded-lg bg-gradient-to-br from-accent-blue to-accent-blue-hover py-3 font-semibold text-white shadow-[0_0_20px_hsl(217_91%_60%/0.2)] transition hover:scale-[1.02] hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? "Iniciando sesión…" : "Iniciar sesión"}
          </button>
        </form>

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
    </main>
  );
}
