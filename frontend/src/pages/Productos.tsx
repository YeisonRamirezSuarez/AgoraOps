/**
 * Productos — manual §1.10: lista de productos, categorías, toppings y
 * asociación toppings ↔ producto. Receta/variantes/combos se editan desde
 * la lista (modal de receta básico).
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { CrudPage } from "../components/CrudPage";
import { EnConstruccion } from "../components/EnConstruccion";
import { useTabParam } from "../lib/useTab";
import {
  Badge, Button, cop, Field, Input, Modal, PageHeader, Select, useToast,
} from "../components/ui";

const TABS = [
  "Lista de productos", "Carga masiva de productos", "Categorías",
  "Listado de toppings", "Toppings por producto", "Promociones",
];

export default function Productos() {
  const [tab, setTab] = useTabParam(TABS);
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    api<{ id: number; name: string }[]>("/api/catalogs/categories")
      .then(setCategories).catch(() => {});
  }, [tab]);

  return (
    <div className="fade-in-up">
      <PageHeader title={tab} subtitle="Productos" />

      {tab === "Lista de productos" && (
        <CrudPage
          title="producto"
          endpoint="/api/products"
          fields={[
            { name: "code", label: "Código", required: true },
            { name: "name", label: "Nombre", required: true },
            { name: "description", label: "Descripción", inTable: false },
            {
              name: "category_id", label: "Categoría", type: "select", required: true,
              options: categories.map((c) => ({ value: c.id, label: c.name })),
            },
            {
              name: "product_type", label: "Tipo de producto", type: "select", required: true,
              options: [{ value: "NORMAL", label: "Normal" }, { value: "COMBO", label: "Combo" }],
            },
            {
              name: "sale_price", label: "Precio de venta", type: "number", required: true,
              render: (r) => cop.format(Number(r.sale_price)),
            },
            { name: "cost_price", label: "Precio de costo", type: "number", inTable: false },
            { name: "image_url", label: "URL de la imagen (foto del producto)", inTable: false },
            {
              name: "goes_to_kitchen", label: "¿Va a cocina?", type: "checkbox",
              render: (r) => (r.goes_to_kitchen ? <Badge color="cyan">A cocina</Badge> : <Badge color="gray">No</Badge>),
            },
            { name: "is_inventariable", label: "¿Inventariable?", type: "checkbox", inTable: false },
            { name: "is_active", label: "Estado", type: "checkbox" },
          ]}
        />
      )}

      {tab === "Categorías" && (
        <CrudPage
          title="categoría"
          endpoint="/api/catalogs/categories"
          fields={[
            { name: "name", label: "Nombre", required: true },
            { name: "description", label: "Descripción" },
            { name: "is_active", label: "Estado", type: "checkbox" },
          ]}
        />
      )}

      {tab === "Listado de toppings" && (
        <CrudPage
          title="topping"
          endpoint="/api/catalogs/toppings"
          fields={[
            { name: "name", label: "Nombre", required: true },
            {
              name: "price", label: "Precio", type: "number", required: true,
              render: (r) => cop.format(Number(r.price)),
            },
            {
              name: "inventory_mode", label: "Inventario", type: "select",
              options: [
                { value: "consumible", label: "Consumible" },
                { value: "receta", label: "Receta" },
              ],
            },
            { name: "is_active", label: "Estado", type: "checkbox" },
          ]}
        />
      )}

      {tab === "Carga masiva de productos" && (
        <EnConstruccion titulo="Carga masiva de productos"
          nota="Carga y actualización por Excel con plantilla descargable (manual §1.10.2) — Fase 2 del roadmap." />
      )}
      {tab === "Promociones" && (
        <EnConstruccion titulo="Promociones"
          nota="Submódulo nuevo (no documentado en el manual v18) — pendiente de definición de requisitos." />
      )}
      {tab === "Toppings por producto" && <ToppingsPorProducto />}
    </div>
  );
}

/** §1.10.5: asociar toppings a productos con máximo permitido. */
function ToppingsPorProducto() {
  const toast = useToast();
  const [products, setProducts] = useState<{ id: number; name: string }[]>([]);
  const [toppings, setToppings] = useState<{ id: number; name: string }[]>([]);
  const [productId, setProductId] = useState("");
  const [assigned, setAssigned] = useState<{ topping_id: number; max_allowed: number }[]>([]);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api<{ id: number; name: string }[]>("/api/products").then(setProducts).catch(() => {});
    api<{ id: number; name: string }[]>("/api/catalogs/toppings").then(setToppings).catch(() => {});
  }, []);

  useEffect(() => {
    if (!productId) { setAssigned([]); return; }
    api<{ topping_id: number; max_allowed: number }[]>(`/api/products/${productId}/toppings`)
      .then(setAssigned).catch(() => setAssigned([]));
  }, [productId]);

  function toggle(toppingId: number) {
    const exists = assigned.find((a) => a.topping_id === toppingId);
    setAssigned(exists
      ? assigned.filter((a) => a.topping_id !== toppingId)
      : [...assigned, { topping_id: toppingId, max_allowed: 1 }]);
  }

  async function save() {
    setEditing(true);
    try {
      await api(`/api/products/${productId}/toppings`, {
        method: "PUT",
        body: { items: assigned.map((a) => ({ toppingId: a.topping_id, maxAllowed: a.max_allowed })) },
      });
      toast("success", "Toppings del producto actualizados");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Error al guardar");
    } finally {
      setEditing(false);
    }
  }

  return (
    <div className="max-w-xl">
      <Field label="Producto">
        <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">— Seleccione un producto —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>

      {productId && (
        <>
          <div className="mt-4 space-y-2">
            {toppings.map((t) => {
              const a = assigned.find((x) => x.topping_id === t.id);
              return (
                <div key={t.id}
                  className={`flex items-center justify-between rounded-xl border p-3 transition ${
                    a ? "border-accent-orange bg-accent-orange/10" : "border-border-subtle"
                  }`}>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!a} onChange={() => toggle(t.id)}
                      className="h-4 w-4 accent-[hsl(24_95%_53%)]" />
                    {t.name}
                  </label>
                  {a && (
                    <label className="flex items-center gap-2 text-xs text-text-secondary">
                      Máximo permitido
                      <Input type="number" min={1} value={a.max_allowed} className="!w-16"
                        onChange={(e) => setAssigned(assigned.map((x) =>
                          x.topping_id === t.id ? { ...x, max_allowed: Number(e.target.value) } : x))} />
                    </label>
                  )}
                </div>
              );
            })}
            {toppings.length === 0 && (
              <p className="text-sm text-text-muted">Cree toppings primero en "Listado de toppings".</p>
            )}
          </div>
          <Button className="mt-4" onClick={save} disabled={editing}>
            {editing ? "Guardando…" : "Guardar"}
          </Button>
        </>
      )}
    </div>
  );
}
