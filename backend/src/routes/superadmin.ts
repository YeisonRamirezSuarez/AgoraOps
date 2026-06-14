/**
 * Multicomercio — panel del Super Administrador (manual: Super Admin).
 * Gestión de establecimientos (tenants): creación con provisión completa
 * (grupos, admin, métodos de pago, denominaciones, sala/mesas, caja,
 * objetivos), configuración y personalización (paleta de colores, logo),
 * habilitar/inhabilitar, consumo (actividad de negocio, almacenamiento en
 * BD y últimas conexiones) y ranking de movimientos para el dashboard.
 *
 * Las queries son cross-tenant a propósito: este router SOLO es accesible
 * con is_super_admin en el JWT (requireSuperAdmin).
 */
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { config } from "../config.js";
import { pool, query, queryOne } from "../db.js";
import { dbErrorMessage } from "../lib/crud.js";
import { TEMP_PASSWORD } from "../lib/constants.js";
import { generateUsername } from "../lib/username.js";
import { sendTenantWelcomeEmail } from "../lib/mailer.js";
import { requireAuth, requireSuperAdmin } from "../middleware/auth.js";

export const superadminRouter = Router();
superadminRouter.use(requireAuth, requireSuperAdmin);

/** Zona horaria de referencia para los rangos (igual que el dashboard). */
const TZ = "America/Bogota";

/** Paletas disponibles; deben coincidir con frontend/shared/constants/palettes.ts */
const PALETTES = [
  "celeste", "esmeralda", "violeta", "naranja",
  "rosa", "ambar", "grafito", "rojo",
] as const;

function rangeDays(q: unknown): number {
  const n = parseInt(String(q), 10);
  return [7, 30, 90, 180, 365].includes(n) ? n : 30;
}

/* ─────────────────── Dashboard global (ranking) ─────────────────── */

superadminRouter.get("/overview", async (req, res) => {
  const days = rangeDays(req.query.days);

  const [counts, ranking, series] = await Promise.all([
    queryOne<{ total: number; active: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE is_active)::int AS active
       FROM tenants`,
    ),
    query<{
      id: string; name: string; slug: string; country: string;
      is_active: boolean; logo_url: string | null;
      orders_count: number; sales: string; payments_count: number;
      last_order_at: string | null; users_count: number;
      last_login_at: string | null;
    }>(
      `SELECT t.id, t.name, t.slug, t.country, t.is_active, bs.logo_url,
              COALESCE(o.orders_count, 0)::int AS orders_count,
              COALESCE(o.sales, 0) AS sales,
              COALESCE(o.payments_count, 0)::int AS payments_count,
              lo.last_order_at,
              COALESCE(u.users_count, 0)::int AS users_count,
              u.last_login_at
       FROM tenants t
       LEFT JOIN business_settings bs ON bs.tenant_id = t.id
       LEFT JOIN (
         SELECT o.tenant_id,
                COUNT(*) FILTER (WHERE o.status <> 'cancelada') AS orders_count,
                COALESCE(SUM(o.total - o.tip) FILTER (WHERE o.status = 'pagada'), 0) AS sales,
                (SELECT COUNT(*) FROM order_payments op
                  JOIN orders o2 ON o2.id = op.order_id
                  WHERE o2.tenant_id = o.tenant_id
                    AND (op.created_at AT TIME ZONE '${TZ}')::date
                        >= (now() AT TIME ZONE '${TZ}')::date - $1::int) AS payments_count
         FROM orders o
         WHERE (o.created_at AT TIME ZONE '${TZ}')::date
               >= (now() AT TIME ZONE '${TZ}')::date - $1::int
         GROUP BY o.tenant_id
       ) o ON o.tenant_id = t.id
       LEFT JOIN LATERAL (
         SELECT MAX(created_at) AS last_order_at
         FROM orders WHERE tenant_id = t.id
       ) lo ON true
       LEFT JOIN (
         SELECT tenant_id,
                COUNT(*) FILTER (WHERE is_active) AS users_count,
                MAX(last_login_at) AS last_login_at
         FROM users WHERE tenant_id IS NOT NULL
         GROUP BY tenant_id
       ) u ON u.tenant_id = t.id
       ORDER BY orders_count DESC, sales DESC, t.name`,
      [days],
    ),
    query<{ day: string; orders: number; sales: string }>(
      `SELECT to_char(o.created_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS day,
              COUNT(*) FILTER (WHERE o.status <> 'cancelada')::int AS orders,
              COALESCE(SUM(o.total - o.tip) FILTER (WHERE o.status = 'pagada'), 0) AS sales
       FROM orders o
       WHERE (o.created_at AT TIME ZONE '${TZ}')::date
             >= (now() AT TIME ZONE '${TZ}')::date - $1::int
       GROUP BY 1 ORDER BY 1`,
      [days],
    ),
  ]);

  const rows = ranking.map((r) => ({ ...r, sales: Number(r.sales) }));
  res.json({
    days,
    tenants: {
      total: counts?.total ?? 0,
      active: counts?.active ?? 0,
      inactive: (counts?.total ?? 0) - (counts?.active ?? 0),
    },
    totals: {
      orders: rows.reduce((s, r) => s + (r.orders_count as number), 0),
      sales: rows.reduce((s, r) => s + (r.sales as number), 0),
      withoutActivity: rows.filter((r) => (r.orders_count as number) === 0).length,
    },
    ranking: rows,
    series: series.map((s) => ({ ...s, sales: Number(s.sales) })),
  });
});

/* ─────────────────── Listado y detalle ─────────────────── */

superadminRouter.get("/tenants", async (_req, res) => {
  const rows = await query(
    `SELECT t.id, t.name, t.slug, t.country, t.timezone, t.is_active,
            t.created_at, bs.business_name, bs.logo_url, bs.theme_palette,
            COALESCE(u.users_count, 0)::int AS users_count,
            u.last_login_at, lo.last_order_at
     FROM tenants t
     LEFT JOIN business_settings bs ON bs.tenant_id = t.id
     LEFT JOIN (
       SELECT tenant_id, COUNT(*) FILTER (WHERE is_active) AS users_count,
              MAX(last_login_at) AS last_login_at
       FROM users WHERE tenant_id IS NOT NULL GROUP BY tenant_id
     ) u ON u.tenant_id = t.id
     LEFT JOIN LATERAL (
       SELECT MAX(created_at) AS last_order_at FROM orders WHERE tenant_id = t.id
     ) lo ON true
     ORDER BY t.created_at DESC`,
  );
  res.json(rows);
});

superadminRouter.get("/tenants/:id", async (req, res) => {
  const tenant = await queryOne(
    `SELECT t.*, bs.business_name, bs.phone, bs.tax_id, bs.address,
            bs.logo_url, bs.facebook, bs.instagram, bs.theme_palette,
            bs.tip_enabled, bs.tip_percentage, bs.service_enabled,
            bs.service_percentage
     FROM tenants t
     LEFT JOIN business_settings bs ON bs.tenant_id = t.id
     WHERE t.id = $1`,
    [req.params.id],
  );
  if (!tenant) {
    res.status(404).json({ error: "Establecimiento no encontrado" });
    return;
  }
  const users = await query(
    `SELECT u.id, u.username, u.email, u.full_name, u.is_active, u.is_locked,
            u.last_login_at, g.name AS group_name, g.role_type
     FROM users u LEFT JOIN groups g ON g.id = u.group_id
     WHERE u.tenant_id = $1
     ORDER BY g.role_type NULLS LAST, u.full_name`,
    [req.params.id],
  );
  res.json({ ...tenant, users });
});

/* ─────────────────── Crear (provisión completa) ─────────────────── */

const createSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/,
    "El slug solo admite minúsculas, números y guiones"),
  country: z.enum(["CO", "EC"]),
  timezone: z.string().min(1).default("America/Bogota"),
  phone: z.string().nullish(),
  taxId: z.string().nullish(),
  address: z.string().nullish(),
  logoUrl: z.string().nullish(),
  facebook: z.string().nullish(),
  instagram: z.string().nullish(),
  themePalette: z.enum(PALETTES).default("celeste"),
  // Moneda (nacional/internacional). Si no se envían, se derivan del país.
  currencyCode: z.string().min(1).max(8).optional(),
  currencySymbol: z.string().min(1).max(4).optional(),
  currencyDecimals: z.union([z.literal(0), z.literal(2)]).optional(),
  roomName: z.string().min(1).default("Sala Principal"),
  tablesCount: z.number().int().min(0).max(200).default(5),
  cashRegisterName: z.string().min(1).default("Caja Principal"),
  admin: z.object({
    fullName: z.string().min(1),
    email: z.string().email("Correo del administrador inválido"),
    phone: z.string().nullish(),
  }),
});

/** Denominaciones por país: COP billetes / USD (Ecuador). */
const DENOMINATIONS: Record<"CO" | "EC", number[]> = {
  CO: [1000, 2000, 5000, 10000, 20000, 50000, 100000],
  EC: [1, 5, 10, 20, 50, 100],
};

superadminRouter.post("/tenants", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Complete los campos requeridos",
    });
    return;
  }
  const d = parsed.data;

  const dup = await queryOne("SELECT id FROM tenants WHERE slug = $1", [d.slug]);
  if (dup) {
    res.status(409).json({ error: "Ya existe un establecimiento con ese slug." });
    return;
  }

  // El username del administrador se genera automáticamente desde su nombre
  // (inicial + apellido); es único globalmente, así que no hay que pedirlo ni
  // validar duplicados manualmente. La clave temporal es fija (TEMP_PASSWORD).
  const username = await generateUsername(d.admin.fullName);
  const password = TEMP_PASSWORD;
  const hash = await bcrypt.hash(password, 10);

  // Moneda: default por país (CO → COP/$/0, EC → USD/$/2) salvo override.
  const currency = {
    code: d.currencyCode ?? (d.country === "EC" ? "USD" : "COP"),
    symbol: d.currencySymbol ?? "$",
    decimals: d.currencyDecimals ?? (d.country === "EC" ? 2 : 0),
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tenant = (await client.query(
      `INSERT INTO tenants (name, slug, country, timezone,
         currency_code, currency_symbol, currency_decimals)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [d.name, d.slug, d.country, d.timezone,
       currency.code, currency.symbol, currency.decimals],
    )).rows[0];

    await client.query(
      `INSERT INTO business_settings (tenant_id, business_name, phone, tax_id,
         address, logo_url, facebook, instagram, theme_palette)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tenant.id, d.name, d.phone ?? null, d.taxId ?? null, d.address ?? null,
        d.logoUrl ?? null, d.facebook ?? null, d.instagram ?? null, d.themePalette,
      ],
    );

    // Grupos base (manual §1.2)
    const groups = (await client.query(
      `INSERT INTO groups (tenant_id, name, role_type) VALUES
         ($1, 'Administrador', 'administrador'),
         ($1, 'Mesero', 'empleado'),
         ($1, 'Cocina', 'empleado'),
         ($1, 'Mesero_cocina', 'empleado')
       RETURNING id, name`,
      [tenant.id],
    )).rows as { id: number; name: string }[];
    const adminGroupId = groups.find((g) => g.name === "Administrador")!.id;

    await client.query(
      `INSERT INTO users (tenant_id, username, email, password_hash, full_name,
         phone, group_id, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
      [
        tenant.id, username, d.admin.email, hash,
        d.admin.fullName, d.admin.phone ?? null, adminGroupId,
      ],
    );

    // Métodos de pago activos del manual (§1.7.7); sin legacy PHP
    await client.query(
      `INSERT INTO payment_methods (tenant_id, name, is_active, is_legacy) VALUES
         ($1, 'EFECTIVO', true, false),
         ($1, 'TARJETA', true, false),
         ($1, 'TRANSFERENCIA', true, false),
         ($1, 'VENTA A CREDITO', true, false),
         ($1, 'COMBINADO', true, false)`,
      [tenant.id],
    );

    await client.query(
      `INSERT INTO currency_denominations (tenant_id, value)
       SELECT $1, unnest($2::int[])`,
      [tenant.id, DENOMINATIONS[d.country]],
    );

    const room = (await client.query(
      "INSERT INTO rooms (tenant_id, name) VALUES ($1, $2) RETURNING id",
      [tenant.id, d.roomName],
    )).rows[0];
    if (d.tablesCount > 0) {
      await client.query(
        `INSERT INTO tables (tenant_id, room_id, number, seats)
         SELECT $1, $2, n, 4 FROM generate_series(1, $3::int) AS n`,
        [tenant.id, room.id, d.tablesCount],
      );
    }

    await client.query(
      "INSERT INTO cash_registers (tenant_id, name) VALUES ($1, $2)",
      [tenant.id, d.cashRegisterName],
    );

    // Objetivos: debe existir la fila (§1.7.5)
    await client.query("INSERT INTO objectives (tenant_id) VALUES ($1)", [tenant.id]);

    await client.query("COMMIT");

    // Correo de apertura del establecimiento al administrador (paso a paso,
    // enlace al frontend, credenciales y logos). No debe tumbar la creación si
    // el SMTP falla: el tenant ya quedó commiteado y las credenciales se
    // muestran igual en el panel.
    void sendTenantWelcomeEmail({
      to: d.admin.email,
      fullName: d.admin.fullName,
      businessName: d.name,
      username,
      tempPassword: password,
      loginUrl: `${config.appUrl}/login`,
      brandLogoUrl: `${config.appUrl}/pwa-192x192.png`,
      tenantLogoUrl: d.logoUrl ?? null,
    }).catch((e) => {
      console.error(`[superadmin] No se pudo enviar el correo de apertura a ${d.admin.email}:`, e);
    });

    res.status(201).json({
      tenant,
      adminCredentials: {
        username,
        email: d.admin.email,
        tempPassword: password,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: dbErrorMessage(err) });
  } finally {
    client.release();
  }
});

/* ─────────────────── Configurar / estado ─────────────────── */

const updateSchema = createSchema
  .omit({ admin: true, roomName: true, tablesCount: true, cashRegisterName: true, slug: true })
  .partial();

superadminRouter.put("/tenants/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Datos inválidos",
    });
    return;
  }
  const d = parsed.data;
  try {
    const tenant = await queryOne(
      `UPDATE tenants SET
         name = COALESCE($2, name),
         country = COALESCE($3, country),
         timezone = COALESCE($4, timezone),
         currency_code = COALESCE($5, currency_code),
         currency_symbol = COALESCE($6, currency_symbol),
         currency_decimals = COALESCE($7, currency_decimals)
       WHERE id = $1 RETURNING *`,
      [req.params.id, d.name ?? null, d.country ?? null, d.timezone ?? null,
       d.currencyCode ?? null, d.currencySymbol ?? null,
       d.currencyDecimals ?? null],
    );
    if (!tenant) {
      res.status(404).json({ error: "Establecimiento no encontrado" });
      return;
    }
    await query(
      `UPDATE business_settings SET
         business_name = COALESCE($2, business_name),
         phone = COALESCE($3, phone),
         tax_id = COALESCE($4, tax_id),
         address = COALESCE($5, address),
         logo_url = COALESCE($6, logo_url),
         facebook = COALESCE($7, facebook),
         instagram = COALESCE($8, instagram),
         theme_palette = COALESCE($9, theme_palette)
       WHERE tenant_id = $1`,
      [
        req.params.id, d.name ?? null, d.phone ?? null, d.taxId ?? null,
        d.address ?? null, d.logoUrl ?? null, d.facebook ?? null,
        d.instagram ?? null, d.themePalette ?? null,
      ],
    );
    res.json(tenant);
  } catch (err) {
    res.status(400).json({ error: dbErrorMessage(err) });
  }
});

superadminRouter.patch("/tenants/:id/status", async (req, res) => {
  const isActive = Boolean(req.body?.isActive);
  const row = await queryOne(
    "UPDATE tenants SET is_active = $2 WHERE id = $1 RETURNING id, is_active",
    [req.params.id, isActive],
  );
  if (!row) {
    res.status(404).json({ error: "Establecimiento no encontrado" });
    return;
  }
  res.json(row);
});

/** Restablecer la clave de un usuario del establecimiento (clave temporal). */
superadminRouter.post("/tenants/:id/users/:userId/reset-password", async (req, res) => {
  const password = TEMP_PASSWORD;
  const hash = await bcrypt.hash(password, 10);
  const row = await queryOne(
    `UPDATE users SET password_hash = $3, must_change_password = true
     WHERE id = $2 AND tenant_id = $1
     RETURNING id, username, email`,
    [req.params.id, req.params.userId, hash],
  );
  if (!row) {
    res.status(404).json({ error: "Usuario no encontrado en este establecimiento" });
    return;
  }
  res.json({ ...row, tempPassword: password });
});

/* ─────────────────── Consumo del establecimiento ─────────────────── */

superadminRouter.get("/tenants/:id/usage", async (req, res) => {
  const days = rangeDays(req.query.days);
  const id = req.params.id;

  const tenant = await queryOne("SELECT id, name FROM tenants WHERE id = $1", [id]);
  if (!tenant) {
    res.status(404).json({ error: "Establecimiento no encontrado" });
    return;
  }

  const inRange = `(created_at AT TIME ZONE '${TZ}')::date
                   >= (now() AT TIME ZONE '${TZ}')::date - $2::int`;

  const [activity, payments, totals, series] = await Promise.all([
    queryOne<{ orders: number; sales: string; cancelled: number; last_order_at: string | null }>(
      `SELECT COUNT(*) FILTER (WHERE status <> 'cancelada')::int AS orders,
              COALESCE(SUM(total - tip) FILTER (WHERE status = 'pagada'), 0) AS sales,
              COUNT(*) FILTER (WHERE status = 'cancelada')::int AS cancelled,
              MAX(created_at) AS last_order_at
       FROM orders WHERE tenant_id = $1 AND ${inRange}`,
      [id, days],
    ),
    queryOne<{ count: number }>(
      `SELECT COUNT(op.id)::int AS count
       FROM order_payments op JOIN orders o ON o.id = op.order_id
       WHERE o.tenant_id = $1
         AND (op.created_at AT TIME ZONE '${TZ}')::date
             >= (now() AT TIME ZONE '${TZ}')::date - $2::int`,
      [id, days],
    ),
    queryOne<{
      reservations: number; clients: number; products: number;
      active_users: number; last_login_at: string | null;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM reservations WHERE tenant_id = $1) AS reservations,
         (SELECT COUNT(*)::int FROM clients WHERE tenant_id = $1) AS clients,
         (SELECT COUNT(*)::int FROM products WHERE tenant_id = $1) AS products,
         (SELECT COUNT(*)::int FROM users WHERE tenant_id = $1 AND is_active) AS active_users,
         (SELECT MAX(last_login_at) FROM users WHERE tenant_id = $1) AS last_login_at`,
      [id],
    ),
    query<{ day: string; orders: number; sales: string }>(
      `SELECT to_char(created_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS day,
              COUNT(*) FILTER (WHERE status <> 'cancelada')::int AS orders,
              COALESCE(SUM(total - tip) FILTER (WHERE status = 'pagada'), 0) AS sales
       FROM orders WHERE tenant_id = $1 AND ${inRange}
       GROUP BY 1 ORDER BY 1`,
      [id, days],
    ),
  ]);

  // Almacenamiento: todas las tablas con tenant_id (estimado por fila) +
  // hijas de orders (sin tenant_id) vía JOIN. pg_column_size ≈ bytes reales.
  const tenantTables = await query<{ table_name: string }>(
    `SELECT c.table_name
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_name = c.table_name AND t.table_schema = c.table_schema
     WHERE c.column_name = 'tenant_id' AND c.table_schema = 'public'
       AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_name`,
  );

  // Hijas de orders (el grueso del histórico), sin columna tenant_id propia.
  const children: [string, string][] = [
    ["order_items", `JOIN orders o ON o.id = x.order_id`],
    ["order_payments", `JOIN orders o ON o.id = x.order_id`],
    ["order_item_toppings",
      `JOIN order_items oi ON oi.id = x.order_item_id JOIN orders o ON o.id = oi.order_id`],
  ];
  // Antes era un SELECT por tabla (N+1) que saturaba el pool con decenas de
  // viajes seriales; ahora se estima TODO en un solo viaje con UNION ALL.
  const unionQueries = tenantTables.map(({ table_name }) =>
    `SELECT '${table_name}' AS table_name, COUNT(*)::int AS rows,
            COALESCE(SUM(pg_column_size(x.*)), 0)::bigint AS bytes
     FROM "${table_name}" x WHERE x.tenant_id = $1`,
  );
  const childrenQueries = children.map(([table, join]) =>
    `SELECT '${table}' AS table_name, COUNT(x.*)::int AS rows,
            COALESCE(SUM(pg_column_size(x.*)), 0)::bigint AS bytes
     FROM ${table} x ${join} WHERE o.tenant_id = $1`,
  );
  const allQueries = [...unionQueries, ...childrenQueries].join("\nUNION ALL\n");
  const storageRows = await query<{ table_name: string; rows: number; bytes: string }>(
    `SELECT * FROM (${allQueries}) q WHERE q.rows > 0`,
    [id],
  );
  const storage = storageRows
    .map((r) => ({ table: r.table_name, rows: r.rows, bytes: Number(r.bytes) }))
    .sort((a, b) => b.bytes - a.bytes);

  res.json({
    days,
    activity: {
      orders: activity?.orders ?? 0,
      sales: Number(activity?.sales ?? 0),
      cancelled: activity?.cancelled ?? 0,
      payments: payments?.count ?? 0,
      reservations: totals?.reservations ?? 0,
      clients: totals?.clients ?? 0,
      products: totals?.products ?? 0,
      activeUsers: totals?.active_users ?? 0,
      lastOrderAt: activity?.last_order_at ?? null,
      lastLoginAt: totals?.last_login_at ?? null,
    },
    series: series.map((s) => ({ ...s, sales: Number(s.sales) })),
    storage: {
      tables: storage,
      totalRows: storage.reduce((s, t) => s + t.rows, 0),
      totalBytes: storage.reduce((s, t) => s + t.bytes, 0),
    },
  });
});
