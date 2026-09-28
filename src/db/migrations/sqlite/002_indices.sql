-- Índices para consultas frecuentes con años de datos
CREATE INDEX IF NOT EXISTS sesiones_expira ON sesiones(expira);
CREATE INDEX IF NOT EXISTS multas_fecha ON multas(fecha);
CREATE INDEX IF NOT EXISTS justificaciones_multa ON justificaciones(multa_id);
