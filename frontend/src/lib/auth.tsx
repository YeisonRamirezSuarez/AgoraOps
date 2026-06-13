import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, getToken, setToken } from "./api";

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  groupName: string | null;
  roleType: "administrador" | "empleado" | null;
  isSuperAdmin: boolean;
  /** Clave temporal vigente: la app entera queda bloqueada hasta cambiarla. */
  mustChangePassword: boolean;
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (username: string, password: string) =>
    Promise<{ mustChangePassword: boolean; isSuperAdmin: boolean }>;
  logout: () => void;
  /** Tras cambiar la clave: guarda el token nuevo y desbloquea la sesión. */
  completePasswordChange: (token: string | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api<SessionUser & { tenantId: string }>("/api/auth/me")
      .then((me) =>
        setUser({
          id: me.id,
          username: me.username,
          fullName: me.fullName,
          groupName: me.groupName,
          roleType: me.roleType,
          isSuperAdmin: me.isSuperAdmin,
          mustChangePassword: me.mustChangePassword ?? false,
        }),
      )
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(username: string, password: string) {
    const data = await api<{
      token: string;
      mustChangePassword: boolean;
      user: SessionUser;
    }>("/api/auth/login", { method: "POST", body: { username, password } });
    setToken(data.token);
    setUser({ ...data.user, mustChangePassword: data.mustChangePassword });
    return {
      mustChangePassword: data.mustChangePassword,
      isSuperAdmin: data.user.isSuperAdmin,
    };
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  function completePasswordChange(token: string | null) {
    if (token) setToken(token);
    setUser((u) => (u ? { ...u, mustChangePassword: false } : u));
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, completePasswordChange }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
