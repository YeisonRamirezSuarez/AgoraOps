/**
 * Catálogos CRUD del manual montados con la fábrica genérica.
 * Las validaciones de negocio (nombre inmutable, no eliminar con
 * dependencias, montos > 0…) las aplican los triggers/constraints de BD
 * y se traducen a mensajes con dbErrorMessage().
 */
import { Router } from "express";
import { crudRouter } from "../lib/crud.js";

export const catalogsRouter = Router();

// §1.7.1 Salas
catalogsRouter.use("/rooms", crudRouter({
  table: "rooms",
  columns: ["name", "is_active"],
}));

// §1.7.2 Mesas del restaurante (número inmutable; Configuración = admin.
// La vista operativa de mesas para meseros es GET /api/orders/board.)
catalogsRouter.use("/tables", crudRouter({
  table: "tables",
  columns: ["room_id", "number", "seats", "is_active"],
  immutable: ["number"],
}));

// §1.10.3 Categorías
catalogsRouter.use("/categories", crudRouter({
  table: "categories",
  columns: ["name", "description", "is_active"],
  orderBy: "name",
}));

// §1.10.4 Toppings
catalogsRouter.use("/toppings", crudRouter({
  table: "toppings",
  columns: ["name", "price", "inventory_mode", "is_active"],
}));

// §1.6.6 Clientes (PHP: clientes.php; eliminar valida ventas/reservas en BD)
catalogsRouter.use("/clients", crudRouter({
  table: "clients",
  columns: ["document_id", "name", "phone", "email", "address"],
  adminOnly: false, // el pago necesita listar/crear clientes (§1.6.3)
  orderBy: "name",
}));

// §1.11.3 Proveedores
catalogsRouter.use("/suppliers", crudRouter({
  table: "suppliers",
  columns: ["name", "phone", "email", "address", "is_active"],
  orderBy: "name",
}));

// §1.7.9 Bancos para transferencia
catalogsRouter.use("/banks", crudRouter({
  table: "banks",
  columns: ["name", "is_active"],
  orderBy: "name",
}));

// §1.7.8 Denominación de moneda
catalogsRouter.use("/denominations", crudRouter({
  table: "currency_denominations",
  columns: ["value", "is_active"],
  orderBy: "value",
}));

// §1.8.6 Impresoras (nombre inmutable — trigger en BD)
catalogsRouter.use("/printers", crudRouter({
  table: "printers",
  columns: ["name", "connection_type", "device_name", "ip_address", "port", "location", "is_active"],
}));

// §1.14 Grupos (eliminar con usuarios asociados lo bloquea el trigger)
catalogsRouter.use("/groups", crudRouter({
  table: "groups",
  columns: ["name", "role_type"],
  orderBy: "name",
}));

// §1.11.1 Productos del inventario
catalogsRouter.use("/inventory-products", crudRouter({
  table: "inventory_products",
  columns: ["type", "name", "unit", "product_id", "variant_id", "topping_id", "stock", "min_stock", "is_active"],
  orderBy: "name",
}));

// §1.8.2 Cajas (editar solo estado/nota y eliminar si nunca abierta — triggers BD)
catalogsRouter.use("/cash-registers", crudRouter({
  table: "cash_registers",
  columns: ["name", "status", "note"],
  immutable: ["name"],
}));
