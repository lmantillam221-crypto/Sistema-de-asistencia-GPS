const celda = (x) => {
  let s = x == null ? '' : String(x);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita inyección de fórmulas en Excel
  return /[",\n;\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** CSV compatible con Excel (BOM UTF-8, separador coma, CRLF). */
export const aCSV = (filas) => '﻿' + filas.map((f) => f.map(celda).join(',')).join('\r\n');

export function enviarCSV(res, nombre, filas) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(aCSV(filas));
}
