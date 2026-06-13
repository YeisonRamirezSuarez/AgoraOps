/** Cliente del API AgoraOps (REST + SSE). */

const API_URL = import.meta.env.VITE_API_URL ?? "";

const TOKEN_KEY = "agoraops_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  // 401 = sesión vencida… excepto en el propio login, donde significa
  // credenciales incorrectas y debe mostrarse el mensaje del servidor.
  if (res.status === 401 && !path.startsWith("/api/auth/login")) {
    setToken(null);
    window.location.href = "/login";
    throw new ApiError("Sesión expirada", 401);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      (data as { error?: string }).error ?? "Error en el servidor",
      res.status,
      data,
    );
  }
  return data as T;
}

/** Suscripción SSE a eventos del tenant (mesas, cocina, stock). */
export function subscribeEvents(
  onEvent: (event: { table: string; action: string; id: string }) => void,
): () => void {
  const token = getToken();
  if (!token) return () => {};
  const source = new EventSource(`${API_URL}/api/events?token=${token}`);
  source.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      /* heartbeat */
    }
  };
  return () => source.close();
}
