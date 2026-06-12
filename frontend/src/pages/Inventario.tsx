/**
 * Inventario — manual §1.11: productos del inventario (ingredientes y
 * consumibles), movimientos (entradas/salidas con razones y movimiento de
 * caja opcional) y proveedores.
 */
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { CrudPage } from "../components/CrudPage";
import { EnConstruccion } from "../components/EnConstruccion";
import { useTabParam } from "../lib/useTab";
import { ArrowLeft, Plus } from "lucide-react";
import {
  Badge, Button, cop, Field, FormRow, Input, MoneyInput, PageHeader, Select, Table,
  usePagination, useToast,
} from "../components/ui";
import { ENTRY_REASONS, EXIT_REASONS } from "../shared/constants/movementReasons";

const TABS = ["Productos del inventario", "Lista de recetas", "Proveedores", "Movimientos"];

export default function Inventario() {
  const [tab, setTab] = useTabParam(TABS);
  return (
    <div className="fade-in-up">
      <PageHeader title={tab} subtitle="Inventario" />
      {tab === "Productos del inventario" && (
        <CrudPage
          title="producto de inventario"
          endpoint="/api/catalogs/inventory-products"
          fields={[
            {
              name: "type", label: "Tipo", type: "select", required: true,
              options: [
                { value: "ingrediente", label: "Ingrediente" },
                { value: "consumible", label: "Consumible" },
              ],
              render: (r) => (
                <Badge color={r.type === "ingrediente" ? "cyan" : "blue"}>{String(r.type)}</Badge>
              ),
            },
            { name: "name", label: "Nombre", required: true },
            { name: "unit", label: "Unidad" },
            {
              name: "stock", label: "Cantidad total", type: "number",
              render: (r) => (
                <span className={Number(r.stock) < 0 ? "font-semibold text-accent-rose"
                  : Number(r.stock) <= Number(r.min_stock) ? "font-semibold text-accent-amber" : ""}>
                  {String(r.stock)}
                </span>
              ),
            },
            { name: "min_stock", label: "Cantidad mínima", type: "number" },
            { name: "is_active", label: "Estado", type: "checkbox" },
          ]}
        />
      )}
      {tab === "Lista de recetas" && (
        <EnConstruccion titulo="Lista de recetas"
          nota="Consulta de la estructura e ingredientes de cada platillo (manual §1.11.2) — la edición ya existe en el backend (/api/products/:id/recipe)." />
      )}
      {tab === "Movimientos" && <MovementsTab />}
      {tab === "Proveedores" && (
        <CrudPage
          title="proveedor"
          endpoint="/api/catalogs/suppliers"
          fields={[
            { name: "name", label: "Nombre", required: true },
            { name: "phone", label: "Teléfono" },
            { name: "email", label: "Correo" },
            { name: "address", label: "Dirección", inTable: false },
            { name: "is_active", label: "Estado", type: "checkbox" },
          ]}
        />
      )}
    </div>
  );
}

/* ───────── Movimientos (§1.11.4) ───────── */
function MovementsTab() {
  const toast = useToast();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    api<Record<string, unknown>[]>("/api/inventory/movements").then(setRows).catch(() => {});
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "true") {
      setOpen(true);
      window.history.replaceState(null, "", "/inventario?tab=Movimientos");
    }
  }, []);
  const { slice, bar } = usePagination(rows);

  // Registro tipo página (estilo Polaris), reemplaza al modal
  if (open) {
    return <MovementModal open onClose={() => setOpen(false)} onDone={load} />;
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus size={15} className="-mt-0.5 mr-1 inline" /> Registrar movimiento
        </Button>
      </div>
      <Table
        headers={["Fecha", "Producto", "Tipo", "Razón", "Cantidad", "Antes → Después", "Proveedor", "Usuario"]}
        empty={rows.length === 0}
      >
        {slice.map((r) => (
          <tr key={String(r.id)}>
            <td className="px-4 py-2 text-xs">{new Date(String(r.created_at)).toLocaleString("es-CO")}</td>
            <td className="px-4 py-2">{String(r.product_name ?? "—")}</td>
            <td className="px-4 py-2">
              <Badge color={r.direction === "ENTRADA" ? "emerald" : "rose"}>{String(r.direction)}</Badge>
            </td>
            <td className="px-4 py-2">{String(r.reason)}</td>
            <td className="px-4 py-2">{String(r.quantity)} {String(r.unit ?? "")}</td>
            <td className="px-4 py-2 text-xs">{String(r.qty_before)} → {String(r.qty_after)}</td>
            <td className="px-4 py-2">{String(r.supplier_name ?? "—")}</td>
            <td className="px-4 py-2">{String(r.user_name ?? "—")}</td>
          </tr>
        ))}
      </Table>

      {bar}
    </>
  );

  function MovementModal({ open, onClose, onDone }: {
    open: boolean; onClose: () => void; onDone: () => void;
  }) {
    const [products, setProducts] = useState<{ id: number; name: string; unit: string }[]>([]);
    const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([]);
    const [sessions, setSessions] = useState<{ session_id: number | null; name: string }[]>([]);
    const [presentations, setPresentations] = useState<{ id: number; name: string; conversion_factor: string }[]>([]);

    const [form, setForm] = useState({
      productId: "", direction: "ENTRADA", reason: "Compra", quantity: "",
      presentationId: "", supplierId: "", total: "", referenceDocument: "",
      cashSessionId: "", cashMovementType: "",
    });

    useEffect(() => {
      if (!open) return;
      setForm({ productId: "", direction: "ENTRADA", reason: "Compra", quantity: "",
        presentationId: "", supplierId: "", total: "", referenceDocument: "",
        cashSessionId: "", cashMovementType: "" });
      api<typeof products>("/api/catalogs/inventory-products").then(setProducts).catch(() => {});
      api<typeof suppliers>("/api/catalogs/suppliers").then(setSuppliers).catch(() => {});
      // Solo cajas abiertas (§1.11.4)
      api<{ session_id: number | null; name: string }[]>("/api/cash/sessions")
        .then((s) => setSessions(s.filter((x) => x.session_id))).catch(() => {});
    }, [open]);

    useEffect(() => {
      if (!form.productId) { setPresentations([]); return; }
      api<typeof presentations>(`/api/inventory/products/${form.productId}/presentations`)
        .then(setPresentations).catch(() => setPresentations([]));
    }, [form.productId]);

    const isEntry = form.direction === "ENTRADA";
    const reasons = isEntry ? ENTRY_REASONS : EXIT_REASONS;

    async function save(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault();
      try {
        await api("/api/inventory/movements", {
          method: "POST",
          body: {
            inventoryProductId: Number(form.productId),
            direction: form.direction,
            reason: form.reason,
            quantity: Number(form.quantity),
            presentationId: form.presentationId ? Number(form.presentationId) : null,
            supplierId: form.supplierId ? Number(form.supplierId) : null,
            total: form.total ? Number(form.total) : null,
            referenceDocument: form.referenceDocument || null,
            cashSessionId: form.cashSessionId ? Number(form.cashSessionId) : null,
            cashMovementType: form.cashMovementType || null,
          },
        });
        toast("success", "Movimiento registrado correctamente");
        onDone(); onClose();
      } catch (err) {
        toast("error", err instanceof ApiError ? err.message : "No se pudo registrar");
      }
    }

    return (
      <form onSubmit={save} className="fade-in-up">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Registrar movimiento</h2>
          <div className="flex gap-2">
            <Button type="submit">
              <Plus size={15} className="-mt-0.5 mr-1 inline" /> Agregar
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              <ArrowLeft size={15} className="-mt-0.5 mr-1 inline" /> Volver
            </Button>
          </div>
        </div>

        <div className="glass max-w-3xl space-y-4 rounded-2xl p-6">
          <FormRow label="Producto del inventario" required>
            <Select required value={form.productId}
              onChange={(e) => setForm({ ...form, productId: e.target.value })}>
              <option value="">— Seleccione una opción —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
            </Select>
          </FormRow>
          <FormRow label="Tipo de movimiento" required>
            <Select value={form.direction}
              onChange={(e) => setForm({
                ...form, direction: e.target.value,
                reason: e.target.value === "ENTRADA" ? "Compra" : "Devolución",
                supplierId: "", total: "",
              })}>
              <option value="ENTRADA">Ingreso</option>
              <option value="SALIDA">Salida</option>
            </Select>
          </FormRow>
          <FormRow label="Razón" required>
            <Select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
              {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </FormRow>
          <FormRow label="Cantidad" required>
            <Input type="number" min={0.01} step="any" required value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          </FormRow>
          {presentations.length > 0 && (
            <FormRow label="Presentación de compra (opcional)">
              <Select value={form.presentationId}
                onChange={(e) => setForm({ ...form, presentationId: e.target.value })}>
                <option value="">— Unidad —</option>
                {presentations.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} (×{p.conversion_factor})</option>
                ))}
              </Select>
            </FormRow>
          )}
          {isEntry && (
            <>
              <FormRow label="Proveedor">
                <Select value={form.supplierId}
                  onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                  <option value="">— Seleccione una opción —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </FormRow>
              <FormRow label="Total ($)">
                <MoneyInput value={form.total}
                  onValueChange={(raw) => setForm({ ...form, total: raw })} />
              </FormRow>
            </>
          )}
          <FormRow label="Documento de referencia">
            <Input value={form.referenceDocument}
              onChange={(e) => setForm({ ...form, referenceDocument: e.target.value })} />
          </FormRow>
          <FormRow label="Movimiento de caja (opcional)">
            <Select value={form.cashSessionId}
              onChange={(e) => setForm({ ...form, cashSessionId: e.target.value })}>
              <option value="">— Sin movimiento de caja —</option>
              {sessions.map((s) => <option key={s.session_id} value={String(s.session_id)}>{s.name}</option>)}
            </Select>
          </FormRow>
          {form.cashSessionId && (
            <FormRow label="Tipo de movimiento en caja" required>
              <Select required value={form.cashMovementType}
                onChange={(e) => setForm({ ...form, cashMovementType: e.target.value })}>
                <option value="">— Seleccione una opción —</option>
                <option value="ENTRADA">Entrada</option>
                <option value="SALIDA">Salida</option>
              </Select>
            </FormRow>
          )}
        </div>
        <p className="mt-2 text-xs font-medium text-accent-rose">* Campos obligatorios</p>
      </form>
    );
  }
}
