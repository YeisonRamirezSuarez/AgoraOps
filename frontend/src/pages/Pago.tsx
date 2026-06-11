/**
 * Pago full — manual §1.6.3, layout Polaris Food:
 * izquierda: TOTAL grande + toggles (Propina, Combinado, Pago por
 * producto, Venta a crédito) + CONFIGURACIÓN (cliente obligatorio con
 * *Crear cliente y método de pago); derecha: "Recepción de {método}" con
 * monto, atajos de denominación (§1.7.8), banner Faltante/Cambio y botón
 * Cobrar habilitado solo cuando alcanza.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Banknote, Plus, Trash2, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Badge, Button, cop, Field, Input, Select, useToast } from "../components/ui";
import type { Order, OrderItem } from "./Orden";

interface PaymentOptions {
  methods: { id: number; name: string }[];
  banks: { id: number; name: string }[];
  denominations: { id: number; value: string }[];
  settings: { tip_enabled: boolean; tip_percentage: string } | null;
}
interface PayLine { method_id: string; bank_id: string; amount: string }

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

  const [clientId, setClientId] = useState("");
  const [newClient, setNewClient] = useState<{ name: string; document_id: string } | null>(null);
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [lines, setLines] = useState<PayLine[]>([{ method_id: "", bank_id: "", amount: "" }]);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    api<Order>(`/api/orders/${orderId}`).then(setOrder).catch(() => navigate("/mesas"));
    api<PaymentOptions>("/api/orders/payment-options").then((o) => {
      setOptions(o);
      // Preseleccionar EFECTIVO como Polaris
      const cash = o.methods.find((m) => m.name === "EFECTIVO");
      if (cash) setLines([{ method_id: String(cash.id), bank_id: "", amount: "" }]);
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

  const amountDue = byProduct
    ? items.filter((i) => selectedItems.includes(i.id)).reduce((s, i) => s + Number(i.subtotal), 0)
    : items.reduce((s, i) => s + Number(i.subtotal), 0);
  const tipPct = Number(options?.settings?.tip_percentage ?? 0);
  const tipEnabled = !!options?.settings?.tip_enabled;
  const tip = tipOn && tipEnabled ? Math.round((amountDue * tipPct) / 100) : 0;
  const toPay = amountDue + tip;
  const entered = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const missing = Math.max(0, toPay - entered);
  const change = Math.max(0, entered - toPay);

  const methodName = (id: string) =>
    options?.methods.find((m) => String(m.id) === id)?.name ?? "";

  function setLine(idx: number, patch: Partial<PayLine>) {
    setLines(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function pay() {
    let finalClientId = Number(clientId);
    if (newClient) {
      if (!newClient.name.trim()) {
        toast("error", "El nombre del cliente es obligatorio");
        return;
      }
      const created = await api<{ id: number }>("/api/catalogs/clients", {
        method: "POST", body: newClient,
      });
      finalClientId = created.id;
    }
    if (!finalClientId) {
      toast("error", "El cliente es obligatorio para facturar el pago.");
      return;
    }
    if (byProduct && selectedItems.length === 0) {
      toast("error", "Seleccione los productos a pagar.");
      return;
    }
    const valid = lines.filter((l) => l.method_id && Number(l.amount) > 0);
    if (valid.length === 0 || missing > 0) {
      toast("error", `Faltan ${cop.format(missing)} por ingresar.`);
      return;
    }
    // Transferencia requiere banco (§1.6.3)
    for (const l of valid) {
      if (methodName(l.method_id) === "TRANSFERENCIA" && !l.bank_id) {
        toast("error", "Seleccione el banco para la transferencia.");
        return;
      }
    }

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
      await api(`/api/orders/${orderId}/pay`, {
        method: "POST", body: { clientId: finalClientId, tip, payments: body },
      });
      toast("success", "Pago registrado correctamente");
      navigate(byProduct ? `/mesas/${orderId}` : "/mesas");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No fue posible registrar el pago");
    } finally {
      setPaying(false);
    }
  }

  if (!order || !options) return <p className="text-text-muted">Cargando…</p>;

  const singleLine = lines[0];
  const singleIsCash = methodName(singleLine?.method_id ?? "") === "EFECTIVO";
  const singleIsTransfer = methodName(singleLine?.method_id ?? "") === "TRANSFERENCIA";

  return (
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
                  <Toggle label={`Propina (${tipPct}%)`} checked={tipOn} onChange={setTipOn} />
                )}
                <Toggle label="Combinado" checked={split}
                  onChange={(v) => {
                    setSplit(v);
                    setLines(v
                      ? [...lines, { method_id: "", bank_id: "", amount: "" }]
                      : [lines[0] ?? { method_id: "", bank_id: "", amount: "" }]);
                  }} />
                <Toggle label="Pago por producto" checked={byProduct}
                  onChange={(v) => { setByProduct(v); setSelectedItems([]); }} />
                <Toggle label="Venta a crédito" checked={false} disabled
                  onChange={() => toast("error", "Venta a crédito — pendiente de definición de requisitos.")} />
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
                <input type="number" min={0} value={singleLine?.amount ?? ""}
                  onChange={(e) => setLine(0, { amount: e.target.value })}
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
                      <Input type="number" min={0} placeholder="Monto" value={l.amount}
                        onChange={(e) => setLine(idx, { amount: e.target.value })} />
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
            <div className="mb-4 flex items-center justify-between rounded-xl border border-accent-rose/40 bg-accent-rose/10 px-4 py-3">
              <span className="text-sm font-medium text-accent-rose">Faltante:</span>
              <span className="text-xl font-bold text-accent-rose">{cop.format(missing)}</span>
            </div>
          ) : change > 0 ? (
            <div className="mb-4 flex items-center justify-between rounded-xl border border-accent-emerald/40 bg-accent-emerald/10 px-4 py-3">
              <span className="text-sm font-medium text-accent-emerald">Cambio:</span>
              <span className="text-xl font-bold text-accent-emerald">{cop.format(change)}</span>
            </div>
          ) : entered > 0 ? (
            <div className="mb-4 flex items-center justify-between rounded-xl border border-accent-emerald/40 bg-accent-emerald/10 px-4 py-3">
              <span className="text-sm font-medium text-accent-emerald">Pago exacto</span>
              <span className="text-xl font-bold text-accent-emerald">✓</span>
            </div>
          ) : null}

          {tip > 0 && (
            <p className="mb-3 text-center text-xs text-accent-amber">
              Incluye propina de {cop.format(tip)} ({tipPct}%)
            </p>
          )}

          <Button variant="success" className="w-full !py-3.5"
            disabled={paying || missing > 0 || toPay === 0}
            onClick={pay}>
            {paying ? "Registrando…" : <>Cobrar&nbsp;&nbsp;{cop.format(toPay)}</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={() => !disabled && onChange(!checked)}
      className={`glass flex items-center justify-between rounded-xl px-4 py-2.5 text-sm transition ${
        disabled ? "opacity-50" : "hover:border-accent-blue/40"
      }`}>
      <span>{label}{disabled && <span className="ml-1 text-[10px] text-text-muted">(próximamente)</span>}</span>
      <span className={`relative h-5 w-9 rounded-full transition ${
        checked ? "bg-accent-blue" : "bg-bg-tertiary"
      }`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
          checked ? "left-[18px]" : "left-0.5"
        }`} />
      </span>
    </button>
  );
}
