/** Razones de movimientos de inventario (manual §1.11.4). */
export const ENTRY_REASONS = ["Compra", "Ajuste"];
export const EXIT_REASONS = ["Devolución", "Venta", "Daño", "Vencido", "Ajuste"];

/**
 * Usernames reservados: NO se permiten al crear usuarios ni al provisionar
 * establecimientos (comparación sin distinguir mayúsculas). Evita cuentas
 * sensibles tipo admin/root en cualquier establecimiento.
 * Nota: "superadmin" se bloquea aquí para impedir crear cuentas nuevas, pero
 * la cuenta de plataforma ya existente con ese nombre sigue siendo válida (por
 * eso queda EXCLUIDA del CHECK de BD en la migración 00051).
 */
export const RESERVED_USERNAMES = new Set([
  "admin", "root", "administrator", "administrador",
  "superadmin", "superuser", "sysadmin", "postgres", "system",
]);

/** True si el username está reservado (normaliza espacios y mayúsculas). */
export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(username.trim().toLowerCase());
}

/**
 * Contraseña temporal con la que se crean los usuarios y administradores. Es
 * fija a propósito (fácil de dictar/entregar) y se fuerza el cambio en el
 * primer ingreso (must_change_password = true). Cumple complejidad básica:
 * mayúscula + minúscula + dígitos + símbolo.
 */
export const TEMP_PASSWORD = "AgoraOps123*";
