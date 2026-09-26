/* Tiendas: ubicación, geocerca (radio permitido) y estado. */
import { esc, fmtDist, leerCoords } from '../../core/util.js';
import { toast, abrirCapa, cerrarCapa } from '../../core/ui.js';
import { crearMapa } from '../mapa.js';

let mapa = null;
export default {
  id: 'tiendas', titulo: 'Tiendas', icono: 'tienda', grupo: 'Gestión',
  cargar: (P) => P.api.get('/panel/tiendas'),
  render(d, P) {
    return `<div class="grid-2"><div class="card"><div class="row between"><div><h2>Tiendas y puntos de venta</h2><span class="small muted">La geocerca es el círculo dentro del cual la marca cuenta como "en tienda".</span></div>
        ${P.esAdmin() ? '<button type="button" class="btn-p" data-accion="nueva">Agregar tienda</button>' : ''}</div>
      ${d.length ? d.map((t) => `<div class="lista-row"><div><b>${esc(t.nombre)}</b> <span class="tiny muted">${esc(t.codigo)}</span><div class="tiny muted">${esc(t.direccion || '')} · ${t.lat.toFixed(5)}, ${t.lng.toFixed(5)} · radio ${fmtDist(t.radio_m)}</div></div>
        <div class="row nw">${t.activa ? '<span class="chip ok">Activa</span>' : '<span class="chip grey">Inactiva</span>'}<a class="btn btn-sm" href="https://www.google.com/maps?q=${t.lat},${t.lng}" target="_blank" rel="noopener">Maps</a>${P.esAdmin() ? `<button type="button" class="btn-sm" data-accion="editar" data-id="${t.id}">Editar</button>` : ''}</div></div>`).join('') : '<div class="vacio">Aún no hay tiendas. Agrega la primera para empezar.</div>'}</div>
      <div class="card"><h2>Mapa</h2><div class="mapa alto" id="mapaTiendas"></div></div></div>`;
  },
  alPintar(d) {
    const el = document.getElementById('mapaTiendas');
    if (!el || !window.L) return;
    mapa = crearMapa(el, mapa);
    mapa.dibujar(d.filter((t) => t.activa), []);
  },
  accion(a, el, P) {
    if (a === 'nueva') return formulario(null, P);
    if (a === 'editar') return formulario(P.datos.tiendas.find((t) => t.id === Number(el.dataset.id)), P);
  },
};

function formulario(t, P) {
  const m = abrirCapa(`<h2>${t ? 'Editar tienda' : 'Nueva tienda'}</h2>
    <div class="grid-form"><label class="f">Nombre<input type="text" id="tN" value="${esc(t?.nombre || '')}" maxlength="80" placeholder="Ej.: Galería Arcángel"></label>
      <label class="f">Dirección / referencia<input type="text" id="tD" value="${esc(t?.direccion || '')}" maxlength="160" placeholder="Ej.: Stand 12, 2.º piso"></label>
      <label class="f">Coordenadas (lat, lng)<input type="text" id="tC" value="${t ? `${t.lat}, ${t.lng}` : ''}" placeholder="-7.1547, -78.5166"><small>Toca el mapa o pega desde Google Maps</small></label>
      <label class="f">Radio permitido (m)<input type="number" id="tR" value="${t?.radio_m ?? 80}" min="10" max="5000"><small>En galerías y centros comerciales usa 50–100 m</small></label></div>
    <div class="row"><button type="button" class="btn-sm" id="tAqui">Usar mi ubicación actual</button><span class="tiny muted" id="tInfo"></span></div>
    <div class="mapa" id="mapaForm" style="height:300px"></div>
    ${t ? `<label class="check"><input type="checkbox" id="tA" ${t.activa ? 'checked' : ''}><span>Tienda activa</span></label>` : ''}
    <div class="row" style="justify-content:flex-end"><button type="button" data-cerrar>Cancelar</button><button type="button" class="btn-p" data-ok>Guardar</button></div>`, { clase: 'modal ancho' });
  let mf = null;
  const pintar = () => {
    const c = leerCoords(m.querySelector('#tC').value), r = Number(m.querySelector('#tR').value) || 80;
    if (!window.L) return;
    mf ||= crearMapa(m.querySelector('#mapaForm'), null, { alClic: (ll) => { m.querySelector('#tC').value = `${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`; pintar(); } });
    mf.dibujar(c ? [{ nombre: m.querySelector('#tN').value || 'Tienda', lat: c.lat, lng: c.lng, radio_m: r }] : [], [], { encuadrar: true });
  };
  setTimeout(pintar, 60);
  m.querySelector('#tC').addEventListener('change', pintar);
  m.querySelector('#tR').addEventListener('change', pintar);
  m.querySelector('#tAqui').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Este navegador no tiene GPS.', 'bad');
    m.querySelector('#tInfo').textContent = 'Buscando…';
    navigator.geolocation.getCurrentPosition((p) => { m.querySelector('#tC').value = `${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`; m.querySelector('#tInfo').textContent = `Precisión ±${Math.round(p.coords.accuracy)} m`; pintar(); },
      () => { m.querySelector('#tInfo').textContent = 'No se pudo obtener la ubicación.'; }, { enableHighAccuracy: true, timeout: 20000 });
  });
  m.querySelector('[data-ok]').addEventListener('click', async () => {
    const c = leerCoords(m.querySelector('#tC').value);
    if (!c) return toast('Escribe coordenadas válidas (ej.: -7.1547, -78.5166) o toca el mapa.', 'bad');
    const body = { nombre: m.querySelector('#tN').value.trim(), direccion: m.querySelector('#tD').value.trim(), lat: c.lat, lng: c.lng, radio_m: Number(m.querySelector('#tR').value) };
    try {
      if (t) await P.api.put(`/panel/tiendas/${t.id}`, { ...body, activa: m.querySelector('#tA').checked });
      else await P.api.post('/panel/tiendas', body);
      cerrarCapa(); toast('Tienda guardada.'); P.refrescar();
    } catch (e) { toast(e.message, 'bad'); }
  });
}
