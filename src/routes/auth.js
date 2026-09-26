import { Router } from 'express';
import { z } from 'zod';
import { validar } from '../lib/errores.js';
import { COOKIE_APP, COOKIE_PANEL, h, leerCookies, limitador, ponerCookie } from '../middleware.js';

const esqLogin = z.object({ codigo: z.string().trim().min(1).max(40), clave: z.string().min(1).max(200) });

export function rutasAuth(ctx) {
  const r = Router();
  const lim = limitador({ max: 40 });
  const cookieOpc = (req) => ({ dias: ctx.cfg.sesionDias, seguro: ctx.cfg.produccion && (req.secure || ctx.cfg.trustProxy) });

  r.get('/estado', (req, res) => {
    const emp = ctx.s.empresa.obtener();
    res.json({ empresa: emp.nombre, rubro: emp.rubro, demo: ctx.cfg.demo, relojSimulado: ctx.reloj.simulado, ahora: ctx.reloj.ahora(), zona: emp.zona_horaria, version: '2.0.0' });
  });

  for (const [ruta, cookie, panel] of [['/app', COOKIE_APP, false], ['/panel', COOKIE_PANEL, true]]) {
    r.post(`${ruta}/login`, lim, h((req, res) => {
      const d = validar(esqLogin, req.body);
      const { token, usuario } = ctx.s.usuarios.login({ codigo: d.codigo, secreto: d.clave, panel, ip: req.ip, agente: req.get('user-agent') });
      ponerCookie(res, cookie, token, cookieOpc(req));
      res.json({ usuario });
    }));
    r.post(`${ruta}/logout`, h((req, res) => {
      ctx.s.usuarios.cerrarSesion(leerCookies(req)[cookie]);
      ponerCookie(res, cookie, '', cookieOpc(req));
      res.json({ ok: true });
    }));
  }
  return r;
}
