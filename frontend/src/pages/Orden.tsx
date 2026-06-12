/**
 * Vista de la orden — réplica completa de Polaris blank_tb_order_items
 * (docs/polaris-restaurante-mesas-spec.md) con el tema hpos:
 *  · Buscador + categorías con productos (variantes, toppings, receta) y
 *    validación de inventario en cliente (array_inventario de Polaris)
 *  · Ticket por estados: carrito (nuevo/devuelto) editable, en cocina,
 *    historial LISTO (listo/entregado) y cancelados
 *  · Confirmar (marchar) → imprime comanda de los ítems confirmados
 *  · Devolución/Reorden por cantidades con motivo obligatorio (modal-return)
 *  · Cerrar mesa (solo sin productos activos) · Comentario de mesa
 *  · Traslado de productos: wizard 2 pasos (ítems → sala → mesa)
 *  · Reimpresión: prefactura / comanda con impresoras configuradas
 *  · Compras Compartidas: clientes por ítem, asignación obligatoria
 *  · Domicilio: cliente + domiciliario al abrir mesa de la sala DOMICILIO
 *  · Cobrar Mesa → pantalla de pago (solo sin pendientes)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRightLeft, ChevronUp, MessageSquare, Minus, Pencil, Plus,
  Printer, ReceiptText, RotateCcw, Search, Send, ShoppingCart, Trash2,
  Undo2, UserPlus, Users, Wallet, X,
} from "lucide-react";
import { api, ApiError, subscribeEvents } from "../lib/api";
import {
  Badge, Button, cop, Field, Input, Modal, Select, TextArea, useToast,
} from "../components/ui";
import {
  isCartStatus, isFinished, isInKitchen, KITCHEN_STATUS_LABELS,
} from "../shared/constants/kitchenStatus";
import type { KitchenStatus } from "../shared/constants/kitchenStatus";
import { imprimirComanda, imprimirPreFactura, listPrinters } from "../lib/printing";
import type { Printer as PrinterInfo } from "../lib/printing";

/* ───── tipos (formas del backend /menu/polaris y /orders/:id) ───── */
interface Variant {
  id: number; name: string; price: string;
  receta: { product_id: number; quantity: number }[];
}
interface ToppingOption { id: number; name: string; price: string; max_allowed: number }
export interface MenuProduct {
  id: number; name: string; desc: string | null; price: string;
  is_inventariable: boolean; goes_to_kitchen: boolean; type_product: string;
  category_id: number; category_name: string;
  variantes: Variant[]; toppings: ToppingOption[];
  receta: { product_id: number; quantity: number }[] | null;
}
type InventoryMap = Record<string, { product_name: string; quantity: number }>;

export interface OrderItem {
  id: number; product_id: number; variant_id: number | null;
  product_name: string; quantity: number; unit_price: string;
  subtotal: string; notes: string | null; kitchen_status: KitchenStatus;
  is_paid: boolean; customer_id: number | null;
  customer_name_shared: string | null;
  toppings: { topping_id: number; topping_name: string; topping_price: string; quantity: number }[];
}
export interface Order {
  id: number; order_number: string; comment: string | null; status: string;
  table_id: number; room_id: number | null; attended_by: string | null;
  client_id: number | null; delivery_personnel_id: number | null;
  items: OrderItem[];
}
interface BoardCell {
  table_id: number; number: number; room_id: number; room_name: string;
  order_id: number | null;
}
interface Client { id: number; name: string; last_name: string | null; document_id: string }
interface Driver {
  id: number; name: string; phone: string; plate: string; company_name: string;
}

const STATUS_COLOR: Partial<Record<KitchenStatus, "gray" | "amber" | "cyan" | "emerald" | "rose">> = {
  nuevo: "gray", devuelto: "amber", requerido: "amber", en_preparacion: "cyan",
  listo: "emerald", entregado: "emerald", cancelado: "rose",
};

const clientLabel = (c: Client) =>
  `${c.name}${c.last_name ? ` ${c.last_name}` : ""}`.trim();

export default function Orden() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [order, setOrder] = useState<Order | null>(null);
  const [table, setTable] = useState<BoardCell | null>(null);
  const [menu, setMenu] = useState<MenuProduct[]>([]);
  const [inventory, setInventory] = useState<InventoryMap>({});
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("TODOS");

  const [productModal, setProductModal] =
    useState<{ product: MenuProduct; item?: OrderItem } | null>(null);
  const [modal, setModal] = useState<
    "" | "comment" | "return" | "transfer" | "close" | "view" | "print" |
    "assign" | "newCustomer" | "domCliente" | "domDriver"
  >("");
  const [sheetOpen, setSheetOpen] = useState(false);

  // Compras Compartidas (Polaris: isSharedOrderMode / existstSharedPurchase)
  const [sharedMode, setSharedMode] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(() => {
    api<Order>(`/api/orders/${orderId}`).then((o) => {
      setOrder(o);
      // Si la orden ya tiene ítems con cliente, el modo compartido queda
      // activo y bloqueado (Polaris: existstSharedPurchase)
      if (o.items.some((i) => i.customer_id)) setSharedMode(true);
    }).catch(() => navigate("/mesas"));
  }, [orderId, navigate]);

  const loadClients = useCallback(() => {
    api<Client[]>("/api/clients").then(setClients).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    loadClients();
    api<{ products: MenuProduct[]; inventory: InventoryMap }>("/api/products/menu/polaris")
      .then((r) => { setMenu(r.products); setInventory(r.inventory); })
      .catch(() => {});
    api<BoardCell[]>("/api/orders/board")
      .then((b) => setTable(b.find((c) => c.order_id === Number(orderId)) ?? null))
      .catch(() => {});
    return subscribeEvents((e) => {
      if (e.table === "order_items" || e.table === "orders") load();
    });
  }, [load, loadClients, orderId]);

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
  const cartItems = activeItems.filter((i) => isCartStatus(i.kitchen_status));
  const kitchenItems = activeItems.filter((i) => isInKitchen(i.kitchen_status));
  const finishedItems = activeItems.filter((i) => isFinished(i.kitchen_status));
  const total = activeItems.reduce((s, i) => s + Number(i.subtotal), 0);

  // Polaris visibilidadBotones
  const allCancelled = items.length === 0 || items.every((i) => i.kitchen_status === "cancelado");
  const canClose = allCancelled;
  const canConfirm = cartItems.length > 0;
  const canPay = cartItems.length === 0 && !allCancelled;
  const hasProducts = items.length > 0;
  const sharedLocked = items.some((i) => i.customer_id); // toggle bloqueado

  const isDomicilio = (table?.room_name ?? "").toUpperCase() === "DOMICILIO";

  // Domicilio: al entrar la primera vez sin cliente, el modal es obligatorio
  useEffect(() => {
    if (order && table && isDomicilio && !order.client_id) setModal("domCliente");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, table?.table_id]);

  // Compartidas: si se activa con ítems sin cliente, asignación obligatoria
  useEffect(() => {
    if (sharedMode && activeItems.some((i) => !i.customer_id) &&
        items.some((i) => i.customer_id)) {
      setModal("assign");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedMode]);

  async function confirmItems() {
    if (confirming) return;
    if (cartItems.length === 0) {
      toast("error", "No hay productos nuevos para confirmar.");
      return;
    }
    setConfirming(true);
    const ids = cartItems.map((i) => i.id);
    try {
      await api(`/api/orders/${orderId}/confirm`, {
        method: "POST", body: { itemIds: ids },
      });
      toast("success", "Pedido confirmado correctamente");
      load();
      // Polaris: al confirmar imprime la comanda de los ids confirmados
      void printComanda(ids);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Error al confirmar");
    } finally {
      setConfirming(false);
    }
  }

  async function printComanda(itemIds?: number[]) {
    try {
      const printers = await listPrinters("comanda");
      const ok = await imprimirComanda(order!.id, itemIds, printers[0] ?? null);
      if (ok) toast("success", "Impresión enviada");
    } catch {
      toast("error", "Error al imprimir");
    }
  }

  async function printPrefactura() {
    try {
      const printers = await listPrinters("prefactura");
      const ok = await imprimirPreFactura(order!.id, printers[0] ?? null);
      if (ok) toast("success", "Impresión enviada");
      else toast("error", "No hay impresoras de prefactura configuradas");
    } catch {
      toast("error", "Error al imprimir");
    }
  }

  async function removeItem(item: OrderItem) {
    try {
      await api(`/api/orders/${orderId}/items/${item.id}`, { method: "DELETE" });
      toast("success", "Producto eliminado correctamente");
      load();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No se pudo eliminar");
    }
  }

  function goToPay() {
    // Polaris action=pagar: con pendientes no se cobra
    if (cartItems.length > 0) {
      toast("error", "Confirme los productos pendientes antes de cobrar");
      return;
    }
    if (kitchenItems.length > 0) {
      toast("error", "No se puede cobrar. Algunos productos aún se encuentran en preparación.");
      return;
    }
    navigate(`/mesas/${order!.id}/pago`);
  }

  async function toggleShared() {
    if (sharedLocked) return; // Polaris: con compras asociadas no se apaga
    if (!sharedMode) {
      setSharedMode(true);
      if (activeItems.some((i) => !i.customer_id) && activeItems.length > 0) {
        setModal("assign");
      }
    } else {
      setSharedMode(false);
      setSelectedCustomerId(null);
    }
  }

  if (!order) return <p className="text-text-muted">Cargando orden…</p>;

  const itemCount = activeItems.reduce((s, i) => s + i.quantity, 0);

  /* ══ Ticket (panel derecho / bottom sheet) ══ */
  const renderItems = (list: OrderItem[], opts: { editable?: boolean } = {}) =>
    list.map((item) => (
      <li key={item.id} className="flex items-start gap-2">
        <span className="mt-0.5 w-5 text-right text-sm font-bold">{item.quantity}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold uppercase leading-tight">{item.product_name}</p>
          {item.toppings.length > 0 && (
            <p className="text-xs text-accent-orange">
              {item.toppings.map((t) => `${t.topping_name} x${t.quantity}`).join(", ")}
            </p>
          )}
          {item.notes && <p className="text-xs italic text-text-muted">{item.notes}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge color={STATUS_COLOR[item.kitchen_status] ?? "gray"}>
              {/* Polaris: 3 y 4 se muestran LISTO en el ticket */}
              {(isFinished(item.kitchen_status) ? "Listo" : KITCHEN_STATUS_LABELS[item.kitchen_status]).toUpperCase()}
              {item.is_paid ? " · PAGADO" : ""}
            </Badge>
            {sharedMode && item.customer_name_shared && (
              <Badge color="cyan">{item.customer_name_shared.toUpperCase()}</Badge>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold">{cop.format(Number(item.subtotal))}</p>
          {opts.editable && (
            <div className="flex justify-end gap-1">
              <button aria-label="Editar"
                onClick={() => {
                  const p = menu.find((m) => m.id === item.product_id);
                  if (p) setProductModal({ product: p, item });
                }}
                className="rounded-lg p-1.5 text-text-muted transition hover:bg-accent-blue/15 hover:text-accent-blue">
                <Pencil size={14} />
              </button>
              <button onClick={() => removeItem(item)} aria-label="Quitar"
                className="rounded-lg p-1.5 text-text-muted transition hover:bg-accent-rose/15 hover:text-accent-rose">
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>
      </li>
    ));

  const panelBody = activeItems.length === 0 ? (
    <div className="grid h-full min-h-48 place-items-center text-center text-text-muted">
      <div>
        <ReceiptText size={34} className="mx-auto mb-2 opacity-50" />
        <p className="text-sm">Mesa vacía</p>
      </div>
    </div>
  ) : (
    <>
      {cartItems.length > 0 && (
        <PanelSection label="Por confirmar">
          {renderItems(cartItems, { editable: true })}
        </PanelSection>
      )}
      {kitchenItems.length > 0 && (
        <PanelSection label="En cocina">{renderItems(kitchenItems)}</PanelSection>
      )}
      {finishedItems.length > 0 && (
        <PanelSection label="Listos">{renderItems(finishedItems)}</PanelSection>
      )}
    </>
  );

  const panelActions = (
    <div className="mt-4 space-y-2 border-t border-border-subtle pt-4">
      {/* Compras Compartidas (Polaris toggle-switch) */}
      <button type="button" onClick={toggleShared} disabled={sharedLocked && sharedMode}
        className={`flex w-full items-center justify-between rounded-xl border px-4 py-2.5 text-sm transition ${
          sharedMode ? "border-accent-blue/50 bg-accent-blue/5" : "border-border-subtle hover:border-border-medium"
        } ${sharedLocked && sharedMode ? "opacity-70" : ""}`}>
        <span className="flex items-center gap-2 font-medium text-text-secondary">
          <Users size={16} /> Compras Compartidas
        </span>
        <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${
          sharedMode ? "bg-accent-blue" : "bg-bg-tertiary"
        }`}>
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
            sharedMode ? "left-[18px]" : "left-0.5"
          }`} />
        </span>
      </button>

      {/* Cliente activo para nuevos ítems (modo compartido) */}
      {sharedMode && (
        <div className="flex items-center gap-2">
          <Select value={selectedCustomerId ?? ""} aria-label="Cliente"
            onChange={(e) => setSelectedCustomerId(e.target.value ? Number(e.target.value) : null)}
            className="flex-1">
            <option value="">— Seleccionar cliente —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.document_id} - {clientLabel(c)}</option>
            ))}
          </Select>
          <button onClick={() => setModal("newCustomer")} aria-label="Nuevo cliente"
            className="glass grid h-10 w-10 shrink-0 place-items-center rounded-xl text-accent-blue">
            <UserPlus size={17} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={() => setModal("view")}>
          <ReceiptText size={15} className="-mt-0.5 mr-1.5 inline" /> Ver Orden
        </Button>
        <Button onClick={confirmItems} disabled={!canConfirm || confirming}>
          <Send size={15} className="-mt-0.5 mr-1.5 inline" />
          {confirming ? "Enviando…" : "Confirmar"}
        </Button>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        {/* Botón rojo: devolución/reorden (Polaris abrirDevolucionModal) */}
        <Button variant="danger" onClick={() => setModal("return")} aria-label="Devoluciones"
          disabled={kitchenItems.length === 0 && finishedItems.length === 0}>
          <Undo2 size={15} />
        </Button>
        <Button variant="dark" onClick={goToPay} disabled={!canPay}>
          <Wallet size={15} className="-mt-0.5 mr-1.5 inline" /> Cobrar Mesa
        </Button>
      </div>
      {cartItems.length > 0 && (
        <p className="text-center text-[11px] text-accent-amber">
          Confirme los productos nuevos antes de cobrar
        </p>
      )}
    </div>
  );

  return (
    <div className="fade-in-up -m-6 flex min-h-[100dvh] flex-col">
      {/* ══ Cabecera ══ */}
      <header className="glass flex items-center justify-between gap-3 rounded-none border-x-0 border-t-0 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/mesas")} aria-label="Volver a mesas"
            className="rounded-lg p-2 text-text-muted transition hover:bg-bg-tertiary hover:text-text-primary">
            <ArrowLeft size={19} />
          </button>
          <div>
            <h1 className="text-lg font-bold">
              Orden: {order.id} {table && `- Mesa ${table.number}`}
            </h1>
            <p className="text-sm text-text-secondary">Mesero: {order.attended_by ?? "—"}</p>
            {isDomicilio && order.client_id && (
              <p className="text-xs text-accent-blue">
                Domicilio · {clients.find((c) => c.id === order.client_id)
                  ? clientLabel(clients.find((c) => c.id === order.client_id)!)
                  : `Cliente #${order.client_id}`}
              </p>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Total</p>
          <p className="text-2xl font-bold leading-tight text-accent-cyan">{cop.format(total)}</p>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        {/* ══ Columna izquierda: menú ══ */}
        <div className="flex-1 p-4 pb-28 sm:p-6 lg:pb-6">
          <div className="mb-4 flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <Input placeholder="Buscar productos…" value={search}
                onChange={(e) => setSearch(e.target.value)} className="!pl-9" />
            </div>
            {/* Toolbar Polaris: cerrar mesa, reimpresión, comentario, traslado */}
            <IconBtn label="Cerrar mesa" onClick={() => setModal("close")} disabled={!canClose}>
              <X size={17} />
            </IconBtn>
            {hasProducts && (
              <IconBtn label="Reimpresión del voucher" onClick={() => setModal("print")}>
                <Printer size={17} />
              </IconBtn>
            )}
            <IconBtn label="Agregar comentario a la mesa" onClick={() => setModal("comment")}>
              <MessageSquare size={17} />
            </IconBtn>
            <IconBtn label="Trasladar Productos a otra Mesa" onClick={() => setModal("transfer")}>
              <ArrowRightLeft size={17} />
            </IconBtn>
          </div>

          {/* Categorías */}
          <div className="mb-5 flex flex-wrap gap-2">
            {categories.map((c) => (
              <button key={c} onClick={() => setCategory(c)}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-wide transition sm:py-1.5 ${
                  c === category
                    ? "bg-gradient-to-br from-accent-blue to-accent-blue-hover text-white shadow-[0_0_12px_hsl(199_89%_48%/0.25)]"
                    : "glass text-text-secondary hover:text-text-primary"
                }`}>
                {c}
              </button>
            ))}
          </div>

          {/* Productos */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(165px,1fr))] gap-3">
            {filteredMenu.map((p) => (
              <button key={p.id} onClick={() => setProductModal({ product: p })}
                className="glass relative flex min-h-28 flex-col justify-between rounded-2xl p-4 text-left transition hover:-translate-y-0.5 hover:border-accent-blue/50 hover:shadow-lg">
                <span className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-accent-blue/15 text-accent-blue">
                  <Plus size={15} />
                </span>
                <p className="pr-8 text-sm font-bold uppercase leading-tight">{p.name}</p>
                <p className="mt-5 font-bold text-accent-cyan">
                  {p.variantes.length > 0
                    ? `Desde ${cop.format(Math.min(...p.variantes.map((v) => Number(v.price))))}`
                    : cop.format(Number(p.price))}
                </p>
              </button>
            ))}
            {filteredMenu.length === 0 && (
              <p className="col-span-full py-10 text-center text-sm text-text-muted">
                Sin productos disponibles
              </p>
            )}
          </div>
        </div>

        {/* ══ Panel derecho (tablet/desktop) ══ */}
        <aside className="glass hidden w-96 flex-col border-l border-border-subtle p-5 lg:flex">
          <div className="flex-1 overflow-y-auto">{panelBody}</div>
          {panelActions}
        </aside>
      </div>

      {/* ══ Barra carrito fija (móviles) ══ */}
      <div className="fixed inset-x-0 bottom-0 z-40 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden">
        <button onClick={() => setSheetOpen(true)}
          className="flex w-full items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-accent-blue to-accent-blue-hover px-5 py-3 text-white shadow-[0_4px_20px_hsl(199_89%_48%/0.45)] transition active:scale-[0.98]">
          <span className="flex min-w-0 items-center gap-3">
            <ShoppingCart size={22} className="shrink-0" />
            <span className="min-w-0 text-left leading-tight">
              <span className="block truncate text-xs font-semibold opacity-90">
                {itemCount === 0
                  ? "Mesa vacía"
                  : `${itemCount} producto${itemCount === 1 ? "" : "s"}${
                      cartItems.length > 0 ? ` · ${cartItems.length} por confirmar` : ""
                    }`}
              </span>
              <span className="block text-lg font-bold">{cop.format(total)}</span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 font-semibold">
            Ver orden <ChevronUp size={18} />
          </span>
        </button>
      </div>

      {/* ══ Bottom sheet (móviles) ══ */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm lg:hidden"
          onMouseDown={(e) => e.target === e.currentTarget && setSheetOpen(false)}>
          <div className="slide-up glass flex max-h-[85vh] flex-col rounded-t-2xl border-b-0 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Pedido{table && ` — Mesa ${table.number}`}</h2>
                <p className="text-sm font-bold text-accent-cyan">{cop.format(total)}</p>
              </div>
              <button onClick={() => setSheetOpen(false)} aria-label="Cerrar pedido"
                className="grid h-11 w-11 place-items-center rounded-xl text-text-muted transition hover:bg-bg-tertiary hover:text-text-primary">
                <X size={22} />
              </button>
            </div>
            <div className="min-h-24 flex-1 overflow-y-auto">{panelBody}</div>
            {panelActions}
          </div>
        </div>
      )}

      {/* ══ Modales ══ */}
      {productModal && (
        <ProductModal product={productModal.product} item={productModal.item}
          orderId={order.id} inventory={inventory}
          customerId={sharedMode ? selectedCustomerId : null} sharedMode={sharedMode}
          onClose={() => setProductModal(null)} onSaved={load} />
      )}
      <CommentModal open={modal === "comment"} order={order}
        onClose={() => setModal("")} onSaved={load} />
      <ReturnModal open={modal === "return"} orderId={order.id}
        items={items.filter((i) =>
          !isCartStatus(i.kitchen_status) && i.kitchen_status !== "cancelado" && !i.is_paid)}
        onClose={() => setModal("")} onDone={load} />
      <TransferModal open={modal === "transfer"} order={order}
        items={activeItems} onClose={() => setModal("")} onDone={load} />
      <CloseModal open={modal === "close"} orderId={order.id} onClose={() => setModal("")} />
      <ViewOrderModal open={modal === "view"} order={order} total={total}
        sharedMode={sharedMode} onClose={() => setModal("")} />
      <PrintModal open={modal === "print"} onClose={() => setModal("")}
        onComanda={() => { setModal(""); void printComanda(); }}
        onPrefactura={() => { setModal(""); void printPrefactura(); }} />
      <AssignModal open={modal === "assign"} orderId={order.id}
        items={activeItems.filter((i) => !i.customer_id)} clients={clients}
        onNewCustomer={() => setModal("newCustomer")}
        onClose={() => setModal("")} onDone={load} />
      <NewCustomerModal open={modal === "newCustomer"}
        onClose={() => setModal("")}
        onCreated={(id) => { loadClients(); setSelectedCustomerId(id); setModal(""); }} />
      <DomicilioClienteModal open={modal === "domCliente"} orderId={order.id}
        clients={clients}
        onNewCustomer={() => setModal("newCustomer")}
        onClose={() => setModal("")}
        onDone={() => { load(); setModal("domDriver"); }} />
      <DomiciliarioModal open={modal === "domDriver"} orderId={order.id}
        onClose={() => setModal("")} onDone={load} />
    </div>
  );
}

/* ───────── piezas ───────── */
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

function IconBtn({ label, onClick, disabled, children }: {
  label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} title={label} aria-label={label} disabled={disabled}
      className={`glass grid h-11 w-11 shrink-0 place-items-center rounded-xl transition ${
        disabled ? "cursor-not-allowed opacity-40" : "text-text-secondary hover:text-accent-blue"
      }`}>
      {children}
    </button>
  );
}

/* ───────── Modal de producto: variantes + cantidad + toppings + nota ─────────
   Réplica de abrirModalAgregar/abrirModalEditar de Polaris, con validación
   de inventario por receta contra el mapa array_inventario. */
function ProductModal({ product, item, orderId, inventory, customerId, sharedMode, onClose, onSaved }: {
  product: MenuProduct; item?: OrderItem; orderId: number;
  inventory: InventoryMap; customerId: number | null; sharedMode: boolean;
  onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [qty, setQty] = useState(item?.quantity ?? 1);
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [variantId, setVariantId] = useState<number | null>(item?.variant_id ?? null);
  const [selected, setSelected] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {};
    for (const t of item?.toppings ?? []) {
      if (t.topping_id) init[t.topping_id] = t.quantity;
    }
    return init;
  });
  const [saving, setSaving] = useState(false);

  const editing = !!item;
  const hasVariants = product.variantes.length > 0;
  const variant = product.variantes.find((v) => v.id === variantId) ?? null;
  const unitPrice = variant ? Number(variant.price) : Number(product.price);

  const toppingsTotal = product.toppings.reduce(
    (s, t) => s + Number(t.price) * (selected[t.id] ?? 0), 0);
  const lineTotal = (unitPrice + toppingsTotal) * qty;

  /** Polaris hayCantidadRecetaDisponible: receta * cantidad vs inventario. */
  function checkInventory(): string | null {
    const receta = variant ? variant.receta : (product.receta ?? []);
    if (!product.is_inventariable || receta.length === 0) return null;
    for (const ing of receta) {
      const stock = inventory[ing.product_id];
      if (stock && stock.quantity < ing.quantity * qty) {
        return `¡El producto ${product.name} solo tiene ${Math.floor(stock.quantity / ing.quantity)} unidades disponibles!`;
      }
    }
    return null;
  }

  async function save() {
    if (hasVariants && !variantId) {
      toast("error", "Seleccione una variante");
      return;
    }
    const invError = checkInventory();
    if (invError) {
      toast("error", invError);
      return;
    }
    if (sharedMode && !customerId && !editing) {
      toast("error", "Seleccione el cliente para el producto");
      return;
    }
    setSaving(true);
    const toppings = Object.entries(selected)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => ({ toppingId: Number(id), quantity: q }));
    try {
      if (editing) {
        await api(`/api/orders/${orderId}/items/${item!.id}`, {
          method: "PUT",
          body: { quantity: qty, notes: notes || undefined, toppings, customerId: item!.customer_id },
        });
      } else {
        await api(`/api/orders/${orderId}/items`, {
          method: "POST",
          body: {
            productId: product.id, variantId, quantity: qty,
            notes: notes || undefined, toppings, customerId,
          },
        });
        toast("success", "Producto agregado correctamente");
      }
      onSaved(); onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "¡Error al agregar el producto!");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={product.name.toUpperCase()} onClose={onClose}>
      <p className="-mt-3 mb-4 text-lg font-bold text-accent-cyan">{cop.format(unitPrice)}</p>
      {product.desc && <p className="mb-4 text-sm text-text-secondary">{product.desc}</p>}

      {hasVariants && (
        <>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-text-muted">Variante</p>
          <div className="mb-4 grid grid-cols-2 gap-2">
            {product.variantes.map((v) => (
              <button key={v.id} onClick={() => setVariantId(v.id)}
                className={`rounded-xl border p-2.5 text-left text-sm transition ${
                  v.id === variantId
                    ? "border-accent-blue bg-accent-blue/10"
                    : "border-border-subtle hover:border-border-medium"
                }`}>
                <span className="block font-semibold">{v.name}</span>
                <span className="text-xs text-text-muted">{cop.format(Number(v.price))}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-text-muted">Cantidad</p>
      <div className="glass mb-4 flex items-center justify-between rounded-xl p-2">
        <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Restar"
          className="grid h-12 w-12 place-items-center rounded-lg bg-bg-tertiary transition hover:text-accent-blue active:scale-95">
          <Minus size={18} />
        </button>
        <input type="number" min={1} value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
          className="w-20 border-b border-border-medium bg-transparent text-center text-xl font-bold outline-none" />
        <button onClick={() => setQty((q) => q + 1)} aria-label="Sumar"
          className="grid h-12 w-12 place-items-center rounded-lg bg-gradient-to-br from-accent-blue to-accent-blue-hover text-white active:scale-95">
          <Plus size={18} />
        </button>
      </div>

      {product.toppings.length > 0 && (
        <>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-text-muted">
            Adicionales / Toppings
          </p>
          <div className="mb-4 space-y-2">
            {product.toppings.map((t) => {
              const q = selected[t.id] ?? 0;
              return (
                <div key={t.id}
                  className={`flex items-center justify-between rounded-xl border p-2.5 transition ${
                    q > 0 ? "border-accent-orange bg-accent-orange/10" : "border-border-subtle"
                  }`}>
                  <span className="text-sm">
                    {t.name} <span className="text-text-muted">+{cop.format(Number(t.price))}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSelected({ ...selected, [t.id]: Math.max(0, q - 1) })}
                      aria-label={`Quitar ${t.name}`}
                      className="grid h-11 w-11 place-items-center rounded-lg bg-bg-tertiary transition active:scale-95">
                      <Minus size={16} />
                    </button>
                    <span className="w-6 text-center text-base font-bold">{q}</span>
                    <button
                      onClick={() => {
                        // Polaris cambiarToppingQty: respeta el máximo permitido
                        if (q + 1 > t.max_allowed) {
                          toast("error", `Máximo ${t.max_allowed} de ${t.name}`);
                          return;
                        }
                        setSelected({ ...selected, [t.id]: q + 1 });
                      }}
                      aria-label={`Agregar ${t.name}`}
                      className="grid h-11 w-11 place-items-center rounded-lg bg-accent-orange/20 text-accent-orange transition active:scale-95">
                      <Plus size={16} />
                    </button>
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
      {/* Polaris: nota en MAYÚSCULAS y sin saltos de línea */}
      <TextArea rows={2} value={notes} placeholder="Ej: Sin sal, salsa aparte…"
        onChange={(e) => setNotes(e.target.value.toUpperCase().replace(/[\r\n]+/g, ""))} />

      <Button className="mt-5 w-full" onClick={save} disabled={saving}>
        {saving ? "Guardando…" : editing
          ? `Guardar cambios — ${cop.format(lineTotal)}`
          : `Agregar a la Orden — ${cop.format(lineTotal)}`}
      </Button>
    </Modal>
  );
}

/* ───────── Devolución / Reorden por cantidades (Polaris modal-return) ───────── */
function ReturnModal({ open, orderId, items, onClose, onDone }: {
  open: boolean; orderId: number; items: OrderItem[];
  onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [qtys, setQtys] = useState<Record<number, number>>({});
  useEffect(() => { if (open) { setReason(""); setQtys({}); } }, [open]);

  const selected = Object.entries(qtys).filter(([, q]) => q > 0)
    .map(([id, q]) => ({ itemId: Number(id), quantity: q }));

  // Polaris: "Solicitar de nuevo" solo si TODO lo seleccionado fue entregado
  // (en hpos también 'listo' mientras el Monitor no marque entregas)
  const reorderBlocked = selected.some((s) => {
    const it = items.find((i) => i.id === s.itemId);
    return it && !isFinished(it.kitchen_status);
  });

  async function run(action: "devolution" | "reorder") {
    if (!reason.trim()) {
      toast("error", action === "devolution"
        ? "Debes ingresar un motivo para devolver."
        : "Debes ingresar el motivo de la solicitud.");
      return;
    }
    if (selected.length === 0) {
      toast("error", action === "devolution"
        ? "Selecciona productos."
        : "Selecciona productos para pedir de nuevo.");
      return;
    }
    if (action === "reorder" && reorderBlocked) {
      toast("error", "El producto no ha sido entregado, no es posible solicitarlo nuevamente");
      return;
    }
    try {
      await api(`/api/orders/${orderId}/${action}`, {
        method: "POST", body: { reason, items: selected },
      });
      toast("success", action === "devolution"
        ? "Devolución registrada correctamente"
        : "Productos solicitados de nuevo");
      onDone(); onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No fue posible completar");
    }
  }

  return (
    <Modal open={open} title="Devoluciones" onClose={onClose}>
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-text-muted">No hay productos disponibles.</p>
      ) : (
        <div className="mb-4 max-h-60 space-y-2 overflow-y-auto">
          {items.map((i) => {
            const q = qtys[i.id] ?? 0;
            return (
              <div key={i.id} className="flex items-center justify-between rounded-xl border border-border-subtle p-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-bold">{i.product_name}</p>
                  <p className="text-xs text-text-muted">
                    Disponible: {i.quantity}
                    {i.toppings.length > 0 &&
                      ` · ${i.toppings.map((t) => `${t.topping_name} x${t.quantity}`).join(", ")}`}
                  </p>
                  <Badge color={STATUS_COLOR[i.kitchen_status] ?? "gray"}>
                    {KITCHEN_STATUS_LABELS[i.kitchen_status].toUpperCase()}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setQtys({ ...qtys, [i.id]: Math.max(0, q - 1) })}
                    aria-label="Restar"
                    className="grid h-10 w-10 place-items-center rounded-lg bg-bg-tertiary active:scale-95">
                    <Minus size={15} />
                  </button>
                  <span className={`w-6 text-center font-bold ${q > 0 ? "text-accent-blue" : "text-text-muted"}`}>
                    {q}
                  </span>
                  <button onClick={() => setQtys({ ...qtys, [i.id]: Math.min(i.quantity, q + 1) })}
                    aria-label="Sumar"
                    className="grid h-10 w-10 place-items-center rounded-lg bg-accent-blue/15 text-accent-blue active:scale-95">
                    <Plus size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Field label="Motivo (obligatorio)">
        <TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Volver</Button>
        <Button variant="ghost" onClick={() => run("reorder")} disabled={reorderBlocked}>
          <RotateCcw size={14} className="-mt-0.5 mr-1 inline" /> Solicitar de nuevo
        </Button>
        <Button variant="danger" onClick={() => run("devolution")}>Devolver</Button>
      </div>
    </Modal>
  );
}

/* ───────── Ver Orden (historial; agrupado por cliente si compartidas) ───────── */
function ViewOrderModal({ open, order, total, sharedMode, onClose }: {
  open: boolean; order: Order; total: number; sharedMode: boolean; onClose: () => void;
}) {
  const groups = useMemo(() => {
    if (!sharedMode) return [{ name: null as string | null, items: order.items }];
    const map = new Map<string, OrderItem[]>();
    for (const i of order.items) {
      const key = i.customer_name_shared ?? "Sin cliente";
      map.set(key, [...(map.get(key) ?? []), i]);
    }
    return [...map.entries()].map(([name, items]) => ({ name, items }));
  }, [order.items, sharedMode]);

  return (
    <Modal open={open} title={`Orden ${order.id}`} onClose={onClose}>
      {groups.map((g) => (
        <div key={g.name ?? "_"} className="mb-3">
          {g.name && (
            <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-accent-blue">
              {g.name}
            </p>
          )}
          <ul className="space-y-2 text-sm">
            {g.items.map((i) => (
              <li key={i.id}
                className={`flex items-center justify-between gap-2 border-b border-border-subtle pb-2 last:border-0 ${
                  i.kitchen_status === "cancelado" ? "opacity-50 line-through" : ""
                }`}>
                <span>
                  {i.quantity}x {i.product_name}{" "}
                  <Badge color={STATUS_COLOR[i.kitchen_status] ?? "gray"}>
                    {KITCHEN_STATUS_LABELS[i.kitchen_status]}
                  </Badge>
                </span>
                <span className="font-medium">{cop.format(Number(i.subtotal))}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="mt-3 flex justify-between border-t border-border-medium pt-3 font-bold">
        <span>TOTAL</span><span>{cop.format(total)}</span>
      </div>
    </Modal>
  );
}

/* ───────── Reimpresión (prefactura / comanda) ───────── */
function PrintModal({ open, onClose, onComanda, onPrefactura }: {
  open: boolean; onClose: () => void; onComanda: () => void; onPrefactura: () => void;
}) {
  return (
    <Modal open={open} title="Reimpresión" onClose={onClose}>
      <p className="mb-4 text-sm text-text-secondary">¿Qué desea imprimir?</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={onPrefactura}>Prefactura</Button>
        <Button variant="ghost" onClick={onComanda}>Comanda</Button>
      </div>
    </Modal>
  );
}

/* ───────── Comentario de la mesa (Guardar / Eliminar, Polaris actionComment) ───────── */
function CommentModal({ open, order, onClose, onSaved }: {
  open: boolean; order: Order; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [comment, setComment] = useState(order.comment ?? "");
  useEffect(() => setComment(order.comment ?? ""), [order.comment]);

  async function action(method: "save" | "delete") {
    await api(`/api/orders/${order.id}/comment`, {
      method: "PUT", body: { comment: method === "save" ? comment : null },
    });
    toast("success", method === "save" ? "Comentario guardado" : "Comentario eliminado");
    onSaved(); onClose();
  }

  return (
    <Modal open={open} title="Comentario de la mesa" onClose={onClose}>
      <Field label="Comentario">
        <TextArea rows={3} value={comment}
          onChange={(e) => setComment(e.target.value.replace(/[\r\n]+/g, ""))} />
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="danger" onClick={() => action("delete")}>Eliminar</Button>
        <Button onClick={() => action("save")}>Guardar</Button>
      </div>
    </Modal>
  );
}

/* ───────── Traslado: wizard 2 pasos (Polaris blank_mover_productos_mesas) ───────── */
function TransferModal({ open, order, items, onClose, onDone }: {
  open: boolean; order: Order; items: OrderItem[]; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [board, setBoard] = useState<BoardCell[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [roomId, setRoomId] = useState("");
  const [tableId, setTableId] = useState("");

  useEffect(() => {
    if (!open) return;
    setStep(1); setSelected([]); setRoomId(""); setTableId("");
    api<BoardCell[]>("/api/orders/board").then((b) =>
      setBoard(b.filter((c) => c.table_id !== order.table_id)),
    );
  }, [open, order.table_id]);

  const rooms = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of board) map.set(c.room_id, c.room_name);
    return [...map.entries()];
  }, [board]);
  const tables = board.filter((c) => String(c.room_id) === roomId);

  async function transfer() {
    const cell = board.find((c) => c.table_id === Number(tableId));
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
      onClose();
      // Polaris: si la mesa origen quedó vacía vuelve a mesas; si no, recarga
      if (selected.length === items.length) navigate("/mesas");
      else onDone();
      void r;
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No fue posible trasladar");
    }
  }

  return (
    <Modal open={open}
      title={`Trasladar Productos — Paso ${step} de 2`} onClose={onClose}>
      {step === 1 ? (
        <>
          <p className="mb-1 text-base font-bold">Selección de Productos</p>
          <p className="mb-3 text-xs text-text-secondary">Seleccione los ítems que desea mover.</p>
          <label className="mb-1 flex items-center gap-2 rounded-lg p-2 text-xs font-semibold uppercase text-text-muted">
            <input type="checkbox"
              checked={selected.length === items.length && items.length > 0}
              onChange={(e) => setSelected(e.target.checked ? items.map((i) => i.id) : [])}
              className="h-4 w-4 accent-[hsl(199_89%_48%)]" />
            Producto / Detalles
          </label>
          <div className="mb-4 max-h-52 space-y-1 overflow-y-auto">
            {items.map((i) => (
              <label key={i.id} className="flex items-center justify-between gap-2 rounded-lg p-2 text-sm hover:bg-bg-tertiary">
                <span className="flex items-center gap-2">
                  <input type="checkbox" checked={selected.includes(i.id)}
                    onChange={(e) => setSelected(e.target.checked
                      ? [...selected, i.id] : selected.filter((x) => x !== i.id))}
                    className="h-4 w-4 accent-[hsl(199_89%_48%)]" />
                  <span className="font-semibold">{i.product_name}</span>
                </span>
                <span className="font-bold">{i.quantity}</span>
              </label>
            ))}
            {items.length === 0 && (
              <p className="py-4 text-center text-sm text-text-muted">Sin productos para trasladar.</p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={() => {
              if (selected.length === 0) { toast("error", "Seleccione productos"); return; }
              setStep(2);
            }}>Siguiente →</Button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-1 text-base font-bold">Destino del Traslado</p>
          <p className="mb-3 text-xs text-text-secondary">Elija el destino del traslado paso a paso.</p>
          <Field label="1. Seleccione la Sala">
            <Select value={roomId} onChange={(e) => { setRoomId(e.target.value); setTableId(""); }}>
              <option value="">— 1. Seleccione la Sala —</option>
              {rooms.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </Select>
          </Field>
          <Field label="2. Seleccione la Mesa">
            <Select value={tableId} onChange={(e) => setTableId(e.target.value)} disabled={!roomId}>
              <option value="">— 2. Seleccione la Mesa —</option>
              {tables.map((c) => (
                <option key={c.table_id} value={c.table_id}>
                  Mesa {c.number}{c.order_id ? " (ocupada)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStep(1)}>← Atrás</Button>
            <Button onClick={transfer}>Confirmar Traslado ✓</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ───────── Cerrar mesa (Polaris closeTable: "¿Desea cerrar la orden?") ───────── */
function CloseModal({ open, orderId, onClose }: {
  open: boolean; orderId: number; onClose: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();

  async function close() {
    try {
      await api(`/api/orders/${orderId}/close`, { method: "POST", body: {} });
      navigate("/mesas");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No se pudo cerrar la mesa");
    }
  }

  return (
    <Modal open={open} title="Cerrar mesa" onClose={onClose}>
      <p className="mb-4 text-sm text-text-secondary">¿Desea cerrar la orden?</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="danger" onClick={close}>Aceptar</Button>
      </div>
    </Modal>
  );
}

/* ───────── Asignación de clientes (Compras Compartidas) ───────── */
function AssignModal({ open, orderId, items, clients, onNewCustomer, onClose, onDone }: {
  open: boolean; orderId: number; items: OrderItem[]; clients: Client[];
  onNewCustomer: () => void; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [assign, setAssign] = useState<Record<number, number | "">>({});
  useEffect(() => { if (open) setAssign({}); }, [open]);

  async function save() {
    const pending = items.filter((i) => !assign[i.id]);
    if (pending.length > 0) {
      toast("error", "Asigna un cliente a todos los productos");
      return;
    }
    try {
      await api(`/api/orders/${orderId}/items-customer`, {
        method: "PUT",
        body: {
          assignments: items.map((i) => ({ itemId: i.id, customerId: Number(assign[i.id]) })),
        },
      });
      toast("success", "Clientes asignados correctamente");
      onDone(); onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No fue posible asignar");
    }
  }

  return (
    <Modal open={open} title="Asignar clientes" onClose={onClose}>
      <p className="mb-3 text-sm text-text-secondary">
        Hay productos sin cliente. Asigna cada producto para continuar con Compras Compartidas.
      </p>
      <div className="mb-4 max-h-60 space-y-2 overflow-y-auto">
        {items.map((i) => (
          <div key={i.id} className="flex items-center gap-2 rounded-xl border border-border-subtle p-2.5">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {i.quantity}x {i.product_name}
            </span>
            <Select value={assign[i.id] ?? ""} aria-label={`Cliente para ${i.product_name}`}
              onChange={(e) => setAssign({ ...assign, [i.id]: e.target.value ? Number(e.target.value) : "" })}
              className="w-44">
              <option value="">— Cliente —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{clientLabel(c)}</option>
              ))}
            </Select>
          </div>
        ))}
      </div>
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={onNewCustomer}>
          <UserPlus size={14} className="-mt-0.5 mr-1 inline" /> Nuevo cliente
        </Button>
        <Button onClick={save}>Guardar asignación</Button>
      </div>
    </Modal>
  );
}

/* ───────── Registro rápido de cliente (Polaris register_customer) ───────── */
function NewCustomerModal({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: (id: number) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    person_type: 2, name: "", last_name: "", document_id: "", email: "", phone: "",
  });
  useEffect(() => {
    if (open) setForm({ person_type: 2, name: "", last_name: "", document_id: "", email: "", phone: "" });
  }, [open]);

  async function save() {
    try {
      const r = await api<{ id: number }>("/api/clients", { method: "POST", body: form });
      toast("success", "Cliente registrado correctamente");
      onCreated(r.id);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No fue posible registrar el cliente");
    }
  }

  const juridica = form.person_type === 1;
  return (
    <Modal open={open} title="Nuevo cliente" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tipo de persona">
          <Select value={form.person_type}
            onChange={(e) => setForm({ ...form, person_type: Number(e.target.value) })}>
            <option value={2}>Persona Natural</option>
            <option value={1}>Persona Jurídica</option>
          </Select>
        </Field>
        <Field label="Número de documento *">
          <Input value={form.document_id}
            onChange={(e) => setForm({ ...form, document_id: e.target.value })} />
        </Field>
        <Field label={juridica ? "Razón social *" : "Nombre completo *"}>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        {!juridica && (
          <Field label="Apellidos">
            <Input value={form.last_name}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          </Field>
        )}
        <Field label="Email *">
          <Input type="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Teléfono">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={save}>Guardar</Button>
      </div>
    </Modal>
  );
}

/* ───────── Domicilio: cliente de la orden (Polaris abrirModalDomicilio) ───────── */
function DomicilioClienteModal({ open, orderId, clients, onNewCustomer, onClose, onDone }: {
  open: boolean; orderId: number; clients: Client[];
  onNewCustomer: () => void; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  useEffect(() => { if (open) setSearch(""); }, [open]);

  const filtered = clients.filter((c) =>
    clientLabel(c).toLowerCase().includes(search.toLowerCase()) ||
    c.document_id.includes(search));

  async function pick(c: Client) {
    try {
      await api(`/api/orders/${orderId}/delivery`, {
        method: "PUT", body: { clientId: c.id },
      });
      toast("success", "Cliente asignado correctamente");
      onDone();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No fue posible asignar el cliente");
    }
  }

  return (
    <Modal open={open} title="Cliente del domicilio" onClose={onClose}>
      <p className="mb-3 text-sm text-text-secondary">
        Esta orden es de la sala DOMICILIO: seleccione el cliente que recibe el pedido.
      </p>
      <Input placeholder="Buscar por nombre o documento…" value={search}
        onChange={(e) => setSearch(e.target.value)} className="mb-3" />
      <div className="mb-4 max-h-56 space-y-1 overflow-y-auto">
        {filtered.map((c) => (
          <button key={c.id} onClick={() => pick(c)}
            className="flex w-full items-center justify-between rounded-lg p-2.5 text-left text-sm transition hover:bg-bg-tertiary">
            <span className="font-semibold">{clientLabel(c)}</span>
            <span className="text-xs text-text-muted">{c.document_id}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="py-4 text-center text-sm text-text-muted">Sin resultados.</p>
        )}
      </div>
      <Button variant="ghost" className="w-full" onClick={onNewCustomer}>
        <UserPlus size={14} className="-mt-0.5 mr-1 inline" /> Registrar nuevo cliente
      </Button>
    </Modal>
  );
}

/* ───────── Domicilio: domiciliario (Polaris abrirModalDomiciliario) ───────── */
function DomiciliarioModal({ open, orderId, onClose, onDone }: {
  open: boolean; orderId: number; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [companies, setCompanies] = useState<{ id: number; name: string }[]>([]);
  const [registering, setRegistering] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", plate: "", companyId: "" });

  const loadOptions = useCallback(() => {
    api<{ drivers: Driver[]; companies: { id: number; name: string }[] }>("/api/orders/delivery-options")
      .then((r) => { setDrivers(r.drivers); setCompanies(r.companies); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (open) { loadOptions(); setRegistering(false); }
  }, [open, loadOptions]);

  async function pick(d: Driver) {
    try {
      await api(`/api/orders/${orderId}/delivery`, {
        method: "PUT", body: { personnelId: d.id },
      });
      toast("success", "Domiciliario asignado correctamente");
      onDone(); onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No fue posible asignar el domiciliario");
    }
  }

  async function register() {
    try {
      await api("/api/orders/delivery-personnel-quick", {
        method: "POST",
        body: { ...form, companyId: Number(form.companyId) },
      });
      toast("success", "Domiciliario creado correctamente.");
      setRegistering(false);
      setForm({ firstName: "", lastName: "", phone: "", plate: "", companyId: "" });
      loadOptions();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Completa todos los campos para continuar.");
    }
  }

  return (
    <Modal open={open} title="Domiciliario" onClose={onClose}>
      {!registering ? (
        <>
          <div className="mb-4 max-h-56 space-y-1 overflow-y-auto">
            {drivers.map((d) => (
              <button key={d.id} onClick={() => pick(d)}
                className="flex w-full items-center justify-between rounded-lg p-2.5 text-left text-sm transition hover:bg-bg-tertiary">
                <span>
                  <span className="block font-semibold">{d.name}</span>
                  <span className="text-xs text-text-muted">{d.company_name} · {d.plate}</span>
                </span>
                <span className="text-xs text-text-muted">{d.phone}</span>
              </button>
            ))}
            {drivers.length === 0 && (
              <p className="py-4 text-center text-sm text-text-muted">No hay domiciliarios activos.</p>
            )}
          </div>
          <Button variant="ghost" className="w-full" onClick={() => setRegistering(true)}>
            <UserPlus size={14} className="-mt-0.5 mr-1 inline" /> Nuevo domiciliario
          </Button>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombres *">
              <Input value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
            </Field>
            <Field label="Apellidos *">
              <Input value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            </Field>
            <Field label="Teléfono *">
              <Input value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Placa *">
              <Input value={form.plate}
                onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })} />
            </Field>
          </div>
          <Field label="Empresa *">
            <Select value={form.companyId}
              onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
              <option value="">— Seleccione —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRegistering(false)}>Volver</Button>
            <Button onClick={register}>Guardar</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
