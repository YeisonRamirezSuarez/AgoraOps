/**
 * Paletas de colores personalizables por establecimiento (Multicomercio).
 * El Super Admin elige la paleta al crear/configurar el tenant; la app la
 * aplica al iniciar sesión sobrescribiendo los design tokens de index.css
 * (Tailwind v4 referencia las variables CSS en runtime, por lo que basta
 * con setear las custom properties en :root).
 * Las claves deben coincidir con PALETTES en backend/routes/superadmin.ts.
 */

export interface Palette {
  key: string;
  label: string;
  /** --color-accent-blue (acento principal: botones, links, activos) */
  accent: string;
  /** --color-accent-blue-hover */
  accentHover: string;
  /** --color-accent-cyan (precios y totales) */
  cyan: string;
  /** Gradiente vertical del sidebar (4 paradas, de claro a oscuro) */
  sidebar: [string, string, string, string];
}

export const PALETTES: Palette[] = [
  {
    key: "celeste",
    label: "Celeste AgoraOps",
    accent: "hsl(197 92% 44%)",
    accentHover: "hsl(200 90% 37%)",
    cyan: "hsl(199 95% 45%)",
    sidebar: ["hsl(195 95% 58%)", "hsl(200 92% 50%)", "hsl(208 88% 44%)", "hsl(214 85% 38%)"],
  },
  {
    key: "esmeralda",
    label: "Esmeralda",
    accent: "hsl(152 70% 35%)",
    accentHover: "hsl(155 75% 29%)",
    cyan: "hsl(160 84% 30%)",
    sidebar: ["hsl(150 70% 46%)", "hsl(155 72% 38%)", "hsl(160 75% 30%)", "hsl(165 78% 24%)"],
  },
  {
    key: "violeta",
    label: "Violeta",
    accent: "hsl(262 78% 50%)",
    accentHover: "hsl(265 75% 43%)",
    cyan: "hsl(270 80% 48%)",
    sidebar: ["hsl(258 82% 64%)", "hsl(262 78% 55%)", "hsl(266 75% 46%)", "hsl(270 72% 38%)"],
  },
  {
    key: "naranja",
    label: "Naranja Polaris",
    accent: "hsl(24 92% 43%)",
    accentHover: "hsl(20 90% 38%)",
    cyan: "hsl(16 90% 45%)",
    sidebar: ["hsl(32 95% 55%)", "hsl(24 92% 50%)", "hsl(14 88% 46%)", "hsl(4 80% 42%)"],
  },
  {
    key: "rosa",
    label: "Rosa",
    accent: "hsl(340 78% 46%)",
    accentHover: "hsl(345 78% 41%)",
    cyan: "hsl(335 85% 45%)",
    sidebar: ["hsl(335 80% 60%)", "hsl(340 78% 52%)", "hsl(345 75% 44%)", "hsl(350 72% 36%)"],
  },
  {
    key: "ambar",
    label: "Dorado",
    accent: "hsl(38 95% 38%)",
    accentHover: "hsl(34 92% 33%)",
    cyan: "hsl(28 90% 40%)",
    sidebar: ["hsl(42 95% 52%)", "hsl(38 92% 46%)", "hsl(32 88% 40%)", "hsl(26 85% 34%)"],
  },
  {
    key: "grafito",
    label: "Grafito",
    accent: "hsl(215 28% 38%)",
    accentHover: "hsl(215 30% 30%)",
    cyan: "hsl(210 30% 36%)",
    sidebar: ["hsl(218 22% 38%)", "hsl(220 24% 30%)", "hsl(222 26% 23%)", "hsl(224 28% 16%)"],
  },
  {
    key: "rojo",
    label: "Rojo",
    accent: "hsl(0 75% 45%)",
    accentHover: "hsl(0 74% 40%)",
    cyan: "hsl(355 80% 45%)",
    sidebar: ["hsl(4 80% 58%)", "hsl(0 76% 50%)", "hsl(356 74% 42%)", "hsl(352 72% 34%)"],
  },
];

export const DEFAULT_PALETTE = "celeste";

export function getPalette(key: string | null | undefined): Palette {
  return PALETTES.find((p) => p.key === key) ?? PALETTES[0];
}

/* ─── Contraste (a11y): relleno de marca legible con texto blanco ───
   Los acentos de cada paleta ya vienen oscurecidos para que `text-accent-blue`
   e íconos sobre blanco mejoren. Para los BOTONES (texto blanco sobre relleno)
   se necesita algo aún más oscuro: se baja la luminosidad HSL hasta cruzar el
   ratio WCAG objetivo, válido para cualquier paleta (incluidas las cálidas). */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [255 * f(0), 255 * f(8), 255 * f(4)];
}
/** Ratio de contraste WCAG entre blanco y un color hsl(h s% l%). */
function whiteContrast(h: number, s: number, l: number): number {
  const lin = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hslToRgb(h, s, l);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return 1.05 / (lum + 0.05);
}
/** Convierte un "hsl(H S% L%)" a hex (#rrggbb); para metadatos que solo
 * aceptan hex de forma universal (p. ej. <meta name="theme-color">). */
function hslStringToHex(hsl: string): string | null {
  const m = /hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(hsl);
  if (!m) return null;
  const [r, g, b] = hslToRgb(+m[1], +m[2], +m[3]);
  const h = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Oscurece un "hsl(H S% L%)" hasta que el texto blanco encima alcance `target`. */
function strongFill(hsl: string, target: number): string {
  const m = /hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(hsl);
  if (!m) return hsl;
  const h = +m[1], s = +m[2];
  let l = +m[3];
  while (l > 12 && whiteContrast(h, s, l) < target) l -= 1;
  return `hsl(${h} ${s}% ${l}%)`;
}

/** Aplica la paleta sobre los design tokens globales (o la restaura).
 * Además de los colores base deriva las variables de apoyo: brillos de
 * foco/botones (--accent-glow*), tinte del fondo de página (--page-tint) y el
 * relleno fuerte de botones (--color-primary-strong*, AA con texto blanco),
 * para que TODA la app cambie con la paleta del establecimiento. */
export function applyPalette(key: string | null | undefined): void {
  const p = getPalette(key);
  const s = document.documentElement.style;
  s.setProperty("--color-accent-blue", p.accent);
  s.setProperty("--color-accent-blue-hover", p.accentHover);
  s.setProperty("--color-accent-cyan", p.cyan);
  p.sidebar.forEach((c, i) => s.setProperty(`--sidebar-g${i + 1}`, c));

  // Relleno de botón con texto blanco: AA-normal (≥4.6) y un tono más para el
  // degradado. strongFill garantiza el contraste sea cual sea la paleta.
  s.setProperty("--color-primary-strong", strongFill(p.accent, 4.6));
  s.setProperty("--color-primary-strong-2", strongFill(p.accent, 6.5));

  // Derivadas: el acento viene como "hsl(H S% L%)" → versión con alpha
  s.setProperty("--accent-glow", p.accent.replace(")", " / 0.2)"));
  s.setProperty("--accent-glow-strong", p.accent.replace(")", " / 0.45)"));
  const hue = /hsl\((\d+)/.exec(p.accent)?.[1] ?? "199";
  s.setProperty("--page-tint", `hsl(${hue} 80% 95%)`);

  // Barra de estado del PWA (Android/standalone) acorde a la paleta del tenant:
  // el <meta name="theme-color"> debe seguir el acento del establecimiento, no
  // un color fijo. (El theme_color del manifest es estático por build; este meta
  // lo ajusta en runtime al iniciar sesión / cargar el branding.)
  const themeHex = hslStringToHex(p.accent);
  if (themeHex) {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", themeHex);
  }
}
