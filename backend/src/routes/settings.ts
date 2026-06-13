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

export const settingsRouter = Router();

/** Branding del establecimiento (nombre, logo y paleta de colores).
 * Registrado ANTES del guard de administrador: lo necesita cualquier
 * usuario autenticado para aplicar el tema al iniciar sesión. */
settingsRouter.get("/branding", requireAuth, async (req, res) => {
  if (!req.user!.tenantId) {
    res.json({ business_name: null, logo_url: null, theme_palette: "celeste" });
    return;
  }
  const row = await queryOne(
    `SELECT business_name, logo_url, theme_palette
     FROM business_settings WHERE tenant_id = $1`,
    [req.user!.tenantId],
  );
  res.json(row ?? { business_name: null, logo_url: null, theme_palette: "celeste" });
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
     GROUP BY pm.id ORDER BY pm.is_legacy, pm.name`,
    [req.user!.tenantId],
  );
  res.json(rows);
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
      for (const bankId of parsed.data.bank_ids) {
        await query(
          "INSERT INTO payment_method_banks (payment_method_id, bank_id) VALUES ($1, $2)",
          [req.params.id, bankId],
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
 * semana (0=domingo … 6=sábado). Al servir el menú (GET /products/menu/*),
 * si un día tiene favoritas configuradas solo se muestran esas categorías;
 * si no tiene ninguna, se muestran todas. Origen Polaris: prioridad_menu.
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
    // Lista vacía = el día vuelve a mostrar todas las categorías.
    await query(
      "DELETE FROM menu_priority WHERE tenant_id = $1 AND weekday = ANY($2::int[])",
      [req.user!.tenantId, weekdays],
    );
    for (const weekday of weekdays) {
      for (let i = 0; i < categoryIds.length; i++) {
        await query(
          `INSERT INTO menu_priority (tenant_id, weekday, category_id, sort_order)
           VALUES ($1, $2, $3, $4)`,
          [req.user!.tenantId, weekday, categoryIds[i], i],
        );
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});
