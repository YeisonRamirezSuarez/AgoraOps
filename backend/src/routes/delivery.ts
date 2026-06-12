/**
 * Gestión de domicilios — réplica de Polaris (blank_gestion_domicilio,
 * verificado en QA 2026-06-12):
 *  - Empresas aliadas: nombre obligatorio ("El nombre de la empresa es
 *    obligatorio." lo valida también el cliente), nombre en MAYÚSCULAS,
 *    duplicados permitidos (igual que Polaris), dirección vacía se
 *    muestra "No definido". No se elimina con personal asociado: "No se
 *    puede eliminar la empresa porque tiene domiciliarios asociados."
 *  - Domiciliarios: todos los campos obligatorios ("Completa todos los
 *    campos para continuar."), placa en MAYÚSCULAS. Eliminar con
 *    pedidos asociados (orders.delivery_personnel_id) lo DESACTIVA:
 *    "El domiciliario tiene pedidos asociados. Se ha DESACTIVADO para
 *    preservar el historial." (action_taken: 'deactivated'); sin
 *    pedidos se borra físicamente (action_taken: 'deleted').
 *  - Respuestas con los mensajes exactos del QA. Corregido respecto a
 *    Polaris: el update devuelve el nombre completo bien armado (en
 *    Polaris responde name null y la tarjeta queda rota hasta recargar).
 *  - availability siempre "DISPONIBLE" (igual que el QA; solo se usa en
 *    la búsqueda del cliente).
 */
import { Router } from "express";
import { query, queryOne } from "../db.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

export const deliveryRouter = Router();
deliveryRouter.use(requireAuth, requireAdmin);

/* ───────────────────────── Formas Polaris ───────────────────────── */

interface CompanyRow {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  status: string;
}

interface PersonnelRow {
  id: number;
  company_id: number;
  company_name: string;
  first_name: string;
  last_name: string;
  phone: string;
  plate: string;
  status: string;
  has_history: boolean;
}

const initialsOf = (first: string, last: string) =>
  ((first.trim()[0] ?? "") + (last.trim()[0] ?? "")).toUpperCase() || "NA";

/** Empresa con la forma del state de Polaris (contact, "No definido"). */
const shapeCompany = (c: CompanyRow) => ({
  id: c.id,
  name: c.name,
  contact: c.phone || "No definido",
  address: c.address || "No definido",
  status: c.status,
});

/** Domiciliario con la forma del state de Polaris (name ya armado). */
const shapeDriver = (d: PersonnelRow) => ({
  id: d.id,
  first_name: d.first_name,
  last_name: d.last_name,
  name: `${d.first_name} ${d.last_name}`.trim(),
  phone: d.phone,
  plate: d.plate,
  status: d.status,
  company_id: d.company_id,
  company_name: d.company_name,
  availability: "DISPONIBLE",
  initials: initialsOf(d.first_name, d.last_name),
  has_history: d.has_history,
});

const SELECT_DRIVER = `
  SELECT p.id, p.company_id, p.first_name, p.last_name, p.phone, p.plate,
         p.status, c.name AS company_name,
         EXISTS (SELECT 1 FROM orders o WHERE o.delivery_personnel_id = p.id)
           AS has_history
    FROM delivery_personnel p
    JOIN delivery_companies c ON c.id = p.company_id`;

async function getDriver(tenantId: string | null, id: string | number) {
  return queryOne<PersonnelRow>(
    `${SELECT_DRIVER} WHERE p.id = $1 AND p.tenant_id = $2`, [id, tenantId]);
}

/* ───────────────────────── Estado unificado ───────────────────────── */

// Una sola carga, como el server-render de Polaris (más recientes primero)
deliveryRouter.get("/", async (req, res) => {
  const companies = await query<CompanyRow>(
    `SELECT id, name, phone, address, status FROM delivery_companies
      WHERE tenant_id = $1 ORDER BY id DESC`,
    [req.user!.tenantId],
  );
  const drivers = await query<PersonnelRow>(
    `${SELECT_DRIVER} WHERE p.tenant_id = $1 ORDER BY p.id DESC`,
    [req.user!.tenantId],
  );
  res.json({
    companies: companies.map(shapeCompany),
    drivers: drivers.map(shapeDriver),
  });
});

/* ───────────────────────── Empresas ───────────────────────── */

interface CompanyBody {
  name?: string;
  phone?: string;
  address?: string;
  status?: string;
}

function normalizeCompany(b: CompanyBody) {
  return {
    name: String(b.name ?? "").trim().toUpperCase().slice(0, 150),
    phone: String(b.phone ?? "").replace(/\D/g, "").slice(0, 50) || null,
    address: String(b.address ?? "").trim().slice(0, 255) || null,
    status: b.status === "INACTIVO" ? "INACTIVO" : "ACTIVO",
  };
}

deliveryRouter.post("/companies", async (req, res) => {
  const b = normalizeCompany(req.body as CompanyBody);
  if (!b.name) {
    res.status(400).json({ error: "El nombre de la empresa es obligatorio." });
    return;
  }
  const row = await queryOne<CompanyRow>(
    `INSERT INTO delivery_companies (tenant_id, name, phone, address, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, phone, address, status`,
    [req.user!.tenantId, b.name, b.phone, b.address, b.status],
  );
  res.status(201).json({
    message: "Empresa creada correctamente.",
    company: shapeCompany(row!),
  });
});

deliveryRouter.put("/companies/:id", async (req, res) => {
  const b = normalizeCompany(req.body as CompanyBody);
  if (!b.name) {
    res.status(400).json({ error: "El nombre de la empresa es obligatorio." });
    return;
  }
  const row = await queryOne<CompanyRow>(
    `UPDATE delivery_companies
        SET name = $3, phone = $4, address = $5, status = $6
      WHERE id = $1 AND tenant_id = $2
      RETURNING id, name, phone, address, status`,
    [req.params.id, req.user!.tenantId, b.name, b.phone, b.address, b.status],
  );
  if (!row) {
    res.status(404).json({ error: "No fue posible guardar la empresa." });
    return;
  }
  res.json({
    message: "Empresa actualizada correctamente.",
    company: shapeCompany(row),
  });
});

deliveryRouter.delete("/companies/:id", async (req, res) => {
  const used = await queryOne(
    `SELECT 1 AS x FROM delivery_personnel WHERE company_id = $1 AND tenant_id = $2 LIMIT 1`,
    [req.params.id, req.user!.tenantId],
  );
  if (used) {
    res.status(409).json({
      error: "No se puede eliminar la empresa porque tiene domiciliarios asociados.",
    });
    return;
  }
  const row = await queryOne(
    `DELETE FROM delivery_companies WHERE id = $1 AND tenant_id = $2 RETURNING id`,
    [req.params.id, req.user!.tenantId],
  );
  if (!row) {
    res.status(404).json({ error: "No fue posible eliminar la empresa." });
    return;
  }
  res.json({ message: "Empresa eliminada correctamente." });
});

/* ───────────────────────── Domiciliarios ───────────────────────── */

interface PersonnelBody {
  first_name?: string;
  last_name?: string;
  phone?: string;
  plate?: string;
  status?: string;
  company_id?: number;
}

function normalizePersonnel(b: PersonnelBody) {
  return {
    first_name: String(b.first_name ?? "").trim().slice(0, 80),
    last_name: String(b.last_name ?? "").trim().slice(0, 80),
    phone: String(b.phone ?? "").replace(/\D/g, "").slice(0, 20),
    plate: String(b.plate ?? "").trim().toUpperCase().slice(0, 20),
    status: b.status === "INACTIVO" ? "INACTIVO" : "ACTIVO",
    company_id: Number(b.company_id) || 0,
  };
}

async function validatePersonnel(
  tenantId: string | null,
  b: ReturnType<typeof normalizePersonnel>,
): Promise<string | null> {
  if (!b.first_name || !b.last_name || !b.phone || !b.plate || !b.company_id) {
    return "Completa todos los campos para continuar.";
  }
  const company = await queryOne(
    `SELECT id FROM delivery_companies WHERE id = $1 AND tenant_id = $2`,
    [b.company_id, tenantId],
  );
  if (!company) return "Completa todos los campos para continuar.";
  return null;
}

deliveryRouter.post("/personnel", async (req, res) => {
  const b = normalizePersonnel(req.body as PersonnelBody);
  const error = await validatePersonnel(req.user!.tenantId, b);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  const row = await queryOne<{ id: number }>(
    `INSERT INTO delivery_personnel
       (tenant_id, company_id, first_name, last_name, phone, plate, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [req.user!.tenantId, b.company_id, b.first_name, b.last_name, b.phone,
     b.plate, b.status],
  );
  const driver = await getDriver(req.user!.tenantId, row!.id);
  res.status(201).json({
    message: "Domiciliario creado correctamente.",
    driver: shapeDriver(driver!),
  });
});

deliveryRouter.put("/personnel/:id", async (req, res) => {
  const b = normalizePersonnel(req.body as PersonnelBody);
  const error = await validatePersonnel(req.user!.tenantId, b);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  const row = await queryOne(
    `UPDATE delivery_personnel
        SET company_id = $3, first_name = $4, last_name = $5, phone = $6,
            plate = $7, status = $8
      WHERE id = $1 AND tenant_id = $2 RETURNING id`,
    [req.params.id, req.user!.tenantId, b.company_id, b.first_name,
     b.last_name, b.phone, b.plate, b.status],
  );
  if (!row) {
    res.status(404).json({ error: "No fue posible guardar el domiciliario." });
    return;
  }
  const driver = await getDriver(req.user!.tenantId, req.params.id);
  res.json({
    message: "Domiciliario actualizado correctamente.",
    driver: shapeDriver(driver!),
  });
});

// Eliminar: con pedidos asociados se desactiva para conservar historial
deliveryRouter.delete("/personnel/:id", async (req, res) => {
  const driver = await getDriver(req.user!.tenantId, req.params.id);
  if (!driver) {
    res.status(404).json({ error: "No fue posible eliminar el domiciliario." });
    return;
  }
  if (driver.has_history) {
    await query(
      `UPDATE delivery_personnel SET status = 'INACTIVO'
        WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.user!.tenantId],
    );
    res.json({
      message: "El domiciliario tiene pedidos asociados. Se ha DESACTIVADO para preservar el historial.",
      action_taken: "deactivated",
    });
    return;
  }
  await query(
    `DELETE FROM delivery_personnel WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, req.user!.tenantId],
  );
  res.json({
    message: "Domiciliario eliminado correctamente.",
    action_taken: "deleted",
  });
});

deliveryRouter.post("/personnel/:id/activate", async (req, res) => {
  const row = await queryOne(
    `UPDATE delivery_personnel SET status = 'ACTIVO'
      WHERE id = $1 AND tenant_id = $2 RETURNING id`,
    [req.params.id, req.user!.tenantId],
  );
  if (!row) {
    res.status(404).json({ error: "No fue posible reactivar el domiciliario." });
    return;
  }
  res.json({ message: "Domiciliario reactivado correctamente." });
});
