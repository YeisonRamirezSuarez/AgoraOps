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
type AppEvent = { table: string; action: string; id: string };

// Un único EventSource compartido por toda la app: antes cada componente que
// se suscribía (campana + Cocina/Mesas/Orden/Notificaciones) abría su PROPIA
// conexión SSE, multiplicando conexiones en el backend y disparando un
// re-fetch por cada una ante el mismo evento. Ahora se multiplexan los
// listeners locales sobre una sola conexión, que se cierra al quedar sin
// suscriptores (logout/desmontaje) y se reabre si cambia el token (re-login).
let sharedSource: EventSource | null = null;
let sharedToken: string | null = null;
const eventListeners = new Set<(event: AppEvent) => void>();

function ensureEventSource() {
  const token = getToken();
  if (!token) {
    closeEventSource();
    return;
  }
  if (sharedSource && sharedToken !== token) closeEventSource(); // re-login
  if (sharedSource) return;
  sharedToken = token;
  const source = new EventSource(`${API_URL}/api/events?token=${token}`);
  source.onmessage = (e) => {
    let event: AppEvent;
    try {
      event = JSON.parse(e.data);
    } catch {
      return; // heartbeat (": ping") u otra línea no-JSON
    }
    for (const listener of eventListeners) listener(event);
  };
  sharedSource = source;
}

function closeEventSource() {
  if (sharedSource) sharedSource.close();
  sharedSource = null;
  sharedToken = null;
}

export function subscribeEvents(onEvent: (event: AppEvent) => void): () => void {
  eventListeners.add(onEvent);
  ensureEventSource();
  return () => {
    eventListeners.delete(onEvent);
    if (eventListeners.size === 0) closeEventSource();
  };
}
