/* Mapas con Leaflet + OpenStreetMap: geocercas de tiendas y posiciones. */
import { esc } from '../core/util.js';

/** Crea (o recrea tras un redibujado) un mapa en el elemento, conservando la vista anterior. */
const colorMarca = (v, d) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d;

export function crearMapa(el, previo = null, { alClic = null } = {}) {
  const L = window.L;
  let vista = null;
  if (previo?.map) { try { vista = { c: previo.map.getCenter(), z: previo.map.getZoom() }; previo.map.stop(); previo.map.remove(); } catch {} }
  const map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, fadeAnimation: false, zoomAnimation: false, markerZoomAnimation: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  const capa = L.layerGroup().addTo(map);
  if (alClic) map.on('click', (e) => alClic(e.latlng));
  let primera = !vista;
  if (vista) map.setView(vista.c, vista.z, { animate: false });
  return {
    map,
    dibujar(tiendas, puntos = [], { encuadrar = false } = {}) {
      capa.clearLayers();
      const b = [];
      for (const t of tiendas) {
        L.circle([t.lat, t.lng], { radius: t.radio_m, color: colorMarca('--mapa-borde', '#e2508a'), weight: 2, fillColor: colorMarca('--mapa-relleno', '#fc90ae'), fillOpacity: 0.18 }).addTo(capa).bindTooltip(esc(t.nombre));
        L.circleMarker([t.lat, t.lng], { radius: 4, color: colorMarca('--mapa-centro', '#c2386c'), fillOpacity: 1 }).addTo(capa);
        b.push([t.lat, t.lng]);
      }
      for (const p of puntos) {
        const icon = L.divIcon({ className: '', html: `<div class="pin-mapa" style="background:${p.color}">${esc(iniciales(p.texto))}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
        L.marker([p.lat, p.lng], { icon }).addTo(capa).bindPopup(p.popup || esc(p.texto));
        b.push([p.lat, p.lng]);
      }
      if ((primera || encuadrar) && b.length) { map.fitBounds(b, { padding: [40, 40], maxZoom: 17, animate: false }); primera = false; }
      else if (primera) map.setView([-7.1547, -78.5166], 15, { animate: false });
      setTimeout(() => { if (el.isConnected) map.invalidateSize({ animate: false }); }, 50);
    },
  };
}
const iniciales = (n) => String(n || '').split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
