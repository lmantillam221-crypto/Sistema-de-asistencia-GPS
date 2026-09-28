import { Router } from '../lib/enrutador.js';
import { z } from 'zod';
import { validar } from '../lib/errores.js';
import { COOKIE_APP, COOKIE_PANEL, h, leerCookies, limitador, ponerCookie } from '../middleware.js';
import { hayAdmin, configurarNegocio } from '../lib/configuracion-inicial.js';

const esqLogin = z.object({ codigo: z.string().trim().min(1).max(40), clave: z.string().min(1).max(200) });

export function rutasAuth(ctx) {
  const r = Router();
  const lim = limitador();
  const cookieOpc = (req) => ({ dias: ctx.cfg.sesionDias, seguro: ctx.cfg.produccion && (req.secure || ctx.cfg.trustProxy) });

  r.get('/estado', h(async (req, res) => {
    const emp = ctx.s.empresa.obtener();
    res.json({ empresa: emp.nombre, rubro: emp.rubro, demo: ctx.cfg.demo, relojSimulado: ctx.reloj.simulado, ahora: ctx.reloj.ahora(), zona: emp.zona_horaria, version: '2.2.0', configurar: !(await hayAdmin(ctx)), tiempoReal: ctx.cfg.tiempoReal || 'sse', marca: ctx.cfg.marca });
  }));

  /* Asistente de primer uso: solo funciona mientras no exista ninguna cuenta de administración. */
  r.post('/panel/configurar', lim, h(async (req, res) => {
    const d = validar(z.object({
      empresa: z.string().max(80).optional(), rubro: z.string().max(80).optional(),
      admin: z.object({ codigo: z.string().trim().min(2).max(20), nombre: z.string().trim().min(1).max(80), clave: z.string().min(8).max(200) }),
      tienda: z.object({ nombre: z.string().trim().min(1).max(80), direccion: z.string().max(160).optional(), coords: z.string().max(60), radio_m: z.number().int().min(10).max(5000).optional() }),
      horario: z.object({ inicio: z.string().regex(/^\d{2}:\d{2}$/), fin: z.string().regex(/^\d{2}:\d{2}$/) }).optional(),
      equipo: z.string().max(5000).optional(),
    }), req.body);
    const r2 = await configurarNegocio(ctx, d);
    const { token } = await ctx.s.usuarios.login({ codigo: d.admin.codigo, secreto: d.admin.clave, panel: true, ip: req.ip, agente: req.get('user-agent') });
    ponerCookie(res, COOKIE_PANEL, token, cookieOpc(req));
    res.status(201).json(r2);
  }));

  for (const [ruta, cookie, panel] of [['/app', COOKIE_APP, false], ['/panel', COOKIE_PANEL, true]]) {
    r.post(`${ruta}/login`, lim, h(async (req, res) => {
      const d = validar(esqLogin, req.body);
      const { token, usuario } = await ctx.s.usuarios.login({ codigo: d.codigo, secreto: d.clave, panel, ip: req.ip, agente: req.get('user-agent') });
      ponerCookie(res, cookie, token, cookieOpc(req));
      res.json({ usuario });
    }));
    r.post(`${ruta}/logout`, h(async (req, res) => {
      await ctx.s.usuarios.cerrarSesion(leerCookies(req)[cookie]);
      ponerCookie(res, cookie, '', cookieOpc(req));
      res.json({ ok: true });
    }));
  }
  return r;
}
