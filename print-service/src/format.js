/**
 * Renderizado de tirillas CONSCIENTE DEL ANCHO DE PAPEL.
 *
 * El mismo documento (comanda, prefactura, voucher, cierre de caja) puede ir
 * a impresoras de distinto ancho a la vez (p.ej. PEDIDO en cocina 58mm y
 * PREFACTURA en caja 80mm). Por eso el ancho NO se fija al generar el
 * contenido en el backend, sino aquí, justo antes de mandarlo a CADA
 * impresora física, usando el `paper_width` que tiene configurado.
 *
 * Anchos estándar de térmicas POS (Font A, 1 byte = 1 columna):
 *   80mm → 48 columnas    ·    58mm → 32 columnas
 *
 * Un "documento" es un arreglo de líneas declarativas; el renderizador las
 * convierte en texto monoespaciado del ancho correcto:
 *   { t:"text",    v, align?:"left"|"center"|"right" }   línea simple
 *   { t:"row",     left, right }                          izq + der en la misma línea
 *   { t:"kv",      k, v }                                 igual que row (clave/valor)
 *   { t:"cols",    cells:[...], widths:[...], align:[...] } matriz N columnas
 *   { t:"divider", ch?:"-" }                              línea separadora
 *   { t:"blank" }                                         línea en blanco
 */
"use strict";

/** Columnas según el ancho de papel (mm). Default 80mm. */
function colsFor(paperWidth) {
  return Number(paperWidth) === 58 ? 32 : 48;
}

/** Parte un texto en renglones de a lo sumo `width` columnas (por palabras). */
function wrap(text, width) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (w.length > width) {
      // Palabra más larga que la línea: se trocea duro.
      if (cur) { lines.push(cur); cur = ""; }
      for (let i = 0; i < w.length; i += width) lines.push(w.slice(i, i + width));
      continue;
    }
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= width) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function center(text, cols) {
  return wrap(text, cols).map((l) => {
    const pad = Math.max(0, Math.floor((cols - l.length) / 2));
    return " ".repeat(pad) + l;
  }).join("\n");
}

function alignRight(text, cols) {
  return wrap(text, cols).map((l) => " ".repeat(Math.max(0, cols - l.length)) + l).join("\n");
}

/**
 * Izquierda + derecha en la misma línea (item + precio). Si no caben juntos,
 * el lado izquierdo se parte en varias líneas y el derecho queda alineado a la
 * derecha de la PRIMERA línea.
 */
function row(left, right, cols) {
  const r = String(right ?? "");
  const leftWidth = Math.max(1, cols - r.length - 1); // -1 = separación mínima
  const ls = wrap(left, leftWidth);
  const out = [];
  ls.forEach((l, i) => {
    if (i === 0) {
      const gap = Math.max(1, cols - l.length - r.length);
      out.push(l + " ".repeat(gap) + r);
    } else {
      out.push(l);
    }
  });
  return out.join("\n");
}

/**
 * Matriz de N columnas con alineación por columna. `widths` admite números
 * (columnas fijas) y "*"/null/0 (columna "flexible": se reparte el espacio
 * restante). Así el documento es AGNÓSTICO al ancho del papel: p.ej.
 * widths:[5,"*"] = "Cant" fija en 5 y "Producto" ocupa el resto, sea 58 u 80mm.
 */
function cols(cells, widths, align, totalCols) {
  let ws;
  if (widths && widths.length === cells.length) {
    const fixed = widths.map((w) =>
      (w === "*" || w == null || Number(w) === 0) ? null : Number(w));
    const used = fixed.reduce((s, w) => s + (w || 0), 0);
    const flexN = fixed.filter((w) => w === null).length;
    const flexW = flexN ? Math.max(1, Math.floor((totalCols - used) / flexN)) : 0;
    ws = fixed.map((w) => (w === null ? flexW : w));
  } else {
    ws = cells.map(() => Math.floor(totalCols / cells.length));
  }
  const al = align ?? cells.map(() => "left");
  // Cada celda puede ocupar varias líneas; las apilamos.
  const wrapped = cells.map((c, i) => wrap(String(c ?? ""), ws[i]));
  const height = Math.max(...wrapped.map((w) => w.length));
  const lines = [];
  for (let r = 0; r < height; r++) {
    let line = "";
    for (let i = 0; i < cells.length; i++) {
      const cell = wrapped[i][r] ?? "";
      const w = ws[i];
      let piece;
      if (al[i] === "right") piece = " ".repeat(Math.max(0, w - cell.length)) + cell;
      else if (al[i] === "center") {
        const p = Math.max(0, Math.floor((w - cell.length) / 2));
        piece = (" ".repeat(p) + cell).padEnd(w);
      } else piece = cell.padEnd(w);
      line += piece;
    }
    lines.push(line.replace(/\s+$/, ""));
  }
  return lines.join("\n");
}

/** Renderiza un documento completo a texto del ancho dado. */
function renderDoc(doc, paperWidth) {
  const C = colsFor(paperWidth);
  const out = [];
  for (const ln of doc || []) {
    switch (ln.t) {
      case "text":
        out.push(ln.align === "center" ? center(ln.v, C)
          : ln.align === "right" ? alignRight(ln.v, C)
            : wrap(ln.v, C).join("\n"));
        break;
      case "row":
        out.push(row(ln.left, ln.right, C));
        break;
      case "kv":
        out.push(row(ln.k, ln.v, C));
        break;
      case "cols":
        out.push(cols(ln.cells, ln.widths, ln.align, C));
        break;
      case "divider":
        out.push(String(ln.ch || "-").repeat(C).slice(0, C));
        break;
      case "blank":
      default:
        out.push("");
    }
  }
  return out.join("\n") + "\n";
}

module.exports = { colsFor, renderDoc, wrap, center, row, cols };
