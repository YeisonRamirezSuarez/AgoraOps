-- =============================================================
-- 00038: MONEDA POR ESTABLECIMIENTO (nacional / internacional)
-- El producto puede operar en distintos países, por lo que el formato
-- de dinero (símbolo y decimales) se configura por establecimiento desde
-- la creación/edición en el Super Admin y aplica en toda la app.
--   currency_code     ISO de la moneda (COP, USD, …) — referencia.
--   currency_symbol   símbolo a mostrar antes del monto ($).
--   currency_decimals 0 o 2 decimales.
-- Default por país: CO → COP / $ / 0 ; EC → USD / $ / 2
-- (el Super Admin puede sobreescribirlo).
-- =============================================================

ALTER TABLE tenants
  ADD COLUMN currency_code     TEXT     NOT NULL DEFAULT 'COP',
  ADD COLUMN currency_symbol   TEXT     NOT NULL DEFAULT '$',
  ADD COLUMN currency_decimals SMALLINT NOT NULL DEFAULT 0
    CHECK (currency_decimals IN (0, 2));

-- Backfill de establecimientos existentes según su país.
UPDATE tenants SET currency_code = 'USD', currency_decimals = 2 WHERE country = 'EC';
UPDATE tenants SET currency_code = 'COP', currency_decimals = 0 WHERE country = 'CO';
