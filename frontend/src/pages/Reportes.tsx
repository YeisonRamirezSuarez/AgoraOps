/**
 * Reportes — manual §1.9: Reporte general (admin), Reporte de ventas
 * (admin y mesero_cocina; trabajador solo sus ventas del día), Órdenes
 * canceladas (admin) y Duplicado voucher (por número de orden).
 */
import { useCallback, useEffect, useState } from "react";
import { Eraser, FileSpreadsheet, FileText, Receipt, Search } from "lucide-react";
import * as XLSX from "xlsx";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { EnConstruccion } from "../components/EnConstruccion";
import { useTabParam } from "../lib/useTab";
import {
  Badge, Button, cop, Field, fmtDateTime, Input, Modal, PageHeader, Select,
  Table, usePagination, useToast,
} from "../components/ui";

const today = () => new Date().toISOString().slice(0, 10);

export default function Reportes() {
  const { user } = useAuth();
  const isAdmin = user?.roleType === "administrador" || user?.isSuperAdmin;
  const tabs = isAdmin
    ? ["Reporte general", "Reporte de ventas", "Reporte de productos",
       "Ordenes canceladas", "Ventas a crédito", "Duplicado voucher"]
    : ["Reporte de ventas", "Duplicado voucher"];
  const [tab, setTab] = useTabParam(tabs);

  return (
    <div className="fade-in-up">
      <PageHeader title={tab} subtitle="Reportes" />
      {tab === "Reporte de ventas" && <SalesTab isAdmin={!!isAdmin} />}
      {tab === "Reporte general" && <GeneralTab />}
      {tab === "Ordenes canceladas" && <CancelledTab />}
      {tab === "Reporte de productos" && (
        <EnConstruccion titulo="Reporte de productos"
          nota="Productos más vendidos con unidades y totales — siguiente iteración (los datos ya existen en order_items)." />
      )}
      {tab === "Ventas a crédito" && (
        <EnConstruccion titulo="Ventas a crédito"
          nota="Ventas con método CUENTA POR COBRAR y su estado de cartera — pendiente de definición de requisitos." />
      )}
      {tab === "Duplicado voucher" && <VoucherTab />}
    </div>
  );
}

function DateFilters({ from, to, setFrom, setTo, onSearch }: {
  from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void;
  onSearch: () => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <Field label="Desde"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="!w-40" /></Field>
      <Field label="Hasta"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="!w-40" /></Field>
      <Button onClick={onSearch}><Search size={14} className="-mt-0.5 mr-1 inline" /> Búsqueda</Button>
    </div>
  );
}

/* ───────── Reporte de ventas (§1.9.2) ───────── */
function SalesTab({ isAdmin }: { isAdmin: boolean }) {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(() => {
    api<Record<string, unknown>[]>(`/api/reports/sales?from=${from}&to=${to}`)
      .then(setRows).catch(() => {});
  }, [from, to]);
  useEffect(load, [load]);

  const total = rows.reduce((s, r) => s + Number(r.total), 0);
  const { slice, bar } = usePagination(rows);

  return (
    <>
      {isAdmin
        ? <DateFilters from={from} to={to} setFrom={setFrom} setTo={setTo} onSearch={load} />
        : <p className="mb-4 text-xs text-text-muted">Se muestran sus ventas del día actual.</p>}
      <p className="mb-3 text-sm text-text-secondary">
        {rows.length} ventas · Total <span className="font-bold text-text-primary">{cop.format(total)}</span>
      </p>
      <Table headers={["Orden", "Fecha", "Mesa", "Atendió", "Cliente", "Total", "Pagos", ""]} empty={rows.length === 0}>
        {slice.map((r) => (
          <tr key={String(r.id)}>
            <td className="px-4 py-2">#{String(r.order_number)}</td>
            <td className="px-4 py-2 text-xs">{fmtDateTime(r.created_at as string)}</td>
            <td className="px-4 py-2">{r.table_number ? `Mesa ${r.table_number}` : "—"}</td>
            <td className="px-4 py-2">{String(r.attended_by ?? "—")}</td>
            <td className="px-4 py-2">{String(r.client_name ?? "—")}</td>
            <td className="px-4 py-2 font-medium">{cop.format(Number(r.total))}</td>
            <td className="px-4 py-2 text-xs">
              {(r.payments as { method: string; amount: number }[])
                .map((p) => `${p.method}: ${cop.format(Number(p.amount))}`).join(" · ")}
            </td>
            <td className="px-4 py-2">
              <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>Detalle</Button>
            </td>
          </tr>
        ))}
      </Table>

      {bar}

      <Modal open={!!detail} title={`Detalle de venta #${detail?.order_number ?? ""}`} onClose={() => setDetail(null)}>
        {detail && (
          <ul className="space-y-1 text-sm">
            {(detail.items as { name: string; qty: number; subtotal: number }[]).map((i, idx) => (
              <li key={idx} className="flex justify-between border-b border-border-subtle py-1.5 last:border-0">
                <span>{i.name} ×{i.qty}</span>
                <span>{cop.format(Number(i.subtotal))}</span>
              </li>
            ))}
            <li className="flex justify-between pt-2 font-bold">
              <span>Total</span><span>{cop.format(Number(detail.total))}</span>
            </li>
          </ul>
        )}
      </Modal>
    </>
  );
}

/* ───────── Reporte general (§1.9.1 — réplica Polaris) ─────────
   Filtros: Atendió (usuario que abrió), Vendió (cajero que cobró), Fecha de
   fin (paid_at), Método de pago y Caja. Grid de 13 columnas con Subtotal
   BRUTO (incluye cancelados) y Total neto; Exportar XLS; drill-down a
   "Registro de la orden" y al Recibo. */

const pct = (v: unknown) => `${Number(v)}%`; // 10.00 → "10%"
const estadoLabel = (s: unknown) =>
  s === "pagada" ? "FINALIZADO" : s === "abierta" ? "EN CURSO" : "CANCELADA";

interface GeneralFilters {
  users: { id: string; username: string; full_name: string }[];
  paymentMethods: { id: number; name: string }[];
  cashSessions: { id: number; label: string }[];
}

function GeneralTab() {
  const toast = useToast();
  const [opts, setOpts] = useState<GeneralFilters>({
    users: [], paymentMethods: [], cashSessions: [],
  });
  // Filtros (vacío = "Seleccione una opción", igual que Polaris)
  const [atendio, setAtendio] = useState("");
  const [vendio, setVendio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [payMethod, setPayMethod] = useState("");
  const [cashSession, setCashSession] = useState("");

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [receiptId, setReceiptId] = useState<number | null>(null);

  useEffect(() => {
    api<GeneralFilters>("/api/reports/general/filters").then(setOpts).catch(() => {});
  }, []);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (atendio) qs.set("atendio", atendio);
    if (vendio) qs.set("vendio", vendio);
    if (fechaFin) qs.set("fechaFin", fechaFin);
    if (payMethod) qs.set("payMethod", payMethod);
    if (cashSession) qs.set("cashSession", cashSession);
    api<Record<string, unknown>[]>(`/api/reports/general?${qs.toString()}`)
      .then(setRows).catch(() => {});
  }, [atendio, vendio, fechaFin, payMethod, cashSession]);
  useEffect(load, [load]);

  function clearFilters() {
    setAtendio(""); setVendio(""); setFechaFin(""); setPayMethod(""); setCashSession("");
  }

  function exportXls() {
    if (rows.length === 0) { toast("error", "No hay registros para exportar."); return; }
    const header = [
      "Número de orden", "Fecha de inicio", "Fecha de fin", "Estado de la orden",
      "Atendió", "Vendió", "Método de pago", "Subtotal", "Propina",
      "Porcentaje de la propina", "Descuento", "Domicilio", "Total",
    ];
    const data = rows.map((r) => [
      String(r.order_number), fmtDateTime(r.opened_at as string),
      fmtDateTime(r.paid_at as string), estadoLabel(r.status),
      String(r.atendio ?? ""), String(r.vendio ?? ""), String(r.pay_method ?? ""),
      Number(r.subtotal), Number(r.tip), pct(r.tip_percentage),
      Number(r.discount), Number(r.delivery_fee), Number(r.total),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reporte general");
    XLSX.writeFile(wb, "Reporte_general.xlsx");
  }

  const { slice, bar } = usePagination(rows);

  return (
    <>
      {/* Filtros — réplica del formulario de búsqueda de Polaris */}
      <div className="glass mb-4 rounded-2xl p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Atendió">
            <Select value={atendio} onChange={(e) => setAtendio(e.target.value)}>
              <option value="">Seleccione una opción</option>
              {opts.users.map((u) => (
                <option key={u.id} value={u.id}>{u.username}</option>
              ))}
            </Select>
          </Field>
          <Field label="Vendió">
            <Select value={vendio} onChange={(e) => setVendio(e.target.value)}>
              <option value="">Seleccione una opción</option>
              {opts.users.map((u) => (
                <option key={u.id} value={u.id}>{u.username}</option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha de fin">
            <Input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
          </Field>
          <Field label="Método de pago">
            <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              <option value="">Seleccione una opción</option>
              {opts.paymentMethods.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Caja">
            <Select value={cashSession} onChange={(e) => setCashSession(e.target.value)}>
              <option value="">Seleccione una opción</option>
              {opts.cashSessions.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={load}><Search size={14} className="-mt-0.5 mr-1 inline" /> Búsqueda</Button>
          <Button variant="ghost" onClick={clearFilters}>
            <Eraser size={14} className="-mt-0.5 mr-1 inline" /> Limpiar Filtros
          </Button>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-text-secondary">{rows.length} órdenes</p>
        <Button variant="ghost" onClick={exportXls}>
          <FileSpreadsheet size={14} className="-mt-0.5 mr-1 inline" /> Exportar
        </Button>
      </div>

      <Table
        headers={[
          "", "Número de orden", "Fecha de inicio", "Fecha de fin", "Estado de la orden",
          "Atendió", "Vendió", "Método de pago", "Subtotal", "Propina",
          "Porcentaje de la propina", "Descuento", "Domicilio", "Total",
        ]}
        empty={rows.length === 0}
      >
        {slice.map((r) => (
          <tr key={String(r.id)}>
            <td className="whitespace-nowrap px-4 py-2">
              <button title="Registro de la orden" className="mr-2 text-text-muted hover:text-brand-500"
                onClick={() => setDetailId(Number(r.id))}>
                <FileText size={16} className="inline" />
              </button>
              <button title="Recibo" className="text-text-muted hover:text-brand-500"
                onClick={() => setReceiptId(Number(r.id))}>
                <Receipt size={16} className="inline" />
              </button>
            </td>
            <td className="px-4 py-2">{String(r.order_number)}</td>
            <td className="px-4 py-2 text-xs">{fmtDateTime(r.opened_at as string)}</td>
            <td className="px-4 py-2 text-xs">{fmtDateTime(r.paid_at as string)}</td>
            <td className="px-4 py-2">
              <Badge color={r.status === "pagada" ? "emerald" : "amber"}>
                {estadoLabel(r.status)}
              </Badge>
            </td>
            <td className="px-4 py-2">{String(r.atendio ?? "—")}</td>
            <td className="px-4 py-2">{String(r.vendio ?? "—")}</td>
            <td className="px-4 py-2">{String(r.pay_method ?? "—")}</td>
            <td className="px-4 py-2">{cop.format(Number(r.subtotal))}</td>
            <td className="px-4 py-2">{cop.format(Number(r.tip))}</td>
            <td className="px-4 py-2">{pct(r.tip_percentage)}</td>
            <td className="px-4 py-2">{cop.format(Number(r.discount))}</td>
            <td className="px-4 py-2">{cop.format(Number(r.delivery_fee))}</td>
            <td className="px-4 py-2 font-medium">{cop.format(Number(r.total))}</td>
          </tr>
        ))}
      </Table>

      {bar}

      <OrderDetailModal id={detailId} onClose={() => setDetailId(null)} />
      <ReceiptModal id={receiptId} onClose={() => setReceiptId(null)} />
    </>
  );
}

/* ── Registro de la orden (drill-down): todos los ítems incl. cancelados ── */
function OrderDetailModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    if (id == null) { setRows([]); return; }
    api<Record<string, unknown>[]>(`/api/reports/general/${id}/items`)
      .then(setRows).catch(() => {});
  }, [id]);

  function exportXls() {
    if (rows.length === 0) return;
    const header = [
      "Número de orden", "Número de mesa", "Tipo de producto", "Nombre del producto",
      "Cantidad del producto", "Cantidad del topping", "Promoción aplicada",
      "Monto de descuento", "Descripción", "Estado del pago", "Total",
    ];
    const data = rows.map((r) => [
      String(r.order_number), r.table_number ? String(r.table_number) : "",
      String(r.product_type), String(r.product_name), Number(r.quantity),
      Number(r.topping_qty), "", 0, String(r.description ?? ""),
      String(r.pay_state), Number(r.total),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Registro de la orden");
    XLSX.writeFile(wb, `Registro_orden_${rows[0]?.order_number ?? id}.xlsx`);
  }

  return (
    <Modal open={id != null} title={`Registro de la orden ${rows[0]?.order_number ?? ""}`}
      onClose={onClose} wide>
      <div className="mb-3 flex justify-end">
        <Button variant="ghost" size="sm" onClick={exportXls}>
          <FileSpreadsheet size={14} className="-mt-0.5 mr-1 inline" /> Exportar
        </Button>
      </div>
      <Table
        headers={[
          "N° orden", "N° mesa", "Tipo de producto", "Nombre del producto",
          "Cant. producto", "Cant. topping", "Promoción aplicada",
          "Monto de descuento", "Descripción", "Estado del pago", "Total",
        ]}
        empty={rows.length === 0}
      >
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="px-3 py-2">{String(r.order_number)}</td>
            <td className="px-3 py-2">{r.table_number ? String(r.table_number) : "—"}</td>
            <td className="px-3 py-2">{String(r.product_type)}</td>
            <td className="px-3 py-2">{String(r.product_name)}</td>
            <td className="px-3 py-2">{Number(r.quantity)}</td>
            <td className="px-3 py-2">{Number(r.topping_qty)}</td>
            <td className="px-3 py-2">—</td>
            <td className="px-3 py-2">{cop.format(0)}</td>
            <td className="max-w-44 truncate px-3 py-2">{String(r.description ?? "—")}</td>
            <td className="px-3 py-2">
              <Badge color={r.pay_state === "CANCELADO" ? "rose"
                : r.pay_state === "PAGO" ? "emerald" : "amber"}>
                {String(r.pay_state)}
              </Badge>
            </td>
            <td className="px-3 py-2 font-medium">{cop.format(Number(r.total))}</td>
          </tr>
        ))}
      </Table>
    </Modal>
  );
}

/* ── Recibo (drill-down): voucher con totales (réplica blank_receipt_report) ── */
function ReceiptModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const [r, setR] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (id == null) { setR(null); return; }
    api<Record<string, unknown>>(`/api/reports/general/${id}/receipt`)
      .then(setR).catch(() => {});
  }, [id]);

  const items = (r?.items ?? []) as { name: string; qty: number; unit: number; subtotal: number }[];

  return (
    <Modal open={id != null} title="Recibo" onClose={onClose}>
      {r && (
        <div className="font-mono text-sm">
          <div className="text-center">
            <p className="text-base font-bold">{String(r.business_name ?? "")}</p>
            {r.address ? <p className="text-xs">{String(r.address)}</p> : null}
            {r.tax_id ? <p className="text-xs">NIT - {String(r.tax_id)}</p> : null}
          </div>
          <div className="my-2 border-y border-dashed border-border-medium py-2 text-xs">
            <p className="font-bold">Pedido: {String(r.order_number)}
              {r.table_number ? ` / Mesa: ${r.table_number}` : ""}</p>
            <p>Inicio: {fmtDateTime(r.opened_at as string)}</p>
            <p>Fin: {fmtDateTime(r.paid_at as string)}</p>
          </div>
          <div className="text-xs">
            <p>Mesero: {String(r.attended_name ?? "—")}</p>
            <p>Cajero: {String(r.cashier_name ?? "—")}</p>
            {r.cash_register_name ? <p>Caja: {String(r.cash_register_name)}</p> : null}
            <p>Método de Pago: {String(r.pay_method ?? "—")}</p>
          </div>
          <div className="my-2 border-y border-dashed border-border-medium py-2">
            <p className="mb-1 text-center font-bold">RECIBO</p>
            {items.map((it, i) => (
              <div key={i} className="flex justify-between">
                <span>{it.name} ×{it.qty}</span>
                <span>{cop.format(Number(it.subtotal))}</span>
              </div>
            ))}
          </div>
          <div className="space-y-0.5 text-xs">
            <div className="flex justify-between"><span>SUBTOTAL</span><span>{cop.format(Number(r.subtotal))}</span></div>
            {/* Línea del % = propina SUGERIDA (config); PROPINA = la real que dio el cliente */}
            <div className="flex justify-between"><span>{pct(r.tip_percentage)}</span><span>{cop.format(Math.round(Number(r.subtotal) * Number(r.tip_percentage) / 100))}</span></div>
            <div className="flex justify-between"><span>PROPINA</span><span>{cop.format(Number(r.tip))}</span></div>
            {Number(r.discount) > 0 && (
              <div className="flex justify-between"><span>DESCUENTO</span><span>-{cop.format(Number(r.discount))}</span></div>
            )}
            {Number(r.delivery_fee) > 0 && (
              <div className="flex justify-between"><span>DOMICILIO</span><span>{cop.format(Number(r.delivery_fee))}</span></div>
            )}
            <div className="flex justify-between pt-1 text-sm font-bold"><span>TOTAL</span><span>{cop.format(Number(r.total))}</span></div>
          </div>
          <Button className="mt-4 w-full" variant="ghost" onClick={() => window.print()}>Imprimir</Button>
        </div>
      )}
    </Modal>
  );
}

/* ───────── Órdenes canceladas (§1.9.3) ───────── */
function CancelledTab() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(() => {
    api<Record<string, unknown>[]>(`/api/reports/cancelled?from=${from}&to=${to}`)
      .then(setRows).catch(() => {});
  }, [from, to]);
  useEffect(load, [load]);
  const { slice, bar } = usePagination(rows);

  return (
    <>
      <DateFilters from={from} to={to} setFrom={setFrom} setTo={setTo} onSearch={load} />
      <Table headers={["Orden", "Fecha", "Mesa", "Atendió", "Canceló", "Motivo", "Valor", ""]} empty={rows.length === 0}>
        {slice.map((r) => {
          const items = r.cancelled_items as unknown[];
          return (
            <tr key={String(r.id)}>
              <td className="px-4 py-2">#{String(r.order_number)}</td>
              <td className="px-4 py-2 text-xs">{fmtDateTime(r.cancelled_at as string)}</td>
              <td className="px-4 py-2">{r.table_number ? `Mesa ${r.table_number}` : "—"}</td>
              <td className="px-4 py-2">{String(r.attended_by ?? "—")}</td>
              <td className="px-4 py-2">{String(r.cancelled_by_name ?? "—")}</td>
              <td className="max-w-44 truncate px-4 py-2">{String(r.cancel_reason ?? "—")}</td>
              <td className="px-4 py-2 text-accent-rose">{cop.format(Number(r.cancelled_value ?? 0))}</td>
              <td className="px-4 py-2">
                {items.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>Detalle</Button>
                )}
              </td>
            </tr>
          );
        })}
      </Table>

      {bar}

      <Modal open={!!detail} title="Productos cancelados" onClose={() => setDetail(null)}>
        {detail && (
          <ul className="space-y-2 text-sm">
            {(detail.cancelled_items as { name: string; qty: number; reason: string; by: string }[]).map((i, idx) => (
              <li key={idx} className="rounded-lg border border-border-subtle p-2">
                <p className="font-medium">{i.name} ×{i.qty}</p>
                <p className="text-xs text-text-secondary">Motivo: {i.reason ?? "—"} · Por: {i.by ?? "—"}</p>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}

/* ───────── Duplicado voucher (§1.9.4) ───────── */
function VoucherTab() {
  const toast = useToast();
  const [orderNumber, setOrderNumber] = useState("");
  const [voucher, setVoucher] = useState<Record<string, unknown> | null>(null);

  async function find() {
    if (!orderNumber.trim()) {
      toast("error", "Ingrese el número de orden.");
      return;
    }
    setVoucher(null);
    try {
      setVoucher(await api(`/api/reports/voucher/${orderNumber.trim()}`));
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No fue posible obtener el voucher");
    }
  }

  return (
    <div className="max-w-lg">
      <div className="mb-4 flex items-end gap-2">
        <Field label="Número de orden">
          <Input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
        </Field>
        <Button onClick={find}>Buscar</Button>
      </div>

      {voucher && (
        <div className="glass rounded-2xl p-5 font-mono text-sm">
          <p className="mb-1 text-center text-base font-bold">VOUCHER — #{String(voucher.order_number)}</p>
          <p className="mb-3 text-center text-xs text-text-muted">
            {fmtDateTime(voucher.created_at as string)}
            {voucher.table_number ? ` · Mesa ${voucher.table_number}` : ""}
          </p>
          <div className="border-y border-dashed border-border-medium py-2">
            {(voucher.items as { name: string; qty: number; subtotal: number }[]).map((i, idx) => (
              <div key={idx} className="flex justify-between">
                <span>{i.name} ×{i.qty}</span>
                <span>{cop.format(Number(i.subtotal))}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between py-2 font-bold">
            <span>TOTAL</span><span>{cop.format(Number(voucher.total))}</span>
          </div>
          {/* Multi-pago: un voucher por pago (§1.9.4) */}
          <div className="border-t border-dashed border-border-medium pt-2 text-xs">
            {(voucher.payments as { method: string; amount: number; voucher: string }[]).map((p, idx) => (
              <div key={idx} className="flex justify-between">
                <span>{p.method} ({p.voucher})</span>
                <span>{cop.format(Number(p.amount))}</span>
              </div>
            ))}
          </div>
          <Button className="mt-4 w-full" variant="ghost" onClick={() => window.print()}>
            Imprimir
          </Button>
        </div>
      )}
    </div>
  );
}
