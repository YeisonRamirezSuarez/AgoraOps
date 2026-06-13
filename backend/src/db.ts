import pg from "pg";
import net from "node:net";
import dns from "node:dns";
import { config } from "./config.js";

// Resolver personalizado utilizando servidores DNS públicos rápidos para evitar
// timeouts causados por servidores DNS IPv6 locales/domésticos inestables (como fe80::1).
const dnsResolver = new dns.Resolver();
dnsResolver.setServers(["8.8.8.8", "1.1.1.1"]);

function customStream(streamConfig: any) {
  const socket = new net.Socket();
  const originalConnect = socket.connect;

  (socket as any).connect = function (options: any, connectionListener?: () => void) {
    let host = "";
    let port = 0;

    if (typeof options === "object") {
      host = options.host;
      port = options.port;
    } else {
      port = arguments[0];
      host = arguments[1];
    }

    // Si es localhost o una IP directa, no hacemos resolución personalizada.
    if (host === "localhost" || host === "127.0.0.1" || net.isIP(host)) {
      return (originalConnect as any).apply(this, arguments as any);
    }

    dnsResolver.resolve4(host, (err, addresses) => {
      if (err || !addresses || addresses.length === 0) {
        // En caso de fallo de resolución directa, reintentar con el resolver nativo del sistema
        (originalConnect as any).call(socket, { host, port });
      } else {
        // Conectar usando la IP directa resuelta
        (originalConnect as any).call(socket, { host: addresses[0], port });
      }
    });

    return socket;
  };

  return socket;
}

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax, // pocas conexiones por instancia en serverless (ver config)
  // Libera conexiones ociosas pronto para no retener cupo del pooler entre ráfagas.
  idleTimeoutMillis: 10_000,
  // Falla rápido si el pooler está saturado en vez de colgar la petición.
  connectionTimeoutMillis: 10_000,
  // Permite que la lambda termine sin conexiones colgadas (mejor reciclaje en Vercel).
  allowExitOnIdle: true,
  ssl: config.dbSsl, // centralizado en config (localhost sin SSL, hosted con SSL)
  stream: customStream as any, // Evita fallos de DNS lento/ENOTFOUND en el entorno local
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
