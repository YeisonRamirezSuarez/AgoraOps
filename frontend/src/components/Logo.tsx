/**
 * Marca AgoraOps — "A + nodo + flecha": una A con volumen (degradado celeste),
 * un nodo concéntrico en el vértice (punto de datos / antena) y una flecha
 * ascendente integrada que cruza la A y apunta arriba-derecha (crecimiento).
 *
 * Dos tonos:
 *  - "color": degradado celeste, para fondos claros (login, panel claro).
 *  - "mono":  un solo color vía `currentColor`, para el menú de cada
 *    establecimiento (la barra usa la paleta del tenant, así que el blanco
 *    se ve intencional sobre cualquier paleta). Hereda el color del texto.
 *
 * El `useId()` genera IDs únicos por instancia para que varios logos en la
 * misma página no compartan (ni pisen) sus <linearGradient>.
 */
import { useId } from "react";

type Tone = "color" | "mono";

export function LogoMark({
  tone = "color",
  className,
  title = "AgoraOps",
  animated = false,
}: {
  tone?: Tone;
  className?: string;
  title?: string;
  /** Intro "armándose": la A sube, la flecha se dibuja y el nodo aparece.
   *  Las animaciones viven en index.css bajo `.logo-animate` (respeta
   *  prefers-reduced-motion). */
  animated?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const mono = tone === "mono";
  const leg = mono ? "currentColor" : `url(#leg-${uid})`;
  const arrow = mono ? "currentColor" : `url(#arr-${uid})`;
  const dot = mono ? "currentColor" : "#0aa7f5";

  return (
    <svg
      viewBox="0 0 120 128"
      className={`${animated ? "logo-animate " : ""}${className ?? ""}`}
      role="img"
      aria-label={title}
      fill="none"
    >
      {!mono && (
        <defs>
          <linearGradient id={`leg-${uid}`} x1="0" y1="0" x2="0.15" y2="1">
            <stop offset="0" stopColor="#4fd2fb" />
            <stop offset="0.55" stopColor="#0c9ce8" />
            <stop offset="1" stopColor="#0f56b3" />
          </linearGradient>
          <linearGradient id={`arr-${uid}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#34c6fb" />
            <stop offset="1" stopColor="#abe8ff" />
          </linearGradient>
        </defs>
      )}
      {/* Piernas de la A (Λ con grosor): vértice arriba, base abierta */}
      <path className="la-leg" d="M60 30 L106 114 L82 114 L60 66 L38 114 L14 114 Z" fill={leg} />
      {/* Brillo sutil para dar volumen (solo versión a color) */}
      {!mono && (
        <path
          className="la-leg"
          d="M60 30 L70 48 L86 114 L82 114 L60 66 Z"
          fill="#ffffff"
          opacity="0.14"
        />
      )}
      {/* Flecha ascendente integrada (travesaño dinámico) */}
      <path
        className="la-arrow"
        pathLength={100}
        d="M22 100 C 46 92 54 78 66 64 C 78 50 86 44 96 35"
        stroke={arrow}
        strokeWidth="13"
        strokeLinecap="round"
      />
      {/* Punta de la flecha, alineada a la tangente del trazo */}
      <path className="la-head" d="M108.6 23.6 L104.7 44.7 L87.3 25.3 Z" fill={arrow} />
      {/* Nodo concéntrico en el vértice */}
      <circle className="la-node" cx="60" cy="26" r="13" fill="none" stroke={arrow} strokeWidth="5" />
      <circle className="la-node" cx="60" cy="26" r="5.5" fill={dot} />
    </svg>
  );
}

/**
 * Lockup horizontal: marca + palabra "AgoraOps". En "color" el texto va en
 * carbón/azul (fondos claros); en "mono" todo hereda `currentColor` (menú).
 * `tagline` opcional para el eslogan bajo la palabra (login).
 */
export function LogoLockup({
  tone = "color",
  tagline = false,
  markClassName = "h-10 w-auto",
  className,
}: {
  tone?: Tone;
  tagline?: boolean;
  markClassName?: string;
  className?: string;
}) {
  const mono = tone === "mono";
  return (
    <div className={`flex items-center gap-3 ${className ?? ""}`}>
      <LogoMark tone={tone} className={markClassName} />
      <div className="leading-none">
        <div className="text-2xl font-extrabold tracking-tight">
          {mono ? (
            <span>AgoraOps</span>
          ) : (
            <>
              <span className="text-[#22303f]">Agora</span>
              <span className="text-[#099dd7]">Ops</span>
            </>
          )}
        </div>
        {tagline && (
          <div
            className={`mt-1 text-[10px] font-bold uppercase tracking-[0.2em] ${
              mono ? "opacity-80" : "text-text-muted"
            }`}
          >
            Soluciones de gestión integral
          </div>
        )}
      </div>
    </div>
  );
}
