/**
 * Runner de migraciones sin Docker ni CLI externas.
 *   npm run db:migrate          → aplica migraciones pendientes
 *   npm run db:seed             → migraciones + seed.sql
 * Lee apps/api/db/migrations/*.sql en orden y registra lo aplicado en
 * la tabla _migrations.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");
const SEED_FILE = join(__dirname, "..", "..", "db", "seed.sql");

async function main() {
  const withSeed = process.argv.includes("--seed");
  const client = await pool.connect();

  try {
    await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    )`);

    const applied = new Set(
      (await client.query("SELECT name FROM _migrations")).rows.map(
        (r) => r.name,
      ),
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      console.log(`Aplicando ${file}…`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`✗ Falló ${file}`);
        throw err;
      }
    }

    if (withSeed) {
      console.log("Aplicando seed.sql…");
      await client.query(readFileSync(SEED_FILE, "utf8"));
    }

    console.log("✓ Base de datos al día");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
