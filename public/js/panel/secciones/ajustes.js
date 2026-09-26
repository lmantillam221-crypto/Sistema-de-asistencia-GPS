/* Configuración: reglas del negocio, multas, checklists, respaldo e importación. */
import { esc, cap, DIAS, ORDEN_SEMANA } from '../../core/util.js';
import { toast, confirmar } from '../../core/ui.js';

let borrador = null;
const ZONAS = ['America/Lima', 'America/Bogota', 'America/Guayaquil', 'America/La_Paz', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/Mexico_City', 'America/Caracas', 'America/Asuncion', 'America/Montevideo', 'Europe/Madrid'];

const tog = (id, on, titulo, desc) => `<div class="switch-row"><div><b>${titulo}</b><div class="small muted">${desc}</div></div><label class="toggle"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} aria-label="${esc(titulo)}"><span></span></label></div>`;

export default {
  id: 'ajustes', titulo: 'Configuración', icono: 'ajustes', grupo: 'Sistema', soloAdmin: true,
  cargar: (P) => P.api.get('/panel/ajustes'),
  render(e, P) {
    const b = borrador || { nombre: e.nombre, rubro: e.rubro, zona_horaria: e.zona_horaria, ...structuredClone(e.ajustes) };
    const hay = !!borrador;
    const lista = (id, items, titulo, desc) => `<div class="card"><div><h2>${titulo}</h2><span class="small muted">${desc}</span></div>
      <div class="stack" style="gap:8px">${items.map((x, i) => `<div class="row nw"><input type="text" data-lista="${id}" data-i="${i}" value="${esc(x)}" maxlength="80" data-fijo="1"><button type="button" class="btn-sm btn-bad" data-accion="quitarItem" data-lista="${id}" data-i="${i}" aria-label="Quitar">✕</button></div>`).join('') || '<span class="small muted">Sin ítems: no se mostrará el checklist.</span>'}</div>
      <div><button type="button" class="btn-sm" data-accion="agregarItem" data-lista="${id}">+ Agregar ítem</button></div></div>`;
    return `<div class="grid-2">
      <div class="card"><div><h2>Empresa</h2></div><div class="grid-form">
        <label class="f">Nombre comercial<input type="text" id="aNombre" data-k="nombre" value="${esc(b.nombre)}" data-fijo="1"></label>
        <label class="f">Rubro<input type="text" id="aRubro" data-k="rubro" value="${esc(b.rubro)}" data-fijo="1"></label>
        <label class="f">Zona horaria<select id="aZona" data-k="zona_horaria" data-fijo="1">${[...new Set([b.zona_horaria, ...ZONAS])].map((z) => `<option ${z === b.zona_horaria ? 'selected' : ''}>${z}</option>`).join('')}</select></label></div></div>
      <div class="card"><div><h2>Montos de multas</h2><span class="small muted">Pon 0 para no cobrar ese tipo. Aplica a las multas nuevas.</span></div><div class="grid-form">
        <label class="f">Tardanza<div class="moneda"><span>S/</span><input type="number" id="aMT" data-k="multas.tardanza" data-n="1" min="0" step="0.5" value="${b.multas.tardanza}" data-fijo="1"></div></label>
        <label class="f">Falta<div class="moneda"><span>S/</span><input type="number" id="aMF" data-k="multas.falta" data-n="1" min="0" step="0.5" value="${b.multas.falta}" data-fijo="1"></div></label>
        <label class="f">Salida anticipada<div class="moneda"><span>S/</span><input type="number" id="aMS" data-k="multas.salidaAnticipada" data-n="1" min="0" step="0.5" value="${b.multas.salidaAnticipada}" data-fijo="1"></div></label></div></div>
      <div class="card ancho"><div><h2>Reglas de asistencia y horarios</h2></div><div class="grid-form">
        <label class="f">Tolerancia de tardanza (min)<input type="number" id="aTol" data-k="toleranciaMin" data-n="1" min="0" max="120" value="${b.toleranciaMin}" data-fijo="1"></label>
        <label class="f">Reporte GPS automático cada (min)<input type="number" id="aInt" data-k="intervaloControlMin" data-n="1" min="5" max="240" value="${b.intervaloControlMin}" data-fijo="1"></label>
        <label class="f">Precisión GPS máxima aceptada (m)<input type="number" id="aPrec" data-k="precisionMaximaM" data-n="1" min="20" max="1000" value="${b.precisionMaximaM}" data-fijo="1"></label>
        <label class="f">Máximo de turnos por persona a la semana<input type="number" id="aMax" data-k="maxTurnosSemana" data-n="1" min="1" max="21" value="${b.maxTurnosSemana}" data-fijo="1"></label>
        <label class="f">Recordatorio antes del turno (horas)<input type="number" id="aRec" data-k="recordatorioHoras" data-n="1" min="0" max="48" step="0.5" value="${b.recordatorioHoras}" data-fijo="1"></label>
        <label class="f">Día de elección de horarios<select id="aVD" data-k="ventana.dia" data-n="1" data-fijo="1">${ORDEN_SEMANA.map((d) => `<option value="${d}" ${b.ventana.dia === d ? 'selected' : ''}>${cap(DIAS[d])}</option>`).join('')}</select></label>
        <label class="f">Elección desde<input type="time" id="aVDe" data-k="ventana.desde" value="${b.ventana.desde}" data-fijo="1"></label>
        <label class="f">Elección hasta<input type="time" id="aVH" data-k="ventana.hasta" value="${b.ventana.hasta}" data-fijo="1"></label></div>
        <div>${tog('aVSC', b.ventanaSemanaCompleta, 'Elección abierta toda la semana previa', 'Además de la ventana, se pueden elegir turnos libres de la próxima semana en cualquier momento.')}
          ${tog('aExig', b.exigirUbicacionEnEntrada, 'Exigir estar en la tienda para marcar entrada', 'Si está fuera de la geocerca, la app no deja marcar entrada. Si está apagado, se registra y se alerta.')}
          ${tog('aCub', b.permitirCubrir, 'Permitir cubrir turnos de otra persona', 'Una colaboradora puede marcar entrada en un turno ajeno (queda la alerta "Cubrió turno").')}
          ${tog('aDisp', b.controlDispositivo, 'Controlar el celular de cada persona', 'Alerta si alguien marca desde un celular distinto al habitual (evita que otra persona marque por ella).')}
          ${tog('aVen', b.registrarVentas, 'Registrar ventas del turno (cuadre de caja)', 'Al marcar salida se pide N° de ventas y montos en efectivo, Yape/Plin y tarjeta.')}</div></div>
      ${lista('checklistApertura', b.checklistApertura, 'Checklist de apertura', 'Se muestra al marcar entrada.')}
      ${lista('checklistCierre', b.checklistCierre, 'Checklist de cierre', 'Se muestra al marcar salida.')}
    </div>
    <div class="row" style="position:sticky;bottom:12px;z-index:5"><div class="card plano row" style="padding:10px 14px;flex-direction:row;box-shadow:var(--shadow)"><button type="button" class="btn-p" data-accion="guardar" ${hay ? '' : 'disabled'}>Guardar cambios</button>${hay ? '<button type="button" data-accion="descartar">Descartar</button>' : ''}<span class="small muted">${hay ? 'Tienes cambios sin guardar.' : 'Todo guardado.'}</span></div></div>
    <div class="grid-2">
      <div class="card"><div><h2>Copia de seguridad</h2><span class="small muted">Descarga toda la base de datos (asistencia, horarios, multas, ventas y equipo). Guárdala en Google Drive una vez por semana.</span></div>
        <div><a class="btn btn-p" href="/api/panel/respaldo">Descargar respaldo (.db)</a></div></div>
      <div class="card"><div><h2>Importar desde la versión anterior</h2><span class="small muted">Carga el archivo <b>index.html</b> anterior o la <b>copia de seguridad (.json)</b> que descargaste de él. Se crean la tienda, las colaboradoras con su mismo usuario y PIN, los turnos, las marcas GPS y las multas.</span></div>
        <input type="file" id="aImportar" accept=".html,.htm,.json,application/json,text/html"></div>
    </div>
    ${P.demo ? `<div class="card sim" style="border:2px dashed #f0cf7a;background:#fffaf0"><div><h2>Demostración</h2><span class="small muted">Genera 3 semanas de asistencia, ventas y multas de ejemplo para explorar el sistema. El reloj simulado se controla desde "En vivo".</span></div>
      <div class="row"><button type="button" class="btn-p" data-accion="demoCrear">Crear datos de ejemplo</button><button type="button" class="btn-bad" data-accion="demoBorrar">Borrar datos de ejemplo</button></div></div>` : ''}`;
  },
  alEscribir(el, P) {
    const e = P.datos.ajustes;
    if (!el.dataset.k && !el.dataset.lista) return;
    borrador ||= { nombre: e.nombre, rubro: e.rubro, zona_horaria: e.zona_horaria, ...structuredClone(e.ajustes) };
    if (el.dataset.lista) { borrador[el.dataset.lista][Number(el.dataset.i)] = el.value; }
    else {
      const ruta = el.dataset.k.split('.'), v = el.dataset.n ? (el.value === '' ? '' : Number(el.value)) : el.value;
      let o = borrador; for (let i = 0; i < ruta.length - 1; i++) o = o[ruta[i]]; o[ruta[ruta.length - 1]] = v;
    }
    const g = document.querySelector('[data-accion="guardar"]'); if (g) g.disabled = false;
  },
  async alCambiar(el, P) {
    const mapa = { aVSC: 'ventanaSemanaCompleta', aExig: 'exigirUbicacionEnEntrada', aCub: 'permitirCubrir', aDisp: 'controlDispositivo', aVen: 'registrarVentas' };
    if (mapa[el.id]) { const e = P.datos.ajustes; borrador ||= { nombre: e.nombre, rubro: e.rubro, zona_horaria: e.zona_horaria, ...structuredClone(e.ajustes) }; borrador[mapa[el.id]] = el.checked; return P.pintar(); }
    if (el.dataset.k) { this.alEscribir(el, P); return P.pintar(); }
    if (el.id === 'aImportar' && el.files?.[0]) {
      const f = el.files[0];
      if (!(await confirmar({ titulo: `¿Importar "${f.name}"?`, texto: 'Se agregan los datos a los actuales. Las colaboradoras que ya existan (mismo usuario) no se duplican.', si: 'Importar' }))) { el.value = ''; return; }
      try {
        const r = await P.api.post('/panel/importar-anterior', { texto: await f.text() });
        toast(`Importado: ${r.colaboradoras} colaboradoras, ${r.turnos} turnos, ${r.marcas} marcas, ${r.multas} multas.`);
        P.refrescar();
      } catch (err) { toast(err.message, 'bad'); }
      el.value = '';
    }
  },
  async accion(a, el, P) {
    const e = P.datos.ajustes;
    if (a === 'agregarItem' || a === 'quitarItem') {
      borrador ||= { nombre: e.nombre, rubro: e.rubro, zona_horaria: e.zona_horaria, ...structuredClone(e.ajustes) };
      if (a === 'agregarItem') borrador[el.dataset.lista].push('');
      else borrador[el.dataset.lista].splice(Number(el.dataset.i), 1);
      return P.pintar();
    }
    if (a === 'descartar') { borrador = null; return P.pintar(); }
    if (a === 'guardar') {
      const { nombre, rubro, zona_horaria, ...aj } = borrador;
      aj.checklistApertura = aj.checklistApertura.map((x) => x.trim()).filter(Boolean);
      aj.checklistCierre = aj.checklistCierre.map((x) => x.trim()).filter(Boolean);
      await P.api.put('/panel/ajustes', { nombre, rubro, zona_horaria, ajustes: aj });
      borrador = null; toast('Configuración guardada.');
      const yo = await P.api.get('/panel/yo'); P.ajustes = yo.ajustes; P.empresa = yo.empresa;
      return P.refrescar();
    }
    if (a === 'demoCrear') { const r = await P.api.post('/panel/demo/ejemplo'); toast(r.marcas ? `Datos de ejemplo creados (${r.marcas} marcas GPS).` : 'Los turnos pasados ya tienen datos; bórralos primero para regenerarlos.'); return P.refrescar(); }
    if (a === 'demoBorrar') { if (!(await confirmar({ titulo: '¿Borrar los datos de ejemplo?', si: 'Borrar', peligro: true }))) return; await P.api.del('/panel/demo/ejemplo'); toast('Datos de ejemplo borrados.'); return P.refrescar(); }
  },
};
