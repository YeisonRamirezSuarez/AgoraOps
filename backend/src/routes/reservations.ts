/**
 * Reservaciones — réplica de Polaris (grid/form_tb_reservations,
 * verificado en QA 2026-06-12):
 *  - Campos: estado (1 Reservado / 2 Confirmado / 3 Cancelado), fecha,
 *    hora de inicio, horas (1-12), cliente, personas (1-12).
 *  - Sin fecha/hora pasada ("Reservas aceptadas a partir de hoy
 *    solamente"); en edición solo se valida si la fecha/hora cambió,
 *    para poder cambiar de estado reservas antiguas (igual que Polaris,
 *    que valida onChange).
 *  - Duplicado cliente+fecha+hora → "Este cliente ya reservó en esta
 *    fecha y hora."
 *  - No genera notificaciones ni asigna mesa.
 */
import { Router } from "express";
import { query, queryOne } from "../db.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

export const reservationsRouter = Router();
reservationsRouter.use(requireAuth, requireAdmin);

const TZ = "America/Bogota";

/** Fecha (YYYY-MM-DD) y hora (HH:MM) actuales en hora del negocio. */
function nowLocal(): { date: string; time: string } {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date());
  return { date, time };
}

const SELECT_LIST = `
  SELECT r.id, r.stage_id, r.client_id, r.number_hours, r.people,
         to_char(r.reservation_date, 'YYYY-MM-DD') AS reservation_date,
         to_char(r.reservation_time, 'HH24:MI:SS') AS reservation_time,
         c.name AS client_name, c.phone AS client_phone
    FROM reservations r
    LEFT JOIN clients c ON c.id = r.client_id`;

interface ReservationBody {
  stage_id?: number;
  reservation_date?: string; // YYYY-MM-DD
  reservation_time?: string; // HH:MM
  number_hours?: number;
  client_id?: number;
  people?: number;
}

/** Validaciones del formulario Polaris. Devuelve mensaje de error o null. */
function validate(b: ReservationBody, opts: { dateChanged: boolean }): string | null {
  const missing: string[] = [];
  if (!b.reservation_date) missing.push("Fecha de reserva: Campo obligatorio");
  if (!b.reservation_time) missing.push("Hora de inicio: Campo obligatorio");
  if (!b.client_id) missing.push("Cliente: Campo obligatorio");
  if (missing.length > 0) return missing.join("\n");

  if (![1, 2, 3].includes(Number(b.stage_id))) return "Estado de la reserva inválido";
  const hours = Number(b.number_hours ?? 1);
  if (!Number.isInteger(hours) || hours < 1 || hours > 12)
    return "Mínimo 1 hora, máximo 12 horas";
  const people = Number(b.people ?? 1);
  if (!Number.isInteger(people) || people < 1 || people > 12)
    return "Mínimo 1 persona, máximo 12 personas por mesa";

  if (opts.dateChanged) {
    const now = nowLocal();
    const date = String(b.reservation_date);
    const time = String(b.reservation_time).slice(0, 5);
    if (date < now.date || (date === now.date && time < now.time))
      return "Reservas aceptadas a partir de hoy solamente";
  }
  return null;
}

/** Polaris: un cliente no puede reservar dos veces en la misma fecha y hora. */
async function isDuplicate(
  tenantId: string | null, b: ReservationBody, excludeId?: string,
): Promise<boolean> {
  const row = await queryOne(
    `SELECT id FROM reservations
      WHERE tenant_id = $1 AND client_id = $2
        AND reservation_date = $3 AND reservation_time = $4
        AND ($5::int IS NULL OR id <> $5::int)`,
    [tenantId, b.client_id, b.reservation_date, b.reservation_time, excludeId ?? null],
  );
  return !!row;
}

// Lista completa (la grilla agrupa, busca y pagina en el cliente)
reservationsRouter.get("/", async (req, res) => {
  const rows = await query(
    `${SELECT_LIST}
      WHERE r.tenant_id = $1
      ORDER BY lower(c.name), r.reservation_date DESC, r.reservation_time DESC`,
    [req.user!.tenantId],
  );
  res.json(rows);
});

reservationsRouter.post("/", async (req, res) => {
  const b = req.body as ReservationBody;
  const error = validate(b, { dateChanged: true });
  if (error) {
    res.status(400).json({ error });
    return;
  }
  if (await isDuplicate(req.user!.tenantId, b)) {
    res.status(409).json({ error: "Este cliente ya reservó en esta fecha y hora." });
    return;
  }
  const row = await queryOne(
    `INSERT INTO reservations
       (tenant_id, stage_id, reservation_date, reservation_time, number_hours, client_id, people)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [req.user!.tenantId, b.stage_id, b.reservation_date, b.reservation_time,
     b.number_hours ?? 1, b.client_id, b.people ?? 1],
  );
  res.status(201).json(row);
});

// En edición solo se cambian estado, horas, cliente y personas; la fecha y la
// hora de la reserva son inmutables (la UI las muestra bloqueadas).
reservationsRouter.put("/:id", async (req, res) => {
  const b = req.body as ReservationBody;
  const prev = await queryOne<{ reservation_date: string; reservation_time: string }>(
    `SELECT to_char(reservation_date, 'YYYY-MM-DD') AS reservation_date,
            to_char(reservation_time, 'HH24:MI') AS reservation_time
       FROM reservations WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, req.user!.tenantId],
  );
  if (!prev) {
    res.status(404).json({ error: "Registro no encontrado" });
    return;
  }
  // Validar con la fecha/hora almacenadas (lo que mande el cliente se ignora);
  // dateChanged=false para poder cambiar de estado reservas con fecha pasada
  const stored = {
    ...b,
    reservation_date: prev.reservation_date,
    reservation_time: prev.reservation_time,
  };
  const error = validate(stored, { dateChanged: false });
  if (error) {
    res.status(400).json({ error });
    return;
  }
  if (await isDuplicate(req.user!.tenantId, stored, req.params.id)) {
    res.status(409).json({ error: "Este cliente ya reservó en esta fecha y hora." });
    return;
  }
  await query(
    `UPDATE reservations
        SET stage_id = $3, number_hours = $4, client_id = $5, people = $6
      WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, req.user!.tenantId, b.stage_id,
     b.number_hours ?? 1, b.client_id, b.people ?? 1],
  );
  res.json({ ok: true });
});

reservationsRouter.delete("/:id", async (req, res) => {
  const row = await queryOne(
    `DELETE FROM reservations WHERE id = $1 AND tenant_id = $2 RETURNING id`,
    [req.params.id, req.user!.tenantId],
  );
  if (!row) {
    res.status(404).json({ error: "Registro no encontrado" });
    return;
  }
  res.json({ ok: true });
});
