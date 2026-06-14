import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { ToastProvider } from "./components/ui";
import SplashScreen from "./components/SplashScreen";
import Layout from "./components/Layout";
import SuperAdminLayout from "./components/SuperAdminLayout";
import SuperDashboard from "./pages/superadmin/SuperDashboard";
import Establecimientos from "./pages/superadmin/Establecimientos";
import EstablecimientoNuevo from "./pages/superadmin/EstablecimientoNuevo";
import EstablecimientoDetalle from "./pages/superadmin/EstablecimientoDetalle";
import Login from "./pages/Login";
import Recuperar from "./pages/Recuperar";
import RestablecerContrasena from "./pages/RestablecerContrasena";
import Dashboard from "./pages/Dashboard";
import Mesas from "./pages/Mesas";
import Orden from "./pages/Orden";
import Pago from "./pages/Pago";
import Cocina from "./pages/Cocina";
import Cajas from "./pages/Cajas";
import Productos from "./pages/Productos";
import Inventario from "./pages/Inventario";
import Reportes from "./pages/Reportes";
import Configuracion from "./pages/Configuracion";
import Seguridad from "./pages/Seguridad";
import Notificaciones from "./pages/Notificaciones";
import CambiarContrasena from "./pages/CambiarContrasena";
import { MenuPage, QrPage } from "./pages/Restaurante";
import MenuPublico from "./pages/MenuPublico";
import { ClientesPage } from "./pages/Clientes";
import { DomiciliosPage } from "./pages/Domicilios";
import { ReservacionesPage } from "./pages/Reservaciones";

function Loading() {
  return <SplashScreen />;
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  // Clave temporal: no se puede usar nada hasta cambiarla (sin menús)
  if (user.mustChangePassword) return <Navigate to="/primer-ingreso" replace />;
  // El Super Admin no opera el POS (no tiene tenant): su panel es /superadmin
  if (user.isSuperAdmin) return <Navigate to="/superadmin" replace />;
  return <>{children}</>;
}

function SuperProtected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/primer-ingreso" replace />;
  if (!user.isSuperAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/** Primer ingreso: solo el cambio de contraseña, a pantalla completa. */
function FirstLoginGate() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword) {
    return <Navigate to={user.isSuperAdmin ? "/superadmin" : "/dashboard"} replace />;
  }
  return <CambiarContrasena forzado />;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/recuperar" element={<Recuperar />} />
            <Route path="/restablecer" element={<RestablecerContrasena />} />
            <Route path="/primer-ingreso" element={<FirstLoginGate />} />
            {/* Menú público (§1.6.2): sin sesión, lo abre el QR de las mesas. */}
            <Route path="/m/:tenantId" element={<MenuPublico />} />
            <Route
              path="/superadmin"
              element={
                <SuperProtected>
                  <SuperAdminLayout />
                </SuperProtected>
              }
            >
              <Route index element={<Navigate to="/superadmin/dashboard" replace />} />
              <Route path="dashboard" element={<SuperDashboard />} />
              <Route path="establecimientos" element={<Establecimientos />} />
              <Route path="establecimientos/nuevo" element={<EstablecimientoNuevo />} />
              <Route path="establecimientos/:id" element={<EstablecimientoDetalle />} />
              <Route path="cambiar-contrasena" element={<CambiarContrasena />} />
            </Route>
            <Route
              path="/"
              element={
                <Protected>
                  <Layout />
                </Protected>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="restaurante/menu" element={<MenuPage />} />
              <Route path="restaurante/qr" element={<QrPage />} />
              <Route path="restaurante/reservaciones" element={<ReservacionesPage />} />
              <Route path="restaurante/clientes" element={<ClientesPage />} />
              <Route path="restaurante/domicilios" element={<DomiciliosPage />} />
              <Route path="mesas" element={<Mesas />} />
              <Route path="mesas/:orderId" element={<Orden />} />
              <Route path="mesas/:orderId/pago" element={<Pago />} />
              <Route path="cocina" element={<Cocina />} />
              <Route path="productos" element={<Productos />} />
              <Route path="inventario" element={<Inventario />} />
              <Route path="cajas" element={<Cajas />} />
              <Route path="reportes" element={<Reportes />} />
              <Route path="configuracion" element={<Configuracion />} />
              <Route path="seguridad" element={<Seguridad />} />
              <Route path="notificaciones" element={<Notificaciones />} />
              <Route path="cambiar-contrasena" element={<CambiarContrasena />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}
