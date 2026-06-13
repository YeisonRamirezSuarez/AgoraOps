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
    accent: "hsl(197 92% 55%)",
    accentHover: "hsl(200 90% 47%)",
    cyan: "hsl(199 95% 45%)",
    sidebar: ["hsl(195 95% 58%)", "hsl(200 92% 50%)", "hsl(208 88% 44%)", "hsl(214 85% 38%)"],
  },
  {
    key: "esmeralda",
    label: "Esmeralda",
    accent: "hsl(152 70% 42%)",
    accentHover: "hsl(155 75% 34%)",
    cyan: "hsl(160 84% 30%)",
    sidebar: ["hsl(150 70% 46%)", "hsl(155 72% 38%)", "hsl(160 75% 30%)", "hsl(165 78% 24%)"],
  },
  {
    key: "violeta",
    label: "Violeta",
    accent: "hsl(262 80% 60%)",
    accentHover: "hsl(265 75% 52%)",
    cyan: "hsl(270 80% 48%)",
    sidebar: ["hsl(258 82% 64%)", "hsl(262 78% 55%)", "hsl(266 75% 46%)", "hsl(270 72% 38%)"],
  },
  {
    key: "naranja",
    label: "Naranja Polaris",
    accent: "hsl(24 95% 53%)",
    accentHover: "hsl(20 90% 47%)",
    cyan: "hsl(16 90% 45%)",
    sidebar: ["hsl(32 95% 55%)", "hsl(24 92% 50%)", "hsl(14 88% 46%)", "hsl(4 80% 42%)"],
  },
  {
    key: "rosa",
    label: "Rosa",
    accent: "hsl(340 80% 55%)",
    accentHover: "hsl(345 78% 47%)",
    cyan: "hsl(335 85% 45%)",
    sidebar: ["hsl(335 80% 60%)", "hsl(340 78% 52%)", "hsl(345 75% 44%)", "hsl(350 72% 36%)"],
  },
  {
    key: "ambar",
    label: "Dorado",
    accent: "hsl(38 95% 48%)",
    accentHover: "hsl(32 92% 42%)",
    cyan: "hsl(28 90% 40%)",
    sidebar: ["hsl(42 95% 52%)", "hsl(38 92% 46%)", "hsl(32 88% 40%)", "hsl(26 85% 34%)"],
  },
  {
    key: "grafito",
    label: "Grafito",
    accent: "hsl(215 28% 42%)",
    accentHover: "hsl(215 30% 34%)",
    cyan: "hsl(210 30% 36%)",
    sidebar: ["hsl(218 22% 38%)", "hsl(220 24% 30%)", "hsl(222 26% 23%)", "hsl(224 28% 16%)"],
  },
  {
    key: "rojo",
    label: "Rojo",
    accent: "hsl(0 78% 55%)",
    accentHover: "hsl(0 74% 47%)",
    cyan: "hsl(355 80% 45%)",
    sidebar: ["hsl(4 80% 58%)", "hsl(0 76% 50%)", "hsl(356 74% 42%)", "hsl(352 72% 34%)"],
  },
];

export const DEFAULT_PALETTE = "celeste";

export function getPalette(key: string | null | undefined): Palette {
  return PALETTES.find((p) => p.key === key) ?? PALETTES[0];
}

/** Aplica la paleta sobre los design tokens globales (o la restaura).
 * Además de los colores base deriva las variables de apoyo: brillos de
 * foco/botones (--accent-glow*) y tinte del fondo de página (--page-tint),
 * para que TODA la app cambie con la paleta del establecimiento. */
export function applyPalette(key: string | null | undefined): void {
  const p = getPalette(key);
  const s = document.documentElement.style;
  s.setProperty("--color-accent-blue", p.accent);
  s.setProperty("--color-accent-blue-hover", p.accentHover);
  s.setProperty("--color-accent-cyan", p.cyan);
  p.sidebar.forEach((c, i) => s.setProperty(`--sidebar-g${i + 1}`, c));

  // Derivadas: el acento viene como "hsl(H S% L%)" → versión con alpha
  s.setProperty("--accent-glow", p.accent.replace(")", " / 0.2)"));
  s.setProperty("--accent-glow-strong", p.accent.replace(")", " / 0.45)"));
  const hue = /hsl\((\d+)/.exec(p.accent)?.[1] ?? "199";
  s.setProperty("--page-tint", `hsl(${hue} 80% 95%)`);
}
