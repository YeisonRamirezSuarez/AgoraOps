/**
 * Token público estable por establecimiento para el menú/QR (§1.6.2).
 *
 * El QR impreso en las mesas debe ser PERMANENTE: no puede cambiar cuando
 * cambia el día ni el menú. Por eso la URL pública depende solo del tenant
 * (`/m/<tenantId>?c=<code>`) y el menú se resuelve dinámicamente en el
 * servidor según el día. El `code` es un HMAC del tenant_id con el secreto
 * del servidor: estable (mismo tenant → mismo code) y evita que alguien
 * adivine/enumere establecimientos cambiando el id en la URL.
 *
 * Espejo del patrón de Polaris (restaurant_menu_2?act=<id>&code=<token>).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

/** Firma estable (12 hex) del tenant para la URL pública del menú. */
export function signTenant(tenantId: string): string {
  return createHmac("sha256", config.jwtSecret)
    .update(`public-menu:${tenantId}`)
    .digest("hex")
    .slice(0, 12);
}

/** Valida el `code` recibido contra la firma esperada (comparación segura). */
export function verifyTenantCode(tenantId: string, code: string | undefined): boolean {
  if (!code) return false;
  const expected = signTenant(tenantId);
  if (code.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(code), Buffer.from(expected));
}
