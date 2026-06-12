import { pool } from "./src/db.js";

async function run() {
  const client = await pool.connect();
  try {
    const tenantId = '00000000-0000-0000-0000-000000000001';
    await client.query("DELETE FROM inventory_products WHERE name IN ('JUGO DE MORA', 'COMINO', 'QUESO MOZZARELLA')");
    await client.query(`
      INSERT INTO inventory_products (tenant_id, name, type, unit, min_stock, stock, is_active)
      VALUES 
        ($1, 'JUGO DE MORA', 'ingrediente', 'Unidad', 10, 9, true),
        ($1, 'COMINO', 'ingrediente', 'Gramos', 100, 0, true),
        ($1, 'QUESO MOZZARELLA', 'ingrediente', 'Gramos', 500, -250.5, true)
    `, [tenantId]);
    console.log("Demo overdraft inventory added successfully.");
  } catch (error) {
    console.error("Error seeding inventory products:", error);
  } finally {
    client.release();
    await pool.end();
  }
}
run();
