/* Componentes de interfaz: toast, tooltip, hojas/modales y redibujado que conserva lo escrito. */
import { esc } from './util.js';

let toastT;
export function toast(texto, tipo = '') {
  let el = document.getElementById('toast');
  if (!el) { el = Object.assign(document.createElement('div'), { id: 'toast', role: 'status' }); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
  el.className = 'toast ' + tipo; el.textContent = texto; el.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 3800);
}

/** Tooltips para gráficos (atributo data-tip con texto plano). */
export function activarTooltips() {
  const tip = Object.assign(document.createElement('div'), { className: 'tip', hidden: true });
  document.body.appendChild(tip);
  document.addEventListener('pointerover', (e) => { const el = e.target.closest?.('[data-tip]'); if (!el) return; tip.textContent = el.dataset.tip; tip.hidden = false; });
  document.addEventListener('pointermove', (e) => {
    if (tip.hidden) return;
    const w = tip.offsetWidth, h = tip.offsetHeight; let x = e.clientX + 14, y = e.clientY + 14;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14; if (y + h > innerHeight - 8) y = e.clientY - h - 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  });
  document.addEventListener('pointerout', (e) => { if (e.target.closest?.('[data-tip]') && !e.relatedTarget?.closest?.('[data-tip]')) tip.hidden = true; });
}

/** Reemplaza el HTML de un contenedor conservando valores escritos, foco y <details> abiertos. */
export function redibujar(cont, html) {
  const vals = {}, act = document.activeElement, actId = act && cont.contains(act) ? act.id : null;
  let sel = null;
  cont.querySelectorAll('input[id], select[id], textarea[id]').forEach((el) => { if (el.type !== 'file' && !el.dataset.fijo) vals[el.id] = el.type === 'checkbox' ? el.checked : el.value; });
  if (actId && act.selectionStart != null) { try { sel = [act.selectionStart, act.selectionEnd]; } catch {} }
  const abiertos = [...cont.querySelectorAll('details[id]')].map((d) => [d.id, d.open]);
  const scrolls = [...cont.querySelectorAll('[data-scroll][id]')].map((d) => [d.id, d.scrollLeft, d.scrollTop]);
  cont.innerHTML = html;
  for (const [id, v] of Object.entries(vals)) {
    const el = cont.querySelector('#' + CSS.escape(id));
    if (!el || el.dataset.fijo) continue;
    if (el.type === 'checkbox') el.checked = v; else el.value = v;
  }
  for (const [id, o] of abiertos) { const d = cont.querySelector('#' + CSS.escape(id)); if (d) d.open = o; }
  for (const [id, x, y] of scrolls) { const d = cont.querySelector('#' + CSS.escape(id)); if (d) { d.scrollLeft = x; d.scrollTop = y; } }
  if (actId) { const el = cont.querySelector('#' + CSS.escape(actId)); if (el) { el.focus({ preventScroll: true }); if (sel) { try { el.setSelectionRange(...sel); } catch {} } } }
}

/** Abre una hoja inferior (móvil) o modal (panel). Devuelve el elemento y una función para cerrarlo. */
export function abrirCapa(html, { clase = 'modal', fondo = 'modal-fondo', alCerrar } = {}) {
  cerrarCapa();
  const f = document.createElement('div');
  f.className = fondo; f.id = 'capa';
  f.innerHTML = `<div class="${clase}" role="dialog" aria-modal="true" tabindex="-1">${html}</div>`;
  f.addEventListener('click', (e) => { if (e.target === f || e.target.closest('[data-cerrar]')) cerrarCapa(); });
  document.body.appendChild(f);
  document.body.style.overflow = 'hidden';
  f._alCerrar = alCerrar;
  // En el celular (hojas) no se abre el teclado solo; en el panel se enfoca el primer campo si nadie lo hizo antes.
  setTimeout(() => {
    if (f.contains(document.activeElement)) return;
    (fondo === 'hoja-fondo' ? f.querySelector('.hoja') : f.querySelector('input:not([type=checkbox]), textarea, select, button.btn-p'))?.focus({ preventScroll: true });
  }, 30);
  return f.firstElementChild;
}
export function cerrarCapa() {
  const f = document.getElementById('capa');
  if (!f) return;
  f._alCerrar?.();
  f.remove();
  document.body.style.overflow = '';
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarCapa(); });

/** Confirmación con botones propios (en lugar de window.confirm). */
export function confirmar({ titulo, texto = '', si = 'Confirmar', no = 'Cancelar', peligro = false, clase = 'modal', fondo = 'modal-fondo' }) {
  return new Promise((ok) => {
    let respondido = false;
    const el = abrirCapa(`<h2>${esc(titulo)}</h2>${texto ? `<p class="muted">${texto}</p>` : ''}
      <div class="row" style="justify-content:flex-end"><button type="button" data-r="no">${esc(no)}</button><button type="button" class="${peligro ? 'btn-dark' : 'btn-p'}" data-r="si">${esc(si)}</button></div>`,
    { clase, fondo, alCerrar: () => { if (!respondido) ok(false); } });
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (!b) return; respondido = true; ok(b.dataset.r === 'si'); cerrarCapa(); });
  });
}

export const ICONOS = {
  hoy: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  calendario: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  multa: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M7 15h4"/>',
  perfil: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  vivo: '<circle cx="12" cy="12" r="3"/><path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7"/>',
  grafico: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  equipo: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.5c2.5 0 4.5 1.2 5.5 4"/>',
  tienda: '<path d="M3 9l1.5-5h15L21 9M3 9h18v11H3zM3 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3"/>',
  reporte: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  historial: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  wa: '<path d="M20.5 12a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.1-4.2A8.5 8.5 0 1 1 20.5 12z"/>',
};
export const icono = (n, tam = 24, extra = '') => `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${ICONOS[n] || ''}</svg>`;
