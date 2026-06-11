/**
 * Dashboard — manual §1.5 (ventas, objetivos, top, alertas, sobregiros).
 * Origen PHP: inicio.php. Reusa get_dashboard_stats() de la BD.
 */
import { Router } from "express";
import { queryOne } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const dashboardRouter = Router();

dashboardRouter.get("/", requireAuth, async (req, res) => {
  const row = await queryOne<{ get_dashboard_stats: unknown }>(
    "SELECT get_dashboard_stats($1)",
    [req.user!.tenantId],
  );
  res.json(row?.get_dashboard_stats ?? {});
});
