/**
 * Impresión física vía el servicio local de AgoraOps
 * (AgoraOpsPrintService, http://localhost:9090). Reemplaza el bridge viejo
 * (localhost:8080) y los window.print(): cada tirilla se envía como
 * "documento" declarativo + el paper_width de la impresora destino, y el
 * servicio la renderiza al ancho correcto (80mm=48col / 58mm=32col, ver
 * print-service/src/format.js). La impresora se resuelve por ENDPOINT
 * (PAGO/PEDIDO/PREFACTURA/CAJA), igual que Polaris.
 */
import { api } from "./api";
import { cop } from "../components/ui";

/** Servicio de impresión local de AgoraOps. */
const PRINT_SERVICE = "http://localhost:9090";
const SERVICE_DOWN = "¡Error: AgoraOpsPrintService no responde!";

export type Endpoint = "PAGO" | "PEDIDO" | "PREFACTURA" | "CAJA";

export interface ConfiguredPrinter {
  id: number;
  name: string;
  connection_type: "USB" | "ETHERNET" | "BLUETOOTH";
  device_name: string | null;
  ip_address: string | null;
  port: number | null;
  endpoint: Endpoint | null;
  paper_width: number;
  location: string | null;
  is_active: boolean;
}

/** Línea declarativa de tirilla; el servicio la renderiza al ancho real. */
export type DocLine =
  | { t: "text"; v: string; align?: "left" | "center" | "right" }
  | { t: "row"; left: string; right: string }
  | { t: "kv"; k: string; v: string }
  | { t: "cols"; cells: string[]; widths?: (number | "*")[]; align?: ("left" | "center" | "right")[] }
  | { t: "divider"; ch?: string }
  | { t: "blank" };

export interface DetectedPrinter {
  name: string;
  driver: string | null;
  port: string | null;
}

/** Escapa texto para tirillas que aún se construyan como HTML (legado). */
export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

/**
 * Impresoras detectadas por el servicio local (puebla "Nombre de impresora").
 * Lanza error si el servicio no responde. Get-Printer en frío tarda: timeout
 * holgado.
 */
export async function fetchDetectedPrinters(): Promise<DetectedPrinter[]> {
  const res = await fetch(`${PRINT_SERVICE}/printer/impresoras`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error("El servicio de impresión respondió con error");
  const data = (await res.json()) as { ok?: boolean; printers?: DetectedPrinter[] };
  return data.printers ?? [];
}

/* ════════════ Resolución de impresora por endpoint ════════════ */

/** Impresoras activas configuradas (con endpoint + paper_width). */
async function getActivePrinters(): Promise<ConfiguredPrinter[]> {
  return api<ConfiguredPrinter[]>("/api/orders/printers/list");
}

/** Primera impresora activa configurada para ese endpoint, o null. */
export async function resolvePrinter(endpoint: Endpoint): Promise<ConfiguredPrinter | null> {
  const printers = await getActivePrinters();
  return printers.find((p) => p.endpoint === endpoint) ?? null;
}

/** Parámetros de conexión + ancho para el servicio. */
function target(p: ConfiguredPrinter) {
  return {
    connectionType: p.connection_type,
    // USB/Bluetooth → nombre en el SO; ETHERNET usa ip/puerto.
    printerName: p.connection_type === "ETHERNET" ? undefined : (p.device_name || p.name),
    ip: p.ip_address ?? undefined,
    port: p.port ?? undefined,
    paperWidth: p.paper_width,
  };
}

/** POST al servicio local con manejo del caso "servicio caído". */
async function postService(path: string, body: unknown): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${PRINT_SERVICE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(SERVICE_DOWN);
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || "No fue posible imprimir.");
  }
}

/** Imprime un documento en una impresora concreta (opcional: abrir cajón). */
export async function printDoc(
  printer: ConfiguredPrinter, doc: DocLine[], opts?: { openDrawer?: boolean },
): Promise<void> {
  await postService("/printer/print", { ...target(printer), doc, openDrawer: opts?.openDrawer });
}

/** Resuelve la impresora del endpoint e imprime; error claro si no hay. */
export async function printToEndpoint(
  endpoint: Endpoint, doc: DocLine[], opts?: { openDrawer?: boolean },
): Promise<void> {
  const printer = await resolvePrinter(endpoint);
  if (!printer) {
    throw new Error(
      `No hay impresora configurada para ${endpoint}. Agréguela en Configuración de impresoras.`,
    );
  }
  await printDoc(printer, doc, opts);
}

/** Abre el cajón monedero (impresora del endpoint CAJA). */
export async function openCashDrawer(): Promise<void> {
  const printer = await resolvePrinter("CAJA");
  if (!printer) {
    throw new Error(
      "No hay impresora configurada para CAJA (cajón monedero). Agréguela en Configuración de impresoras.",
    );
  }
  await postService("/printer/open-drawer", target(printer));
}

/* ════════════ Tirillas de la orden ════════════ */

interface ComandaPayload { json_local: string; json_externo: string; }

/**
 * Comanda de cocina (endpoint PEDIDO). itemIds limita a los productos recién
 * confirmados. Sin precios (es ticket de cocina), igual que Polaris.
 */
export async function imprimirComanda(orderId: number, itemIds?: number[]): Promise<void> {
  const qs = itemIds?.length ? `?items=${itemIds.join(",")}` : "";
  const payload = await api<ComandaPayload>(`/api/orders/${orderId}/comanda${qs}`);
  const ext = JSON.parse(payload.json_externo) as {
    pedido: string; fecha: string; hora: string; mesero: string;
    mesa: number | null; zona: string; comentario: string;
    productos: { nombre: string; cantidad: number }[];
  };
  const doc: DocLine[] = [
    { t: "text", v: `PEDIDO N ${ext.pedido}`, align: "center" },
    { t: "blank" },
    { t: "text", v: `FECHA: ${ext.fecha}` },
    { t: "text", v: `HORA: ${ext.hora}` },
    { t: "text", v: `ZONA: ${ext.zona}` },
    { t: "text", v: `MESA #: ${ext.mesa ?? ""}` },
    { t: "text", v: `MESERO: ${ext.mesero}` },
    { t: "divider" },
    { t: "cols", cells: ["Cant", "Producto"], widths: [5, "*"], align: ["center", "left"] },
    ...ext.productos.map((p): DocLine => ({
      t: "cols", cells: [String(p.cantidad), p.nombre], widths: [5, "*"], align: ["center", "left"],
    })),
    ...(ext.comentario
      ? [{ t: "divider" } as DocLine, { t: "text", v: `NOTA: ${ext.comentario}` } as DocLine]
      : []),
    { t: "blank" },
    { t: "text", v: "Impreso por AgoraOps", align: "center" },
  ];
  await printToEndpoint("PEDIDO", doc);
}

interface PrefacturaPayload {
  comercio: string; direccion: string; nit: string; pedido: number;
  mesa: number | null; mesero: string;
  productos: { nombre: string; cantidad: number; valor_unitario: number; valor: number }[];
  subtotal: number; total: number; propina: number;
}

/** Prefactura / cuenta previa (endpoint PREFACTURA). */
export async function imprimirPreFactura(orderId: number): Promise<void> {
  const p = await api<PrefacturaPayload>(`/api/orders/${orderId}/prefactura`);
  const doc: DocLine[] = [
    { t: "text", v: p.comercio || "AgoraOps", align: "center" },
    ...(p.nit ? [{ t: "text", v: `NIT: ${p.nit}`, align: "center" } as DocLine] : []),
    ...(p.direccion ? [{ t: "text", v: p.direccion, align: "center" } as DocLine] : []),
    { t: "divider" },
    { t: "text", v: "PRE-FACTURA", align: "center" },
    { t: "kv", k: "Pedido N", v: String(p.pedido) },
    { t: "kv", k: "Mesa", v: String(p.mesa ?? "") },
    { t: "kv", k: "Mesero", v: p.mesero },
    { t: "divider" },
    ...p.productos.map((it): DocLine => ({
      t: "row", left: `${it.cantidad} ${it.nombre}`, right: cop.format(it.valor),
    })),
    { t: "divider" },
    { t: "kv", k: "Subtotal", v: cop.format(p.subtotal) },
    ...(p.propina ? [{ t: "kv", k: "Propina", v: cop.format(p.propina) } as DocLine] : []),
    { t: "kv", k: "TOTAL", v: cop.format(p.total) },
    { t: "blank" },
    { t: "text", v: "Gracias por su visita", align: "center" },
  ];
  await printToEndpoint("PREFACTURA", doc);
}
