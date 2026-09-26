/* Bitácora de auditoría: quién hizo qué y cuándo. */
import { esc, nombreBonito } from '../../core/util.js';

const ACCIONES = {
  login_panel: 'Ingresó al panel', login_app: 'Ingresó a la app', login_fallido: 'Intento de ingreso fallido', marca_entrada: 'Marcó entrada', marca_salida: 'Marcó salida',
  turno_elegido: 'Eligió turno', turno_soltado: 'Soltó turno', turno_asignado: 'Asignó turno', turno_liberado: 'Liberó turno', turno_extra_creado: 'Creó turno extra', turno_eliminado: 'Eliminó turno',
  cobertura_solicitada: 'Pidió cobertura', cobertura_tomada: 'Tomó cobertura', multa_pagada: 'Registró pago', multa_anulada: 'Anuló multa', multa_pendiente: 'Reabrió multa', multas_pagadas: 'Registró pago total',
  multa_manual: 'Multa manual', justificacion_enviada: 'Envió justificación', justificacion_aprobada: 'Aprobó justificación', justificacion_rechazada: 'Rechazó justificación',
  usuario_creado: 'Creó usuario', usuario_actualizado: 'Editó usuario', clave_restablecida: 'Restableció clave', clave_cambiada: 'Cambió su clave', celular_desvinculado: 'Desvinculó celular',
  tienda_creada: 'Creó tienda', tienda_actualizada: 'Editó tienda', plantilla_guardada: 'Guardó plantilla', dia_especial_guardado: 'Guardó día especial', dia_especial_borrado: 'Quitó día especial',
  ajustes_guardados: 'Cambió la configuración', respaldo_descargado: 'Descargó respaldo', importacion_version_anterior: 'Importó datos anteriores',
};

export default {
  id: 'auditoria', titulo: 'Auditoría', icono: 'historial', grupo: 'Sistema', soloAdmin: true,
  cargar: (P) => P.api.get('/panel/auditoria?limite=400'),
  render(d) {
    return `<div class="card"><div><h2>Bitácora</h2><span class="small muted">Últimos ${d.length} movimientos. Sirve para aclarar reclamos y detectar accesos indebidos.</span></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>Fecha y hora</th><th>Persona</th><th>Acción</th><th>Detalle</th><th>IP</th></tr></thead><tbody>
      ${d.map((r) => `<tr><td class="num small">${new Date(r.ts).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${r.usuario ? esc(nombreBonito(r.usuario)) : '<span class="muted">Sistema</span>'}</td>
        <td><span class="chip ${r.accion.includes('fallido') ? 'bad' : r.accion.startsWith('marca') ? 'ok' : 'grey'}">${esc(ACCIONES[r.accion] || r.accion)}</span></td>
        <td class="tiny muted" style="max-width:380px">${r.detalle ? esc(JSON.stringify(r.detalle).replace(/[{}"]/g, '').replace(/,/g, ', ').slice(0, 160)) : ''}</td><td class="tiny muted">${esc(r.ip || '')}</td></tr>`).join('')}</tbody></table></div></div>`;
  },
};
