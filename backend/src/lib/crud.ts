/**
 * Fábrica de routers CRUD para catálogos simples con tenant_id.
 * Cubre los submódulos del manual cuyo comportamiento es
 * listar/agregar/editar/eliminar con validaciones de BD (triggers/FKs):
 * salas, mesas, categorías, toppings, proveedores, clientes, bancos,
 * denominaciones, impresoras, grupos, reservaciones, etc.
 * Las reglas de negocio que no caben aquí viven en sus routers propios.
 */
import { Router } from "express";
import { query, queryOne } from "../db.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

interface CrudOptions {
  table: string;
  /** Columnas que el cliente puede escribir. */
  columns: string[];
  /** Columnas no editables después de crear (ej. número de mesa §1.7.2). */
  immutable?: string[];
  /** true → solo administrador (la mayoría de catálogos del manual). */
  adminOnly?: boolean;
  orderBy?: string;
}

export function crudRouter(opts: CrudOptions): Router {
  const router = Router();
  const guard = opts.adminOnly === false ? [requireAuth] : [requireAuth, requireAdmin];
  const orderBy = opts.orderBy ?? "id";

  router.get("/", ...guard, async (req, res) => {
    const rows = await query(
      `SELECT * FROM ${opts.table} WHERE tenant_id = $1 ORDER BY ${orderBy}`,
      [req.user!.tenantId],
    );
    res.json(rows);
  });

  router.get("/:id", ...guard, async (req, res) => {
    const row = await queryOne(
      `SELECT * FROM ${opts.table} WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.user!.tenantId],
    );
    if (!row) {
      res.status(404).json({ error: "Registro no encontrado" });
      return;
    }
    res.json(row);
  });

  router.post("/", ...guard, async (req, res) => {
    const cols = opts.columns.filter((c) => req.body[c] !== undefined);
    if (cols.length === 0) {
      res.status(400).json({ error: "Sin datos para registrar" });
      return;
    }
    const values = cols.map((c) => req.body[c]);
    const placeholders = cols.map((_, i) => `$${i + 2}`).join(", ");
    try {
      const row = await queryOne(
        `INSERT INTO ${opts.table} (tenant_id, ${cols.join(", ")})
         VALUES ($1, ${placeholders}) RETURNING *`,
        [req.user!.tenantId, ...values],
      );
      res.status(201).json(row);
    } catch (err) {
      res.status(400).json({ error: dbErrorMessage(err) });
    }
  });

  router.put("/:id", ...guard, async (req, res) => {
    const editable = opts.columns.filter(
      (c) => !(opts.immutable ?? []).includes(c),
    );
    const cols = editable.filter((c) => req.body[c] !== undefined);
    if (cols.length === 0) {
      res.status(400).json({ error: "Sin datos para actualizar" });
      return;
    }
    const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(", ");
    try {
      const row = await queryOne(
        `UPDATE ${opts.table} SET ${sets}
         WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [req.params.id, req.user!.tenantId, ...cols.map((c) => req.body[c])],
      );
      if (!row) {
        res.status(404).json({ error: "Registro no encontrado" });
        return;
      }
      res.json(row);
    } catch (err) {
      res.status(400).json({ error: dbErrorMessage(err) });
    }
  });

  router.delete("/:id", ...guard, async (req, res) => {
    try {
      const row = await queryOne(
        `DELETE FROM ${opts.table} WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [req.params.id, req.user!.tenantId],
      );
      if (!row) {
        res.status(404).json({ error: "Registro no encontrado" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: dbErrorMessage(err) });
    }
  });

  return router;
}

/**
 * Error de negocio con el código P0001 (igual que un RAISE EXCEPTION de los
 * triggers): dbErrorMessage() lo traduce a su mensaje tal cual para la UI.
 */
export function bizError(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: "P0001", message });
}

/** Traduce errores de Postgres (triggers/constraints) a mensajes de UI. */
export function dbErrorMessage(err: unknown): string {
  const e = err as { code?: string; message?: string; constraint?: string };
  if (e.code === "23505") return "Ya existe un registro con esos datos.";
  if (e.code === "23503")
    return "No se puede completar: el registro tiene datos asociados.";
  // RAISE EXCEPTION de los triggers del manual (mensajes ya en español)
  if (e.code === "P0001" && e.message) return e.message;
  return e.message ?? "Error en la base de datos.";
}
