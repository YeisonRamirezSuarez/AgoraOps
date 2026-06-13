/**
 * Productos — manual §1.10: lista de productos, categorías, toppings y
 * asociación toppings ↔ producto. Receta/variantes/combos se editan desde
 * la lista (modal de receta básico).
 */
import { useEffect, useMemo, useState } from "react";
import {
  Download, LayoutGrid, List as ListIcon, Pencil, Plus, Search, Trash2, UtensilsCrossed,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { CrudPage } from "../components/CrudPage";
import { EnConstruccion } from "../components/EnConstruccion";
import { CargaMasivaProductos } from "../components/CargaMasivaProductos";
import { ProductoForm } from "../components/ProductoForm";
import { useTabParam } from "../lib/useTab";
import type { Product } from "../shared/domain";
import {
  Badge, Button, ConfirmDialog, cop, Field, Input, Loader,
  PageHeader, Select, useToast,
} from "../components/ui";

interface Categoria { id: number; name: string }

const TABS = [
  "Lista de productos", "Carga masiva de productos", "Categorías",
  "Listado de toppings", "Toppings por producto", "Promociones",
];

export default function Productos() {
  const [tab, setTab] = useTabParam(TABS);

  return (
    <div className="fade-in-up">
      <PageHeader title={tab} subtitle="Productos" />

      {tab === "Lista de productos" && <ProductosLista />}

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
            { name: "price", label: "Precio", type: "money", required: true },
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

      {tab === "Carga masiva de productos" && <CargaMasivaProductos />}
      {tab === "Promociones" && (
        <EnConstruccion titulo="Promociones"
          nota="Submódulo nuevo (no documentado en el manual v18) — pendiente de definición de requisitos." />
      )}
      {tab === "Toppings por producto" && <ToppingsPorProducto />}
    </div>
  );
}

/* ───────── Lista de productos estilo Polaris (§1.10.1) ─────────
   Pestañas por categoría, columnas costo/utilidad/estado, vista
   tarjetas/lista, exportar CSV y "+ Nuevo" que abre el formulario con
   pestañas (ProductoForm). */
function ProductosLista() {
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "cards">("list");
  const [activeCat, setActiveCat] = useState<"all" | number>("all");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);

  function load() {
    Promise.all([
      api<Product[]>("/api/products"),
      api<Categoria[]>("/api/catalogs/categories"),
    ])
      .then(([p, c]) => { setProducts(p); setCategories(c); })
      .catch((e) => toast("error", e instanceof ApiError ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const catName = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (activeCat !== "all" && p.category_id !== activeCat) return false;
      if (!q) return true;
      return [p.name, p.description ?? "", catName.get(p.category_id) ?? ""]
        .some((s) => s.toLowerCase().includes(q));
    });
  }, [products, search, activeCat, catName]);

  // Agrupar por categoría siguiendo el orden del catálogo
  const grouped = useMemo(() => {
    const byCat = new Map<number, Product[]>();
    for (const p of filtered) {
      const arr = byCat.get(p.category_id);
      if (arr) arr.push(p);
      else byCat.set(p.category_id, [p]);
    }
    return categories
      .filter((c) => byCat.has(c.id))
      .map((c) => ({ category: c, items: byCat.get(c.id)! }));
  }, [filtered, categories]);

  async function remove() {
    if (!deleting) return;
    try {
      await api(`/api/products/${deleting.id}`, { method: "DELETE" });
      toast("success", "Producto eliminado correctamente");
      load();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No se pudo eliminar");
    } finally { setDeleting(null); }
  }

  function exportCsv() {
    const headers = ["Categoría", "Producto", "Descripción", "Costo prep.",
      "Precio venta", "Utilidad ($)", "Utilidad (%)", "Estado"];
    const lines = filtered.map((p) => {
      const cost = Number(p.cost_price), price = Number(p.sale_price);
      const pct = price > 0 ? Math.round((1 - cost / price) * 100) : 0;
      return [
        catName.get(p.category_id) ?? "", p.name, p.description ?? "",
        cost, price, price - cost, pct, p.is_active ? "Activo" : "Inactivo",
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
    });
    const csv = [headers.join(","), ...lines].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "productos.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  if (editing !== null) {
    return (
      <ProductoForm
        producto={editing === "new" ? null : editing}
        categories={categories}
        onSaved={() => { setEditing(null); setLoading(true); load(); }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  if (loading) return <Loader label="Cargando productos" />;

  return (
    <div className="fade-in-up">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input placeholder="Búsqueda rápida" value={search}
            onChange={(e) => setSearch(e.target.value)} className="!w-64 !pl-9" />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border-medium">
            <button onClick={() => setView("cards")} aria-label="Vista tarjetas"
              className={`px-2.5 py-2 ${view === "cards" ? "bg-accent-blue text-white" : "text-text-secondary"}`}>
              <LayoutGrid size={16} />
            </button>
            <button onClick={() => setView("list")} aria-label="Vista lista"
              className={`px-2.5 py-2 ${view === "list" ? "bg-accent-blue text-white" : "text-text-secondary"}`}>
              <ListIcon size={16} />
            </button>
          </div>
          <Button variant="ghost" onClick={exportCsv}>
            <Download size={15} className="-mt-0.5 mr-1 inline" /> Exportar
          </Button>
          <Button onClick={() => setEditing("new")}>
            <Plus size={15} className="-mt-0.5 mr-1 inline" /> Nuevo
          </Button>
        </div>
      </div>

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border-subtle pb-px">
        <CatTab label="Todas" active={activeCat === "all"} onClick={() => setActiveCat("all")} />
        {categories.map((c) => (
          <CatTab key={c.id} label={c.name} active={activeCat === c.id} onClick={() => setActiveCat(c.id)} />
        ))}
      </div>

      {grouped.length === 0 ? (
        <div className="glass grid place-items-center rounded-2xl py-14 text-text-muted">
          <UtensilsCrossed size={32} className="mb-2 opacity-60" />
          <p className="text-sm">No hay productos para mostrar</p>
        </div>
      ) : view === "list" ? (
        <div className="space-y-5">
          {grouped.map(({ category, items }) => (
            <div key={category.id} className="glass overflow-hidden rounded-2xl">
              <div className="border-b border-border-subtle px-5 py-3.5">
                <h3 className="font-bold uppercase tracking-wide">{category.name}</h3>
                <p className="text-xs text-text-muted">{items.length} registro(s)</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-bg-tertiary/60 text-left text-xs uppercase tracking-wide text-text-secondary">
                    <tr>
                      <th className="w-24 px-4 py-3 font-medium">Acciones</th>
                      <th className="px-4 py-3 font-medium">Producto</th>
                      <th className="px-4 py-3 font-medium">Descripción</th>
                      <th className="px-4 py-3 font-medium">Costo prep.</th>
                      <th className="px-4 py-3 font-medium">Precio venta</th>
                      <th className="px-4 py-3 font-medium">Utilidad ($)</th>
                      <th className="px-4 py-3 font-medium">Utilidad (%)</th>
                      <th className="px-4 py-3 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle/60">
                    {items.map((p) => {
                      const cost = Number(p.cost_price), price = Number(p.sale_price);
                      const pct = price > 0 ? Math.round((1 - cost / price) * 100) : 0;
                      return (
                        <tr key={p.id} className="transition hover:bg-bg-tertiary/40">
                          <td className="px-4 py-2.5">
                            <div className="flex gap-1">
                              <button onClick={() => setDeleting(p)} aria-label="Eliminar"
                                className="rounded-lg p-1.5 text-text-muted transition hover:bg-accent-rose/15 hover:text-accent-rose">
                                <Trash2 size={15} />
                              </button>
                              <button onClick={() => setEditing(p)} aria-label="Editar"
                                className="rounded-lg p-1.5 text-text-muted transition hover:bg-accent-blue/15 hover:text-accent-blue">
                                <Pencil size={15} />
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 font-medium uppercase">{p.name}</td>
                          <td className="max-w-xs truncate px-4 py-2.5 text-text-secondary">{p.description || "—"}</td>
                          <td className="px-4 py-2.5">{cop.format(cost)}</td>
                          <td className="px-4 py-2.5">{cop.format(price)}</td>
                          <td className="px-4 py-2.5 font-semibold text-accent-emerald">{cop.format(price - cost)}</td>
                          <td className="px-4 py-2.5">{pct}%</td>
                          <td className="px-4 py-2.5">
                            <Badge color={p.is_active ? "emerald" : "gray"}>
                              {p.is_active ? "Activo" : "Inactivo"}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <div key={p.id} className="glass flex flex-col overflow-hidden rounded-2xl">
              {p.image_url ? (
                <img src={p.image_url} alt={p.name} className="h-36 w-full object-cover" />
              ) : (
                <div className="grid h-36 w-full place-items-center bg-bg-tertiary text-text-muted">
                  <UtensilsCrossed size={28} strokeWidth={1.5} />
                </div>
              )}
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold uppercase leading-tight">{p.name}</h3>
                  <Badge color={p.is_active ? "emerald" : "gray"}>
                    {p.is_active ? "Activo" : "Inactivo"}
                  </Badge>
                </div>
                <p className="text-xs text-text-muted">{catName.get(p.category_id)}</p>
                <p className="text-lg font-bold text-accent-cyan">{cop.format(Number(p.sale_price))}</p>
                <div className="mt-auto flex gap-2 pt-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                    <Pencil size={14} className="-mt-0.5 mr-1 inline" /> Editar
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setDeleting(p)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog open={!!deleting} title="Confirmar eliminación"
        message={`¿Desea eliminar el producto "${deleting?.name ?? ""}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar" onConfirm={remove} onCancel={() => setDeleting(null)} />
    </div>
  );
}

function CatTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm transition ${
        active ? "border-accent-blue font-medium text-accent-blue"
          : "border-transparent text-text-secondary hover:text-text-primary"
      }`}>
      {label}
    </button>
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
