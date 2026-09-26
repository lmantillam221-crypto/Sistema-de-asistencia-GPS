/* Punto de entrada de la demo web: backend en el navegador + app del equipo + panel. */
import { reiniciarDemo, listo } from './backend.js';

window.__ncDemo = { reiniciar: reiniciarDemo, listo };
await listo;
// Las dos interfaces se cargan después del backend (el orden importa: interceptan fetch).
await import('../public/js/colaborador/main.js');
await import('../public/js/panel/main.js');
