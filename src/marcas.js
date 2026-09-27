/* Marcas (empresas) que usan el sistema. Cada una tiene su logo, paleta y tipografía en marcas/<id>/publico,
   y sus datos separados (otra base / otro sitio de Netlify). Se elige con la variable MARCA. */
import nubeChic from '../marcas/nube-chic/marca.json' with { type: 'json' };
import mundoNuvana from '../marcas/mundo-nuvana/marca.json' with { type: 'json' };

export const MARCAS = { 'nube-chic': nubeChic, 'mundo-nuvana': mundoNuvana };
export const MARCA_PREDETERMINADA = 'nube-chic';
export const marcaPorId = (id) => MARCAS[String(id || '').trim()] || MARCAS[MARCA_PREDETERMINADA];

/** Reemplaza los marcadores {{…}} de los HTML y el manifiesto con los datos de la marca. */
export function aplicarMarca(texto, m) {
  return String(texto)
    .replaceAll('{{MARCA_NOMBRE}}', m.nombre).replaceAll('{{MARCA_APP}}', m.nombreApp)
    .replaceAll('{{MARCA_COLOR}}', m.colorTema).replaceAll('{{MARCA_FONDO}}', m.colorFondo);
}
