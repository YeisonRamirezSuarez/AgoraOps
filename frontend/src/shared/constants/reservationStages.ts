/** Etapas de reserva (manual §1.7.3 — catálogo solo visual). */
export const RESERVATION_STAGES = ["Reservado", "Confirmado", "Cancelado"] as const;
export type ReservationStage = (typeof RESERVATION_STAGES)[number];
