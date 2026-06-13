/**
 * Impresión física — réplica del flujo de Polaris (blank_tb_order_items):
 *  · Equipos POS Android exponen un bridge local en http://localhost:8080
 *    (GET /modelo para detectar el equipo, POST /voucher para imprimir).
 *  · En PC se usa la impresora configurada (printers.url_send = agente local
 *    de impresión); la conexión va dentro del JSON: USB → [nombre impresora],
 *    red → [ip, puerto].
 *  · El backend genera los payloads con los formatos exactos de Polaris
 *    (GET /api/orders/:id/comanda y /api/orders/:id/prefactura).
 */
import { api } from "./api";

const BRIDGE = "http://localhost:8080";

/** Escapa texto para insertarlo en el HTML de una tirilla (voucher/reporte). */
export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

/**
 * Abre una ventana e imprime el HTML de una tirilla (voucher de pago, cierre
 * de caja, reporte). El HTML debe traer su propio onload=window.print().
 * Devuelve false si el navegador bloqueó la ventana emergente.
 */
export function printReceipt(html: string, height = 640): boolean {
  const w = window.open("", "_blank", `width=420,height=${height}`);
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}

export interface Printer {
  id: number;
  name: string;
  connection_type: "USB" | "ETHERNET";
  printer_name: string | null;
  ip_address: string | null;
  port: number | null;
  purpose: "comanda" | "prefactura" | "ambas";
  url_send: string | null;
}

interface ComandaPayload {
  json_local: string;
  json_externo: string;
}

interface PrefacturaPayload {
  conexion: { tipo: string; parametros: (string | number)[] };
  [k: string]: unknown;
}

let modeloPosCache: string | null | undefined;

/** Polaris obtenerModeloPos(): null si no hay bridge POS local. */
export async function obtenerModeloPos(): Promise<string | null> {
  if (modeloPosCache !== undefined) return modeloPosCache;
  try {
    const res = await fetch(`${BRIDGE}/modelo`, { signal: AbortSignal.timeout(1500) });
    const data = (await res.json()) as { estado?: string; modelo?: string };
    modeloPosCache = data.estado === "ERROR" ? null : (data.modelo ?? null);
  } catch {
    modeloPosCache = null;
  }
  return modeloPosCache;
}

export async function listPrinters(purpose: "comanda" | "prefactura"): Promise<Printer[]> {
  const printers = await api<Printer[]>("/api/orders/printers/list");
  return printers.filter((p) => p.purpose === purpose || p.purpose === "ambas");
}

/** Completa la conexión del JSON como Polaris antes de enviarlo al agente. */
function withConexion<T extends { conexion: { tipo: string; parametros: (string | number)[] } }>(
  payload: T,
  printer: Printer,
): T {
  payload.conexion.tipo = printer.connection_type;
  if (printer.connection_type === "USB") {
    payload.conexion.parametros = [printer.printer_name ?? ""];
  } else {
    payload.conexion.parametros = [printer.ip_address ?? "", printer.port ?? ""];
  }
  return payload;
}

async function sendToAgent(printer: Printer, body: unknown): Promise<void> {
  if (!printer.url_send) throw new Error("La impresora no tiene agente configurado (url_send)");
  const res = await fetch(printer.url_send, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Error al imprimir");
}

/**
 * Imprime la comanda (Polaris imprimirComanda/verificarImpresionComanda).
 * itemIds limita a los productos recién confirmados.
 * Devuelve false si no hay bridge POS ni impresora disponible.
 */
export async function imprimirComanda(
  orderId: number,
  itemIds: number[] | undefined,
  printer: Printer | null,
): Promise<boolean> {
  const qs = itemIds?.length ? `?items=${itemIds.join(",")}` : "";
  const payload = await api<ComandaPayload>(`/api/orders/${orderId}/comanda${qs}`);

  const modelo = await obtenerModeloPos();
  if (modelo) {
    // Equipo POS → bridge local con el formato json_local
    await fetch(`${BRIDGE}/voucher`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: payload.json_local,
    });
    return true;
  }

  if (!printer) return false;
  const externo = JSON.parse(payload.json_externo) as PrefacturaPayload;
  await sendToAgent(printer, withConexion(externo, printer));
  return true;
}

/** Imprime la prefactura (Polaris imprimirPreFactura, type=Pre_Factura). */
export async function imprimirPreFactura(
  orderId: number,
  printer: Printer | null,
): Promise<boolean> {
  const payload = await api<PrefacturaPayload>(`/api/orders/${orderId}/prefactura`);

  const modelo = await obtenerModeloPos();
  if (modelo) {
    await fetch(`${BRIDGE}/voucher`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(payload),
    });
    return true;
  }

  if (!printer) return false;
  await sendToAgent(printer, withConexion(payload, printer));
  return true;
}
