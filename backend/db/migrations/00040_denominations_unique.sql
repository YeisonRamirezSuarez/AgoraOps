-- =============================================================
-- 00040: DENOMINACIÓN DE MONEDA — valor único por establecimiento
-- (Configuración restaurante → Denominación de moneda).
-- En Polaris las denominaciones son valores físicos de billetes/monedas
-- (50, 100, … 50.000) inherentemente únicos; no tiene sentido repetir un
-- valor. `banks` ya tiene UNIQUE(tenant_id, name) desde 00010; aquí se
-- alinea `currency_denominations` con la misma regla.
-- (No se pudo verificar por escritura en el Polaris de producción del
--  cliente — solo lectura —; se aplica la regla lógica y consistente con
--  bancos. El backend traduce 23505 a "Ya existe un registro con esos datos".)
-- =============================================================

-- Deduplicar valores repetidos preexistentes (conserva el id más bajo)
-- antes de crear el índice único, para que la migración no falle.
DELETE FROM currency_denominations a
USING currency_denominations b
WHERE a.tenant_id = b.tenant_id
  AND a.value     = b.value
  AND a.id        > b.id;

ALTER TABLE currency_denominations
  ADD CONSTRAINT currency_denominations_tenant_value_key
  UNIQUE (tenant_id, value);
