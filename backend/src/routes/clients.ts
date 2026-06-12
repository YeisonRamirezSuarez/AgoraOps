/**
 * Clientes — réplica de Polaris (grid/form_tb_customers + Historial,
 * verificado en QA 2026-06-12):
 *  - Tipo de persona 2 Natural / 1 Jurídica (códigos Polaris). Natural
 *    muestra apellidos, género y fecha de nacimiento; Jurídica muestra
 *    responsable IVA y código de verificación.
 *  - Obligatorios (en el orden del modal Polaris): Email, Nombre
 *    completo, Número de documento. Apellidos lleva * en el formulario
 *    pero Polaris NO lo valida (replicado).
 *  - Email inválido → "Email: Datos inválidos". Documento duplicado →
 *    "El número de documento ya existe."
 *  - Eliminar es borrado físico; aquí se bloquea si el cliente tiene
 *    órdenes o reservaciones (decisión propia: Polaris borra todo).
 *  - Historial: Creación = registro completo, Actualización = solo los
 *    campos cambiados (valores nuevos), Eliminación = sin detalle.
 *    Corregido respecto a Polaris: valores legibles (Polaris muestra
 *    códigos crudos y país errado) y el nombre del cliente se conserva
 *    tras el borrado (Polaris muestra "No definido").
 *  - La grilla busca y pagina en el cliente (búsqueda rápida SOLO por
 *    nombre completo, número de documento, tipo de persona y correo).
 */
import { Router } from "express";
import { query, queryOne } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const clientsRouter = Router();
clientsRouter.use(requireAuth);

/* ───────────────────────── Catálogos (códigos Polaris/DIAN) ───────────────────────── */

const PERSON_TYPES: Record<number, string> = {
  2: "Persona Natural",
  1: "Persona Jurídica",
};

// "Ciudadania" sin tilde, igual que Polaris
const DOCUMENT_TYPES: Record<string, string> = {
  CC: "Cédula de Ciudadania",
  NIT: "NIT",
};

const FISCAL_RESPONSIBILITIES: Record<string, string> = {
  "R-99-PN": "No responsable",
  "O-47": "Régimen simple de tributación",
  "O-23": "Agente de retención IVA",
  "O-15": "Autorretenedor",
  "O-13": "Gran contribuyente",
};

const TAX_REGIMES: Record<string, string> = {
  "49": "No Responsable de IVA",
  "48": "Responsable de IVA",
};

interface ClientBody {
  person_type?: number;
  document_id?: string;
  document_type?: string;
  fiscal_responsibility?: string;
  tax_regime?: string;
  name?: string;
  last_name?: string;
  country?: string;
  department_id?: number | null;
  city_id?: number | null;
  gender?: string;
  birthday?: string | null; // YYYY-MM-DD
  verification_code?: string;
  email?: string;
  phone?: string;
  phone2?: string;
  address?: string;
  notes?: string;
}

/* ───────────────────────── Validación (mensajes Polaris) ───────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normaliza el body según tipo de persona y límites del formulario Polaris. */
function normalize(b: ClientBody): ClientBody {
  const juridica = Number(b.person_type) === 1;
  const cut = (v: unknown, n: number) =>
    String(v ?? "").trim().slice(0, n) || undefined;
  return {
    person_type: juridica ? 1 : 2,
    document_id: cut(b.document_id, 20),
    document_type: b.document_type === "NIT" ? "NIT" : "CC",
    fiscal_responsibility:
      b.fiscal_responsibility && FISCAL_RESPONSIBILITIES[b.fiscal_responsibility]
        ? b.fiscal_responsibility
        : "R-99-PN",
    tax_regime: juridica && b.tax_regime === "48" ? "48" : "49",
    name: cut(b.name, 100),
    last_name: juridica ? undefined : cut(b.last_name, 255),
    country: "COLOMBIA",
    department_id: b.department_id || null,
    city_id: b.city_id || null,
    gender: !juridica && b.gender === "Femenino" ? "Femenino" : "Masculino",
    birthday: juridica ? null : b.birthday || null,
    verification_code: juridica ? cut(b.verification_code, 255) : undefined,
    email: cut(b.email, 50),
    phone: cut(b.phone, 12),
    phone2: cut(b.phone2, 12),
    address: cut(b.address, 30),
    notes: cut(b.notes, 32767),
  };
}

/** Mensajes de error del modal de Polaris, en su mismo orden. */
function validate(b: ClientBody): string | null {
  const errors: string[] = [];
  if (!b.email) errors.push("Email: Campo obligatorio");
  if (!b.name) errors.push("Nombre completo: Campo obligatorio");
  if (!b.document_id) errors.push("Número de documento: Campo obligatorio");
  if (errors.length > 0) return errors.join("\n");
  if (!EMAIL_RE.test(b.email!)) return "Email: Datos inválidos";
  return null;
}

async function isDuplicateDoc(
  tenantId: string | null, documentId: string, excludeId?: string,
): Promise<boolean> {
  const row = await queryOne(
    `SELECT id FROM clients
      WHERE tenant_id = $1 AND document_id = $2
        AND ($3::int IS NULL OR id <> $3::int)`,
    [tenantId, documentId, excludeId ?? null],
  );
  return !!row;
}

/* ───────────────────────── Historial (clients_audit) ───────────────────────── */

type AuditDetail = { label: string; value: string }[];

const ND = "No definido"; // así muestra Polaris los campos vacíos

/** Registro completo legible, en el orden de campos del historial Polaris. */
async function fullDetail(b: ClientBody): Promise<AuditDetail> {
  const dep = b.department_id
    ? await queryOne<{ name: string }>(`SELECT name FROM geo_departments WHERE id = $1`, [b.department_id])
    : null;
  const city = b.city_id
    ? await queryOne<{ name: string }>(`SELECT name FROM geo_cities WHERE id = $1`, [b.city_id])
    : null;
  const juridica = b.person_type === 1;
  const rows: AuditDetail = [
    { label: "NÚMERO DE DOCUMENTO", value: b.document_id ?? ND },
    { label: "NOMBRE", value: b.name ?? ND },
    ...(juridica ? [] : [
      { label: "APELLIDOS", value: b.last_name ?? ND },
      { label: "FECHA DE NACIMIENTO", value: b.birthday ?? ND },
      { label: "GÉNERO", value: b.gender ?? ND },
    ]),
    { label: "TELÉFONO 1", value: b.phone ?? ND },
    { label: "TELÉFONO 2", value: b.phone2 ?? ND },
    { label: "DIRECCIÓN", value: b.address ?? ND },
    { label: "PAÍS", value: b.country ?? ND },
    { label: "DEPARTAMENTO", value: dep?.name ?? ND },
    { label: "CIUDAD", value: city?.name ?? ND },
    { label: "EMAIL", value: b.email ?? ND },
    { label: "TIPO DE PERSONA", value: PERSON_TYPES[b.person_type ?? 2] },
    { label: "TIPO DE DOCUMENTO", value: DOCUMENT_TYPES[b.document_type ?? "CC"] },
    ...(juridica ? [
      { label: "RESPONSABLE IVA", value: TAX_REGIMES[b.tax_regime ?? "49"] },
      { label: "CÓDIGO DE VERIFICACIÓN", value: b.verification_code ?? ND },
    ] : []),
    { label: "RESPONSABLE FISCAL", value: FISCAL_RESPONSIBILITIES[b.fiscal_responsibility ?? "R-99-PN"] },
    { label: "NOTAS", value: b.notes ?? ND },
  ];
  return rows;
}

/** Solo los campos que cambiaron, con su valor nuevo (como Polaris). */
async function changedDetail(prev: ClientBody, next: ClientBody): Promise<AuditDetail> {
  const before = await fullDetail(prev);
  const after = await fullDetail(next);
  const prevByLabel = new Map(before.map((r) => [r.label, r.value]));
  return after.filter((r) => prevByLabel.get(r.label) !== r.value);
}

async function logAudit(
  tenantId: string | null, userName: string, action: "create" | "update" | "delete",
  clientId: number, clientName: string, detail: AuditDetail | null,
) {
  await query(
    `INSERT INTO clients_audit (tenant_id, client_id, client_name, user_name, action, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, clientId, clientName, userName, action,
     detail ? JSON.stringify(detail) : null],
  );
}

const fullName = (b: ClientBody) =>
  [b.name, b.last_name].filter(Boolean).join(" ");

/* ───────────────────────── Rutas ───────────────────────── */

// Geografía para los selects dependientes (catálogo global)
clientsRouter.get("/geo", async (_req, res) => {
  const departments = await query(`SELECT id, name FROM geo_departments ORDER BY name`);
  const cities = await query(
    `SELECT id, department_id, name FROM geo_cities ORDER BY name`,
  );
  res.json({ countries: ["COLOMBIA"], departments, cities });
});

// Historial (más reciente primero, como Polaris)
clientsRouter.get("/audit", async (req, res) => {
  const rows = await query(
    `SELECT a.id, a.client_id, a.user_name, a.action, a.detail,
            to_char(a.created_at AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI:SS') AS created_at,
            COALESCE(NULLIF(TRIM(CONCAT(c.name, ' ', COALESCE(c.last_name, ''))), ''), a.client_name) AS client_name
       FROM clients_audit a
       LEFT JOIN clients c ON c.id = a.client_id
      WHERE a.tenant_id = $1
      ORDER BY a.created_at DESC, a.id DESC`,
    [req.user!.tenantId],
  );
  res.json(rows);
});

// Lista completa (la grilla busca y pagina en el cliente)
clientsRouter.get("/", async (req, res) => {
  const rows = await query(
    `SELECT cl.id, cl.person_type, cl.document_id, cl.document_type,
            cl.fiscal_responsibility, cl.tax_regime, cl.name, cl.last_name,
            cl.country, cl.department_id, cl.city_id, cl.gender,
            to_char(cl.birthday, 'YYYY-MM-DD') AS birthday,
            cl.verification_code, cl.email, cl.phone, cl.phone2,
            cl.address, cl.notes,
            d.name AS department_name, ci.name AS city_name
       FROM clients cl
       LEFT JOIN geo_departments d ON d.id = cl.department_id
       LEFT JOIN geo_cities ci ON ci.id = cl.city_id
      WHERE cl.tenant_id = $1
      ORDER BY cl.id`,
    [req.user!.tenantId],
  );
  res.json(rows);
});

clientsRouter.post("/", async (req, res) => {
  const b = normalize(req.body as ClientBody);
  const error = validate(b);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  if (await isDuplicateDoc(req.user!.tenantId, b.document_id!)) {
    res.status(409).json({ error: "El número de documento ya existe." });
    return;
  }
  const row = await queryOne<{ id: number }>(
    `INSERT INTO clients
       (tenant_id, person_type, document_id, document_type, fiscal_responsibility,
        tax_regime, name, last_name, country, department_id, city_id, gender,
        birthday, verification_code, email, phone, phone2, address, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING id`,
    [req.user!.tenantId, b.person_type, b.document_id, b.document_type,
     b.fiscal_responsibility, b.tax_regime, b.name, b.last_name ?? null,
     b.country, b.department_id, b.city_id, b.gender, b.birthday,
     b.verification_code ?? null, b.email, b.phone ?? null, b.phone2 ?? null,
     b.address ?? null, b.notes ?? null],
  );
  await logAudit(req.user!.tenantId, req.user!.username, "create",
    row!.id, fullName(b), await fullDetail(b));
  res.status(201).json(row);
});

clientsRouter.put("/:id", async (req, res) => {
  const prev = await queryOne<ClientBody & { id: number }>(
    `SELECT id, person_type, document_id, document_type, fiscal_responsibility,
            tax_regime, name, last_name, country, department_id, city_id, gender,
            to_char(birthday, 'YYYY-MM-DD') AS birthday, verification_code,
            email, phone, phone2, address, notes
       FROM clients WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, req.user!.tenantId],
  );
  if (!prev) {
    res.status(404).json({ error: "Registro no encontrado" });
    return;
  }
  const b = normalize(req.body as ClientBody);
  const error = validate(b);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  if (await isDuplicateDoc(req.user!.tenantId, b.document_id!, req.params.id)) {
    res.status(409).json({ error: "El número de documento ya existe." });
    return;
  }
  await query(
    `UPDATE clients SET
        person_type = $3, document_id = $4, document_type = $5,
        fiscal_responsibility = $6, tax_regime = $7, name = $8, last_name = $9,
        country = $10, department_id = $11, city_id = $12, gender = $13,
        birthday = $14, verification_code = $15, email = $16, phone = $17,
        phone2 = $18, address = $19, notes = $20
      WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, req.user!.tenantId, b.person_type, b.document_id,
     b.document_type, b.fiscal_responsibility, b.tax_regime, b.name,
     b.last_name ?? null, b.country, b.department_id, b.city_id, b.gender,
     b.birthday, b.verification_code ?? null, b.email, b.phone ?? null,
     b.phone2 ?? null, b.address ?? null, b.notes ?? null],
  );
  const changes = await changedDetail(normalize(prev), b);
  if (changes.length > 0) {
    await logAudit(req.user!.tenantId, req.user!.username, "update",
      prev.id, fullName(b), changes);
  }
  res.json({ ok: true });
});

clientsRouter.delete("/:id", async (req, res) => {
  const prev = await queryOne<{ id: number; name: string; last_name: string | null }>(
    `SELECT id, name, last_name FROM clients WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, req.user!.tenantId],
  );
  if (!prev) {
    res.status(404).json({ error: "Registro no encontrado" });
    return;
  }
  // Decisión hpos: bloquear si tiene movimientos (Polaris hace borrado físico)
  const used = await queryOne(
    `SELECT 1 AS x FROM orders WHERE client_id = $1 AND tenant_id = $2
     UNION ALL
     SELECT 1 FROM reservations WHERE client_id = $1 AND tenant_id = $2
     LIMIT 1`,
    [req.params.id, req.user!.tenantId],
  );
  if (used) {
    res.status(409).json({
      error: "No se puede eliminar: el cliente tiene ventas o reservas asociadas.",
    });
    return;
  }
  await query(`DELETE FROM clients WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, req.user!.tenantId]);
  await logAudit(req.user!.tenantId, req.user!.username, "delete",
    prev.id, [prev.name, prev.last_name].filter(Boolean).join(" "), null);
  res.json({ ok: true });
});
