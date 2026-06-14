import "dotenv/config";
import { readFileSync } from "node:fs";
import type { ConnectionOptions } from "node:tls";

// En Vercel (serverless) o NODE_ENV=production se exige configuración segura.
const isProd = !!process.env.VERCEL || process.env.NODE_ENV === "production";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/agoraops";

// JWT_SECRET es obligatorio en producción: sin él se firmarían tokens con un
// secreto público y cualquiera podría forjar sesiones. En dev se permite un
// valor por defecto para no frenar el arranque local.
const jwtSecret = process.env.JWT_SECRET ?? (isProd ? "" : "dev-secret-solo-local");
if (!jwtSecret) {
  throw new Error(
    "JWT_SECRET es obligatorio en producción. Configúralo en las variables de entorno.",
  );
}

/**
 * SSL de Postgres compartido por el pool y el listener SSE.
 *  - localhost/127.0.0.1: sin SSL (Postgres local no lo soporta).
 *  - Supabase (hosted): SSL obligatorio. Por compatibilidad con el pooler se
 *    deja rejectUnauthorized=false por defecto; DATABASE_SSL_STRICT=true valida
 *    el certificado. DATABASE_SSL_CA aporta el CA de Supabase (PEM en línea o
 *    ruta a archivo) para que esa validación tenga contra qué verificar.
 */
function resolveDbSsl(): ConnectionOptions | undefined {
  if (databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1")) {
    return undefined;
  }
  const ssl: ConnectionOptions = {
    rejectUnauthorized: process.env.DATABASE_SSL_STRICT === "true",
  };
  const ca = process.env.DATABASE_SSL_CA;
  if (ca) {
    ssl.ca = ca.includes("BEGIN CERTIFICATE") ? ca : readFileSync(ca, "utf8");
  }
  return ssl;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl,
  dbSsl: resolveDbSsl(),
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? (isProd ? 5 : 10)),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "12h",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  // URL pública del frontend: base del enlace de restablecimiento del correo.
  // Derivada directamente del primer origen en CORS_ORIGIN para evitar variables redundantes.
  appUrl:
    process.env.CORS_ORIGIN?.split(",")[0]?.trim() ??
    "http://localhost:5173",
  // SMTP para el correo de recuperación. Si no se configura, el mailer cae a
  // modo dev (registra el enlace en consola) y la app sigue funcionando.
  mail: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.MAIL_FROM ?? "AgoraOps <no-reply@agoraops.app>",
  },
};
