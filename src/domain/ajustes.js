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

export const AJUSTES_POR_DEFECTO = esquemaAjustes.parse({});

export function normalizarAjustes(obj) {
  const r = esquemaAjustes.safeParse(obj || {});
  return r.success ? r.data : { ...AJUSTES_POR_DEFECTO, ...(obj || {}) };
}
