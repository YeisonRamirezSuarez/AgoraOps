/**
 * Pago full — manual §1.6.3, layout Polaris Food:
 * izquierda: TOTAL grande + toggles (Propina, Combinado, Pago por
 * producto, Venta a crédito, Pago directo) + CONFIGURACIÓN (cliente
 * obligatorio con *Crear cliente y método de pago); derecha: "Recepción
 * de {método}" con monto, atajos de denominación (§1.7.8), banner
 * Faltante/Cambio y botón Cobrar habilitado solo cuando alcanza.
 * Cobrar → modal "Resumen de Transacción" (cliente, método, Caja de
 * Pago, totales, recibido/cambio) → Confirmar Pago → "Orden Cerrada" y
 * modal de voucher: Imprimir (comprobante de pago) / Correo Electrónico
 * (pendiente) / X para volver a mesas.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Banknote, ClipboardCheck, CreditCard, HandCoins, Info,
  LayoutGrid, Plus, Trash2, WalletCards, X, Zap,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { escHtml, printReceipt } from "../lib/printing";
import { Badge, Button, cop, Field, Input, Loader, MoneyInput, Select, useToast } from "../components/ui";
import type { Order, OrderItem } from "./Orden";

interface PaymentOptions {
  methods: { id: number; name: string }[];
  banks: { id: number; name: string }[];
  denominations: { id: number; value: string }[];
  sessions: { id: number; name: string }[];
  settings: {
    tip_enabled: boolean; tip_percentage: string;
    business_name: string | null; address: string | null;
    phone: string | null; tax_id: string | null;
  } | null;
}
interface PayLine { method_id: string; bank_id: string; amount: string }
interface PaidVoucher {
  payments: { method: string; amount: string; voucher_number: string; change_given: string }[];
  items: OrderItem[];
  clientName: string;
  subtotal: number; tip: number; total: number;
  received: number; change: number;
}

export default function Pago() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [order, setOrder] = useState<Order | null>(null);
  const [tableNumber, setTableNumber] = useState<number | null>(null);
  const [options, setOptions] = useState<PaymentOptions | null>(null);
  const [clients, setClients] = useState<{ id: number; name: string; document_id: string | null }[]>([]);

  // Toggles
  const [tipOn, setTipOn] = useState(false);
  const [split, setSplit] = useState(false);
  const [byProduct, setByProduct] = useState(false);
  const [direct, setDirect] = useState(false);

  const [clientId, setClientId] = useState("");
  const [newClient, setNewClient] = useState<{ name: string; document_id: string } | null>(null);
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [lines, setLines] = useState<PayLine[]>([{ method_id: "", bank_id: "", amount: "" }]);
  const [paying, setPaying] = useState(false);

  // Resumen de transacción + voucher
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [voucher, setVoucher] = useState<PaidVoucher | null>(null);

  useEffect(() => {
    api<Order>(`/api/orders/${orderId}`).then(setOrder).catch(() => navigate("/mesas"));
    api<PaymentOptions>("/api/orders/payment-options").then((o) => {
      setOptions(o);
      // Preseleccionar EFECTIVO y la caja abierta más reciente, como Polaris
      const cash = o.methods.find((m) => m.name === "EFECTIVO");
      if (cash) setLines([{ method_id: String(cash.id), bank_id: "", amount: "" }]);
      if ((o.sessions ?? []).length > 0) setSessionId(String(o.sessions[0].id));
    });
    api<typeof clients>("/api/catalogs/clients").then(setClients).catch(() => {});
    api<{ table_id: number; number: number; order_id: number | null }[]>("/api/orders/board")
      .then((b) => {
        const cell = b.find((c) => c.order_id === Number(orderId));
        if (cell) setTableNumber(cell.number);
      }).catch(() => {});
  }, [orderId, navigate]);

  const items: OrderItem[] = useMemo(
    () => (order?.items ?? []).filter((i) => i.kitchen_status !== "cancelado" && !i.is_paid),
    [order],
  );
  const payingItems = byProduct ? items.filter((i) => selectedItems.includes(i.id)) : items;

  const amountDue = payingItems.reduce((s, i) => s + Number(i.subtotal), 0);
  const tipPct = Number(options?.settings?.tip_percentage ?? 0);
  const tipEnabled = !!options?.settings?.tip_enabled;
  const tip = tipOn && tipEnabled ? Math.round((amountDue * tipPct) / 100) : 0;
  const toPay = amountDue + tip;
  const entered = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  
  // Si no hay monto ingresado y no está dividido, asumimos PAGO EXACTO
  const isExactPayment = !split && lines.length === 1 && !lines[0].amount && toPay > 0;
  const actualEntered = isExactPayment ? toPay : entered;
  const missing = Math.max(0, toPay - actualEntered);
  const change = Math.max(0, actualEntered - toPay);

  const methodName = (id: string) =>
    options?.methods.find((m) => String(m.id) === id)?.name ?? "";
  const clientName = newClient?.name
    || clients.find((c) => String(c.id) === clientId)?.name
    || "";

  function setLine(idx: number, patch: Partial<PayLine>) {
    setLines(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  /** Validaciones previas → abre el Resumen de Transacción (manual §1.6.3). */
  async function openSummary() {
    if (newClient && !newClient.name.trim()) {
      toast("error", "El nombre del cliente es obligatorio");
      return;
    }
    if (!newClient && !clientId) {
      toast("error", "El cliente es obligatorio para facturar el pago.");
      return;
    }
    if (byProduct && selectedItems.length === 0) {
      toast("error", "Seleccione los productos a pagar.");
      return;
    }
    
    let currentLines = lines;
    if (isExactPayment) {
      currentLines = [{ ...lines[0], amount: String(toPay) }];
      setLines(currentLines);
    }

    const valid = currentLines.filter((l) => l.method_id && Number(l.amount) > 0);
    const currentEntered = currentLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const currentMissing = Math.max(0, toPay - currentEntered);

    if (valid.length === 0 || currentMissing > 0) {
      toast("error", `Faltan ${cop.format(currentMissing)} por ingresar.`);
      return;
    }
    // Transferencia requiere banco (§1.6.3)
    for (const l of valid) {
      if (methodName(l.method_id) === "TRANSFERENCIA" && !l.bank_id) {
        toast("error", "Seleccione el banco para la transferencia.");
        return;
      }
    }
    // Refrescar las cajas abiertas al momento de cobrar: pueden abrirse o
    // cerrarse mientras esta pantalla está en uso
    let fresh = options;
    try {
      fresh = await api<PaymentOptions>("/api/orders/payment-options");
      setOptions(fresh);
    } catch { /* sin conexión: se usa lo ya cargado */ }
    const sessions = fresh?.sessions ?? [];
    if (sessions.length === 0) {
      toast("error", "No hay cajas abiertas; no es posible registrar el pago.");
      return;
    }
    if (!sessions.some((s) => String(s.id) === sessionId)) {
      setSessionId(String(sessions[0].id));
    }
    setSummaryOpen(true);
  }

  /** Confirmar Pago en el resumen → registra el pago en la caja elegida. */
  async function confirmPay() {
    let finalClientId = Number(clientId);
    const valid = lines.filter((l) => l.method_id && Number(l.amount) > 0);

    // Propina al primer pago con monto ≥ propina (§1.6.3)
    let tipAssigned = false;
    const body = valid.map((l, idx) => {
      const amount = Number(l.amount);
      const isCash = methodName(l.method_id) === "EFECTIVO";
      const change_given = idx === valid.length - 1 && change > 0 && isCash ? change : 0;
      const tip_included = !tipAssigned && tip > 0 && amount >= tip ? ((tipAssigned = true), tip) : 0;
      return {
        method_id: Number(l.method_id),
        bank_id: l.bank_id ? Number(l.bank_id) : null,
        amount, tip_included, change_given,
        ...(byProduct ? { item_ids: selectedItems } : {}),
      };
    });

    setPaying(true);
    try {
      if (newClient) {
        const created = await api<{ id: number }>("/api/catalogs/clients", {
          method: "POST", body: newClient,
        });
        finalClientId = created.id;
      }
      const r = await api<{ payments: PaidVoucher["payments"] }>(`/api/orders/${orderId}/pay`, {
        method: "POST",
        body: {
          clientId: finalClientId, tip, payments: body,
          sessionId: sessionId ? Number(sessionId) : null,
        },
      });
      setSummaryOpen(false);
      toast("success", "Orden Cerrada");
      setVoucher({
        payments: r.payments,
        items: payingItems,
        clientName,
        subtotal: amountDue, tip, total: toPay,
        received: entered, change,
      });
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No fue posible registrar el pago");
    } finally {
      setPaying(false);
    }
  }

  /** Cierra el flujo de voucher y vuelve a mesas (o a la orden si quedó saldo). */
  function finish() {
    const fullyPaid = !byProduct || selectedItems.length === items.length;
    navigate(fullyPaid ? "/mesas" : `/mesas/${orderId}`);
  }

  /** Imprime el comprobante de pago final en una ventana aparte. */
  function printVoucher() {
    if (!voucher || !order) return;
    const s = options?.settings;
    const esc = escHtml;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Voucher ${esc(order.order_number)}</title>
<style>
  body{font-family:'Courier New',monospace;font-size:12px;width:300px;margin:0 auto;padding:12px;color:#000}
  h1{font-size:14px;text-align:center;margin:0}
  p{margin:2px 0;text-align:center}
  table{width:100%;border-collapse:collapse;margin:8px 0}
  td{padding:1px 0;vertical-align:top}
  .r{text-align:right}.b{font-weight:bold}
  hr{border:none;border-top:1px dashed #000;margin:6px 0}
</style></head><body onload="window.print();window.onafterprint=()=>window.close()">
<h1>${esc(s?.business_name || "AgoraOps")}</h1>
${s?.tax_id ? `<p>NIT: ${esc(s.tax_id)}</p>` : ""}
${s?.address ? `<p>${esc(s.address)}</p>` : ""}
${s?.phone ? `<p>Tel: ${esc(s.phone)}</p>` : ""}
<hr>
<p class="b">VOUCHER DE PAGO</p>
<p>Orden #${esc(order.order_number)}${tableNumber != null ? ` · Mesa ${tableNumber}` : ""}</p>
<p>${new Date().toLocaleString("es-CO")}</p>
<p>Cliente: ${esc(voucher.clientName || "—")}</p>
<hr>
<table>
${voucher.items.map((i) =>
    `<tr><td>${i.quantity}x ${esc(i.product_name)}</td><td class="r">${cop.format(Number(i.subtotal))}</td></tr>`,
  ).join("")}
</table>
<hr>
<table>
<tr><td>Subtotal</td><td class="r">${cop.format(voucher.subtotal)}</td></tr>
<tr><td>Propina</td><td class="r">${cop.format(voucher.tip)}</td></tr>
<tr class="b"><td>TOTAL</td><td class="r">${cop.format(voucher.total)}</td></tr>
<tr><td>Recibido</td><td class="r">${cop.format(voucher.received)}</td></tr>
<tr><td>Cambio</td><td class="r">${cop.format(voucher.change)}</td></tr>
</table>
<hr>
<table>
${voucher.payments.map((p) =>
    `<tr><td>${esc(p.method)}<br><span style="font-size:10px">${esc(p.voucher_number)}</span></td><td class="r">${cop.format(Number(p.amount))}</td></tr>`,
  ).join("")}
</table>
<p>¡Gracias por su compra!</p>
</body></html>`;
    if (!printReceipt(html, 620)) {
      toast("error", "No fue posible imprimir el voucher.");
      return;
    }
    toast("success", "El voucher fue impreso.");
    finish();
  }

  if (!order || !options) return <Loader label="Cargando cuenta" />;

  const singleLine = lines[0];
  const singleIsCash = methodName(singleLine?.method_id ?? "") === "EFECTIVO";
  const singleIsTransfer = methodName(singleLine?.method_id ?? "") === "TRANSFERENCIA";
  const methodsLabel = split
    ? [...new Set(lines.filter((l) => l.method_id).map((l) => methodName(l.method_id)))].join(" + ")
    : methodName(singleLine?.method_id ?? "");

  return (
    <>
      <div className="fade-in-up">
        {/* Encabezado */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/mesas/${orderId}`)}
            className="rounded-lg p-2 text-text-muted transition hover:bg-bg-tertiary hover:text-text-primary">
            <ArrowLeft size={19} />
          </button>
          <h1 className="text-lg font-bold">Pago full</h1>
        </div>
        <div className="flex gap-2">
          {tableNumber != null && <Badge color="blue">MESA {tableNumber}</Badge>}
          <Badge color="blue">ORDEN #{order.order_number}</Badge>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        {/* ══════════ Columna izquierda ══════════ */}
        <div className="space-y-5">
          <div className="glass overflow-hidden rounded-2xl">
            <div className="h-1 bg-gradient-to-r from-accent-blue via-accent-cyan to-accent-rose" />
            <div className="p-6">
              <p className="text-center text-[11px] font-bold uppercase tracking-widest text-text-muted">
                Total
              </p>
              <p className="mb-6 text-center text-4xl font-bold">{cop.format(toPay)}</p>

              <div className="grid gap-2 sm:grid-cols-2">
                {tipEnabled && (
                  <Toggle icon={<HandCoins size={15} />} label={`Propina (${tipPct}%)`}
                    checked={tipOn} onChange={setTipOn} />
                )}
                <Toggle icon={<LayoutGrid size={15} />} label="Combinado" checked={split}
                  onChange={(v) => {
                    setSplit(v);
                    setLines(v
                      ? [...lines, { method_id: "", bank_id: "", amount: "" }]
                      : [lines[0] ?? { method_id: "", bank_id: "", amount: "" }]);
                  }} />
                <Toggle icon={<ClipboardCheck size={15} />} label="Pago por producto" checked={byProduct}
                  onChange={(v) => { setByProduct(v); setSelectedItems([]); }} />
                <Toggle icon={<CreditCard size={15} />} label="Venta a crédito" checked={false} disabled
                  onChange={() => toast("error", "Venta a crédito — pendiente de definición de requisitos.")} />
                <Toggle icon={<Zap size={15} />} label="Pago directo" checked={direct} onChange={setDirect} />
              </div>

              {/* Selección de productos (Pago por producto §1.6.3) */}
              {byProduct && (
                <div className="mt-4 max-h-44 space-y-1 overflow-y-auto rounded-xl border border-border-subtle p-2">
                  {items.map((i) => (
                    <label key={i.id}
                      className={`flex items-center justify-between rounded-lg p-2 text-sm ${
                        selectedItems.includes(i.id) ? "bg-accent-emerald/10" : "hover:bg-bg-tertiary"
                      }`}>
                      <span className="flex items-center gap-2">
                        <input type="checkbox" checked={selectedItems.includes(i.id)}
                          onChange={(e) => setSelectedItems(e.target.checked
                            ? [...selectedItems, i.id]
                            : selectedItems.filter((x) => x !== i.id))}
                          className="h-4 w-4 accent-[hsl(160_84%_39%)]" />
                        {i.quantity}x {i.product_name}
                      </span>
                      <span className="font-medium">{cop.format(Number(i.subtotal))}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* CONFIGURACIÓN: cliente + método */}
          <div className="glass rounded-2xl p-6">
            <p className="mb-4 text-center text-[11px] font-bold uppercase tracking-widest text-text-muted">
              Configuración
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Cliente">
                {newClient ? (
                  <div className="space-y-2">
                    <Input placeholder="Nombre" value={newClient.name}
                      onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} />
                    <Input placeholder="NIT / Cédula" value={newClient.document_id}
                      onChange={(e) => setNewClient({ ...newClient, document_id: e.target.value })} />
                    <button onClick={() => setNewClient(null)}
                      className="text-xs text-accent-blue hover:underline">← volver a la lista</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Select value={clientId}
                      onChange={(e) => {
                        if (e.target.value === "__new__") setNewClient({ name: "", document_id: "" });
                        else setClientId(e.target.value);
                      }}>
                      <option value="">— Seleccione un cliente —</option>
                      <option value="__new__">＊ Crear cliente</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.document_id ? `${c.document_id} - ` : ""}{c.name}
                        </option>
                      ))}
                    </Select>
                    {clientId && (
                      <button onClick={() => setClientId("")} aria-label="Quitar cliente"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-rose/15 text-accent-rose">
                        <X size={13} />
                      </button>
                    )}
                  </div>
                )}
              </Field>

              {!split && (
                <Field label="Método de pago">
                  <Select value={singleLine?.method_id ?? ""}
                    onChange={(e) => setLine(0, { method_id: e.target.value, bank_id: "" })}>
                    {options.methods.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </Select>
                </Field>
              )}
              {!split && singleIsTransfer && (
                <Field label="Banco">
                  <Select value={singleLine?.bank_id ?? ""}
                    onChange={(e) => setLine(0, { bank_id: e.target.value })}>
                    <option value="">— Seleccione el banco —</option>
                    {options.banks.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
          </div>
        </div>

        {/* ══════════ Columna derecha: recepción ══════════ */}
        <div className="glass h-fit rounded-2xl p-6">
          <p className="mb-4 flex items-center gap-2 font-semibold">
            <Banknote size={17} className="text-accent-cyan" />
            Recepción de {split ? "Pagos" : (methodName(singleLine?.method_id ?? "") || "Efectivo")}
          </p>

          {!split ? (
            <>
              {/* Monto único grande */}
              <div className="glass mb-3 flex items-center gap-2 rounded-xl px-4 py-3">
                <span className="text-text-muted">$</span>
                <MoneyInput bare value={singleLine?.amount ?? ""}
                  onValueChange={(raw) => setLine(0, { amount: raw })}
                  placeholder="0,00"
                  className="w-full bg-transparent text-right text-2xl font-bold outline-none" />
                {singleLine?.amount && (
                  <button onClick={() => setLine(0, { amount: "" })} aria-label="Limpiar"
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bg-tertiary text-text-muted">
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Atajos de denominación (§1.7.8) */}
              {singleIsCash && options.denominations.length > 0 && (
                <div className="mb-4 grid grid-cols-2 gap-2">
                  {options.denominations.map((d) => (
                    <button key={d.id}
                      onClick={() => setLine(0, {
                        amount: String((Number(singleLine?.amount) || 0) + Number(d.value)),
                      })}
                      className="glass rounded-xl px-3 py-2.5 text-center transition hover:border-accent-orange/50">
                      <span className="block text-[10px] uppercase text-text-muted">Moneda</span>
                      <span className="font-bold">{cop.format(Number(d.value))}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            /* Pago combinado: varios métodos */
            <div className="mb-4 space-y-3">
              {lines.map((l, idx) => {
                const isTransfer = methodName(l.method_id) === "TRANSFERENCIA";
                return (
                  <div key={idx} className="rounded-xl border border-border-subtle p-3">
                    <div className="grid gap-2">
                      <div className="flex items-center gap-2">
                        <Select value={l.method_id}
                          onChange={(e) => setLine(idx, { method_id: e.target.value, bank_id: "" })}>
                          <option value="">— Método de pago —</option>
                          {options.methods.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </Select>
                        {lines.length > 1 && (
                          <button onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                            aria-label="Quitar método"
                            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-text-muted hover:bg-accent-rose/15 hover:text-accent-rose">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                      {isTransfer && (
                        <Select value={l.bank_id} onChange={(e) => setLine(idx, { bank_id: e.target.value })}>
                          <option value="">— Banco —</option>
                          {options.banks.map((b) => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </Select>
                      )}
                      <MoneyInput placeholder="Monto" value={l.amount}
                        onValueChange={(raw) => setLine(idx, { amount: raw })} />
                    </div>
                  </div>
                );
              })}
              <Button size="sm" variant="ghost"
                onClick={() => setLines([...lines, { method_id: "", bank_id: "", amount: "" }])}>
                <Plus size={13} className="-mt-0.5 mr-1 inline" /> Agregar Método de Pago
              </Button>
            </div>
          )}

          {/* Banner Faltante / Cambio */}
          {missing > 0 ? (
            <div className="mb-4 rounded-xl border border-accent-rose/40 bg-accent-rose/10 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-accent-rose">Faltante:</span>
                <Info size={15} className="text-accent-rose/70" />
              </div>
              <p className="text-right text-xl font-bold text-accent-rose">{cop.format(missing)}</p>
            </div>
          ) : change > 0 ? (
            <div className="mb-4 rounded-xl border border-accent-emerald/40 bg-accent-emerald/10 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-accent-emerald">Cambio:</span>
                <Info size={15} className="text-accent-emerald/70" />
              </div>
              <p className="text-right text-xl font-bold text-accent-emerald">{cop.format(change)}</p>
            </div>
          ) : entered > 0 ? (
            <div className="mb-4 flex items-center justify-between rounded-xl border border-accent-emerald/40 bg-accent-emerald/10 px-4 py-3">
              <span className="text-sm font-medium text-accent-emerald">Pago exacto</span>
              <span className="text-xl font-bold text-accent-emerald">{cop.format(0)}</span>
            </div>
          ) : null}

          {tip > 0 && (
            <p className="mb-3 text-center text-xs text-accent-amber">
              Incluye propina de {cop.format(tip)} ({tipPct}%)
            </p>
          )}

          <Button variant="success" className="w-full !py-3.5"
            disabled={paying || missing > 0 || toPay === 0}
            onClick={openSummary}>
            Cobrar&nbsp;&nbsp;{cop.format(toPay)}
          </Button>
        </div>
      </div>
      </div>

      {/* ══════════ Resumen de Transacción (manual §1.6.3) ══════════ */}
      {summaryOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          onMouseDown={(e) => e.target === e.currentTarget && setSummaryOpen(false)}>
          <div className="glass fade-in-up w-full max-w-md rounded-2xl p-6 shadow-2xl">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-accent-orange/15 text-accent-orange">
              <WalletCards size={22} />
            </div>
            <h2 className="mb-5 text-center text-xl font-bold">Resumen de Transacción</h2>

            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Cliente:</span>
                <span className="font-bold uppercase">{clientName || "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Método:</span>
                <span className="font-bold">{methodsLabel || "—"}</span>
              </div>
            </div>

            <p className="mb-1.5 mt-4 text-center text-xs font-medium text-text-secondary">
              Caja de Pago
            </p>
            <Select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
              {(options.sessions ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name.toUpperCase()}</option>
              ))}
            </Select>

            <div className="mt-4 space-y-1.5 border-t border-border-subtle pt-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Subtotal</span>
                <span className="font-medium">{cop.format(amountDue)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Propina</span>
                <span className="font-medium">{cop.format(tip)}</span>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-border-medium pt-3">
              <span className="text-lg font-bold">Total a Pagar</span>
              <span className="text-lg font-bold">{cop.format(toPay)}</span>
            </div>

            <div className="mt-3 space-y-1 rounded-xl bg-accent-amber/10 px-4 py-3 text-sm">
              <div className="flex items-center justify-between text-accent-orange">
                <span>Recibido:</span>
                <span className="font-bold">{cop.format(actualEntered)}</span>
              </div>
              <div className="flex items-center justify-between text-accent-orange">
                <span>Cambio:</span>
                <span className="font-bold">{cop.format(change)}</span>
              </div>
            </div>

            <div className="mt-6 flex justify-center gap-3">
              <Button variant="ghost" className="!rounded-full !px-7"
                onClick={() => setSummaryOpen(false)} disabled={paying}>
                Cancelar
              </Button>
              <Button className="!rounded-full !px-7" onClick={confirmPay} disabled={paying}>
                {paying ? "Registrando…" : "Confirmar Pago"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ ¿Por qué medio desea recibir el voucher? ══════════ */}
      {voucher && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="glass fade-in-up relative w-full max-w-md rounded-2xl p-6 shadow-2xl">
            <button onClick={finish} aria-label="Cerrar"
              className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full bg-bg-tertiary text-text-muted transition hover:text-text-primary">
              <X size={15} />
            </button>
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-accent-orange/15 text-accent-orange">
              <WalletCards size={22} />
            </div>
            <p className="mb-6 text-center text-lg font-bold">
              ¿Por qué medio desea recibir el voucher?
            </p>
            <div className="flex justify-center gap-3">
              <Button variant="ghost" className="!rounded-full !px-7" onClick={printVoucher}>
                Imprimir
              </Button>
              <Button className="!rounded-full !px-6"
                onClick={() => toast("error", "El envío por correo electrónico estará disponible próximamente.")}>
                Correo Electrónico
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Toggle({ icon, label, checked, onChange, disabled }: {
  icon?: React.ReactNode; label: string; checked: boolean;
  onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={() => !disabled && onChange(!checked)}
      className={`glass flex items-center justify-between rounded-xl px-4 py-2.5 text-sm transition ${
        disabled ? "opacity-50" : "hover:border-accent-blue/40"
      } ${checked ? "border-accent-orange/50" : ""}`}>
      <span className="flex items-center gap-2">
        {icon && <span className="text-text-muted">{icon}</span>}
        {label}{disabled && <span className="ml-1 text-[10px] text-text-muted">(próximamente)</span>}
      </span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${
        checked ? "bg-accent-orange" : "bg-bg-tertiary"
      }`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
          checked ? "left-[18px]" : "left-0.5"
        }`} />
      </span>
    </button>
  );
}
