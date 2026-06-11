-- =============================================================
-- 00014: HORARIOS y OBJETIVOS — manual §1.7.4, §1.7.5
-- Sin equivalente en PHP (funcionalidad nueva del manual).
-- =============================================================

-- Franjas de horario (hora inicial - hora final)
CREATE TABLE schedule_templates (
  id          SERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  CHECK (end_time > start_time)
);

CREATE TABLE schedules (
  id          SERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  template_id INT NOT NULL REFERENCES schedule_templates(id),
  date        DATE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, template_id, date)          -- §1.7.4: sin duplicado mismo día
  -- Validaciones de app: sin horarios vencidos, sin solapamiento
);

-- §1.7.4: no eliminar franja asociada a un usuario
CREATE OR REPLACE FUNCTION guard_schedule_template_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM schedules WHERE template_id = OLD.id) THEN
    RAISE EXCEPTION 'No se puede eliminar un horario asociado a un usuario';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_schedule_templates_guard_delete BEFORE DELETE ON schedule_templates
  FOR EACH ROW EXECUTE FUNCTION guard_schedule_template_delete();

-- Objetivos: solo editables, no se agregan nuevos (§1.7.5)
CREATE TABLE objectives (
  id            SERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL UNIQUE REFERENCES tenants(id),
  daily_goal    NUMERIC(12,2) DEFAULT 0,
  daily_date    DATE,                         -- No menor que hoy (valida la app)
  weekly_goal   NUMERIC(12,2) DEFAULT 0,
  week_start    DATE,
  week_end      DATE,                         -- Entre 5 y 7 días (valida la app)
  monthly_goal  NUMERIC(12,2) DEFAULT 0,
  month_start   DATE,
  month_end     DATE,                         -- Entre 25 y 31 días (valida la app)
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_objectives_updated BEFORE UPDATE ON objectives
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
