/**
 * Formulario "Agregar / Editar producto" estilo Polaris (§1.10.1).
 * Réplica del flujo del sistema legado con pestañas:
 *   Producto · Imagen · Inventario (si es inventariable) · Impuestos.
 * Toda la información del producto se guarda con POST/PUT /api/products;
 * la receta y las variantes se guardan en sus subrecursos una vez existe el
 * id del producto. La pestaña Impuestos es un stub visual (sin backend aún).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ImagePlus, Plus, Trash2, UploadCloud,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { Product } from "../shared/domain";
import {
  Button, cop, Field, Input, MoneyInput, Select, Tabs, TextArea, useToast,
} from "./ui";

interface Categoria { id: number; name: string }
interface Ingrediente { id: number; name: string | null; unit: string | null; type: string }
interface InventoryProduct {
  id: number; name: string | null; unit: string | null; type: string;
  product_id: number | null; stock: string | number; min_stock: string | number;
}
interface RecipeRow { inventoryProductId: number; name: string; unit: string; quantityUsed: string }
interface VariantRow { id?: number; name: string; salePrice: string }

const TAX_NOTE = "Módulo de impuestos pendiente — todavía no se guarda.";

/** Interruptor (switch) estilo Polaris; la UI base no traía uno. */
function Toggle({ checked, onChange, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
        checked ? "bg-accent-blue" : "bg-border-medium"
      }`}>
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
        checked ? "translate-x-[22px]" : "translate-x-0.5"
      }`} />
    </button>
  );
}

/** Fila etiqueta-control compacta de un panel (no usa el FormRow ancho). */
function Row({ label, required, children }: {
  label: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[180px_1fr]">
      <span className="text-sm font-semibold">
        {label}{required && <span className="text-accent-rose"> *</span>}
      </span>
      {children}
    </div>
  );
}

export function ProductoForm({ producto, categories, onSaved, onCancel }: {
  producto: Product | null;
  categories: Categoria[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const isNew = !producto;
  const [tab, setTab] = useState("Producto");
  const [saving, setSaving] = useState(false);

  // ── Pestaña Producto ──
  const [isActive, setIsActive] = useState(producto?.is_active ?? false);
  const [isInventariable, setIsInventariable] = useState(producto?.is_inventariable ?? false);
  const [productType, setProductType] = useState<"NORMAL" | "COMBO">(producto?.product_type ?? "NORMAL");
  const [categoryId, setCategoryId] = useState(producto ? String(producto.category_id) : "");
  const [name, setName] = useState(producto?.name ?? "");
  const [goesToKitchen, setGoesToKitchen] = useState(producto?.goes_to_kitchen ?? false);
  const [salePrice, setSalePrice] = useState(producto ? String(Number(producto.sale_price)) : "");
  const [description, setDescription] = useState(producto?.description ?? "");
  const [imageUrl, setImageUrl] = useState(producto?.image_url ?? "");

  // Utilidad: % editable, costo y $ derivados (Polaris no muestra el costo).
  const saleNum = Number(salePrice || 0);
  const initialPct = producto && Number(producto.sale_price) > 0
    ? Math.round((1 - Number(producto.cost_price) / Number(producto.sale_price)) * 100)
    : 100;
  const [utilidadPct, setUtilidadPct] = useState(String(initialPct));
  const pct = Number(utilidadPct || 0);
  const costPrice = Math.round(saleNum * (1 - pct / 100));
  const utilidadDollar = saleNum - costPrice;

  // ── Variantes ──
  const [enableVariants, setEnableVariants] = useState(false);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const originalVariantIds = useRef<number[]>([]);

  // ── Inventario / receta (va a cocina) ──
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([]);
  const [recipe, setRecipe] = useState<RecipeRow[]>([]);
  const [newIngId, setNewIngId] = useState("");
  const [newIngQty, setNewIngQty] = useState("");
  const [creatingIng, setCreatingIng] = useState(false);
  const [ingName, setIngName] = useState("");
  const [ingUnit, setIngUnit] = useState("Unidad");

  // ── Inventario / consumible directo (NO va a cocina) ──
  const [consumibleId, setConsumibleId] = useState<number | null>(null);
  const [cantInicial, setCantInicial] = useState("");
  const [cantMinima, setCantMinima] = useState("");
  const [cantActual, setCantActual] = useState("");

  // Carga inicial de subrecursos al editar + catálogo de ingredientes.
  useEffect(() => {
    api<InventoryProduct[]>("/api/catalogs/inventory-products")
      .then((rows) => {
        setIngredientes(rows.filter((r) => r.type === "ingrediente"));
        if (producto) {
          // Consumible directo previo (Polaris §1.11.1): si existe, se ajusta
          // la cantidad actual en vez de pedir inicial/mínima.
          const cons = rows.find((r) => r.type === "consumible" && r.product_id === producto.id);
          if (cons) {
            setConsumibleId(cons.id);
            setCantMinima(String(Number(cons.min_stock ?? 0)));
          }
        }
      })
      .catch(() => {});
    if (!producto) return;
    api<{ id: number; name: string; sale_price: string }[]>(`/api/products/${producto.id}/variants`)
      .then((rows) => {
        originalVariantIds.current = rows.map((r) => r.id);
        setVariants(rows.map((r) => ({ id: r.id, name: r.name, salePrice: String(Number(r.sale_price)) })));
        if (rows.length) setEnableVariants(true);
      })
      .catch(() => {});
    api<{ inventory_product_id: number; ingredient_name: string; unit: string; quantity_used: string }[]>(
      `/api/products/${producto.id}/recipe`)
      .then((rows) => setRecipe(rows.map((r) => ({
        inventoryProductId: r.inventory_product_id, name: r.ingredient_name,
        unit: r.unit, quantityUsed: String(Number(r.quantity_used)),
      }))))
      .catch(() => {});
  }, [producto]);

  // Pestañas: Inventario solo aparece si el producto es inventariable.
  const tabs = useMemo(
    () => ["Producto", "Imagen", ...(isInventariable ? ["Inventario"] : []), "Impuestos"],
    [isInventariable],
  );
  useEffect(() => { if (!tabs.includes(tab)) setTab("Producto"); }, [tabs, tab]);

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (!/\.(png|jpe?g)$/i.test(file.name)) {
      toast("error", "Solo se permiten archivos png, jpg o jpeg.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast("error", "La imagen no puede superar 5MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImageUrl(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function crearIngrediente() {
    if (!ingName.trim()) { toast("error", "El nombre del ingrediente es obligatorio."); return; }
    try {
      const created = await api<Ingrediente>("/api/catalogs/inventory-products", {
        method: "POST",
        body: { type: "ingrediente", name: ingName.trim(), unit: ingUnit.trim() || "Unidad" },
      });
      setIngredientes((xs) => [...xs, created]);
      setNewIngId(String(created.id));
      setIngName(""); setIngUnit("Unidad"); setCreatingIng(false);
      toast("success", "Ingrediente creado.");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No se pudo crear el ingrediente.");
    }
  }

  function agregarIngredienteReceta() {
    const ing = ingredientes.find((i) => String(i.id) === newIngId);
    const qty = Number(newIngQty);
    if (!ing) { toast("error", "Seleccione un ingrediente."); return; }
    if (!qty || qty <= 0) { toast("error", "Indique una cantidad válida."); return; }
    if (recipe.some((r) => r.inventoryProductId === ing.id)) {
      toast("warning", "Ese ingrediente ya está en la receta."); return;
    }
    setRecipe((rs) => [...rs, {
      inventoryProductId: ing.id, name: ing.name ?? "", unit: ing.unit ?? "Unidad",
      quantityUsed: String(qty),
    }]);
    setNewIngId(""); setNewIngQty("");
  }

  async function save() {
    if (!name.trim()) { toast("error", "El nombre del producto es obligatorio."); setTab("Producto"); return; }
    if (!categoryId) { toast("error", "Seleccione una categoría."); setTab("Producto"); return; }
    if (!salePrice || saleNum <= 0) { toast("error", "Indique un precio de venta."); setTab("Producto"); return; }

    setSaving(true);
    try {
      const body = {
        category_id: Number(categoryId), name: name.trim(),
        description: description.trim() || null, product_type: productType,
        sale_price: saleNum, cost_price: costPrice,
        is_inventariable: isInventariable, goes_to_kitchen: goesToKitchen,
        image_url: imageUrl || null, is_active: isActive,
      };
      const saved = isNew
        ? await api<Product>("/api/products", { method: "POST", body })
        : await api<Product>(`/api/products/${producto!.id}`, { method: "PUT", body });
      const id = saved.id;

      // Variantes: si se deshabilitan, se borran todas las originales.
      const keepIds = enableVariants
        ? variants.filter((v) => v.id).map((v) => v.id as number)
        : [];
      for (const oid of originalVariantIds.current) {
        if (!keepIds.includes(oid)) {
          await api(`/api/products/${id}/variants/${oid}`, { method: "DELETE" });
        }
      }
      if (enableVariants) {
        for (const v of variants) {
          if (!v.id && v.name.trim()) {
            await api(`/api/products/${id}/variants`, {
              method: "POST", body: { name: v.name.trim(), salePrice: Number(v.salePrice || 0) },
            });
          }
        }
      }

      // Inventario (Polaris §1.11.1): si va a cocina → receta de ingredientes;
      // si NO va a cocina → consumible directo (cantidad inicial/mínima, o
      // cantidad actual al ajustar uno existente). Solo aplica si es inventariable.
      if (isInventariable && goesToKitchen) {
        await api(`/api/products/${id}/recipe`, {
          method: "PUT",
          body: { items: recipe.map((r) => ({ inventoryProductId: r.inventoryProductId, quantityUsed: Number(r.quantityUsed) })) },
        });
        // Si antes era consumible directo, se retira para no descontar doble.
        if (consumibleId) {
          await api(`/api/catalogs/inventory-products/${consumibleId}`, { method: "DELETE" }).catch(() => {});
          setConsumibleId(null);
        }
      } else if (isInventariable && !goesToKitchen) {
        if (consumibleId) {
          await api(`/api/catalogs/inventory-products/${consumibleId}`, {
            method: "PUT", body: { stock: Number(cantActual || 0) },
          });
        } else {
          const created = await api<{ id: number }>("/api/catalogs/inventory-products", {
            method: "POST",
            body: {
              type: "consumible", name: name.trim(), unit: "Unidad", product_id: id,
              stock: Number(cantInicial || 0), min_stock: Number(cantMinima || 0), is_active: true,
            },
          });
          setConsumibleId(created.id);
        }
        await api(`/api/products/${id}/recipe`, { method: "PUT", body: { items: [] } });
      } else {
        // No inventariable: se limpia la receta y se retira el consumible previo.
        await api(`/api/products/${id}/recipe`, { method: "PUT", body: { items: [] } });
        if (consumibleId) {
          await api(`/api/catalogs/inventory-products/${consumibleId}`, { method: "DELETE" }).catch(() => {});
          setConsumibleId(null);
        }
      }

      toast("success", isNew ? "Producto agregado correctamente." : "Producto actualizado correctamente.");
      onSaved();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Error al guardar el producto.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fade-in-up">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">{isNew ? "Agregar producto" : "Editar producto"}</h2>
        <div className="flex gap-2">
          <Button onClick={save} disabled={saving}>
            <Plus size={15} className="-mt-0.5 mr-1 inline" />
            {saving ? "Guardando…" : isNew ? "Agregar" : "Guardar"}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            <ArrowLeft size={15} className="-mt-0.5 mr-1 inline" /> Cancelar
          </Button>
        </div>
      </div>

      <div className="glass max-w-3xl rounded-2xl p-6">
        <Tabs tabs={tabs} active={tab} onChange={setTab} />

        {tab === "Producto" && (
          <div className="space-y-4">
            <div className="grid gap-4 rounded-xl border border-border-subtle p-4 sm:grid-cols-2">
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">Activo</span>
                <Toggle checked={isActive} onChange={setIsActive} />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">Inventariable</span>
                <Toggle checked={isInventariable} onChange={setIsInventariable} />
              </label>
              <Row label="Tipo de producto" required>
                <Select value={productType} onChange={(e) => setProductType(e.target.value as "NORMAL" | "COMBO")}>
                  <option value="NORMAL">Normal</option>
                  <option value="COMBO">Combo</option>
                </Select>
              </Row>
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">Habilitar variantes</span>
                <Toggle checked={enableVariants} onChange={setEnableVariants} />
              </label>
            </div>

            <Row label="Categoría" required>
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">— Seleccione una opción —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Row>
            <Row label="Nombre del producto" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Row>
            <Row label="A la cocina" required>
              <Select value={goesToKitchen ? "si" : "no"}
                onChange={(e) => setGoesToKitchen(e.target.value === "si")}>
                <option value="no">No</option>
                <option value="si">Sí</option>
              </Select>
            </Row>
            <Row label="Precio de venta" required>
              <MoneyInput value={salePrice} onValueChange={setSalePrice} />
            </Row>

            <div className="grid gap-4 rounded-xl border border-border-subtle p-4 sm:grid-cols-2">
              <Field label="Utilidad ($)">
                <Input value={utilidadDollar ? cop.format(utilidadDollar) : "—"} disabled />
              </Field>
              <Field label="Utilidad (%)">
                <Input type="number" min={0} max={100} value={utilidadPct}
                  onChange={(e) => setUtilidadPct(e.target.value)} />
              </Field>
            </div>

            <Row label="Descripción">
              <TextArea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Row>
            <p className="text-xs text-text-muted">
              Observación: al generarse una alerta, la imagen se vacía automáticamente; deberá agregarla de nuevo.
            </p>

            {enableVariants && (
              <div className="rounded-xl border border-border-subtle p-4">
                <h3 className="mb-3 text-sm font-semibold">Variantes</h3>
                <div className="space-y-2">
                  {variants.map((v, i) => (
                    <div key={v.id ?? `n${i}`} className="flex items-center gap-2">
                      <Input className="flex-1" placeholder="Nombre" value={v.name} disabled={!!v.id}
                        onChange={(e) => setVariants((xs) => xs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                      <MoneyInput className="!w-40" value={v.salePrice} disabled={!!v.id}
                        onValueChange={(raw) => setVariants((xs) => xs.map((x, j) => j === i ? { ...x, salePrice: raw } : x))} />
                      <button type="button" aria-label="Quitar variante"
                        onClick={() => setVariants((xs) => xs.filter((_, j) => j !== i))}
                        className="rounded-lg p-2 text-text-muted transition hover:bg-accent-rose/15 hover:text-accent-rose">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
                <Button variant="ghost" size="sm" className="mt-3"
                  onClick={() => setVariants((xs) => [...xs, { name: "", salePrice: "" }])}>
                  <Plus size={14} className="-mt-0.5 mr-1 inline" /> Agregar variante
                </Button>
                {variants.some((v) => v.id) && (
                  <p className="mt-2 text-xs text-text-muted">
                    Las variantes existentes solo pueden eliminarse; para cambiarlas, elimínelas y vuelva a crearlas.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "Imagen" && (
          <div className="space-y-3">
            <input type="file" accept=".png,.jpg,.jpeg" id="producto-img" className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])} />
            <div className="flex items-center gap-4">
              {imageUrl ? (
                <img src={imageUrl} alt="Producto"
                  className="h-28 w-36 rounded-xl border border-border-subtle bg-white object-contain p-1" />
              ) : (
                <span className="grid h-28 w-36 place-items-center rounded-xl border border-dashed border-border-medium text-text-muted">
                  <ImagePlus size={26} />
                </span>
              )}
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => document.getElementById("producto-img")?.click()}>
                  Cargar…
                </Button>
                {imageUrl && (
                  <Button variant="danger" onClick={() => setImageUrl("")}>Quitar</Button>
                )}
              </div>
            </div>
            <label htmlFor="producto-img"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
              className="grid cursor-pointer place-items-center rounded-xl border border-dashed border-border-medium py-10 text-center text-text-muted transition hover:bg-bg-tertiary/50">
              <UploadCloud size={28} className="mb-2" />
              Arrastra un archivo y suéltalo aquí
            </label>
            <p className="text-xs text-text-muted">Solo se permiten archivos con extensión png, jpg, jpeg.</p>
            <p className="text-xs text-text-muted">Recuerde que el peso máximo de la imagen es 5MB.</p>
          </div>
        )}

        {tab === "Inventario" && goesToKitchen && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Receta</h3>
            <div className="overflow-hidden rounded-xl border border-border-subtle">
              <table className="w-full text-sm">
                <thead className="bg-bg-tertiary/60 text-left text-xs uppercase tracking-wide text-text-secondary">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Cantidad</th>
                    <th className="px-4 py-2.5 font-medium">Tipo de unidad</th>
                    <th className="px-4 py-2.5 font-medium">Nombre</th>
                    <th className="w-12 px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle/60">
                  {recipe.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                      No hay ingredientes en esta receta, agregue algunos.
                    </td></tr>
                  )}
                  {recipe.map((r) => (
                    <tr key={r.inventoryProductId}>
                      <td className="px-4 py-2">{r.quantityUsed}</td>
                      <td className="px-4 py-2">{r.unit}</td>
                      <td className="px-4 py-2">{r.name}</td>
                      <td className="px-4 py-2">
                        <button type="button" aria-label="Quitar ingrediente"
                          onClick={() => setRecipe((rs) => rs.filter((x) => x.inventoryProductId !== r.inventoryProductId))}
                          className="rounded-lg p-1.5 text-text-muted transition hover:bg-accent-rose/15 hover:text-accent-rose">
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <Input type="number" min={0} step="any" placeholder="Cantidad" className="!w-28"
                value={newIngQty} onChange={(e) => setNewIngQty(e.target.value)} />
              <Select className="!w-auto !min-w-48" value={newIngId} onChange={(e) => setNewIngId(e.target.value)}>
                <option value="">— Seleccione —</option>
                {ingredientes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </Select>
              <Button variant="ghost" onClick={agregarIngredienteReceta}>Agregar ingrediente</Button>
              <Button variant="ghost" onClick={() => setCreatingIng((v) => !v)}>Crear nuevo ingrediente</Button>
            </div>

            {creatingIng && (
              <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border-subtle p-4">
                <Field label="Nombre del ingrediente">
                  <Input value={ingName} onChange={(e) => setIngName(e.target.value)} className="!w-56" />
                </Field>
                <Field label="Unidad">
                  <Input value={ingUnit} onChange={(e) => setIngUnit(e.target.value)} className="!w-32" />
                </Field>
                <Button onClick={crearIngrediente}>Guardar ingrediente</Button>
              </div>
            )}
          </div>
        )}

        {tab === "Inventario" && !goesToKitchen && (
          <div className="space-y-4">
            {consumibleId ? (
              <div className="space-y-3 rounded-xl border border-border-subtle p-4">
                <div className="grid items-start gap-2 sm:grid-cols-[180px_1fr]">
                  <span className="text-sm font-semibold">Consumible previo encontrado</span>
                  <p className="text-sm text-text-secondary">
                    Se ha encontrado un consumible asociado a este producto anteriormente,
                    escriba la cantidad actual para ajustar el inventario.
                  </p>
                </div>
                <Row label="Cantidad actual">
                  <Input type="number" min={0} step="any" value={cantActual}
                    onChange={(e) => setCantActual(e.target.value)} />
                </Row>
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-border-subtle p-4">
                <Row label="Cantidad inicial">
                  <Input type="number" min={0} step="any" value={cantInicial}
                    onChange={(e) => setCantInicial(e.target.value)} />
                </Row>
                <Row label="Cantidad mínima">
                  <Input type="number" min={0} step="any" value={cantMinima}
                    onChange={(e) => setCantMinima(e.target.value)} />
                </Row>
              </div>
            )}
          </div>
        )}

        {tab === "Impuestos" && (
          <div className="space-y-4">
            <div className="rounded-lg border border-accent-amber/40 bg-accent-amber/10 px-3 py-2 text-xs text-accent-amber">
              {TAX_NOTE}
            </div>
            <div className="flex items-center gap-2">
              <Select className="flex-1" disabled>
                <option>— Seleccione un impuesto —</option>
              </Select>
              <Button variant="ghost" disabled><Plus size={15} /></Button>
            </div>
            <div className="overflow-hidden rounded-xl border border-border-subtle">
              <table className="w-full text-sm">
                <thead className="bg-bg-tertiary/60 text-left text-xs uppercase tracking-wide text-text-secondary">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Impuesto</th>
                    <th className="px-4 py-2.5 font-medium">Concepto</th>
                    <th className="px-4 py-2.5 font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-text-muted">
                    No hay impuestos definidos.
                  </td></tr>
                </tbody>
              </table>
            </div>
            <div className="rounded-xl border border-border-subtle p-4 text-sm">
              <h3 className="mb-3 font-semibold">Cálculo de impuestos</h3>
              <div className="flex justify-between py-1"><span>Base:</span><span>{cop.format(saleNum)}</span></div>
              <div className="flex justify-between py-1"><span>Impuestos:</span><span>{cop.format(0)}</span></div>
              <div className="flex justify-between py-1 font-semibold"><span>Precio Venta:</span><span>{cop.format(saleNum)}</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
