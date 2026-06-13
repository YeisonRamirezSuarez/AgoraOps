-- =============================================================
-- 00042: Configuración de impresoras — réplica EXACTA de Polaris
-- (grid_printer_config) + extensiones acordadas con el cliente.
--
-- Polaris (verificado en producción, solo lectura):
--   · La misma impresora física se registra UNA VEZ POR ENDPOINT
--     (PAGO / PEDIDO / PREFACTURA / CAJA) → "POS-80C" aparece 4 veces.
--   · Campos: Nombre, Tipo de conexión (USB/ETHERNET), IP + Puerto
--     (solo ETHERNET), Endpoint, Estado, Ubicación.
--
-- Extensiones (decisión del cliente: "igual a Polaris + extender"):
--   · paper_width: ancho del papel por impresora (58mm/80mm) para que el
--     formateador ESC/POS arme la tirilla al número de columnas correcto
--     en parques de impresoras mezcladas.
--   · BLUETOOTH como tipo de conexión (entra por el spooler del SO igual
--     que USB en el servicio de impresión local).
-- =============================================================

-- 1) Endpoint (rol de la impresora) — igual que Polaris
ALTER TABLE printers
  ADD COLUMN IF NOT EXISTS endpoint TEXT
  CHECK (endpoint IN ('PAGO', 'PEDIDO', 'PREFACTURA', 'CAJA'));

-- 2) Ancho de papel (extensión) — 58mm o 80mm, por defecto 80
ALTER TABLE printers
  ADD COLUMN IF NOT EXISTS paper_width INT NOT NULL DEFAULT 80
  CHECK (paper_width IN (58, 80));

-- 3) Permitir BLUETOOTH en el tipo de conexión (extensión)
ALTER TABLE printers DROP CONSTRAINT IF EXISTS printers_connection_type_check;
ALTER TABLE printers
  ADD CONSTRAINT printers_connection_type_check
  CHECK (connection_type IN ('USB', 'ETHERNET', 'BLUETOOTH'));

-- 4) La unicidad ya no es por nombre (Polaris repite el nombre por endpoint):
--    pasa a ser (tenant_id, name, endpoint).
ALTER TABLE printers DROP CONSTRAINT IF EXISTS printers_tenant_id_name_key;
ALTER TABLE printers
  ADD CONSTRAINT printers_tenant_id_name_endpoint_key
  UNIQUE (tenant_id, name, endpoint);
