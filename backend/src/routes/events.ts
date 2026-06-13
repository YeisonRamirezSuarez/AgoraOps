/**
 * SSE — eventos en tiempo real para Mesas, Monitor de Cocina y alertas.
 * Postgres pg_notify('app_events', …) → LISTEN → EventSource del frontend.
 * EventSource no envía headers: el JWT viaja como ?token= (lo acepta
 * requireAuth). Reconexión automática del navegador si Vercel corta.
 */
import { Router } from "express";
import pg from "pg";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";

type Subscriber = { tenantId: string | null; send: (data: string) => void };
const subscribers = new Set<Subscriber>();

let listener: pg.Client | null = null;

async function ensureListener() {
  if (listener) return;
  listener = new pg.Client({
    connectionString: config.databaseUrl,
    ssl: config.dbSsl, // centralizado en config (igual que el pool)
  });
  await listener.connect();
  await listener.query("LISTEN app_events");
  listener.on("notification", (msg) => {
    if (!msg.payload) return;
    let tenantId: string | null = null;
    try {
      tenantId = JSON.parse(msg.payload).tenant_id ?? null;
    } catch {
      return;
    }
    for (const sub of subscribers) {
      if (sub.tenantId === tenantId) sub.send(msg.payload);
    }
  });
  listener.on("error", () => {
    listener = null; // se reconecta en la próxima suscripción
  });
}

export const eventsRouter = Router();

eventsRouter.get("/", requireAuth, async (req, res) => {
  await ensureListener();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("retry: 3000\n\n");

  const sub: Subscriber = {
    tenantId: req.user!.tenantId,
    send: (data) => res.write(`data: ${data}\n\n`),
  };
  subscribers.add(sub);

  // Heartbeat para que proxies no corten la conexión
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    subscribers.delete(sub);
  });
});
