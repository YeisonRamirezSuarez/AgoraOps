/**
 * Detección de impresoras instaladas en el equipo.
 *  - Windows: PowerShell `Get-Printer` (spooler). Incluye USB y las
 *    Bluetooth/Red que estén instaladas como impresora de Windows.
 *  - macOS/Linux: `lpstat` (CUPS).
 * La web app de AgoraOps usa esta lista para poblar el desplegable
 * "Nombre de impresora" en Configuración de impresoras.
 */
"use strict";

const { execFile } = require("node:child_process");

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, windowsHide: true, maxBuffer: 1 << 20 },
      (err, stdout) => resolve(err ? "" : String(stdout)));
  });
}

async function listWindows() {
  // ConvertTo-Json: 1 impresora → objeto; varias → arreglo. Normalizamos.
  const ps = "Get-Printer | Select-Object Name,DriverName,PortName,PrinterStatus,Shared | ConvertTo-Json -Compress";
  const out = await run("powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", ps]);
  if (!out.trim()) return [];
  let data;
  try { data = JSON.parse(out); } catch { return []; }
  const arr = Array.isArray(data) ? data : [data];
  return arr.map((p) => ({
    name: p.Name,
    driver: p.DriverName ?? null,
    port: p.PortName ?? null,
    status: p.PrinterStatus ?? null,
    shared: !!p.Shared,
  }));
}

async function listUnix() {
  const out = await run("lpstat", ["-e"]); // nombres de impresoras CUPS
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    .map((name) => ({ name, driver: null, port: null, status: null, shared: false }));
}

async function listPrinters() {
  return process.platform === "win32" ? listWindows() : listUnix();
}

module.exports = { listPrinters };
