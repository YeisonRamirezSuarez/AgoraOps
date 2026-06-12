/**
 * Reportes — manual §1.9: Reporte general (admin), Reporte de ventas
 * (admin y mesero_cocina; trabajador solo sus ventas del día), Órdenes
 * canceladas (admin) y Duplicado voucher (por número de orden).
 */
import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { EnConstruccion } from "../components/EnConstruccion";
import { useTabParam } from "../lib/useTab";
import {
  Badge, Button, cop, Field, Input, Modal, PageHeader, Table, usePagination, useToast,
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
            <td className="px-4 py-2 text-xs">{new Date(String(r.created_at)).toLocaleString("es-CO")}</td>
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

/* ───────── Reporte general (§1.9.1) ───────── */
function GeneralTab() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);

  const load = useCallback(() => {
    api<Record<string, unknown>[]>(`/api/reports/general?from=${from}&to=${to}`)
      .then(setRows).catch(() => {});
  }, [from, to]);
  useEffect(load, [load]);
  const { slice, bar } = usePagination(rows);

  return (
    <>
      <DateFilters from={from} to={to} setFrom={setFrom} setTo={setTo} onSearch={load} />
      <Table headers={["Orden", "Fecha", "Mesa", "Estado", "Atendió", "Total"]} empty={rows.length === 0}>
        {slice.map((r) => (
          <tr key={String(r.id)}>
            <td className="px-4 py-2">#{String(r.order_number)}</td>
            <td className="px-4 py-2 text-xs">{new Date(String(r.created_at)).toLocaleString("es-CO")}</td>
            <td className="px-4 py-2">{r.table_number ? `Mesa ${r.table_number}` : "—"}</td>
            <td className="px-4 py-2">
              <Badge color={r.status === "pagada" ? "emerald" : "amber"}>
                {r.status === "pagada" ? "Finalizada" : "En curso"}
              </Badge>
            </td>
            <td className="px-4 py-2">{String(r.attended_by ?? "—")}</td>
            <td className="px-4 py-2 font-medium">{cop.format(Number(r.total))}</td>
          </tr>
        ))}
      </Table>

      {bar}
    </>
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
              <td className="px-4 py-2 text-xs">{r.cancelled_at ? new Date(String(r.cancelled_at)).toLocaleString("es-CO") : "—"}</td>
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
            {new Date(String(voucher.created_at)).toLocaleString("es-CO")}
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
