/**
 * AgoraOps Print Service — servidor HTTP local (http://localhost:9090).
 * Puente entre la web app de AgoraOps y las impresoras físicas del equipo.
 * Contrato compatible con Polaris (PolarisFoodXprinterService):
 *   GET  /health                  → estado del servicio
 *   GET  /printer/impresoras      → impresoras detectadas en el equipo
 *   POST /synchronize/restaurant  → recibe/guarda la config del restaurante
 *   POST /printer/print           → imprime una tirilla (ESC/POS)
 *   POST /printer/open-drawer     → abre el cajón monedero
 *
 * Se ejecuta en el PC de la caja. Empaquetable a .exe con `npm run build:win`.
 */
"use strict";

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const cors = require("cors");
const { listPrinters } = require("./printers");
const { buildBuffer, drawerBuffer } = require("./escpos");
const { sendToPrinter } = require("./print");

const PORT = process.env.AGORAOPS_PRINT_PORT || 9090;
const CONFIG_FILE = path.join(os.homedir(), ".agoraops-print-service.json");

const app = express();
// La web app corre en https; los navegadores permiten https → http://localhost.
app.use(cors());
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "agoraops-print-service", version: "1.0.0", platform: process.platform });
});

// Lista de impresoras detectadas (puebla el desplegable de Configuración de impresoras)
app.get("/printer/impresoras", async (_req, res) => {
  try {
    res.json({ ok: true, printers: await listPrinters() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Sincroniza la configuración del restaurante/impresoras en el equipo local
app.post("/synchronize/restaurant", (req, res) => {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body ?? {}, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Imprime una tirilla. body: { connectionType, printerName?, ip?, port?, text? | raw?, openDrawer? }
app.post("/printer/print", async (req, res) => {
  try {
    const buffer = buildBuffer(req.body ?? {});
    await sendToPrinter(req.body ?? {}, buffer);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Abre el cajón monedero (para "Abrir caja registradora")
app.post("/printer/open-drawer", async (req, res) => {
  try {
    await sendToPrinter(req.body ?? {}, drawerBuffer());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`✓ AgoraOps Print Service en http://localhost:${PORT}`);
});
