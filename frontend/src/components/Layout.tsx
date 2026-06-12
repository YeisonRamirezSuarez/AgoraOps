/**
 * Layout protegido con el menú jerárquico de Polaris Food (referencia):
 * cabecera con avatar del usuario + botón ☰ para colapsar a solo iconos;
 * módulos principales con submenús desplegables, filtrados por rol
 * (manual §1.2): Mesero → Menú/QR/Mesas + Duplicado voucher; Cocina →
 * Monitor de Cocina; Mesero_cocina → mixto; Administrador → todo.
 *
 * Responsive: en tablets/desktop (md+) el sidebar es fijo y colapsable;
 * en teléfonos se oculta como drawer (se abre con "Más") y la navegación
 * principal del mesero vive en una barra inferior fija (Mesas, Menú,
 * Cocina, Notificaciones). En la toma de pedidos (/mesas/:id) la barra
 * se oculta para dejar lugar a la barra del carrito de la orden.
 */
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, UtensilsCrossed, Settings, Wallet, BarChart3,
  Package, Boxes, Shield, LogOut, ChevronDown, Menu, CircleUserRound,
  LayoutGrid, ChefHat, Bell, X,
} from "lucide-react";
import { useAuth } from "../lib/auth";

interface NavChild {
  label: string;
  to: string;
  /** Grupos del manual que pueden verlo (vacío = solo administrador). */
  roles?: string[];
}
interface NavGroup {
  label: string;
  icon: typeof LayoutDashboard;
  to?: string; // Grupo sin hijos = link directo
  roles?: string[];
  children?: NavChild[];
}

const MESERO = ["Mesero", "Mesero_cocina"];
const COCINA = ["Cocina", "Mesero_cocina"];
const TODOS = ["Mesero", "Cocina", "Mesero_cocina"];

const NAV: NavGroup[] = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/dashboard", roles: TODOS },
  {
    label: "Restaurante", icon: UtensilsCrossed, roles: TODOS,
    children: [
      { label: "Menú", to: "/restaurante/menu", roles: MESERO },
      { label: "QR", to: "/restaurante/qr", roles: MESERO },
      { label: "Mesas", to: "/mesas", roles: MESERO },
      { label: "Monitor de cocina", to: "/cocina", roles: COCINA },
      { label: "Reservaciones", to: "/restaurante/reservaciones" },
      { label: "Clientes", to: "/restaurante/clientes" },
      { label: "Gestión de domicilios", to: "/restaurante/domicilios" },
      { label: "Notificaciones", to: "/notificaciones" },
    ],
  },
  {
    label: "Configuración restaurante", icon: Settings,
    children: [
      { label: "Sala del restaurante", to: "/configuracion?tab=Sala del restaurante" },
      { label: "Mesas del restaurante", to: "/configuracion?tab=Mesas del restaurante" },
      { label: "Etapas de reserva", to: "/configuracion?tab=Etapas de reserva" },
      { label: "Horarios", to: "/configuracion?tab=Horarios" },
      { label: "Objetivos", to: "/configuracion?tab=Objetivos" },
      { label: "Prioridad del menú", to: "/configuracion?tab=Prioridad del menú" },
      { label: "Métodos de pago", to: "/configuracion?tab=Métodos de pago" },
      { label: "Denominación de moneda", to: "/configuracion?tab=Denominación de moneda" },
      { label: "Bancos para transferencia", to: "/configuracion?tab=Bancos para transferencia" },
      { label: "Catálogo de impuestos", to: "/configuracion?tab=Catálogo de impuestos" },
    ],
  },
  {
    label: "Gestión de cajas", icon: Wallet,
    children: [
      { label: "Configuración de parámetros", to: "/cajas?tab=Configuración de parámetros" },
      { label: "Cajas", to: "/cajas?tab=Cajas" },
      { label: "Apertura / Cierre de cajas", to: "/cajas?tab=Apertura / Cierre de cajas" },
      { label: "Reporte de cajas", to: "/cajas?tab=Reporte de cajas" },
      { label: "Descargar servicio de impresión", to: "/cajas?tab=Descargar servicio de impresión" },
      { label: "Configuración de impresoras", to: "/cajas?tab=Configuración de impresoras" },
    ],
  },
  {
    label: "Reportes", icon: BarChart3, roles: ["Mesero", "Mesero_cocina"],
    children: [
      { label: "Reporte general", to: "/reportes?tab=Reporte general" },
      { label: "Reporte de ventas", to: "/reportes?tab=Reporte de ventas", roles: ["Mesero_cocina"] },
      { label: "Reporte de productos", to: "/reportes?tab=Reporte de productos" },
      { label: "Ordenes canceladas", to: "/reportes?tab=Ordenes canceladas" },
      { label: "Ventas a crédito", to: "/reportes?tab=Ventas a crédito" },
      { label: "Duplicado voucher", to: "/reportes?tab=Duplicado voucher", roles: MESERO },
    ],
  },
  {
    label: "Productos", icon: Package,
    children: [
      { label: "Lista de productos", to: "/productos?tab=Lista de productos" },
      { label: "Carga masiva de productos", to: "/productos?tab=Carga masiva de productos" },
      { label: "Categorías", to: "/productos?tab=Categorías" },
      { label: "Listado de toppings", to: "/productos?tab=Listado de toppings" },
      { label: "Toppings por producto", to: "/productos?tab=Toppings por producto" },
      { label: "Promociones", to: "/productos?tab=Promociones" },
    ],
  },
  {
    label: "Inventario", icon: Boxes,
    children: [
      { label: "Productos del inventario", to: "/inventario?tab=Productos del inventario" },
      { label: "Lista de recetas", to: "/inventario?tab=Lista de recetas" },
      { label: "Proveedores", to: "/inventario?tab=Proveedores" },
      { label: "Movimientos", to: "/inventario?tab=Movimientos" },
    ],
  },
  {
    label: "Seguridad", icon: Shield, roles: TODOS,
    children: [
      { label: "Usuarios", to: "/seguridad?tab=Usuarios" },
      { label: "Grupos", to: "/seguridad?tab=Grupos" },
      { label: "Grupos / Usuarios", to: "/seguridad?tab=Grupos / Usuarios" },
      { label: "Cambiar contraseña", to: "/cambiar-contrasena", roles: TODOS },
    ],
  },
];

/** Accesos rápidos de la barra inferior móvil (lo más usado por el mesero). */
const QUICK_NAV = [
  { label: "Mesas", to: "/mesas", icon: LayoutGrid, roles: MESERO },
  { label: "Menú", to: "/restaurante/menu", icon: UtensilsCrossed, roles: MESERO },
  { label: "Cocina", to: "/cocina", icon: ChefHat, roles: COCINA },
  { label: "Avisos", to: "/notificaciones", icon: Bell, roles: TODOS },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isAdmin = user?.roleType === "administrador" || user?.isSuperAdmin;
  const group = user?.groupName ?? "";
  const [collapsed, setCollapsed] = useState(false);
  // Drawer móvil (el sidebar se desliza sobre el contenido en < md)
  const [mobileOpen, setMobileOpen] = useState(false);

  const canSee = (roles?: string[]) => isAdmin || (roles ?? []).includes(group);

  // En la toma de pedidos / pago la orden tiene su propia barra inferior
  const hideMobileNav = /^\/mesas\/\d+/.test(location.pathname);

  // Cerrar el drawer al navegar a otra página
  useEffect(() => setMobileOpen(false), [location.pathname, location.search]);

  function isChildActive(c: NavChild): boolean {
    const [path, query] = c.to.split("?");
    if (location.pathname !== path && !location.pathname.startsWith(`${path}/`)) {
      return false;
    }
    if (!query) return true;
    return decodeURIComponent(location.search) === `?${query}` ||
      decodeURIComponent(location.search).startsWith(`?${query}`);
  }

  const [open, setOpen] = useState<string | null>(() => {
    const current = NAV.find((g) => g.children?.some(isChildActive));
    return current?.label ?? null;
  });

  return (
    // h-dvh + overflow-hidden: el scroll vive en <main> y el menú queda fijo
    <div className="flex h-dvh overflow-hidden">
      {/* Fondo oscuro tras el drawer en móvil */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`sidebar-polaris fixed inset-y-0 left-0 z-50 flex w-72 flex-col p-3 text-white transition-[transform,width] duration-200 md:static md:translate-x-0 md:shrink-0 ${
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      } ${collapsed ? "md:w-[76px]" : "md:w-72"}`}>
        {/* Cabecera: avatar + usuario + botón ☰ (Polaris) */}
        <div className={`mb-4 flex items-center gap-3 px-1 pt-1 ${collapsed ? "md:flex-col" : ""}`}>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-[hsl(200_90%_47%)] shadow-md">
            <CircleUserRound size={30} strokeWidth={1.6} />
          </span>
          <div className={`min-w-0 flex-1 ${collapsed ? "md:hidden" : ""}`}>
            <p className="text-sm leading-tight text-white/80">
              {user?.groupName ?? "Super Admin"}
            </p>
            <p className="truncate text-base font-bold leading-tight">
              {user?.fullName}
            </p>
          </div>
          {/* Colapsar: solo tablet/desktop */}
          <button onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Mostrar menú" : "Ocultar menú"}
            className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg text-white transition hover:bg-white/20 md:grid">
            <Menu size={24} strokeWidth={2.4} />
          </button>
          {/* Cerrar drawer: solo móvil */}
          <button onClick={() => setMobileOpen(false)} aria-label="Cerrar menú"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white transition hover:bg-white/20 md:hidden">
            <X size={24} strokeWidth={2.4} />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto pr-1">
          {NAV.map((g) => {
            if (!g.children) {
              if (!canSee(g.roles)) return null;
              return (
                <NavLink key={g.label} to={g.to!} title={g.label}
                  className={({ isActive }) =>
                    `flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-3 text-[16px] font-semibold transition ${
                      collapsed ? "md:justify-center" : ""
                    } ${
                      isActive
                        ? "bg-black/25 text-white"
                        : "text-white/90 hover:bg-white/15 hover:text-white"
                    }`}>
                  <g.icon size={21} className="shrink-0" />
                  <span className={collapsed ? "md:hidden" : ""}>{g.label}</span>
                </NavLink>
              );
            }
            const children = g.children.filter((c) => canSee(c.roles));
            if (children.length === 0) return null;
            const expanded = open === g.label && !collapsed;
            const groupActive = children.some(isChildActive);
            return (
              <div key={g.label}>
                <button title={g.label}
                  onClick={() => {
                    if (collapsed) {
                      setCollapsed(false);
                      setOpen(g.label);
                    } else {
                      setOpen(expanded ? null : g.label);
                    }
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-3 text-[16px] font-semibold transition ${
                    collapsed ? "md:justify-center" : "justify-between"
                  } ${
                    groupActive
                      ? "bg-black/20 text-white"
                      : "text-white/90 hover:bg-white/15 hover:text-white"
                  }`}>
                  <span className={`flex min-w-0 items-center gap-3 ${collapsed ? "" : "flex-1"}`}>
                    <g.icon size={21} className="shrink-0" />
                    <span className={`truncate whitespace-nowrap ${collapsed ? "md:hidden" : ""}`}>
                      {g.label}
                    </span>
                  </span>
                  <ChevronDown size={15}
                    className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""} ${
                      collapsed ? "md:hidden" : ""
                    }`} />
                </button>
                {expanded && (
                  <div className="mb-1 ml-5 space-y-0.5 border-l border-white/30 pl-3">
                    {children.map((c) => (
                      <button key={c.label} onClick={() => navigate(c.to)}
                        className={`block w-full truncate whitespace-nowrap rounded-lg px-3 py-2 text-left text-[15px] transition ${
                          isChildActive(c)
                            ? "bg-black/25 font-semibold text-white"
                            : "text-white/85 hover:bg-white/15 hover:text-white"
                        }`}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-white/25 pt-2">
          <button onClick={logout} title="Cerrar sesión"
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-[16px] font-semibold text-white/90 transition hover:bg-white/15 hover:text-white ${
              collapsed ? "md:justify-center" : ""
            }`}>
            <LogOut size={21} className="shrink-0" />
            <span className={collapsed ? "md:hidden" : ""}>Cerrar sesión</span>
          </button>
          <p className={`mt-1 px-3 pb-1 text-center text-sm font-extrabold tracking-wide text-white/90 ${
            collapsed ? "md:hidden" : ""
          }`}>
            AgoraOps
          </p>
        </div>
      </aside>

      <main className={`flex-1 overflow-y-auto p-6 ${hideMobileNav ? "" : "pb-24 md:pb-6"}`}>
        <Outlet />
      </main>

      {/* ══════════ Barra de navegación inferior (solo teléfonos) ══════════ */}
      {!hideMobileNav && (
        <nav className="glass fixed inset-x-0 bottom-0 z-40 flex rounded-none border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] md:hidden">
          {QUICK_NAV.filter((l) => canSee(l.roles)).map((l) => (
            <NavLink key={l.to} to={l.to}
              className={({ isActive }) =>
                `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-semibold transition ${
                  isActive ? "text-accent-blue" : "text-text-secondary"
                }`}>
              <l.icon size={22} />
              {l.label}
            </NavLink>
          ))}
          <button onClick={() => { setCollapsed(false); setMobileOpen(true); }}
            aria-label="Abrir menú completo"
            className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-semibold text-text-secondary transition">
            <Menu size={22} />
            Más
          </button>
        </nav>
      )}
    </div>
  );
}
