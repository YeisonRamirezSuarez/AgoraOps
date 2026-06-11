-- =============================================================
-- 00017: FACTURACIÓN ELECTRÓNICA — manual v17 (certificados + secuencias)
-- Origen PHP: tablas documentos (respuesta DIAN: success, is_valid,
-- status_code, xml_base64, invoice_xml, cufe, uuid_dian, qr_string,
-- certificate_days_left, resolution_days_left) y datos_facturae (number).
-- =============================================================

CREATE TABLE invoices (
  id                    SERIAL PRIMARY KEY,
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  order_id              INT REFERENCES orders(id),
  client_id             INT REFERENCES clients(id),
  success               BOOLEAN DEFAULT false,
  message               TEXT,
  email_sent            BOOLEAN DEFAULT false,    -- PHP: send_email_success
  email_sent_at         TIMESTAMPTZ,              -- PHP: send_email_date_time
  is_valid              BOOLEAN DEFAULT false,
  status_code           TEXT,
  status_description    TEXT,
  xml_base64            TEXT,
  invoice_xml           TEXT,
  cufe                  TEXT,                     -- CUFE (CO) / clave de acceso (EC)
  uuid_dian             TEXT,
  qr_string             TEXT,
  certificate_days_left INT,
  resolution_days_left  INT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE invoice_certificates (
  id          SERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,
  expires_at  DATE,
  days_left   INT
);

-- Lista de secuencias (PHP: datos_facturae.number)
CREATE TABLE invoice_sequences (
  id             SERIAL PRIMARY KEY,
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  prefix         TEXT DEFAULT 'FE',
  current_number INT DEFAULT 0,
  resolution     TEXT,
  valid_until    DATE
);
