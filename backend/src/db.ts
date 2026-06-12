import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  ssl: config.dbSsl, // centralizado en config (localhost sin SSL, hosted con SSL)
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
