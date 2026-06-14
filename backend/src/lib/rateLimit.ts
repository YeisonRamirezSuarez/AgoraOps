/**
 * Rate-limit en memoria (sin dependencias), por IP y ventana fija.
 *  - En un servidor de larga vida (node) limita de forma efectiva.
 *  - En serverless (Vercel) es best-effort por instancia; para el abuso real de
 *    "recuperar contraseña" se complementa con un cooldown por cuenta en BD.
 * Lee el IP de x-forwarded-for (Vercel/proxy) y cae a req.ip.
 */
import type { Request, Response, NextFunction } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0]!.trim();
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export function rateLimit(opts: { windowMs: number; max: number; message?: string }) {
  const {
    windowMs,
    max,
    message = "Demasiadas solicitudes. Inténtalo de nuevo más tarde.",
  } = opts;
  const hits = new Map<string, Bucket>();

  // Limpieza periódica de buckets vencidos (evita fuga de memoria). unref() para
  // no impedir que el proceso termine (relevante en serverless).
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of hits) if (b.resetAt <= now) hits.delete(key);
  }, windowMs);
  if (typeof timer.unref === "function") timer.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = clientIp(req);
    const now = Date.now();
    const b = hits.get(key);

    if (!b || b.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (b.count >= max) {
      res.setHeader("Retry-After", String(Math.ceil((b.resetAt - now) / 1000)));
      res.status(429).json({ error: message });
      return;
    }
    b.count += 1;
    next();
  };
}
