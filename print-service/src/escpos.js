/**
 * Comandos ESC/POS mínimos para impresoras térmicas POS (80mm/58mm).
 * Construye el buffer de bytes a enviar a la impresora. La web app puede
 * mandar:
 *   · `raw`  → base64 de ESC/POS ya armado por el cliente.
 *   · `doc`  → documento declarativo (ver format.js); se renderiza AQUÍ al
 *              ancho `paperWidth` (80mm=48 col / 58mm=32 col) de la impresora
 *              destino, para que la misma tirilla salga bien en cualquier mm.
 *   · `text` → texto plano ya formateado (se envía tal cual).
 * `openDrawer` añade el pulso al cajón.
 */
"use strict";

const { renderDoc } = require("./format");

const ESC = 0x1b;
const GS = 0x1d;

// Inicializar impresora (ESC @)
const INIT = Buffer.from([ESC, 0x40]);
// Corte total de papel (GS V 0)
const CUT = Buffer.from([GS, 0x56, 0x00]);
// Avance de líneas antes del corte
const FEED = Buffer.from([ESC, 0x64, 0x04]); // ESC d 4 → 4 líneas
// Pulso de apertura del cajón monedero (ESC p m t1 t2) — pin 0, tiempos estándar
const KICK_DRAWER = Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]);

/** Texto final a imprimir según el job (doc renderizado al ancho, o text). */
function jobText(job) {
  if (Array.isArray(job.doc)) return renderDoc(job.doc, job.paperWidth);
  if (job.text != null) return String(job.text);
  return "";
}

/**
 * Arma el buffer ESC/POS a imprimir.
 * @param {{ raw?: string, text?: string, doc?: object[], paperWidth?: number, openDrawer?: boolean }} job
 * @returns {Buffer}
 */
function buildBuffer(job) {
  const parts = [];
  if (job.raw) {
    // ESC/POS ya construido por el cliente (base64)
    parts.push(Buffer.from(job.raw, "base64"));
  } else {
    parts.push(INIT);
    const text = jobText(job);
    if (text) {
      // Normaliza saltos de línea a CRLF y codifica en CP437/Latin1
      parts.push(Buffer.from(text.replace(/\r?\n/g, "\r\n"), "latin1"));
    }
    parts.push(FEED, CUT);
  }
  if (job.openDrawer) parts.push(KICK_DRAWER);
  return Buffer.concat(parts);
}

/** Solo el pulso de apertura del cajón (para "Abrir caja registradora"). */
function drawerBuffer() {
  return Buffer.concat([INIT, KICK_DRAWER]);
}

module.exports = { buildBuffer, drawerBuffer, jobText, KICK_DRAWER };
