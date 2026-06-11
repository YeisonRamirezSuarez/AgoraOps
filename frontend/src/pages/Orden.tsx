/**
 * Vista de la orden (mesa abierta) — manual §1.6.3.
 * Split: menú (búsqueda + categorías + toppings) | pedido (confirmar →
 * comanda, "Sobre comanda", comentario, devolución con motivo obligatorio,
 * solicitar de nuevo solo si Listo, traslado, cerrar mesa y pago
 * completo/combinado/por producto con propina, atajos de denominación,
 * bancos y cliente obligatorio con *Crear cliente inline).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRightLeft, Ban, CheckCheck, MessageSquare,
  Minus, Plus, RotateCcw, Search, Wallet, XCircle,
} from "lucide-react";
import { api, ApiError, subscribeEvents } from "../lib/api";
import {
  Badge, Button, cop, Field, Input, Modal, Select, TextArea, useToast,
} from "../components/ui";
import { KITCHEN_STATUS_LABELS } from "../shared/constants/kitchenStatus";
import type { KitchenStatus } from "../shared/constants/kitchenStatus";

/* ───── tipos ───── */
interface MenuProduct {
  id: number; name: string; sale_price: string; category_name: string;
  description: string | null;
}
interface ToppingOption { id: number; topping_id: number; name: string; price: string; max_allowed: number }
interface OrderItem {
  id: number; product_name: string; quantity: number; unit_price: string;
  subtotal: string; notes: string | null; kitchen_status: KitchenStatus;
  is_paid: boolean;
  toppings: { topping_name: string; quantity: number }[];
}
interface Order {
  id: number; order_number: string; comment: string | null; status: string;
  table_id: number; items: OrderItem[];
}
interface PaymentOptions {
  methods: { id: number; name: string }[];
  banks: { id: number; name: string }[];
  denominations: { id: number; value: string }[];
  settings: { tip_enabled: boolean; tip_percentage: string } | null;
}

const STATUS_COLOR: Record<KitchenStatus, "gray" | "amber" | "cyan" | "emerald" | "rose"> = {
  nuevo: "gray", requerido: "amber", en_preparacion: "cyan", listo: "emerald", cancelado: "rose",
};

export default function Orden() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [order, setOrder] = useState<Order | null>(null);
  const [menu, setMenu] = useState<MenuProduct[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Todas");

  const [adding, setAdding] = useState<MenuProduct | null>(null);
  const [modal, setModal] = useState<"" | "comment" | "cancel" | "transfer" | "pay" | "close">("");
  const [cancelItem, setCancelItem] = useState<OrderItem | null>(null);

  const load = useCallback(() => {
    api<Order>(`/api/orders/${orderId}`).then(setOrder).catch(() => navigate("/mesas"));
  }, [orderId, navigate]);

  useEffect(() => {
    load();
    api<MenuProduct[]>("/api/products/menu/list").then(setMenu).catch(() => {});
    return subscribeEvents((e) => {
      if (e.table === "order_items" || e.table === "orders") load();
    });
  }, [load]);

  const categories = useMemo(
    () => ["Todas", ...new Set(menu.map((p) => p.category_name))],
    [menu],
  );
  const filteredMenu = menu.filter(
    (p) =>
      (category === "Todas" || p.category_name === category) &&
      p.name.toLowerCase().includes(search.toLowerCase()),
  );

  const activeItems = order?.items.filter((i) => i.kitchen_status !== "cancelado") ?? [];
  const newItems = activeItems.filter((i) => i.kitchen_status === "nuevo");
  const total = activeItems.reduce((s, i) => s + Number(i.subtotal), 0);

  async function confirmItems() {
    try {
      const r = await api<{ sobreComanda: boolean }>(`/api/orders/${orderId}/confirm`, {
        method: "POST", body: { itemIds: newItems.map((i) => i.id) },
      });
      toast("success", r.sobreComanda ? "Comanda impresa (Sobre comanda)" : "Comanda impresa");
      load();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Error al confirmar");
    }
  }

  async function removeItem(item: OrderItem) {
    try {
      await api(`/api/orders/${orderId}/items/${item.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No se pudo eliminar");
    }
  }

  if (!order) return <p className="text-text-muted">Cargando orden…</p>;

  return (
    <div className="fade-in-up">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/mesas")} className="rounded-lg p-2 text-text-muted hover:bg-bg-tertiary hover:text-text-primary">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold">Orden #{order.order_number}</h1>
            <p className="text-xs text-text-secondary">
              {newItems.length > 0 ? "Pedido sin confirmar" : "Pedido confirmado"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setModal("comment")}>
            <MessageSquare size={14} className="-mt-0.5 mr-1 inline" /> Comentario
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setModal("transfer")}>
            <ArrowRightLeft size={14} className="-mt-0.5 mr-1 inline" /> Trasladar
          </Button>
          <Button size="sm" variant="danger" onClick={() => setModal("close")}>
            <XCircle size={14} className="-mt-0.5 mr-1 inline" /> Cerrar mesa
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        {/* ── Menú ── */}
        <section>
          <div className="relative mb-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <Input placeholder="Buscar producto…" value={search} onChange={(e) => setSearch(e.target.value)} className="!pl-9" />
          </div>
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
            {categories.map((c) => (
              <button key={c} onClick={() => setCategory(c)}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-xs transition ${
                  c === category ? "bg-accent-blue/20 font-medium text-accent-blue" : "bg-bg-tertiary text-text-secondary"
                }`}>
                {c}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {filteredMenu.map((p) => (
              <button key={p.id} onClick={() => setAdding(p)}
                className="glass rounded-xl p-3 text-left transition hover:-translate-y-0.5 hover:border-accent-blue/50">
                <p className="text-sm font-medium leading-tight">{p.name}</p>
                <p className="mt-1 text-xs text-text-muted">{p.category_name}</p>
                <p className="mt-2 font-semibold text-accent-cyan">{cop.format(Number(p.sale_price))}</p>
              </button>
            ))}
            {filteredMenu.length === 0 && (
              <p className="col-span-full py-8 text-center text-sm text-text-muted">
                Sin productos disponibles en el menú
              </p>
            )}
          </div>
        </section>

        {/* ── Pedido ── */}
        <section className="glass h-fit rounded-2xl p-4">
          <h2 className="mb-3 font-semibold">Pedido</h2>
          {order.items.length === 0 && (
            <p className="py-6 text-center text-sm text-text-muted">Agregue productos del menú</p>
          )}
          <ul className="space-y-2">
            {order.items.map((item) => (
              <li key={item.id}
                className={`rounded-xl border border-border-subtle p-3 ${item.kitchen_status === "cancelado" ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      {item.product_name} <span className="text-text-muted">×{item.quantity}</span>
                    </p>
                    {item.toppings.length > 0 && (
                      <p className="text-xs text-accent-orange">
                        {item.toppings.map((t) => `${t.topping_name} x${t.quantity}`).join(", ")}
                      </p>
                    )}
                    {item.notes && <p className="text-xs italic text-text-muted">{item.notes}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{cop.format(Number(item.subtotal))}</p>
                    <Badge color={STATUS_COLOR[item.kitchen_status]}>
                      {KITCHEN_STATUS_LABELS[item.kitchen_status]}
                      {item.is_paid ? " · Pagado" : ""}
                    </Badge>
                  </div>
                </div>
                <div className="mt-2 flex gap-1">
                  {item.kitchen_status === "nuevo" && (
                    <Button size="sm" variant="ghost" onClick={() => removeItem(item)}>
                      Quitar
                    </Button>
                  )}
                  {["requerido", "en_preparacion", "listo"].includes(item.kitchen_status) && !item.is_paid && (
                    <Button size="sm" variant="ghost" onClick={() => { setCancelItem(item); setModal("cancel"); }}>
                      <Ban size={13} className="-mt-0.5 mr-1 inline" />
                      {item.kitchen_status === "listo" ? "Devolución" : "Cancelar"}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 border-t border-border-subtle pt-3">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-text-secondary">TOTAL</span>
              <span className="text-2xl font-bold">{cop.format(total)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={confirmItems} disabled={newItems.length === 0}>
                <CheckCheck size={15} className="-mt-0.5 mr-1 inline" /> Confirmar
              </Button>
              <Button variant="success" onClick={() => setModal("pay")}
                disabled={activeItems.length === 0 || newItems.length > 0}>
                <Wallet size={15} className="-mt-0.5 mr-1 inline" /> Cobrar
              </Button>
            </div>
            {newItems.length > 0 && activeItems.length > newItems.length && (
              <p className="mt-2 text-center text-xs text-accent-amber">
                Confirme los productos nuevos antes de cobrar
              </p>
            )}
          </div>
        </section>
      </div>

      <AddProductModal product={adding} orderId={order.id} onClose={() => setAdding(null)} onAdded={load} />
      <CommentModal open={modal === "comment"} order={order} onClose={() => setModal("")} onSaved={load} />
      <CancelModal open={modal === "cancel"} item={cancelItem} orderId={order.id}
        onClose={() => { setModal(""); setCancelItem(null); }} onDone={load} />
      <TransferModal open={modal === "transfer"} order={order} items={activeItems}
        onClose={() => setModal("")} />
      <CloseModal open={modal === "close"} orderId={order.id} onClose={() => setModal("")} />
      <PayModal open={modal === "pay"} orderId={order.id} items={activeItems.filter((i) => !i.is_paid)}
        total={total} onClose={() => setModal("")} onPaid={load} />
    </div>
  );
}

/* ───────── Agregar producto (cantidad + comentario + toppings §1.6.3) ───────── */
function AddProductModal({ product, orderId, onClose, onAdded }: {
  product: MenuProduct | null; orderId: number; onClose: () => void; onAdded: () => void;
}) {
  const toast = useToast();
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [toppings, setToppings] = useState<ToppingOption[]>([]);
  const [selected, setSelected] = useState<Record<number, number>>({});

  useEffect(() => {
    if (!product) return;
    setQty(1); setNotes(""); setSelected({});
    api<ToppingOption[]>(`/api/products/${product.id}/toppings`).then(setToppings).catch(() => setToppings([]));
  }, [product]);

  if (!product) return null;

  async function add() {
    try {
      await api(`/api/orders/${orderId}/items`, {
        method: "POST",
        body: {
          productId: product!.id, quantity: qty, notes: notes || undefined,
          toppings: Object.entries(selected)
            .filter(([, q]) => q > 0)
            .map(([id, q]) => ({ toppingId: Number(id), quantity: q })),
        },
      });
      onAdded(); onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Error al agregar");
    }
  }

  return (
    <Modal open title={product.name} onClose={onClose}>
      {product.description && <p className="mb-3 text-sm text-text-secondary">{product.description}</p>}
      <div className="mb-4 flex items-center justify-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => setQty((q) => Math.max(1, q - 1))}><Minus size={14} /></Button>
        <input type="number" min={1} value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
          className="w-16 rounded-lg border border-border-subtle bg-bg-tertiary py-2 text-center text-lg font-bold outline-none" />
        <Button variant="ghost" size="sm" onClick={() => setQty((q) => q + 1)}><Plus size={14} /></Button>
      </div>
      {toppings.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-medium text-text-secondary">Adicionales</p>
          <div className="space-y-2">
            {toppings.map((t) => {
              const q = selected[t.topping_id] ?? 0;
              return (
                <div key={t.id}
                  className={`flex items-center justify-between rounded-lg border p-2 transition ${
                    q > 0 ? "border-accent-orange bg-accent-orange/10" : "border-border-subtle"
                  }`}>
                  <span className="text-sm">{t.name} <span className="text-text-muted">+{cop.format(Number(t.price))}</span></span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSelected({ ...selected, [t.topping_id]: Math.max(0, q - 1) })}
                      className="rounded bg-bg-tertiary px-2 py-0.5">−</button>
                    <span className="w-5 text-center text-sm">{q}</span>
                    <button onClick={() => setSelected({ ...selected, [t.topping_id]: Math.min(t.max_allowed, q + 1) })}
                      className="rounded bg-bg-tertiary px-2 py-0.5">+</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <Field label="Comentario del producto">
        <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={add}>Agregar</Button>
      </div>
    </Modal>
  );
}

/* ───────── Comentario de la mesa ───────── */
function CommentModal({ open, order, onClose, onSaved }: {
  open: boolean; order: Order; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [comment, setComment] = useState(order.comment ?? "");
  useEffect(() => setComment(order.comment ?? ""), [order.comment]);

  async function save() {
    await api(`/api/orders/${order.id}/comment`, { method: "PUT", body: { comment } });
    toast("success", "Comentario guardado");
    onSaved(); onClose();
  }

  return (
    <Modal open={open} title="Comentario de la mesa" onClose={onClose}>
      <Field label="Comentario">
        <TextArea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={save}>Guardar</Button>
      </div>
    </Modal>
  );
}

/* ───────── Devolución / cancelación (descripción obligatoria §1.6.3) ───────── */
function CancelModal({ open, item, orderId, onClose, onDone }: {
  open: boolean; item: OrderItem | null; orderId: number;
  onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(""); }, [open]);
  if (!item) return null;

  const canReorder = item.kitchen_status === "listo"; // Solicitar de nuevo solo si Listo

  async function run(action: "cancel" | "reorder") {
    if (!reason.trim()) {
      toast("error", "La descripción no debe ir vacía.");
      return;
    }
    try {
      await api(`/api/orders/${orderId}/items/${item!.id}/${action}`, {
        method: "POST", body: { reason },
      });
      toast("success", action === "cancel" ? "Producto cancelado" : "Producto solicitado de nuevo");
      onDone(); onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No fue posible completar");
    }
  }

  return (
    <Modal open={open} title={`Devolución — ${item.product_name}`} onClose={onClose}>
      <Field label="Descripción (obligatoria)">
        <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Volver</Button>
        {canReorder && (
          <Button variant="ghost" onClick={() => run("reorder")}>
            <RotateCcw size={14} className="-mt-0.5 mr-1 inline" /> Solicitar de nuevo
          </Button>
        )}
        <Button variant="danger" onClick={() => run("cancel")}>Cancelar producto</Button>
      </div>
    </Modal>
  );
}

/* ───────── Traslado de productos (§1.6.3) ───────── */
function TransferModal({ open, order, items, onClose }: {
  open: boolean; order: Order; items: OrderItem[]; onClose: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [board, setBoard] = useState<{ table_id: number; number: number; room_id: number; room_name: string }[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [target, setTarget] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelected(items.map((i) => i.id));
    api<typeof board>("/api/orders/board").then((b) =>
      setBoard(b.filter((c) => c.table_id !== order.table_id)),
    );
  }, [open, items, order.table_id]);

  async function transfer() {
    const cell = board.find((c) => c.table_id === Number(target));
    if (!cell || selected.length === 0) {
      toast("error", "Seleccione productos y mesa destino");
      return;
    }
    try {
      const r = await api<{ toOrderId: number }>(`/api/orders/${order.id}/transfer`, {
        method: "POST",
        body: { tableId: cell.table_id, roomId: cell.room_id, itemIds: selected },
      });
      toast("success", "Traslado realizado correctamente");
      navigate(`/mesas/${r.toOrderId}`);
      onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No fue posible trasladar");
    }
  }

  return (
    <Modal open={open} title="Trasladar productos" onClose={onClose}>
      <p className="mb-2 text-xs text-text-secondary">Seleccione los productos:</p>
      <div className="mb-4 max-h-44 space-y-1 overflow-y-auto">
        {items.map((i) => (
          <label key={i.id} className="flex items-center gap-2 rounded-lg p-2 text-sm hover:bg-bg-tertiary">
            <input type="checkbox" checked={selected.includes(i.id)}
              onChange={(e) => setSelected(e.target.checked ? [...selected, i.id] : selected.filter((x) => x !== i.id))}
              className="h-4 w-4 accent-[hsl(217_91%_60%)]" />
            {i.product_name} ×{i.quantity}
          </label>
        ))}
      </div>
      <Field label="Mesa destino">
        <Select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">— Seleccione —</option>
          {board.map((c) => (
            <option key={c.table_id} value={c.table_id}>{c.room_name} · Mesa {c.number}</option>
          ))}
        </Select>
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={transfer}>Confirmar traslado</Button>
      </div>
    </Modal>
  );
}

/* ───────── Cerrar mesa (§1.6.3) ───────── */
function CloseModal({ open, orderId, onClose }: { open: boolean; orderId: number; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [reason, setReason] = useState("");

  async function close() {
    try {
      await api(`/api/orders/${orderId}/close`, { method: "POST", body: { reason } });
      toast("success", "Mesa cerrada");
      navigate("/mesas");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No se pudo cerrar la mesa");
    }
  }

  return (
    <Modal open={open} title="Cerrar mesa" onClose={onClose}>
      <p className="mb-3 text-sm text-text-secondary">
        La mesa solo puede cerrarse si todos los productos fueron cancelados o no se agregaron productos.
      </p>
      <Field label="Motivo">
        <TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Volver</Button>
        <Button variant="danger" onClick={close}>Cerrar mesa</Button>
      </div>
    </Modal>
  );
}

/* ───────── Pago (§1.6.3): completo / combinado / por producto ───────── */
function PayModal({ open, orderId, items, total, onClose, onPaid }: {
  open: boolean; orderId: number; items: OrderItem[]; total: number;
  onClose: () => void; onPaid: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [options, setOptions] = useState<PaymentOptions | null>(null);
  const [clients, setClients] = useState<{ id: number; name: string }[]>([]);
  const [clientId, setClientId] = useState("");
  const [newClient, setNewClient] = useState<{ name: string; document_id: string } | null>(null);

  const [byProduct, setByProduct] = useState(false);
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [split, setSplit] = useState(false);
  const [tipChecked, setTipChecked] = useState(false);
  const [payments, setPayments] = useState<{ method_id: string; bank_id: string; amount: string }[]>([
    { method_id: "", bank_id: "", amount: "" },
  ]);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!open) return;
    api<PaymentOptions>("/api/orders/payment-options").then(setOptions);
    api<{ id: number; name: string }[]>("/api/catalogs/clients").then(setClients).catch(() => {});
    setByProduct(false); setSplit(false); setTipChecked(false);
    setSelectedItems([]); setClientId(""); setNewClient(null);
    setPayments([{ method_id: "", bank_id: "", amount: "" }]);
  }, [open]);

  const amountDue = byProduct
    ? items.filter((i) => selectedItems.includes(i.id)).reduce((s, i) => s + Number(i.subtotal), 0)
    : total;
  const tipPct = Number(options?.settings?.tip_percentage ?? 0);
  const tip = tipChecked && options?.settings?.tip_enabled ? Math.round(amountDue * tipPct / 100) : 0;
  const toPay = amountDue + tip;
  const entered = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const cash = options?.methods.find((m) => m.name === "EFECTIVO");
  const transfer = options?.methods.find((m) => m.name === "TRANSFERENCIA");

  function setAmount(idx: number, value: string) {
    setPayments(payments.map((p, i) => (i === idx ? { ...p, amount: value } : p)));
  }

  async function pay() {
    let finalClientId = Number(clientId);
    if (newClient) {
      if (!newClient.name.trim()) { toast("error", "El nombre del cliente es obligatorio"); return; }
      const created = await api<{ id: number }>("/api/catalogs/clients", {
        method: "POST", body: newClient,
      });
      finalClientId = created.id;
    }
    if (!finalClientId) { toast("error", "El cliente es obligatorio para facturar el pago."); return; }
    if (entered < toPay) { toast("error", `Faltan ${cop.format(toPay - entered)} por ingresar.`); return; }

    const valid = payments.filter((p) => p.method_id && Number(p.amount) > 0);
    if (valid.length === 0) { toast("error", "Ingrese al menos un método de pago"); return; }

    // Propina al primer pago con monto ≥ propina (§1.6.3)
    let tipAssigned = false;
    const body = valid.map((p, idx) => {
      const amount = Number(p.amount);
      const isCash = options?.methods.find((m) => m.id === Number(p.method_id))?.name === "EFECTIVO";
      const change = idx === valid.length - 1 && entered > toPay && isCash ? entered - toPay : 0;
      const tip_included = !tipAssigned && tip > 0 && amount >= tip ? ((tipAssigned = true), tip) : 0;
      return {
        method_id: Number(p.method_id),
        bank_id: p.bank_id ? Number(p.bank_id) : null,
        amount, tip_included, change_given: change,
        ...(byProduct ? { item_ids: selectedItems } : {}),
      };
    });

    setPaying(true);
    try {
      await api(`/api/orders/${orderId}/pay`, {
        method: "POST", body: { clientId: finalClientId, tip, payments: body },
      });
      toast("success", "Pago registrado correctamente");
      onPaid(); onClose();
      if (!byProduct) navigate("/mesas");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No fue posible registrar el pago");
    } finally {
      setPaying(false);
    }
  }

  return (
    <Modal open={open} title="Cobrar" onClose={onClose} wide>
      {/* Pago por producto (§1.6.3) */}
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={byProduct} onChange={(e) => setByProduct(e.target.checked)}
          className="h-4 w-4 accent-[hsl(217_91%_60%)]" />
        Pago por producto
      </label>
      {byProduct && (
        <div className="mb-4 max-h-36 space-y-1 overflow-y-auto rounded-xl border border-border-subtle p-2">
          {items.map((i) => (
            <label key={i.id}
              className={`flex items-center justify-between rounded-lg p-2 text-sm ${
                selectedItems.includes(i.id) ? "bg-accent-emerald/10" : "hover:bg-bg-tertiary"
              }`}>
              <span className="flex items-center gap-2">
                <input type="checkbox" checked={selectedItems.includes(i.id)}
                  onChange={(e) => setSelectedItems(e.target.checked
                    ? [...selectedItems, i.id] : selectedItems.filter((x) => x !== i.id))}
                  className="h-4 w-4 accent-[hsl(160_84%_39%)]" />
                {i.product_name} ×{i.quantity}
              </span>
              <span>{cop.format(Number(i.subtotal))}</span>
            </label>
          ))}
        </div>
      )}

      {/* Cliente obligatorio + *Crear cliente (§1.6.3) */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Field label="Cliente (obligatorio)">
          {newClient ? (
            <div className="space-y-2">
              <Input placeholder="Nombre" value={newClient.name}
                onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} />
              <Input placeholder="NIT / Cédula" value={newClient.document_id}
                onChange={(e) => setNewClient({ ...newClient, document_id: e.target.value })} />
              <button onClick={() => setNewClient(null)} className="text-xs text-accent-blue hover:underline">
                ← volver a la lista
              </button>
            </div>
          ) : (
            <Select value={clientId}
              onChange={(e) => {
                if (e.target.value === "__new__") setNewClient({ name: "", document_id: "" });
                else setClientId(e.target.value);
              }}>
              <option value="">— Seleccione un cliente —</option>
              <option value="__new__">＊ Crear cliente</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
        <div>
          {options?.settings?.tip_enabled && (
            <label className="mt-6 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={tipChecked} onChange={(e) => setTipChecked(e.target.checked)}
                className="h-4 w-4 accent-[hsl(217_91%_60%)]" />
              Agregar propina ({tipPct}%) — {cop.format(tip)}
            </label>
          )}
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={split}
              onChange={(e) => {
                setSplit(e.target.checked);
                setPayments(e.target.checked
                  ? [{ method_id: "", bank_id: "", amount: "" }, { method_id: "", bank_id: "", amount: "" }]
                  : [{ method_id: "", bank_id: "", amount: "" }]);
              }}
              className="h-4 w-4 accent-[hsl(217_91%_60%)]" />
            Pago combinado (dividir)
          </label>
        </div>
      </div>

      {/* Métodos de pago */}
      <div className="space-y-3">
        {payments.map((p, idx) => {
          const isCash = cash && Number(p.method_id) === cash.id;
          const isTransfer = transfer && Number(p.method_id) === transfer.id;
          return (
            <div key={idx} className="rounded-xl border border-border-subtle p-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <Select value={p.method_id}
                  onChange={(e) => setPayments(payments.map((x, i) => i === idx ? { ...x, method_id: e.target.value, bank_id: "" } : x))}>
                  <option value="">— Método de pago —</option>
                  {options?.methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
                {isTransfer && (
                  <Select value={p.bank_id}
                    onChange={(e) => setPayments(payments.map((x, i) => i === idx ? { ...x, bank_id: e.target.value } : x))}>
                    <option value="">— Banco —</option>
                    {options?.banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                )}
                <Input type="number" min={0} placeholder="Monto" value={p.amount}
                  onChange={(e) => setAmount(idx, e.target.value)} />
              </div>
              {/* Atajos de denominación de moneda (§1.7.8) */}
              {isCash && (options?.denominations.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {options!.denominations.map((d) => (
                    <button key={d.id}
                      onClick={() => setAmount(idx, String((Number(p.amount) || 0) + Number(d.value)))}
                      className="rounded-full border border-accent-orange/40 bg-accent-orange/10 px-2.5 py-0.5 text-xs text-accent-orange transition hover:bg-accent-orange/25">
                      +{cop.format(Number(d.value))}
                    </button>
                  ))}
                  <button onClick={() => setAmount(idx, "")}
                    className="rounded-full border border-border-medium px-2.5 py-0.5 text-xs text-text-muted">
                    limpiar
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {split && (
          <Button size="sm" variant="ghost"
            onClick={() => setPayments([...payments, { method_id: "", bank_id: "", amount: "" }])}>
            <Plus size={13} className="-mt-0.5 mr-1 inline" /> Agregar método de pago
          </Button>
        )}
      </div>

      {/* Resumen */}
      <div className="mt-4 rounded-xl bg-bg-tertiary/60 p-3 text-sm">
        <div className="flex justify-between"><span>Subtotal</span><span>{cop.format(amountDue)}</span></div>
        {tip > 0 && <div className="flex justify-between text-accent-amber"><span>Propina</span><span>{cop.format(tip)}</span></div>}
        <div className="mt-1 flex justify-between border-t border-border-subtle pt-1 font-bold">
          <span>Total a pagar</span><span>{cop.format(toPay)}</span>
        </div>
        <div className="flex justify-between text-text-secondary">
          <span>Ingresado</span><span>{cop.format(entered)}</span>
        </div>
        {entered > toPay && (
          <div className="flex justify-between text-accent-emerald">
            <span>Cambio</span><span>{cop.format(entered - toPay)}</span>
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="success" onClick={pay} disabled={paying}>
          {paying ? "Registrando…" : "Confirmar pago"}
        </Button>
      </div>
    </Modal>
  );
}
