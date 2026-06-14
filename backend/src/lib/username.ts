/**
 * Generación automática de username a partir del nombre completo. El usuario
 * NO se escribe ni se edita en el formulario: se deriva del nombre para evitar
 * el prueba y error de elegir nombres ya tomados cuando hay muchos usuarios.
 *
 * Formato: inicial del primer nombre + primer apellido, sin tildes y en
 * minúsculas (ej. "Juan Pérez Gómez" → "jperez"). Si colisiona se agrega un
 * sufijo numérico (jperez2, jperez3…). El username es ÚNICO GLOBALMENTE
 * (índice users_username_global_key, mig 00050), así que se valida contra
 * TODOS los establecimientos.
 */
import { query } from "../db.js";
import { isReservedUsername } from "./constants.js";

/** Base del username: inicial del primer nombre + primer apellido, sin tildes. */
export function baseUsername(fullName: string): string {
  const tokens = fullName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita tildes/diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // descarta puntuación/símbolos
    .split(/\s+/)
    .filter(Boolean);

  let base: string;
  if (tokens.length >= 2) base = tokens[0]!.charAt(0) + tokens[1]!;
  else if (tokens.length === 1) base = tokens[0]!;
  else base = "usuario";

  return base.slice(0, 24);
}

/**
 * Devuelve un username único globalmente derivado del nombre. Consulta en UNA
 * sola query los nombres ya tomados con ese prefijo y elige el primer candidato
 * libre (base, base2, base3…), saltando los reservados. El índice único global
 * es la red de seguridad ante una carrera entre el SELECT y el INSERT.
 */
export async function generateUsername(fullName: string): Promise<string> {
  const base = baseUsername(fullName);
  const taken = new Set(
    (
      await query<{ username: string }>(
        "SELECT username FROM users WHERE username LIKE $1 || '%'",
        [base],
      )
    ).map((r) => r.username),
  );
  for (let n = 0; n < 1000; n++) {
    const candidate = n === 0 ? base : `${base}${n + 1}`;
    if (!taken.has(candidate) && !isReservedUsername(candidate)) return candidate;
  }
  // Salvaguarda prácticamente inalcanzable: garantiza unicidad por tiempo.
  return `${base}${Date.now()}`;
}
