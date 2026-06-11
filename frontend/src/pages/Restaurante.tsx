/**
 * Submódulos de Restaurante — manual §1.6: Menú (vista por categorías,
 * solo lectura §1.6.1), QR (§1.6.2), Reservaciones (§1.6.5), Clientes
 * (§1.6.6) y Gestión de domicilios (Fase 4).
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, QrCode, Search, UtensilsCrossed } from "lucide-react";
import { api } from "../lib/api";
import { CrudPage } from "../components/CrudPage";
import { EnConstruccion } from "../components/EnConstruccion";
import { cop, Input, PageHeader } from "../components/ui";

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
                ? "bg-gradient-to-br from-accent-blue to-accent-blue-hover text-white shadow-[0_0_14px_hsl(199_89%_48%/0.25)]"
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

/* ───────── QR (§1.6.2): código para ver el menú ───────── */
export function QrPage() {
  return (
    <div className="fade-in-up">
      <PageHeader title="QR" subtitle="Código QR para que el cliente vea el menú del restaurante" />
      <div className="glass mx-auto grid max-w-sm place-items-center rounded-2xl p-10 text-center">
        <QrCode size={120} className="mb-4 text-text-secondary" strokeWidth={1} />
        <p className="text-sm text-text-secondary">
          El QR se generará cuando el <span className="font-medium">menú público</span> esté
          desplegado (app de solo lectura del roadmap).
        </p>
      </div>
    </div>
  );
}

/* ───────── Reservaciones (§1.6.5) ───────── */
export function ReservacionesPage() {
  const [rooms, setRooms] = useState<{ id: number; name: string }[]>([]);
  const [clients, setClients] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    api<{ id: number; name: string }[]>("/api/catalogs/rooms").then(setRooms).catch(() => {});
    api<{ id: number; name: string }[]>("/api/catalogs/clients").then(setClients).catch(() => {});
  }, []);
  return (
    <div className="fade-in-up">
      <PageHeader title="Reservaciones" />
      <CrudPage title="reservación" endpoint="/api/catalogs/reservations"
        fields={[
          {
            name: "client_id", label: "Cliente", type: "select", required: true,
            options: clients.map((c) => ({ value: c.id, label: c.name })),
          },
          {
            name: "stage_id", label: "Etapa", type: "select", required: true,
            options: [
              { value: 1, label: "Reservado" },
              { value: 2, label: "Confirmado" },
              { value: 3, label: "Cancelado" },
            ],
          },
          {
            name: "date", label: "Fecha y hora", type: "datetime-local", required: true,
            render: (r) => new Date(String(r.date)).toLocaleString("es-CO"),
          },
          {
            name: "room_id", label: "Sala", type: "select",
            options: rooms.map((r) => ({ value: r.id, label: r.name })),
          },
          { name: "decoration_type", label: "Decoración", inTable: false },
          { name: "cost", label: "Costo", type: "number", inTable: false },
          { name: "observations", label: "Observaciones", inTable: false },
        ]} />
    </div>
  );
}

/* ───────── Clientes (§1.6.6) ───────── */
export function ClientesPage() {
  return (
    <div className="fade-in-up">
      <PageHeader title="Clientes" />
      <CrudPage title="cliente" endpoint="/api/catalogs/clients"
        fields={[
          { name: "document_id", label: "NIT / Cédula" },
          { name: "name", label: "Nombre", required: true },
          { name: "phone", label: "Teléfono" },
          { name: "email", label: "Correo" },
          { name: "address", label: "Dirección", inTable: false },
        ]} />
    </div>
  );
}

/* ───────── Gestión de domicilios (Fase 4) ───────── */
export function DomiciliosPage() {
  return (
    <div className="fade-in-up">
      <PageHeader title="Gestión de domicilios" />
      <EnConstruccion
        titulo="Gestión de domicilios"
        nota="Funcionalidad del PHP legacy (registrarVentaDomi, empresadomi, valorDomi) planificada en Fase 4 del plan de implementación."
      />
    </div>
  );
}
