/**
 * Roles base según el manual de referencia (§1.2).
 * Los roles se gestionan en Seguridad → Grupos (tipo administrador/empleado);
 * estos nombres son los grupos de referencia que siembra el sistema.
 */
export const BASE_GROUPS = {
  ADMINISTRADOR: "Administrador",
  MESERO: "Mesero",
  COCINA: "Cocina",
  MESERO_COCINA: "Mesero_cocina",
} as const;

export type RoleType = "administrador" | "empleado";

/** Acceso por módulo según manual §1.2 (tabla de permisos). */
export const MODULE_ACCESS: Record<string, string[]> = {
  // Restaurante
  "restaurante/menu": [BASE_GROUPS.ADMINISTRADOR, BASE_GROUPS.MESERO, BASE_GROUPS.MESERO_COCINA],
  "restaurante/qr": [BASE_GROUPS.ADMINISTRADOR, BASE_GROUPS.MESERO, BASE_GROUPS.MESERO_COCINA],
  "restaurante/mesas": [BASE_GROUPS.ADMINISTRADOR, BASE_GROUPS.MESERO, BASE_GROUPS.MESERO_COCINA],
  "restaurante/monitor-cocina": [BASE_GROUPS.ADMINISTRADOR, BASE_GROUPS.COCINA, BASE_GROUPS.MESERO_COCINA],
  "restaurante/reservaciones": [BASE_GROUPS.ADMINISTRADOR],
  "restaurante/clientes": [BASE_GROUPS.ADMINISTRADOR],
  "restaurante/notificaciones": [BASE_GROUPS.ADMINISTRADOR],
  // Reportes
  "reportes/general": [BASE_GROUPS.ADMINISTRADOR],
  "reportes/ventas": [BASE_GROUPS.ADMINISTRADOR, BASE_GROUPS.MESERO_COCINA],
  "reportes/ordenes-canceladas": [BASE_GROUPS.ADMINISTRADOR],
  "reportes/duplicado-voucher": [BASE_GROUPS.MESERO, BASE_GROUPS.MESERO_COCINA],
  // Solo administrador
  configuracion: [BASE_GROUPS.ADMINISTRADOR],
  cajas: [BASE_GROUPS.ADMINISTRADOR],
  productos: [BASE_GROUPS.ADMINISTRADOR],
  inventario: [BASE_GROUPS.ADMINISTRADOR],
  seguridad: [BASE_GROUPS.ADMINISTRADOR],
};
