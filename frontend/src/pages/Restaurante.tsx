/**
 * Submódulos de Restaurante — manual §1.6: Menú (vista por categorías,
 * solo lectura §1.6.1), QR (§1.6.2), Reservaciones (§1.6.5), Clientes
 * (§1.6.6) y Gestión de domicilios (Fase 4).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, Search, UtensilsCrossed } from "lucide-react";
import QRCode from "qrcode";
import { api } from "../lib/api";
import { Button, cop, Input, PageHeader } from "../components/ui";

interface MenuProduct {
  id: number; name: string; description: string | null;
  sale_price: string; category_name: string; image_url: string | null;
}

/* ───────── Menú (§1.6.1): píldoras de categorías + secciones
   colapsables con imagen, como Polaris Food ───────── */
export function MenuPage() {
  const [menu, setMenu] = useState<MenuProduct[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("TODOS");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api<MenuProduct[]>("/api/products/menu/list").then(setMenu).catch(() => {});
  }, []);

  const categories = useMemo(
    () => [...new Set(menu.map((p) => p.category_name))],
    [menu],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menu.filter((p) =>
      (category === "TODOS" || p.category_name === category) &&
      (!q || p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q)),
    );
  }, [menu, category, search]);

  const byCategory = useMemo(() => {
    const map = new Map<string, MenuProduct[]>();
    for (const p of visible) {
      map.set(p.category_name, [...(map.get(p.category_name) ?? []), p]);
    }
    return [...map.entries()];
  }, [visible]);

  return (
    <div className="fade-in-up">
      <PageHeader title="Menú" subtitle="Restaurante" />

      {/* Búsqueda rápida (§1.4) */}
      <div className="relative mb-4 max-w-xs">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <Input placeholder="Búsqueda rápida" value={search}
          onChange={(e) => setSearch(e.target.value)} className="!pl-9" />
      </div>

      {/* Píldoras de categorías con TODOS activo */}
      <div className="mb-5 flex flex-wrap gap-2">
        {["TODOS", ...categories].map((c) => (
          <button key={c} onClick={() => setCategory(c)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold uppercase tracking-wide transition ${
              c === category
                ? "bg-gradient-to-br from-accent-blue to-accent-blue-hover text-white shadow-[0_0_14px_var(--accent-glow)]"
                : "glass text-text-secondary hover:text-text-primary"
            }`}>
            {c}
          </button>
        ))}
      </div>

      {/* Secciones por categoría, colapsables (expandidas por defecto) */}
      <div className="space-y-4">
        {byCategory.map(([cat, products]) => {
          const isCollapsed = collapsed[cat];
          return (
            <section key={cat} className="glass rounded-2xl p-5">
              <button
                onClick={() => setCollapsed({ ...collapsed, [cat]: !isCollapsed })}
                className="flex items-center gap-2 text-base font-bold uppercase tracking-wide">
                {cat}
                <ChevronDown size={17}
                  className={`transition-transform ${isCollapsed ? "" : "rotate-180"}`} />
              </button>

              {!isCollapsed && (
                <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-2">
                  {products.map((p) => (
                    <article key={p.id}
                      className="flex items-start justify-between gap-4 border-b border-border-subtle/60 pb-4 last:border-0 md:[&:nth-last-child(2)]:border-0">
                      <div className="min-w-0">
                        <h3 className="font-bold uppercase leading-tight">{p.name}</h3>
                        {p.description && (
                          <p className="mt-1 line-clamp-3 text-sm text-text-secondary">
                            {p.description}
                          </p>
                        )}
                        <p className="mt-2 text-lg font-bold text-accent-cyan">
                          {cop.format(Number(p.sale_price))}
                        </p>
                      </div>
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name}
                          className="h-24 w-32 shrink-0 rounded-xl object-cover shadow-md" />
                      ) : (
                        <div className="grid h-24 w-32 shrink-0 place-items-center rounded-xl bg-bg-tertiary text-text-muted shadow-md">
                          <UtensilsCrossed size={26} strokeWidth={1.5} />
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          );
        })}
        {byCategory.length === 0 && (
          <p className="py-10 text-center text-sm text-text-muted">
            No hay productos disponibles en el menú.
          </p>
        )}
      </div>
    </div>
  );
}

/* ───────── QR (§1.6.2): código permanente del menú público ─────────
   La URL es estable por establecimiento (`/m/<tenantId>?c=<code>`): el QR
   impreso en las mesas NO cambia aunque cambie el menú o el día, porque el
   menú se resuelve dinámicamente en el servidor. */
export function QrPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState<string>("");
  const [error, setError] = useState(false);

  useEffect(() => {
    api<{ tenantId: string; code: string }>("/api/settings/menu-qr")
      .then(({ tenantId, code }) => {
        setUrl(`${window.location.origin}/m/${tenantId}?c=${code}`);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    if (!url || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, url, { width: 280, margin: 2 }, (err) => {
      if (err) setError(true);
    });
  }, [url]);

  function descargar() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "menu-qr.png";
    a.click();
  }

  return (
    <div className="fade-in-up">
      <PageHeader title="QR" subtitle="Código QR del menú" />
      {error ? (
        <p className="text-sm text-danger text-center">No se pudo generar el QR. Intenta de nuevo.</p>
      ) : (
        <div className="mx-auto flex flex-col items-center text-center max-w-sm">
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <canvas ref={canvasRef} aria-label="Código QR del menú" />
          </div>
          <Button
            onClick={descargar}
            className="mt-5"
          >
            <Download size={16} className="mr-2 inline" /> Descargar PNG
          </Button>
        </div>
      )}
    </div>
  );
}

/* Reservaciones vive en pages/Reservaciones.tsx (réplica Polaris) */

/* Clientes vive en pages/Clientes.tsx (réplica Polaris) */

/* Gestión de domicilios vive en pages/Domicilios.tsx (réplica Polaris) */
