/**
 * Layout del panel Super Administrador (Multicomercio): sidebar oscuro
 * fijo para distinguirlo del POS de los establecimientos. Navegación:
 * Dashboard global, Establecimientos y cambio de contraseña.
 * Responsive: drawer en móvil con barra superior.
 */
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Store, KeyRound, LogOut, Menu, X, ShieldCheck,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { applyPalette, DEFAULT_PALETTE } from "../shared/constants/palettes";

const NAV = [
  { label: "Dashboard global", to: "/superadmin/dashboard", icon: LayoutDashboard },
  { label: "Establecimientos", to: "/superadmin/establecimientos", icon: Store },
  { label: "Cambiar contraseña", to: "/superadmin/cambiar-contrasena", icon: KeyRound },
];

export default function SuperAdminLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // El panel del Super Admin siempre usa la identidad base de AgoraOps
  useEffect(() => applyPalette(DEFAULT_PALETTE), []);
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="flex h-dvh overflow-hidden">
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`sidebar-super fixed inset-y-0 left-0 z-50 flex w-72 flex-col p-3 text-white transition-transform duration-200 md:static md:translate-x-0 md:shrink-0 ${
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      }`}>
        <div className="mb-4 flex items-center gap-3 px-1 pt-1">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/95 text-[hsl(228_28%_17%)] shadow-md">
            <ShieldCheck size={26} strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-tight text-white/70">Super Admin</p>
            <p className="truncate text-base font-bold leading-tight">
              {user?.fullName}
            </p>
          </div>
          <button onClick={() => setMobileOpen(false)} aria-label="Cerrar menú"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white transition hover:bg-white/15 md:hidden">
            <X size={24} strokeWidth={2.4} />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto pr-1">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-3 text-[16px] font-semibold transition ${
                  isActive
                    ? "bg-white/15 text-white"
                    : "text-white/80 hover:bg-white/10 hover:text-white"
                }`}>
              <item.icon size={21} className="shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/15 pt-2">
          <button onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-[16px] font-semibold text-white/80 transition hover:bg-white/10 hover:text-white">
            <LogOut size={21} className="shrink-0" />
            Cerrar sesión
          </button>
          <p className="mt-1 px-3 pb-1 text-center text-sm font-extrabold tracking-wide text-white/80">
            AgoraOps · Multicomercio
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior solo móvil */}
        <header className="glass flex items-center gap-3 rounded-none border-x-0 border-t-0 px-4 py-3 md:hidden">
          <button onClick={() => setMobileOpen(true)} aria-label="Abrir menú"
            className="grid h-9 w-9 place-items-center rounded-lg text-text-secondary transition hover:bg-bg-tertiary">
            <Menu size={22} />
          </button>
          <span className="font-bold">Panel Super Admin</span>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
