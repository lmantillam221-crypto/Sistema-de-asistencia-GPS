/* Reglas del negocio configurables desde el panel. Validadas con zod y con valores por defecto. */
import { z } from 'zod';

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)');
const item = z.string().trim().min(1).max(80);

export const esquemaAjustes = z.object({
  toleranciaMin: z.number().int().min(0).max(120).default(30),
  intervaloControlMin: z.number().int().min(5).max(240).default(30),
  precisionMaximaM: z.number().int().min(20).max(1000).default(100),
  maxTurnosSemana: z.number().int().min(1).max(21).default(1),
  ventana: z.object({ dia: z.number().int().min(0).max(6), desde: hora, hasta: hora })
    .refine((v) => v.hasta > v.desde, 'La ventana debe terminar después de empezar')
    .default({ dia: 0, desde: '21:00', hasta: '22:00' }),
  ventanaSemanaCompleta: z.boolean().default(false),
  // Elección de horarios
  elegirHoras: z.boolean().default(true), // cada persona elige su hora de entrada y salida dentro del bloque
  pasoMinutos: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(30),
  horasMinTurno: z.number().min(0).max(16).default(0), // 0 = sin mínimo
  horasMaxTurno: z.number().min(0).max(16).default(0), // 0 = sin límite
  horasMinSemana: z.number().min(0).max(80).default(0),
  horasMaxSemana: z.number().min(0).max(80).default(0),
  unTurnoPorDia: z.boolean().default(true),
  permitirSoltar: z.boolean().default(true),
  mostrarCompaneras: z.boolean().default(true),
  multas: z.object({
    tardanza: z.number().min(0).max(10000).default(5),
    falta: z.number().min(0).max(10000).default(20),
    salidaAnticipada: z.number().min(0).max(10000).default(0),
  }).default({}),
  recordatorioHoras: z.number().min(0).max(48).default(2),
  exigirUbicacionEnEntrada: z.boolean().default(false),
  permitirCubrir: z.boolean().default(true),
  controlDispositivo: z.boolean().default(true),
  registrarVentas: z.boolean().default(true),
  checklistApertura: z.array(item).max(15).default([
    'Luces, música y letrero encendidos',
    'Vitrina, maniquíes y percheros ordenados',
    'Caja inicial contada',
  ]),
  checklistCierre: z.array(item).max(15).default([
    'Prendas dobladas y colgadas por talla',
    'Caja cuadrada con las ventas del turno',
    'Probadores revisados y local cerrado con llave',
  ]),
});

const base = esquemaAjustes;
/** Además de cada campo, revisa que los mínimos no superen a los máximos. */
export const esquemaAjustesValidado = base.superRefine((a, c) => {
  if (a.horasMaxTurno && a.horasMinTurno > a.horasMaxTurno) c.addIssue({ code: 'custom', path: ['horasMinTurno'], message: 'Las horas mínimas por turno no pueden ser más que las máximas.' });
  if (a.horasMaxSemana && a.horasMinSemana > a.horasMaxSemana) c.addIssue({ code: 'custom', path: ['horasMinSemana'], message: 'Las horas mínimas por semana no pueden ser más que las máximas.' });
});

export const AJUSTES_POR_DEFECTO = esquemaAjustes.parse({});

export function normalizarAjustes(obj) {
  const r = esquemaAjustes.safeParse(obj || {});
  return r.success ? r.data : { ...AJUSTES_POR_DEFECTO, ...(obj || {}) };
}
