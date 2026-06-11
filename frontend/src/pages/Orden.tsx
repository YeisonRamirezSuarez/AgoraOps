/**
 * Vista de la orden (mesa abierta) — manual §1.6.3, layout Polaris Food:
 * encabezado "Orden: N - Mesa X / Mesero" con TOTAL a la derecha; buscador
 * + iconos (reimprimir, comentario, traslado); píldoras de categorías;
 * cards de producto con botón +; panel derecho "NUEVO PEDIDO" con badge
 * NUEVO, "Mesa vacía" si no hay ítems, y botones Ver Orden / Confirmar /
 * Cobrar Mesa. El cobro abre la página "Pago full".
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRightLeft, Ban, MessageSquare, Minus, Plus, Printer,
  Receipt, ReceiptText, RotateCcw, Search, Send, Trash2, Undo2, Wallet,
} from "lucide-react";
import { api, ApiError, subscribeEvents } from "../lib/api";
import {
  Badge, Button, cop, Field, Input, Modal, Select, TextArea, useToast,
} from "../components/ui";
import { KITCHEN_STATUS_LABELS } from "../shared/constants/kitchenStatus";
import type { KitchenStatus } from "../shared/constants/kitchenStatus";

/* ───── tipos ───── */
export interface MenuProduct {
  id: number; name: string; sale_price: string; category_name: string;
  description: string | null;
}
interface ToppingOption { id: number; topping_id: number; name: string; price: string; max_allowed: number }
export interface OrderItem {
  id: number; product_name: string; quantity: number; unit_price: string;
  subtotal: string; notes: string | null; kitchen_status: KitchenStatus;
  is_paid: boolean;
  toppings: { topping_name: string; quantity: number }[];
}
export interface Order {
  id: number; order_number: string; comment: string | null; status: string;
  table_id: number; attended_by: string | null; items: OrderItem[];
}

const STATUS_COLOR: Record<KitchenStatus, "gray" | "amber" | "cyan" | "emerald" | "rose"> = {
  nuevo: "gray", requerido: "amber", en_preparacion: "cyan", listo: "emerald", cancelado: "rose",
};

export default function Orden() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [order, setOrder] = useState<Order | null>(null);
  const [tableNumber, setTableNumber] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuProduct[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("TODOS");

  const [adding, setAdding] = useState<MenuProduct | null>(null);
  const [modal, setModal] = useState<"" | "comment" | "cancel" | "transfer" | "close" | "view" | "print">("");
  const [cancelItem, setCancelItem] = useState<OrderItem | null>(null);

  const load = useCallback(() => {
    api<Order>(`/api/orders/${orderId}`).then(setOrder).catch(() => navigate("/mesas"));
  }, [orderId, navigate]);

  useEffect(() => {
    load();
    api<MenuProduct[]>("/api/products/menu/list").then(setMenu).catch(() => {});
    api<{ table_id: number; number: number; order_id: number | null }[]>("/api/orders/board")
      .then((b) => {
        const cell = b.find((c) => c.order_id === Number(orderId));
        if (cell) setTableNumber(cell.number);
      }).catch(() => {});
    return subscribeEvents((e) => {
      if (e.table === "order_items" || e.table === "orders") load();
    });
  }, [load, orderId]);

  const categories = useMemo(
    () => ["TODOS", ...new Set(menu.map((p) => p.category_name))],
    [menu],
  );
  const filteredMenu = menu.filter(
    (p) =>
      (category === "TODOS" || p.category_name === category) &&
      p.name.toLowerCase().includes(search.toLowerCase()),
  );

  const items = order?.items ?? [];
  const activeItems = items.filter((i) => i.kitchen_status !== "cancelado");
  const newItems = activeItems.filter((i) => i.kitchen_status === "nuevo");
  const confirmedItems = activeItems.filter((i) => i.kitchen_status !== "nuevo");
  const total = activeItems.reduce((s, i) => s + Number(i.subtotal), 0);

  async function confirmItems() {
    try {
      const r = await api<{ sobreComanda: boolean }>(`/api/orders/${orderId}/confirm`, {
        method: "POST", body: { itemIds: newItems.map((i) => i.id) },
      });
      toast("success", r.sobreComanda ? "Comanda enviada (Sobre comanda)" : "Comanda enviada a cocina");
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
    <div className="fade-in-up -m-6 flex min-h-[calc(100vh)] flex-col lg:flex-row">
      {/* ══════════ Columna izquierda: menú ══════════ */}
      <div className="flex-1 p-6">
        {/* Encabezado estilo Polaris */}
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/mesas")}
              className="rounded-lg p-2 text-text-muted transition hover:bg-bg-tertiary hover:text-text-primary">
              <ArrowLeft size={19} />
            </button>
            <div>
              <h1 className="text-lg font-bold">
                Orden: {order.order_number} {tableNumber != null && `- Mesa ${tableNumber}`}
              </h1>
              <p className="text-sm text-text-secondary">Mesero: {order.attended_by ?? "—"}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Total</p>
            <p className="text-2xl font-bold text-accent-cyan">{cop.format(total)}</p>
          </div>
        </div>

        {/* Buscador + iconos de acción */}
        <div className="mb-4 flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <Input placeholder="Buscar productos…" value={search}
              onChange={(e) => setSearch(e.target.value)} className="!pl-9" />
          </div>
          <IconBtn label="Reimprimir" onClick={() => setModal("print")}><Printer size={17} /></IconBtn>
          <IconBtn label="Comentario de la mesa" onClick={() => setModal("comment")}><MessageSquare size={17} /></IconBtn>
          <IconBtn label="Trasladar productos" onClick={() => setModal("transfer")}><ArrowRightLeft size={17} /></IconBtn>
        </div>

        {/* Píldoras de categorías */}
        <div className="mb-5 flex flex-wrap gap-2">
          {categories.map((c) => (
            <button key={c} onClick={() => setCategory(c)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                c === category
                  ? "bg-gradient-to-br from-accent-blue to-accent-blue-hover text-white shadow-[0_0_12px_hsl(199_89%_48%/0.25)]"
                  : "glass text-text-secondary hover:text-text-primary"
              }`}>
              {c}
            </button>
          ))}
        </div>

        {/* Cards de producto con botón + */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(165px,1fr))] gap-3">
          {filteredMenu.map((p) => (
            <button key={p.id} onClick={() => setAdding(p)}
              className="glass relative rounded-2xl p-4 text-left transition hover:-translate-y-0.5 hover:border-accent-blue/50 hover:shadow-lg">
              <span className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-accent-blue/15 text-accent-blue">
                <Plus size={15} />
              </span>
              <p className="pr-8 text-sm font-bold uppercase leading-tight">{p.name}</p>
              <p className="mt-5 font-bold text-accent-cyan">{cop.format(Number(p.sale_price))}</p>
            </button>
          ))}
          {filteredMenu.length === 0 && (
            <p className="col-span-full py-10 text-center text-sm text-text-muted">
              Sin productos disponibles
            </p>
          )}
        </div>
      </div>

      {/* ══════════ Panel derecho: pedido ══════════ */}
      <aside className="glass flex w-full flex-col border-l border-border-subtle p-5 lg:w-96">
        <div className="flex-1 overflow-y-auto">
          {activeItems.length === 0 ? (
            <div className="grid h-full min-h-48 place-items-center text-center text-text-muted">
              <div>
                <Receipt size={34} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">Mesa vacía</p>
              </div>
            </div>
          ) : (
            <>
              {newItems.length > 0 && (
                <PanelSection label="Nuevo pedido">
                  {newItems.map((item) => (
                    <PanelItem key={item.id} item={item}
                      badge={<Badge color="amber">NUEVO</Badge>}
                      action={
                        <button onClick={() => removeItem(item)} aria-label="Quitar"
                          className="rounded-lg p-1.5 text-text-muted transition hover:bg-accent-rose/15 hover:text-accent-rose">
                          <Trash2 size={14} />
                        </button>
                      } />
                  ))}
                </PanelSection>
              )}
              {confirmedItems.length > 0 && (
                <PanelSection label="Pedido confirmado">
                  {confirmedItems.map((item) => (
                    <PanelItem key={item.id} item={item}
                      badge={
                        <Badge color={STATUS_COLOR[item.kitchen_status]}>
                          {KITCHEN_STATUS_LABELS[item.kitchen_status].toUpperCase()}
                          {item.is_paid ? " · PAGADO" : ""}
                        </Badge>
                      }
                      action={!item.is_paid ? (
                        <button onClick={() => { setCancelItem(item); setModal("cancel"); }}
                          aria-label="Devolución"
                          className="rounded-lg p-1.5 text-text-muted transition hover:bg-accent-rose/15 hover:text-accent-rose">
                          <Ban size={14} />
                        </button>
                      ) : null} />
                  ))}
                </PanelSection>
              )}
            </>
          )}
        </div>

        {/* Acciones inferiores estilo Polaris */}
        <div className="mt-4 space-y-2 border-t border-border-subtle pt-4">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => setModal("view")}>
              <ReceiptText size={15} className="-mt-0.5 mr-1.5 inline" /> Ver Orden
            </Button>
            <Button onClick={confirmItems} disabled={newItems.length === 0}>
              <Send size={15} className="-mt-0.5 mr-1.5 inline" /> Confirmar
            </Button>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button variant="danger" onClick={() => setModal("close")} aria-label="Cerrar mesa">
              <Undo2 size={15} />
            </Button>
            <Button variant="success"
              onClick={() => navigate(`/mesas/${order.id}/pago`)}
              disabled={activeItems.length === 0 || newItems.length > 0}>
              <Wallet size={15} className="-mt-0.5 mr-1.5 inline" /> Cobrar Mesa
            </Button>
          </div>
          {newItems.length > 0 && (
            <p className="text-center text-[11px] text-accent-amber">
              Confirme los productos nuevos antes de cobrar
            </p>
          )}
        </div>
      </aside>

      {/* ══════════ Modales ══════════ */}
      <AddProductModal product={adding} orderId={order.id} onClose={() => setAdding(null)} onAdded={load} />
      <CommentModal open={modal === "comment"} order={order} onClose={() => setModal("")} onSaved={load} />
      <CancelModal open={modal === "cancel"} item={cancelItem} orderId={order.id}
        onClose={() => { setModal(""); setCancelItem(null); }} onDone={load} />
      <TransferModal open={modal === "transfer"} order={order} items={activeItems} onClose={() => setModal("")} />
      <CloseModal open={modal === "close"} orderId={order.id} onClose={() => setModal("")} />
      <ViewOrderModal open={modal === "view"} order={order} total={total} onClose={() => setModal("")} />
      <PrintModal open={modal === "print"} onClose={() => setModal("")} />
    </div>
  );
}

/* ───────── piezas del panel derecho ───────── */
function PanelSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-px flex-1 border-t border-dashed border-border-medium" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{label}</span>
        <span className="h-px flex-1 border-t border-dashed border-border-medium" />
      </div>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}

function PanelItem({ item, badge, action }: {
  item: OrderItem; badge: React.ReactNode; action: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 w-5 text-right text-sm font-bold">{item.quantity}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold uppercase leading-tight">{item.product_name}</p>
        {item.toppings.length > 0 && (
          <p className="text-xs text-accent-orange">
            {item.toppings.map((t) => `${t.topping_name} x${t.quantity}`).join(", ")}
          </p>
        )}
        {item.notes && <p className="text-xs italic text-text-muted">{item.notes}</p>}
        <div className="mt-1">{badge}</div>
      </div>
      <div className="text-right">
        <p className="text-sm font-bold">{cop.format(Number(item.subtotal))}</p>
        {action}
      </div>
    </li>
  );
}

function IconBtn({ label, onClick, children }: {
  label: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} title={label} aria-label={label}
      className="glass grid h-11 w-11 shrink-0 place-items-center rounded-xl text-text-secondary transition hover:text-accent-blue">
      {children}
    </button>
  );
}

/* ───────── Modal de producto (cantidad + toppings + nota, Polaris) ───────── */
function AddProductModal({ product, orderId, onClose, onAdded }: {
  product: MenuProduct | null; orderId: number; onClose: () => void; onAdded: () => void;
}) {
  const toast = useToast();
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [toppings, setToppings] = useState<ToppingOption[]>([]);
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!product) return;
    setQty(1); setNotes(""); setSelected({});
    api<ToppingOption[]>(`/api/products/${product.id}/toppings`).then(setToppings).catch(() => setToppings([]));
  }, [product]);

  if (!product) return null;

  const toppingsTotal = toppings.reduce(
    (s, t) => s + Number(t.price) * (selected[t.topping_id] ?? 0), 0);
  const lineTotal = (Number(product.sale_price) + toppingsTotal) * qty;

  async function add() {
    setSaving(true);
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
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={product.name.toUpperCase()} onClose={onClose}>
      <p className="-mt-3 mb-4 text-lg font-bold text-accent-cyan">
        {cop.format(Number(product.sale_price))}
      </p>
      {product.description && (
        <p className="mb-4 text-sm text-text-secondary">{product.description}</p>
      )}

      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-text-muted">Cantidad</p>
      <div className="glass mb-4 flex items-center justify-between rounded-xl p-2">
        <button onClick={() => setQty((q) => Math.max(1, q - 1))}
          className="grid h-10 w-10 place-items-center rounded-lg bg-bg-tertiary transition hover:text-accent-blue">
          <Minus size={16} />
        </button>
        <input type="number" min={1} value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
          className="w-20 border-b border-border-medium bg-transparent text-center text-xl font-bold outline-none" />
        <button onClick={() => setQty((q) => q + 1)}
          className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br from-accent-blue to-accent-blue-hover text-white">
          <Plus size={16} />
        </button>
      </div>

      {toppings.length > 0 && (
        <>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-text-muted">
            Adicionales / Toppings
          </p>
          <div className="mb-4 space-y-2">
            {toppings.map((t) => {
              const q = selected[t.topping_id] ?? 0;
              return (
                <div key={t.id}
                  className={`flex items-center justify-between rounded-xl border p-2.5 transition ${
                    q > 0 ? "border-accent-orange bg-accent-orange/10" : "border-border-subtle"
                  }`}>
                  <span className="text-sm">
                    {t.name} <span className="text-text-muted">+{cop.format(Number(t.price))}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSelected({ ...selected, [t.topping_id]: Math.max(0, q - 1) })}
                      className="grid h-7 w-7 place-items-center rounded-lg bg-bg-tertiary">−</button>
                    <span className="w-5 text-center text-sm font-bold">{q}</span>
                    <button onClick={() => setSelected({ ...selected, [t.topping_id]: Math.min(t.max_allowed, q + 1) })}
                      className="grid h-7 w-7 place-items-center rounded-lg bg-accent-orange/20 text-accent-orange">+</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-text-muted">
        Nota / Comentario
      </p>
      <TextArea rows={2} value={notes} placeholder="Ej: Sin sal, salsa aparte…"
        onChange={(e) => setNotes(e.target.value)} />

      <Button className="mt-5 w-full" onClick={add} disabled={saving}>
        {saving ? "Agregando…" : `Agregar a la Orden — ${cop.format(lineTotal)}`}
      </Button>
    </Modal>
  );
}

/* ───────── Ver Orden ───────── */
function ViewOrderModal({ open, order, total, onClose }: {
  open: boolean; order: Order; total: number; onClose: () => void;
}) {
  return (
    <Modal open={open} title={`Orden ${order.order_number}`} onClose={onClose}>
      <ul className="space-y-2 text-sm">
        {order.items.map((i) => (
          <li key={i.id}
            className={`flex items-center justify-between border-b border-border-subtle pb-2 last:border-0 ${
              i.kitchen_status === "cancelado" ? "opacity-50 line-through" : ""
            }`}>
            <span>
              {i.quantity}x {i.product_name}
              <Badge color={STATUS_COLOR[i.kitchen_status]}>
                {KITCHEN_STATUS_LABELS[i.kitchen_status]}
              </Badge>
            </span>
            <span className="font-medium">{cop.format(Number(i.subtotal))}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-between border-t border-border-medium pt-3 font-bold">
        <span>TOTAL</span><span>{cop.format(total)}</span>
      </div>
    </Modal>
  );
}

/* ───────── Reimprimir (comanda / prefactura §1.6.3) ───────── */
function PrintModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  function choose(tipo: string) {
    toast("error", `La impresión de ${tipo} estará disponible con el servicio de impresión local (§1.8.5).`);
    onClose();
  }
  return (
    <Modal open={open} title="Reimprimir" onClose={onClose}>
      <p className="mb-4 text-sm text-text-secondary">¿Qué desea imprimir?</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={() => choose("la comanda")}>Comanda</Button>
        <Button variant="ghost" onClick={() => choose("la prefactura")}>Prefactura</Button>
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

  const canReorder = item.kitchen_status === "listo";

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
              className="h-4 w-4 accent-[hsl(199_89%_48%)]" />
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
