/** Estados de una orden. Origen PHP: CSV "ocupada"/"libre" + ventas/cancelacion_mesas. */
export const ORDER_STATUS = {
  ABIERTA: "abierta",
  PAGADA: "pagada",
  CANCELADA: "cancelada",
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

/**
 * Color de la mesa por tiempo de ocupación (manual §1.6.3):
 * verde claro al ocupar, amarillo a los 30 min, rojo a 1 hora.
 */
export const TABLE_TIME_THRESHOLDS = {
  WARNING_MINUTES: 30,
  DANGER_MINUTES: 60,
} as const;

export function tableTimeColor(minutesOccupied: number): "fresh" | "warning" | "danger" {
  if (minutesOccupied >= TABLE_TIME_THRESHOLDS.DANGER_MINUTES) return "danger";
  if (minutesOccupied >= TABLE_TIME_THRESHOLDS.WARNING_MINUTES) return "warning";
  return "fresh";
}
