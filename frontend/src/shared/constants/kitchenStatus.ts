/**
 * Estados de cocina (manual §1.6.4): Requerido → En preparación → Listo.
 * "nuevo" = sin confirmar (PHP: estado "pendiente" en CSV);
 * "listo" equivale al PHP "entregado"; "cancelado" = PRODUCTO CANCELADO.
 */
export const KITCHEN_STATUS = {
  NUEVO: "nuevo",
  REQUERIDO: "requerido",
  EN_PREPARACION: "en_preparacion",
  LISTO: "listo",
  CANCELADO: "cancelado",
} as const;

export type KitchenStatus = (typeof KITCHEN_STATUS)[keyof typeof KITCHEN_STATUS];

export const KITCHEN_STATUS_LABELS: Record<KitchenStatus, string> = {
  nuevo: "Nuevo",
  requerido: "Requerido",
  en_preparacion: "En preparación",
  listo: "Listo",
  cancelado: "Cancelado",
};

/** Transiciones visibles en el Monitor de Cocina. */
export const KITCHEN_FLOW: KitchenStatus[] = ["requerido", "en_preparacion", "listo"];
