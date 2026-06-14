/**
 * Configuración del restaurante — manual §1.7.7 (métodos de pago) y
 * §1.8.1 (parámetros: propina, % servicio EC, sobregiro).
 * Origen PHP: registrar_datos_local.php / obtener_datos_local.php
 * (informacion_negocio: nombre, telefono, nit, direccion, procenpro,
 * modopropina, facebook, instagram).
 */
import { Router } from "express";
import { z } from "zod";
import { query, queryOne } from "../db.js";
import { dbErrorMessage } from "../lib/crud.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { signTenant } from "../lib/publicToken.js";

export const settingsRouter = Router();

/** URL estable del menú público para generar el QR de las mesas (§1.6.2).
 * Antes del guard de admin: la pantalla de QR la puede ver cualquier
 * usuario autenticado. Devuelve el tenant y su `code` (HMAC estable); el
 * frontend arma `${origin}/m/<tenantId>?c=<code>`. */
settingsRouter.get("/menu-qr", requireAuth, (req, res) => {
  const tenantId = req.user!.tenantId;
  if (!tenantId) {
    res.status(404).json({ error: "Sin establecimiento" });
    return;
  }
  res.json({ tenantId, code: signTenant(tenantId) });
});

/** Branding del establecimiento (nombre, logo y paleta de colores).
 * Registrado ANTES del guard de administrador: lo necesita cualquier
 * usuario autenticado para aplicar el tema al iniciar sesión. */
settingsRouter.get("/branding", requireAuth, async (req, res) => {
  const fallback = {
    business_name: null, logo_url: null, theme_palette: "celeste",
    currency_code: "COP", currency_symbol: "$", currency_decimals: 0,
  };
  if (!req.user!.tenantId) {
    res.json(fallback);
    return;
  }
  const row = await queryOne(
    `SELECT bs.business_name, bs.logo_url, bs.theme_palette,
            t.currency_code, t.currency_symbol, t.currency_decimals
     FROM business_settings bs
     JOIN tenants t ON t.id = bs.tenant_id
     WHERE bs.tenant_id = $1`,
    [req.user!.tenantId],
  );
  res.json(row ?? fallback);
});

settingsRouter.use(requireAuth, requireAdmin);

settingsRouter.get("/", async (req, res) => {
  const row = await queryOne(
    `SELECT bs.*, t.country FROM business_settings bs
     JOIN tenants t ON t.id = bs.tenant_id
     WHERE bs.tenant_id = $1`,
    [req.user!.tenantId],
  );
  res.json(row ?? {});
});

settingsRouter.put("/", async (req, res) => {
  const schema = z.object({
    business_name: z.string().min(1).optional(),
    phone: z.string().nullish(),
    tax_id: z.string().nullish(),
    address: z.string().nullish(),
    facebook: z.string().nullish(),
    instagram: z.string().nullish(),
    tip_enabled: z.boolean().optional(),
    tip_percentage: z.number().min(0).max(100).optional(),
    service_enabled: z.boolean().optional(),
    service_percentage: z.number().min(0).max(100).optional(),
    allow_overdraft: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  const d = parsed.data;
  try {
    const row = await queryOne(
      `UPDATE business_settings SET
         business_name = COALESCE($2, business_name),
         phone = COALESCE($3, phone),
         tax_id = COALESCE($4, tax_id),
         address = COALESCE($5, address),
         facebook = COALESCE($6, facebook),
         instagram = COALESCE($7, instagram),
         tip_enabled = COALESCE($8, tip_enabled),
         tip_percentage = COALESCE($9, tip_percentage),
         service_enabled = COALESCE($10, service_enabled),
         service_percentage = COALESCE($11, service_percentage),
         allow_overdraft = COALESCE($12, allow_overdraft)
       WHERE tenant_id = $1 RETURNING *`,
      [
        req.user!.tenantId, d.business_name ?? null, d.phone ?? null,
        d.tax_id ?? null, d.address ?? null, d.facebook ?? null,
        d.instagram ?? null, d.tip_enabled ?? null, d.tip_percentage ?? null,
        d.service_enabled ?? null, d.service_percentage ?? null,
        d.allow_overdraft ?? null,
      ],
    );
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/** Métodos de pago (§1.7.7): solo estado + bancos en TRANSFERENCIA. */
settingsRouter.get("/payment-methods", async (req, res) => {
  const rows = await query(
    `SELECT pm.*, COALESCE(json_agg(pmb.bank_id)
        FILTER (WHERE pmb.bank_id IS NOT NULL), '[]') AS bank_ids
     FROM payment_methods pm
     LEFT JOIN payment_method_banks pmb ON pmb.payment_method_id = pm.id
     WHERE pm.tenant_id = $1
       -- Catálogo fijo de Polaris (5 métodos). Métodos legacy de tenants
       -- antiguos (NEQUI/DAVIPLATA/RAPPI) quedan fuera de la configuración
       -- pero se conservan en BD para el historial de ventas.
       AND pm.name IN ('EFECTIVO', 'TARJETA', 'TRANSFERENCIA',
                       'VENTA A CREDITO', 'COMBINADO')
     GROUP BY pm.id
     ORDER BY CASE pm.name
       WHEN 'EFECTIVO' THEN 1 WHEN 'TARJETA' THEN 2 WHEN 'TRANSFERENCIA' THEN 3
       WHEN 'VENTA A CREDITO' THEN 4 WHEN 'COMBINADO' THEN 5 ELSE 6 END,
       pm.is_legacy, pm.name`,
    [req.user!.tenantId],
  );
  res.json(rows);
});

/** Guardado masivo (un solo "Guardar" como Polaris): estado de cada método
 * + bancos asociados (solo aplica a TRANSFERENCIA). */
settingsRouter.put("/payment-methods", async (req, res) => {
  const schema = z.object({
    methods: z.array(z.object({
      id: z.number(),
      is_active: z.boolean(),
      bank_ids: z.array(z.number()).optional(),
    })).min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  try {
    const methods = parsed.data.methods;
    // 1) UPDATE de is_active en lote (antes: un UPDATE por método). El
    // RETURNING confirma qué ids son realmente del tenant (sustituye al
    // `if (!row) continue` que ignoraba ids ajenos).
    const updated = await query<{ id: number }>(
      `UPDATE payment_methods pm SET is_active = v.is_active
       FROM unnest($2::int[], $3::bool[]) AS v(id, is_active)
       WHERE pm.id = v.id AND pm.tenant_id = $1
       RETURNING pm.id`,
      [req.user!.tenantId, methods.map((m) => m.id), methods.map((m) => m.is_active)],
    );
    const ownedIds = new Set(updated.map((r) => r.id));

    // 2) Reconciliar bancos solo de métodos con bank_ids definido y del tenant.
    // (bank_ids = [] limpia los bancos; undefined no toca nada — igual que antes.)
    const withBanks = methods.filter((m) => m.bank_ids && ownedIds.has(m.id));
    if (withBanks.length > 0) {
      const affectedIds = withBanks.map((m) => m.id);
      // DELETE en lote y SCOPEADO por tenant (antes el DELETE no validaba
      // tenant: un id ajeno cuyo UPDATE fallaba ya no llegaba aquí, pero el
      // join explícito lo blinda).
      await query(
        `DELETE FROM payment_method_banks pmb
         USING payment_methods pm
         WHERE pmb.payment_method_id = pm.id
           AND pm.tenant_id = $1
           AND pmb.payment_method_id = ANY($2::int[])`,
        [req.user!.tenantId, affectedIds],
      );
      // INSERT en lote: aplanar los pares (method_id, bank_id) en dos arrays
      // paralelos y un único unnest (antes: un INSERT por método).
      const pmIds: number[] = [];
      const bankIds: number[] = [];
      for (const m of withBanks) {
        for (const b of m.bank_ids!) {
          pmIds.push(m.id);
          bankIds.push(b);
        }
      }
      if (pmIds.length > 0) {
        await query(
          `INSERT INTO payment_method_banks (payment_method_id, bank_id)
           SELECT v.pm_id, v.bank_id
           FROM unnest($1::int[], $2::int[]) AS v(pm_id, bank_id)`,
          [pmIds, bankIds],
        );
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

settingsRouter.put("/payment-methods/:id", async (req, res) => {
  const schema = z.object({
    is_active: z.boolean(),
    bank_ids: z.array(z.number()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  try {
    const row = await queryOne(
      `UPDATE payment_methods SET is_active = $3
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, req.user!.tenantId, parsed.data.is_active],
    );
    if (!row) {
      res.status(404).json({ error: "Método de pago no encontrado" });
      return;
    }
    if (parsed.data.bank_ids) {
      await query(
        "DELETE FROM payment_method_banks WHERE payment_method_id = $1",
        [req.params.id],
      );
      if (parsed.data.bank_ids.length > 0) {
        // Un INSERT por lote (unnest) en vez de uno por banco.
        await query(
          `INSERT INTO payment_method_banks (payment_method_id, bank_id)
           SELECT $1, x.bank_id FROM unnest($2::int[]) AS x(bank_id)`,
          [req.params.id, parsed.data.bank_ids],
        );
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/**
 * Prioridad del menú (§1.7.6): categorías favoritas visibles por día de
 * semana (0=domingo … 6=sábado). Al servir el menú (GET /products/menu/*)
 * solo se muestran las categorías con prioridad para ese día; un día sin
 * prioridades configuradas no muestra ninguna categoría (menú vacío).
 * Origen Polaris: prioridad_menu.
 */
settingsRouter.get("/menu-priority", async (req, res) => {
  const rows = await query<{ weekday: number; category_id: number }>(
    `SELECT weekday, category_id FROM menu_priority
     WHERE tenant_id = $1 ORDER BY weekday, sort_order`,
    [req.user!.tenantId],
  );
  // Mapa día → category_ids en orden de prioridad (los días sin favoritas se omiten)
  const byDay: Record<number, number[]> = {};
  for (const r of rows) (byDay[r.weekday] ??= []).push(r.category_id);
  res.json(byDay);
});

settingsRouter.put("/menu-priority", async (req, res) => {
  const schema = z.object({
    weekdays: z.array(z.number().int().min(0).max(6)).min(1),
    categoryIds: z.array(z.number().int()),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  const { weekdays, categoryIds } = parsed.data;
  try {
    // Reemplaza las favoritas de cada día seleccionado (sort_order = posición).
    // Lista vacía = el día queda sin prioridades y su menú no muestra
    // ninguna categoría (no "muestra todas"): ver GET /products/menu/*.
    await query(
      "DELETE FROM menu_priority WHERE tenant_id = $1 AND weekday = ANY($2::int[])",
      [req.user!.tenantId, weekdays],
    );
    if (categoryIds.length > 0) {
      // Inserta todas las (día × categoría) en un solo viaje; ORDINALITY da el
      // sort_order (posición 0-based) en vez de un INSERT por celda.
      await query(
        `INSERT INTO menu_priority (tenant_id, weekday, category_id, sort_order)
         SELECT $1, w.weekday, c.category_id, c.ord - 1
         FROM unnest($2::int[]) AS w(weekday)
         CROSS JOIN unnest($3::int[]) WITH ORDINALITY AS c(category_id, ord)`,
        [req.user!.tenantId, weekdays, categoryIds],
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

/**
 * Objetivos de venta (§1.7.5) — réplica de Polaris form_tb_objetive.
 * Un único registro por establecimiento con las metas y fechas diaria,
 * semanal y mensual. El Dashboard usa estas fechas como rango de facturado.
 * Validaciones verificadas en Polaris (mensajes corregidos):
 *   · los 8 campos son obligatorios;
 *   · la fecha del día no puede ser menor a la fecha actual;
 *   · la fecha fin de semana/mes no puede ser menor a su fecha inicio.
 */
const OBJ_LABELS: Record<string, string> = {
  daily_date: "Fecha del día",
  daily_goal: "Objetivo del día",
  week_start: "Fecha inicio de semana",
  week_end: "Fecha fin de semana",
  weekly_goal: "Objetivo de la semana",
  month_start: "Fecha inicio de mes",
  month_end: "Fecha fin de mes",
  monthly_goal: "Objetivo del mes",
};

settingsRouter.get("/objectives", async (req, res) => {
  const row = await queryOne(
    `SELECT daily_goal, daily_date::text, weekly_goal,
            week_start::text, week_end::text,
            monthly_goal, month_start::text, month_end::text
     FROM objectives WHERE tenant_id = $1`,
    [req.user!.tenantId],
  );
  res.json(row ?? {
    daily_goal: 0, daily_date: null, weekly_goal: 0,
    week_start: null, week_end: null,
    monthly_goal: 0, month_start: null, month_end: null,
  });
});

settingsRouter.put("/objectives", async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const isEmpty = (v: unknown) =>
    v === null || v === undefined || v === "" ||
    (typeof v === "number" && Number.isNaN(v));
  const num = (v: unknown) => (isEmpty(v) ? NaN : Number(v));

  const errors: string[] = [];
  const missing = Object.keys(OBJ_LABELS).filter((k) => {
    const v = b[k];
    return k.endsWith("_goal") ? Number.isNaN(num(v)) : isEmpty(v);
  });
  if (missing.length) {
    errors.push("Los valores deben ser diligenciados correctamente.");
    for (const k of missing) errors.push(`${OBJ_LABELS[k]}: campo obligatorio.`);
  }

  const dailyDate = b.daily_date as string | undefined;
  const weekStart = b.week_start as string | undefined;
  const weekEnd = b.week_end as string | undefined;
  const monthStart = b.month_start as string | undefined;
  const monthEnd = b.month_end as string | undefined;
  const todayISO = new Date().toLocaleDateString("en-CA"); // yyyy-mm-dd local

  if (dailyDate && dailyDate < todayISO) {
    errors.push("La fecha del día no puede ser menor a la fecha actual.");
  }
  if (weekStart && weekEnd && weekEnd < weekStart) {
    errors.push("La fecha fin de semana no puede ser menor a la fecha inicio.");
  }
  if (monthStart && monthEnd && monthEnd < monthStart) {
    errors.push("La fecha fin de mes no puede ser menor a la fecha inicio.");
  }

  if (errors.length) {
    res.status(400).json({ error: errors.join("\n"), errors });
    return;
  }

  try {
    const row = await queryOne(
      `INSERT INTO objectives
         (tenant_id, daily_goal, daily_date, weekly_goal, week_start, week_end,
          monthly_goal, month_start, month_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tenant_id) DO UPDATE SET
         daily_goal = EXCLUDED.daily_goal, daily_date = EXCLUDED.daily_date,
         weekly_goal = EXCLUDED.weekly_goal, week_start = EXCLUDED.week_start,
         week_end = EXCLUDED.week_end, monthly_goal = EXCLUDED.monthly_goal,
         month_start = EXCLUDED.month_start, month_end = EXCLUDED.month_end
       RETURNING daily_goal, daily_date::text, weekly_goal, week_start::text,
                 week_end::text, monthly_goal, month_start::text, month_end::text`,
      [
        req.user!.tenantId,
        num(b.daily_goal), dailyDate, num(b.weekly_goal), weekStart, weekEnd,
        num(b.monthly_goal), monthStart, monthEnd,
      ],
    );
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});
