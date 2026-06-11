/**
 * Razones de movimientos de inventario (manual §1.11.4).
 * Origen PHP: historial_inventario.tipo_movimiento ("venta", entradas manuales).
 */
export const MOVEMENT_DIRECTION = {
  ENTRADA: "ENTRADA",
  SALIDA: "SALIDA",
} as const;

export type MovementDirection = (typeof MOVEMENT_DIRECTION)[keyof typeof MOVEMENT_DIRECTION];

export const ENTRY_REASONS = ["Compra", "Ajuste"] as const;
export const EXIT_REASONS = ["Devolución", "Venta", "Daño", "Vencido", "Ajuste"] as const;

export type MovementReason =
  | (typeof ENTRY_REASONS)[number]
  | (typeof EXIT_REASONS)[number];
