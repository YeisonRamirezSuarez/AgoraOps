-- =============================================================
-- 00023: notificar aperturas/cierres de caja por SSE.
-- La vista de Mesas bloquea la creación de mesas cuando todas las
-- cajas están cerradas (§1.6.3) y debe reflejarlo en vivo cuando
-- alguien abre o cierra una caja.
-- =============================================================

CREATE TRIGGER trg_cash_sessions_notify
  AFTER INSERT OR UPDATE OR DELETE ON cash_sessions
  FOR EACH ROW EXECUTE FUNCTION notify_app_event();
