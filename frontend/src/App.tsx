import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { ToastProvider } from "./components/ui";
import Layout from "./components/Layout";
import Login from "./pages/Login";
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
import {
  MenuPage, QrPage, ClientesPage, DomiciliosPage,
} from "./pages/Restaurante";
import { ReservacionesPage } from "./pages/Reservaciones";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="grid min-h-[100dvh] place-items-center text-text-muted">
        Cargando…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
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
