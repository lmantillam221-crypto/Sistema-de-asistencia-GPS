-- Horarios editables y elegidos con hora de entrada y salida
-- personalizado = el día se editó a mano: la plantilla ya no lo cambia.
ALTER TABLE dias_generados ADD COLUMN personalizado INTEGER NOT NULL DEFAULT 0;
-- Rango original del bloque cuando alguien elige su propia hora dentro de él (para devolverlo al soltarlo).
ALTER TABLE turnos ADD COLUMN bloque_inicio TEXT;
ALTER TABLE turnos ADD COLUMN bloque_fin TEXT;
