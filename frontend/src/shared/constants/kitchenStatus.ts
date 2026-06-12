/**
 * Estados de cocina — mapeo 1:1 con id_kitchen_status de Polaris
 * (ver docs/polaris-restaurante-mesas-spec.md):
 *   nuevo (1 pendiente) · requerido / en_preparacion (2 en cocina) ·
 *   listo (3) · entregado (4) · devuelto (5: re-pedido tras devolución,
 *   vuelve al carrito) · cancelado (6).
 */
export const KITCHEN_STATUS = {
  NUEVO: "nuevo",
  REQUERIDO: "requerido",
  EN_PREPARACION: "en_preparacion",
  LISTO: "listo",
  ENTREGADO: "entregado",
  DEVUELTO: "devuelto",
  CANCELADO: "cancelado",
} as const;

export type KitchenStatus = (typeof KITCHEN_STATUS)[keyof typeof KITCHEN_STATUS];

export const KITCHEN_STATUS_LABELS: Record<KitchenStatus, string> = {
  nuevo: "Nuevo",
  requerido: "Requerido",
  en_preparacion: "En preparación",
  listo: "Listo",
  entregado: "Entregado",
  devuelto: "Devuelto",
  cancelado: "Cancelado",
};

/** Transiciones visibles en el Monitor de Cocina. */
export const KITCHEN_FLOW: KitchenStatus[] = ["requerido", "en_preparacion", "listo"];

/** ¿El ítem vive en el carrito (sin confirmar)? Polaris: estados 1 y 5. */
export function isCartStatus(s: KitchenStatus): boolean {
  return s === "nuevo" || s === "devuelto";
}

/** ¿El ítem está en cocina (confirmado, sin terminar)? Polaris: estado 2. */
export function isInKitchen(s: KitchenStatus): boolean {
  return s === "requerido" || s === "en_preparacion";
}

/** ¿Terminado por cocina (historial con badge LISTO)? Polaris: 3 y 4. */
export function isFinished(s: KitchenStatus): boolean {
  return s === "listo" || s === "entregado";
}
