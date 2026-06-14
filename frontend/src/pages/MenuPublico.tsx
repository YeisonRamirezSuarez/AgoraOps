/**
 * Menú público (§1.6.2) — página que ve el cliente al escanear el QR de la
 * mesa. NO requiere sesión. Ruta estable `/m/:tenantId?c=<code>`: el QR
 * impreso nunca cambia; el menú del día se resuelve en el servidor.
 *
 * Estructura inspirada en cartas digitales tipo Cluvi:
 *   Home → tarjetas de categorías + sección "Recomendados".
 *   Tocar una categoría → lista de productos de esa categoría.
 *   Tocar un producto → detalle.
 * Es solo de consulta (no permite pedir). Responsive móvil / tablet / web.
 */
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { IconType } from "react-icons";
import {
  FaBurger, FaHotdog, FaPizzaSlice, FaDrumstickBite, FaBowlFood, FaUtensils,
  FaMartiniGlassCitrus, FaBeerMugEmpty, FaWineGlass, FaMugHot, FaGlassWater,
  FaBottleWater, FaIceCream, FaFish, FaShrimp, FaBowlRice, FaEgg, FaCheese,
  FaCookie, FaBacon, FaLeaf, FaPepperHot, FaCakeCandles,
  FaInstagram, FaFacebookF, FaWhatsapp,
} from "react-icons/fa6";
import {
  GiFrenchFries, GiSteak, GiSausage, GiNoodles, GiTacos, GiCupcake, GiSodaCan, GiBanana,
} from "react-icons/gi";
import { getPalette } from "../shared/constants/palettes";

const API_URL = import.meta.env.VITE_API_URL ?? "";

interface Producto {
  id: number;
  name: string;
  desc: string | null;
  price: string;
  image_url: string | null;
  category_id: number;
  category_name: string;
}
interface Categoria {
  id: number;
  name: string;
  products: Producto[];
}
interface Business {
  name: string | null;
  logo_url: string | null;
  theme_palette: string | null;
  address: string | null;
  phone: string | null;
  instagram: string | null;
  facebook: string | null;
  currency_symbol: string;
  currency_decimals: number;
}
interface MenuData {
  business: Business;
  categories: Categoria[];
  recommended: Producto[];
}

/* ───────── Estilo "carta": tarjetas pastel teñidas con la paleta del tenant ─────────
 * Cada establecimiento tiene su paleta (business.theme_palette). El menú NO
 * debe quedar fijo en rojo: derivamos todo el color del acento del tenant —
 * el chrome del menú (header, hero, títulos, precios) y el tinte pastel de las
 * tarjetas. Cada tarjeta lleva además un icono acorde a la categoría. */

function catHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0;
  return h;
}
function normalize(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

// Nombre de categoría → icono (line/glyph icons de react-icons). Orden = de lo
// más específico a lo más genérico; el primero que casa gana.
const ICON_RULES: [RegExp, IconType][] = [
  [/coctel|cocktail|trago|licor|mojito|margarita|daiquiri/, FaMartiniGlassCitrus],
  [/chicha|cerveza|beer|michelada|guarapo/, FaBeerMugEmpty],
  [/vino|wine|sangria/, FaWineGlass],
  [/cafe|tinto|capuchino|capuccino|expreso|latte/, FaMugHot],
  [/gaseosa|refresco|soda|cola/, GiSodaCan],
  [/jugo|limonada|malteada|batido|smoothie|granizado|frappe/, FaGlassWater],
  [/agua|bebida|botella/, FaBottleWater],
  [/hamburg|burger/, FaBurger],
  [/perro|hotdog|hot dog|salchipa|salchichor/, FaHotdog],
  [/salchich|chorizo|sausage/, GiSausage],
  [/papa|fritas|french/, GiFrenchFries],
  [/alit|pollo|broaster|pechuga|nugget|apan/, FaDrumstickBite],
  [/pizza/, FaPizzaSlice],
  [/taco|burrito|nacho|quesadill|mexic/, GiTacos],
  [/pasta|spaguet|spaghet|fideo|lasa|raviol|noodle/, GiNoodles],
  [/tocin|bacon/, FaBacon],
  [/marisco|camaron|langost/, FaShrimp],
  [/pescado|mojarra|trucha|tilapia|ceviche/, FaFish],
  [/asad|parrilla|teadero|carne|res|lomo|churrasco|punta|baby|costill|chuleta|cerdo/, GiSteak],
  [/arroz|paella|risotto/, FaBowlRice],
  [/madur|platan|patacon|banano|banana/, GiBanana],
  [/ensalad|verdura|vegetal|veggie|saludable/, FaLeaf],
  [/picant|aji|salsa/, FaPepperHot],
  [/huevo|desayuno|omelet|calentado/, FaEgg],
  [/queso/, FaCheese],
  [/cupcake|ponque|muffin/, GiCupcake],
  [/cumple|celebra/, FaCakeCandles],
  [/galleta|cookie/, FaCookie],
  [/postre|dulce|torta|pastel|brownie|cheesecake|helado|gelato/, FaIceCream],
  [/sopa|caldo|sancocho|crema|ajiaco|mondongo|bowl/, FaBowlFood],
  [/entrada|aperitiv|picad|pasaboc|antojo|compartir|combo|menu|especial/, FaBowlFood],
];
function catIcon(name: string): IconType {
  const n = normalize(name);
  for (const [re, ic] of ICON_RULES) if (re.test(n)) return ic;
  return FaUtensils; // genérico (cubiertos) para "adicionales", "otros", etc.
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
function parseHsl(hsl: string): { h: number; s: number; l: number } {
  const m = /hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(hsl);
  return m ? { h: +m[1], s: +m[2], l: +m[3] } : { h: 0, s: 72, l: 45 };
}

interface MenuTheme {
  vars: CSSProperties;
  cardBg: (name: string) => string;
}
/** Deriva TODO el color del menú del acento del tenant. `--mp-red*` retiñen el
 * header/hero/títulos/precios; las tarjetas usan el color del tenant DIRECTO
 * (gradiente saturado acento→oscuro) con una variación mínima de luminosidad por
 * tarjeta para que no se vean idénticas. Texto e icono van en blanco. */
function buildTheme(paletteKey: string | null | undefined): MenuTheme {
  const { h, s, l } = parseHsl(getPalette(paletteKey).accent);
  const sChrome = clamp(s, 45, 85);
  const sCard = clamp(s, 55, 92);
  const vars = {
    "--mp-red": `hsl(${h} ${sChrome}% ${clamp(l, 30, 46)}%)`,
    "--mp-red-dark": `hsl(${h} ${sChrome}% ${clamp(l - 16, 20, 34)}%)`,
  } as CSSProperties;
  const cardBg = (name: string) => {
    const offs = [0, -3, 3, -2]; // leve variación por tarjeta (misma marca)
    const top = clamp(l + offs[catHash(name) % offs.length], 34, 50);
    return `linear-gradient(150deg,hsl(${h} ${sCard}% ${top}%),hsl(${h} ${sCard}% ${clamp(top - 15, 18, 40)}%))`;
  };
  return { vars, cardBg };
}

/* ───────── Redes del footer: icono de la app + enlace directo al perfil ─────────
 * El valor guardado puede venir como handle ("ryjburguers"), "@handle" o URL
 * completa; se normaliza a una URL y a una etiqueta @usuario legible. */
function socialUrl(value: string, base: string): string {
  const s = value.trim();
  if (/^https?:\/\//i.test(s)) return s;
  return `${base}${s.replace(/^@/, "").replace(/\/+$/, "")}`;
}
const igUrl = (v: string) => socialUrl(v, "https://instagram.com/");
const fbUrl = (v: string) => socialUrl(v, "https://facebook.com/");
function handleFrom(value: string, domain: RegExp, prefix: string, fallback: string): string {
  const s = value.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(s)) {
    const m = s.match(domain);
    return m && m[1] && m[1].toLowerCase() !== "profile.php" ? `${prefix}${m[1]}` : fallback;
  }
  return `${prefix}${s.replace(/^@/, "")}`;
}
const igHandle = (v: string) => handleFrom(v, /instagram\.com\/([^/?#]+)/i, "@", "Instagram");
const fbHandle = (v: string) => handleFrom(v, /facebook\.com\/([^/?#]+)/i, "", "Facebook");
function waUrl(phone: string): string {
  let d = phone.replace(/\D/g, "");
  if (d.length === 10) d = `57${d}`; // celular Colombia sin indicativo país
  return `https://wa.me/${d}`;
}

export default function MenuPublico() {
  const { tenantId } = useParams();
  const [params] = useSearchParams();
  const code = params.get("c") ?? "";
  const [data, setData] = useState<MenuData | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [catSel, setCatSel] = useState<number | null>(null); // null = home
  const [detalle, setDetalle] = useState<Producto | null>(null);
  // Fondo del recuadro del logo: "light" para logos oscuros, "dark" para claros.
  const [logoPlate, setLogoPlate] = useState<"light" | "dark">("light");

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/public/menu/${tenantId}?c=${encodeURIComponent(code)}`);
        if (!res.ok) throw new Error("404");
        const json = (await res.json()) as MenuData;
        if (!cancel) setData(json);
      } catch {
        if (!cancel) setError(true);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [tenantId, code]);

  const money = useMemo(() => {
    const b = data?.business;
    return (v: string | number) => {
      const n = typeof v === "string" ? Number(v) : v;
      const dec = b?.currency_decimals ?? 0;
      return `${b?.currency_symbol ?? "$"}${n.toLocaleString("es-CO", {
        minimumFractionDigits: dec,
        maximumFractionDigits: dec,
      })}`;
    };
  }, [data]);

  // Tema derivado de la paleta del tenant (rige chrome del menú + tarjetas).
  const theme = useMemo(() => buildTheme(data?.business?.theme_palette), [data?.business?.theme_palette]);

  // El fondo del documento (visible en overscroll) también sigue al tenant.
  useEffect(() => {
    const dark = (theme.vars as Record<string, string>)["--mp-red-dark"];
    const root = document.documentElement;
    const body = document.body;
    const prevR = root.style.background;
    const prevB = body.style.background;
    root.style.setProperty("background", dark, "important");
    body.style.setProperty("background", dark, "important");
    return () => {
      root.style.background = prevR;
      body.style.background = prevB;
    };
  }, [theme]);

  // Recuadro del logo adaptativo: lee la luminancia media del logo (ponderada
  // por alpha) y, si es claro, usa fondo oscuro; si es oscuro, fondo claro. Así
  // cualquier logo —incluso PNG transparente— contrasta con el recuadro. Si el
  // storage no permite leer los píxeles (CORS) se conserva el fondo claro.
  const logoUrl = data?.business?.logo_url ?? null;
  useEffect(() => {
    setLogoPlate("light");
    if (!logoUrl) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const cv = document.createElement("canvas");
        cv.width = 32;
        cv.height = 32;
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 32, 32);
        const px = ctx.getImageData(0, 0, 32, 32).data;
        const total = px.length / 4;
        let lumSum = 0;
        let opaque = 0;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] < 128) continue; // solo píxeles opacos = marca real del logo
          opaque++;
          lumSum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
        }
        const transparentRatio = 1 - opaque / total;
        // Recuadro OSCURO solo si el logo es recortado (mayormente transparente) y
        // sus marcas son claras. Si trae su propio fondo (p.ej. blanco) la
        // transparencia es baja → se queda claro y nunca sale un marco negro.
        if (transparentRatio > 0.2 && opaque > 0 && lumSum / opaque > 0.6) {
          setLogoPlate("dark");
        }
      } catch {
        /* canvas "tainted" por CORS: se queda en claro */
      }
    };
    img.src = logoUrl;
    return () => {
      cancelled = true;
    };
  }, [logoUrl]);

  function abrirCategoria(id: number) {
    setCatSel(id);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  if (loading) {
    return (
      <div className="mp-root mp-center" style={theme.vars}>
        <style>{CSS}</style>
        <div className="mp-spinner" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mp-root mp-center" style={theme.vars}>
        <style>{CSS}</style>
        <div className="mp-404">
          <h1>Menú no disponible</h1>
          <p>El enlace no es válido o el establecimiento no tiene menú publicado.</p>
        </div>
      </div>
    );
  }

  const { business, categories, recommended } = data;
  const vacio = categories.length === 0;
  const categoriaActual = categories.find((c) => c.id === catSel) ?? null;

  function ProductCard({ p }: { p: Producto }) {
    return (
      <article className="mp-card" onClick={() => setDetalle(p)}>
        <div className="mp-thumb">
          {p.image_url ? (
            <img src={p.image_url} alt={p.name} loading="lazy" />
          ) : (
            <div className="mp-thumb-ph">{p.category_name.charAt(0)}</div>
          )}
        </div>
        <div className="mp-card-body">
          <h3 className="mp-card-name">{p.name}</h3>
          {p.desc && <p className="mp-card-desc">{p.desc}</p>}
          <div className="mp-card-foot">
            <span className="mp-price">{money(p.price)}</span>
            <span className="mp-ver">VER</span>
          </div>
        </div>
      </article>
    );
  }

  return (
    <div className="mp-root" style={theme.vars}>
      <style>{CSS}</style>

      {/* Header grande y CONSTANTE en todas las vistas: logo + nombre juntos.
          Dentro de una categoría solo se añade la flecha ‹ para volver; el
          branding nunca se encoge. */}
      <header className="mp-hero">
        {categoriaActual && (
          <button className="mp-back" onClick={() => setCatSel(null)} aria-label="Volver">
            ‹
          </button>
        )}
        <div className="mp-brand">
          {business.logo_url && (
            <span className={`mp-logo-chip${logoPlate === "dark" ? " is-dark" : ""}`}>
              <img src={business.logo_url} alt={business.name ?? "Logo"} className="mp-logo" />
            </span>
          )}
          <span className="mp-brand-name">{business.name ?? "Nuestro Menú"}</span>
        </div>
        <p className="mp-hero-sub">Carta digital</p>
      </header>

      {/* ───────── Vista categoría ───────── */}
      {categoriaActual ? (
        <main className="mp-main">
          <h1 className="mp-cat-title mp-cat-title-lg">{categoriaActual.name}</h1>
          <div className="mp-grid">
            {categoriaActual.products.map((p) => (
              <ProductCard key={p.id} p={p} />
            ))}
          </div>
        </main>
      ) : (
        /* ───────── Home ───────── */
        <main className="mp-main">
            {vacio && (
              <div className="mp-empty">
                <p>El menú de hoy aún no está disponible.</p>
              </div>
            )}

            {!vacio && (
              <>
                <h2 className="mp-section-title">Menú</h2>
                <div className="mp-cats">
                  {categories.map((c, i) => {
                    const Icon = catIcon(c.name);
                    return (
                      <button
                        key={c.id}
                        className="mp-cat-card"
                        style={{ background: theme.cardBg(c.name) }}
                        onClick={() => abrirCategoria(c.id)}
                      >
                        <span className="mp-cat-index" aria-hidden="true">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="mp-cat-card-name">{c.name}</span>
                        <Icon className="mp-cat-ic" aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>

                {recommended.length > 0 && (
                  <>
                    <h2 className="mp-section-title">Recomendados</h2>
                    <div className="mp-grid">
                      {recommended.map((p) => (
                        <ProductCard key={`r-${p.id}`} p={p} />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
        </main>
      )}

      <footer className="mp-footer">
        {business.name && <p className="mp-foot-name">{business.name}</p>}
        {business.address && <p>{business.address}</p>}
        {(business.instagram || business.facebook || business.phone) && (
          <div className="mp-socials">
            {business.instagram && (
              <a className="mp-social" href={igUrl(business.instagram)} target="_blank" rel="noopener noreferrer">
                <FaInstagram className="mp-social-ic" aria-hidden="true" />
                <span>{igHandle(business.instagram)}</span>
              </a>
            )}
            {business.facebook && (
              <a className="mp-social" href={fbUrl(business.facebook)} target="_blank" rel="noopener noreferrer">
                <FaFacebookF className="mp-social-ic" aria-hidden="true" />
                <span>{fbHandle(business.facebook)}</span>
              </a>
            )}
            {business.phone && (
              <a className="mp-social" href={waUrl(business.phone)} target="_blank" rel="noopener noreferrer">
                <FaWhatsapp className="mp-social-ic" aria-hidden="true" />
                <span>{business.phone}</span>
              </a>
            )}
          </div>
        )}
        <p className="mp-foot-by">Carta digital · AgoraOps</p>
      </footer>

      {detalle && (
        <div className="mp-modal" onClick={() => setDetalle(null)}>
          <div className="mp-modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="mp-modal-x" onClick={() => setDetalle(null)} aria-label="Cerrar">
              ×
            </button>
            <div className="mp-modal-img">
              {detalle.image_url ? (
                <img src={detalle.image_url} alt={detalle.name} />
              ) : (
                <div className="mp-modal-ph" />
              )}
            </div>
            <div className="mp-modal-body">
              <h3>{detalle.name}</h3>
              {detalle.desc && <p className="mp-modal-desc">{detalle.desc}</p>}
              <p className="mp-modal-price">{money(detalle.price)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CSS = `
body, #root {
  background: #7d0018 !important;
}
/* El shell global de la app bloquea el scroll del documento
   (html,body{overflow:hidden}). La página pública vive fuera de ese shell,
   así que es su propio contenedor scrolleable a pantalla completa. */
.mp-root{--mp-red:#ad0021;--mp-red-dark:#7d0018;--mp-cream:#f6f1e7;--mp-ink:#231b18;
  height:100vh;height:100dvh;overflow-y:auto;-webkit-overflow-scrolling:touch;
  display:flex;flex-direction:column;
  background:var(--mp-cream);color:var(--mp-ink);
  font-family:Georgia,"Times New Roman",serif;-webkit-font-smoothing:antialiased;}
.mp-center{display:grid;place-items:center;height:100vh;height:100dvh;}
.mp-spinner{width:42px;height:42px;border:4px solid #e6dcc8;border-top-color:var(--mp-red);
  border-radius:50%;animation:mp-spin .8s linear infinite;}
@keyframes mp-spin{to{transform:rotate(360deg)}}
.mp-404,.mp-empty{text-align:center;padding:48px 24px;color:#6b5d52;}
.mp-404 h1{color:var(--mp-red);font-size:24px;margin:0 0 8px;}

/* Header único, grande y de tamaño CONSTANTE en home y dentro de categoría:
   logo + nombre juntos. La flecha de volver aparece solo dentro de categoría
   sin alterar el alto del header. */
.mp-hero{position:relative;background:linear-gradient(135deg,var(--mp-red),var(--mp-red-dark));
  color:#fff;text-align:center;padding:30px 60px 26px;box-shadow:0 2px 12px rgba(0,0,0,.18);}
.mp-back{position:absolute;left:14px;top:50%;transform:translateY(-50%);
  width:42px;height:42px;border:none;background:rgba(255,255,255,.16);color:#fff;
  border-radius:50%;font-size:28px;line-height:1;cursor:pointer;
  display:grid;place-items:center;transition:background .15s;}
@media(hover:hover){.mp-back:hover{background:rgba(255,255,255,.3);}}
.mp-brand{display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;}
/* Recuadro adaptativo detrás del logo: garantiza que cualquier logo (incl. PNG
   transparente) contraste con el color de marca del header. El fondo (claro u
   oscuro) lo elige JS según la luminancia del logo (.is-dark para logos claros). */
.mp-logo-chip{display:inline-flex;align-items:center;justify-content:center;
  background:#fff;padding:7px 13px;border-radius:12px;box-shadow:0 3px 10px rgba(0,0,0,.22);}
.mp-logo-chip.is-dark{background:#241c1a;box-shadow:0 3px 10px rgba(0,0,0,.32);
  border:1px solid rgba(255,255,255,.16);}
.mp-logo{height:clamp(44px,10vw,58px);width:auto;max-width:160px;object-fit:contain;display:block;}
.mp-brand-name{margin:0;font-size:clamp(23px,5.2vw,38px);font-weight:800;letter-spacing:.5px;
  text-shadow:0 2px 6px rgba(0,0,0,.28);line-height:1.05;}
.mp-hero-sub{margin:8px 0 0;opacity:.9;font-style:italic;font-size:15px;}

.mp-main{max-width:1080px;margin:0 auto;padding:8px 16px 28px;width:100%;box-sizing:border-box;}
.mp-section-title{color:var(--mp-red);font-size:clamp(20px,4vw,26px);font-weight:800;
  margin:24px 0 14px;text-transform:uppercase;letter-spacing:1px;text-align:center;}
.mp-section-title::after{content:"";display:block;width:54px;height:3px;
  background:var(--mp-red);margin:8px auto 0;border-radius:2px;}

/* Tarjetas de categoría (grid responsive) */
.mp-cats{display:grid;gap:12px;grid-template-columns:repeat(2,1fr);}
@media(min-width:600px){.mp-cats{grid-template-columns:repeat(3,1fr);}}
@media(min-width:900px){.mp-cats{grid-template-columns:repeat(4,1fr);}}
/* Tarjetas con el color del tenant DIRECTO (fondo via inline style). Texto en
   blanco, marco fino interior e icono grande tipo watermark en la esquina
   inferior derecha (efecto elegante). */
.mp-cat-card{position:relative;aspect-ratio:16/10;border:none;border-radius:16px;
  overflow:hidden;cursor:pointer;isolation:isolate;
  background:var(--mp-red);box-shadow:0 4px 14px rgba(20,10,12,.22);
  display:flex;flex-direction:column;align-items:flex-start;justify-content:center;
  padding:14px 16px;font-family:inherit;transition:transform .16s ease,box-shadow .16s ease;}
/* Marco fino interior — toque elegante */
.mp-cat-card::before{content:"";position:absolute;inset:8px;pointer-events:none;
  border:1px solid rgba(255,255,255,.18);border-radius:10px;
  transition:inset .16s ease,border-color .16s ease;}
.mp-cat-card:active{transform:scale(.98);}
@media(hover:hover){.mp-cat-card:hover{transform:translateY(-3px);box-shadow:0 12px 24px rgba(20,10,12,.3);}
  .mp-cat-card:hover::before{inset:6px;border-color:rgba(255,255,255,.42);}
  .mp-cat-card:hover .mp-cat-ic{transform:rotate(-6deg) scale(1.07);opacity:.26;}}
/* Número de índice (arriba-izquierda) */
.mp-cat-index{position:relative;z-index:1;color:rgba(255,255,255,.6);
  font-size:12px;font-weight:700;letter-spacing:1.5px;font-variant-numeric:tabular-nums;}
/* Nombre — blanco, legible sobre el color de marca */
.mp-cat-card-name{position:relative;z-index:1;margin-top:6px;max-width:76%;color:#fff;
  font-size:clamp(15px,3.4vw,20px);font-weight:800;text-transform:uppercase;
  letter-spacing:.6px;line-height:1.16;text-shadow:0 1px 5px rgba(0,0,0,.3);}
/* Icono watermark — esquina inferior derecha, sangra fuera del borde */
.mp-cat-ic{position:absolute;right:-10px;bottom:-12px;z-index:0;color:#fff;opacity:.17;
  font-size:clamp(60px,15vw,92px);transform:rotate(-8deg);pointer-events:none;
  filter:drop-shadow(0 2px 4px rgba(0,0,0,.22));
  transition:transform .2s ease,opacity .2s ease;}

/* Título de categoría (vista detalle) */
.mp-cat-title{color:var(--mp-red);font-weight:800;text-transform:uppercase;letter-spacing:1px;
  text-align:center;}
.mp-cat-title-lg{font-size:clamp(24px,5vw,32px);margin:18px 0 16px;}
.mp-cat-title-lg::after{content:"";display:block;width:60px;height:3px;
  background:var(--mp-red);margin:10px auto 0;border-radius:2px;}

/* Tarjetas de producto (grid responsive) */
.mp-grid{display:grid;gap:12px;grid-template-columns:1fr;}
@media(min-width:560px){.mp-grid{grid-template-columns:repeat(2,1fr);}}
@media(min-width:1000px){.mp-grid{grid-template-columns:repeat(3,1fr);}}
.mp-card{display:flex;gap:12px;background:#fff;border-radius:14px;padding:10px;
  box-shadow:0 1px 4px rgba(0,0,0,.08);cursor:pointer;transition:transform .12s,box-shadow .12s;
  border:1px solid #efe7d6;text-align:left;}
.mp-card:active{transform:scale(.99);}
@media(hover:hover){.mp-card:hover{box-shadow:0 6px 16px rgba(0,0,0,.12);transform:translateY(-2px);}}
.mp-thumb{flex:0 0 90px;width:90px;height:90px;border-radius:10px;overflow:hidden;background:#f0e8d8;}
.mp-thumb img{width:100%;height:100%;object-fit:cover;}
.mp-thumb-ph{width:100%;height:100%;display:grid;place-items:center;
  font-size:34px;font-weight:800;color:#cdbfa3;background:#f0e8d8;}
.mp-card-body{flex:1;min-width:0;display:flex;flex-direction:column;}
.mp-card-name{margin:0 0 3px;font-size:16px;font-weight:700;color:var(--mp-ink);line-height:1.2;}
.mp-card-desc{margin:0;font-size:12.5px;color:#8a7a6c;line-height:1.35;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.mp-card-foot{margin-top:auto;display:flex;align-items:center;justify-content:space-between;padding-top:8px;}
.mp-price{font-size:17px;font-weight:800;color:var(--mp-red);}
.mp-ver{background:var(--mp-red);color:#fff;font-size:11px;font-weight:700;
  padding:5px 14px;border-radius:28px;letter-spacing:.5px;font-family:sans-serif;}

/* Footer al final del contenido (no flotante): el contenido termina limpio
   encima y, si hay poco, margin-top:auto lo ancla al fondo. Sirve igual en
   móvil, tablet y web. */
.mp-footer{margin-top:auto;background:var(--mp-red-dark);color:#f6ddd5;text-align:center;
  padding:20px 20px calc(20px + env(safe-area-inset-bottom));font-size:13px;line-height:1.6;}
.mp-foot-name{font-size:17px;font-weight:800;color:#fff;margin:0 0 4px;}
/* Redes: icono de la app + @usuario, enlazado directo al perfil */
.mp-socials{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:8px 16px;margin:12px 0 4px;}
.mp-social{display:inline-flex;align-items:center;gap:7px;color:#fff;text-decoration:none;
  font-family:sans-serif;font-size:13.5px;opacity:.94;transition:opacity .15s;}
.mp-social-ic{font-size:18px;flex:0 0 auto;}
@media(hover:hover){.mp-social:hover{opacity:1;text-decoration:underline;}}
.mp-foot-by{margin:8px 0 0;opacity:.7;font-size:11px;}

.mp-modal{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.55);
  display:flex;align-items:flex-end;justify-content:center;animation:mp-fade .2s;}
@media(min-width:560px){.mp-modal{align-items:center;}}
@keyframes mp-fade{from{opacity:0}to{opacity:1}}
.mp-modal-card{background:var(--mp-cream);width:100%;max-width:460px;
  border-radius:18px 18px 0 0;overflow:hidden;position:relative;animation:mp-up .25s;}
@media(min-width:560px){.mp-modal-card{border-radius:18px;}}
@keyframes mp-up{from{transform:translateY(30px)}to{transform:translateY(0)}}
.mp-modal-x{position:absolute;top:10px;right:10px;z-index:2;width:34px;height:34px;
  border:none;border-radius:50%;background:rgba(0,0,0,.5);color:#fff;font-size:22px;
  line-height:1;cursor:pointer;}
.mp-modal-img{height:240px;background:#e7ddc9;}
.mp-modal-img img{width:100%;height:100%;object-fit:cover;}
.mp-modal-ph{width:100%;height:100%;background:linear-gradient(135deg,#efe7d6,#e0d4ba);}
.mp-modal-body{padding:18px 20px 26px;}
.mp-modal-body h3{margin:0 0 8px;font-size:22px;font-weight:800;color:var(--mp-ink);}
.mp-modal-desc{margin:0 0 14px;color:#6f6052;font-size:14px;line-height:1.5;}
.mp-modal-price{margin:0;font-size:24px;font-weight:800;color:var(--mp-red);}
`;
