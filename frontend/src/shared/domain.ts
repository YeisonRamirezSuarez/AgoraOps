/**
 * Tipos de dominio de AgoraOps.
 * Nota: cuando Supabase esté corriendo, generar tipos exactos de BD con
 * `npm run db:types` (packages/shared/types/database.ts) y derivar de ahí.
 */
import type { KitchenStatus } from "./constants/kitchenStatus";
import type { OrderStatus } from "./constants/orderStatus";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  country: "CO" | "EC";
  timezone: string;
  logo_url: string | null;
  is_active: boolean;
}

export interface Group {
  id: number;
  tenant_id: string;
  name: string;
  role_type: "administrador" | "empleado";
}

export interface Profile {
  id: string;
  tenant_id: string | null;
  username: string;
  email: string;
  full_name: string;
  phone: string | null;
  group_id: number | null;
  is_super_admin: boolean;
  is_worker: boolean;
  is_locked: boolean;
  must_change_password: boolean;
  is_active: boolean;
  group?: Group;
}

export interface Room {
  id: number;
  tenant_id: string;
  name: string;
  is_active: boolean;
}

export interface RestaurantTable {
  id: number;
  tenant_id: string;
  room_id: number;
  number: number;
  seats: number;
  is_active: boolean;
}

export interface Category {
  id: number;
  tenant_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

export interface Product {
  id: number;
  tenant_id: string;
  category_id: number;
  code: string;
  name: string;
  description: string | null;
  product_type: "NORMAL" | "COMBO";
  sale_price: number;
  cost_price: number;
  is_inventariable: boolean;
  goes_to_kitchen: boolean;
  image_url: string | null;
  printer_id: number | null;
  is_active: boolean;
}

export interface ProductVariant {
  id: number;
  product_id: number;
  name: string;
  sale_price: number;
  uses_inventory: boolean;
  inventory_mode: "receta" | "consumible" | null;
  is_active: boolean;
}

export interface Topping {
  id: number;
  tenant_id: string;
  name: string;
  price: number;
  inventory_mode: "consumible" | "receta" | null;
  is_active: boolean;
}

export interface InventoryProduct {
  id: number;
  tenant_id: string;
  type: "ingrediente" | "consumible";
  name: string | null;
  unit: string;
  product_id: number | null;
  stock: number;
  min_stock: number;
  is_active: boolean;
}

export interface Order {
  id: number;
  tenant_id: string;
  order_number: string;
  table_id: number | null;
  room_id: number | null;
  status: OrderStatus;
  comment: string | null;
  customer_name: string;
  opened_at: string;
  user_id: string;
  attended_by: string | null;
  client_id: number | null;
  subtotal: number;
  tip: number;
  service: number;
  total: number;
  amount_paid: number;
  items?: OrderItem[];
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number | null;
  variant_id: number | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  notes: string | null;
  kitchen_status: KitchenStatus;
  confirmed_at: string | null;
  is_paid: boolean;
  unique_code: string;
  printer_id: number | null;
  toppings?: OrderItemTopping[];
}

export interface OrderItemTopping {
  id: number;
  order_item_id: number;
  topping_id: number | null;
  topping_name: string;
  topping_price: number;
  quantity: number;
}

export interface PaymentMethod {
  id: number;
  tenant_id: string;
  name: string;
  is_active: boolean;
  is_legacy: boolean;
}

export interface Bank {
  id: number;
  tenant_id: string;
  name: string;
  is_active: boolean;
}

export interface CashRegister {
  id: number;
  tenant_id: string;
  name: string;
  status: "FUNCIONANDO" | "FALLANDO";
  note: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CashSession {
  id: number;
  tenant_id: string;
  cash_register_id: number;
  user_id: string;
  user_name: string | null;
  status: "abierta" | "cerrada";
  opening_amount: number;
  income_total: number;
  expense_total: number;
  registered_total: number;
  cash_total: number;
  counted_cash: number | null;
  difference: number | null;
  note: string | null;
  opened_at: string;
  closed_at: string | null;
}

export interface Client {
  id: number;
  tenant_id: string;
  document_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
}
