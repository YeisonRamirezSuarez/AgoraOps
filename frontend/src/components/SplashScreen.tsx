/**
 * Pantalla de arranque (splash) animada: la marca AgoraOps se "arma"
 * (LogoMark animated) sobre el fondo claro de la app, con el wordmark
 * entrando y unos puntos de carga. Se usa como loader de los guards de
 * sesión (App.tsx), así que es lo primero que ve el usuario al abrir la
 * PWA en móvil — un arranque tipo app nativa. Respeta prefers-reduced-motion
 * (las animaciones se desactivan vía index.css).
 */
import { LogoMark } from "./Logo";

export default function SplashScreen() {
  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center p-6"
      style={{
        background:
          "radial-gradient(ellipse at bottom, var(--page-tint), hsl(220 20% 96%) 65%)",
      }}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center">
        <LogoMark tone="color" animated className="h-24 w-auto drop-shadow-sm" />
        <h1 className="word-reveal mt-4 text-3xl font-extrabold tracking-[-0.01em]">
          <span className="text-[#22303f]">Agora</span>
          <span className="text-[#099dd7]">Ops</span>
        </h1>
        <div className="splash-dots mt-5 flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="splash-dot h-2 w-2 rounded-full bg-accent-blue"
              style={{ animationDelay: `${i * 0.16}s` }}
            />
          ))}
        </div>
        <span className="sr-only">Cargando</span>
      </div>
    </div>
  );
}
