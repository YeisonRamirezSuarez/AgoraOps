/**
 * Layout protegido con el menú jerárquico de Polaris Food (referencia):
 * módulos principales con submenús desplegables, filtrados por rol
 * (manual §1.2): Mesero → Menú/QR/Mesas + Duplicado voucher; Cocina →
 * Monitor de Cocina; Mesero_cocina → mixto; Administrador → todo.
 */
import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, UtensilsCrossed, Settings, Wallet, BarChart3,
  Package, Boxes, Shield, LogOut, ChevronDown,
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

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isAdmin = user?.roleType === "administrador" || user?.isSuperAdmin;
  const group = user?.groupName ?? "";

  const canSee = (roles?: string[]) => isAdmin || (roles ?? []).includes(group);

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
    <div className="flex min-h-screen">
      <aside className="glass flex w-64 shrink-0 flex-col border-r border-border-subtle p-3">
        <div className="mb-5 px-2 pt-2">
          <span className="bg-gradient-to-br from-accent-blue to-accent-cyan bg-clip-text text-lg font-bold text-transparent">
            AgoraOps
          </span>
          <p className="text-[11px] text-text-muted">
            {user?.fullName} · {user?.groupName ?? "Super Admin"}
          </p>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto pr-1">
          {NAV.map((g) => {
            if (!g.children) {
              if (!canSee(g.roles)) return null;
              return (
                <NavLink key={g.label} to={g.to!}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                      isActive
                        ? "bg-accent-blue/15 font-medium text-accent-blue"
                        : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                    }`}>
                  <g.icon size={17} /> {g.label}
                </NavLink>
              );
            }
            const children = g.children.filter((c) => canSee(c.roles));
            if (children.length === 0) return null;
            const expanded = open === g.label;
            const groupActive = children.some(isChildActive);
            return (
              <div key={g.label}>
                <button
                  onClick={() => setOpen(expanded ? null : g.label)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
                    groupActive
                      ? "text-accent-blue"
                      : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                  }`}>
                  <span className="flex items-center gap-3">
                    <g.icon size={17} /> {g.label}
                  </span>
                  <ChevronDown size={14}
                    className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>
                {expanded && (
                  <div className="mb-1 ml-4 space-y-0.5 border-l border-border-subtle pl-3">
                    {children.map((c) => (
                      <button key={c.label} onClick={() => navigate(c.to)}
                        className={`block w-full rounded-lg px-3 py-1.5 text-left text-[13px] transition ${
                          isChildActive(c)
                            ? "bg-accent-blue/15 font-medium text-accent-blue"
                            : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
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

        <div className="border-t border-border-subtle pt-2">
          <button onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-text-secondary transition hover:bg-bg-tertiary hover:text-accent-rose">
            <LogOut size={17} /> Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
