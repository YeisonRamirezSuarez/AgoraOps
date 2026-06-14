/**
 * AgoraOps API — backend Express (Node + JWT + PostgreSQL + SSE).
 * Reemplaza al backend PHP de HPOS; la trazabilidad por módulo está en
 * docs/implementation_plan.md → "Trazabilidad PHP → AgoraOps".
 */
import express from "express";
import "express-async-errors"; // captura errores en rutas async (Express 4)
import cors from "cors";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { catalogsRouter } from "./routes/catalogs.js";
import { productsRouter } from "./routes/products.js";
import { ordersRouter } from "./routes/orders.js";
import { kitchenRouter } from "./routes/kitchen.js";
import { cashRouter, INSTALLERS_DIR } from "./routes/cash.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { eventsRouter } from "./routes/events.js";
import { settingsRouter } from "./routes/settings.js";
import { inventoryRouter } from "./routes/inventory.js";
import { reportsRouter } from "./routes/reports.js";
import { reservationsRouter } from "./routes/reservations.js";
import { clientsRouter } from "./routes/clients.js";
import { deliveryRouter } from "./routes/delivery.js";
import { schedulesRouter } from "./routes/schedules.js";
import { superadminRouter } from "./routes/superadmin.js";
import { publicRouter } from "./routes/public.js";

const app = express();

app.use(cors({ origin: config.corsOrigin.split(",") }));
app.use(express.json({ limit: "6mb" })); // imágenes de producto máx 5MB (§1.10.1)

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "agoraops-api" });
});

// Descargas del servicio de impresión (§1.8.5): los ZIP/instaladores de
// print-service-installers se sirven aquí para "Descargar servicio de impresión".
app.use("/print-service", express.static(INSTALLERS_DIR));

// Menú público (§1.6.2): SIN auth, lo consume la página del QR de las mesas.
app.use("/api/public", publicRouter);

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/catalogs", catalogsRouter);
app.use("/api/products", productsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/kitchen", kitchenRouter);
app.use("/api/cash", cashRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/events", eventsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/reservations", reservationsRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/delivery", deliveryRouter);
app.use("/api/schedules", schedulesRouter);
app.use("/api/superadmin", superadminRouter);

// Manejador de errores no capturados
app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Error interno del servidor" });
  },
);

// En Vercel (serverless) no se abre puerto; el handler exportado atiende.
if (!process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log(`✓ AgoraOps API en http://localhost:${config.port}`);
  });
}

export default app;
