import { fetchText } from './http.js';
import { requireSession } from '../server/auth.js';

const SHEETS = { works: '1948361639', repairs: '969162020' };

function toSheetUrl(dataUrl, gid) {
  const url = new URL(dataUrl);
  url.searchParams.set('gid', gid);
  url.searchParams.set('single', 'true');
  url.searchParams.set('output', 'csv');
  url.searchParams.set('_t', Date.now().toString());
  return url.toString();
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') { cell += '"'; i++; } else inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) { row.push(cell.trim()); cell = ''; }
    else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(cell.trim());
      if (row.some(value => value.length)) rows.push(row);
      row = []; cell = '';
    } else cell += char;
  }
  if (cell.length || row.length) { row.push(cell.trim()); if (row.some(value => value.length)) rows.push(row); }
  const headers = (rows.shift() || []).map(value => value.replace(/^["']|["']$/g, '').trim());
  return rows.map(line => Object.fromEntries(headers.map((header, index) => [header, (line[index] || '').replace(/^["']|["']$/g, '').trim()])));
}

function pickColumns(rows, columns) {
  return rows.map(row => Object.fromEntries(columns.map(column => [column, row[column] || ''])));
}

export default async function handler(req, res) {
  if (!requireSession(req, res)) return;
  const dataUrl = process.env.DATA_URL || process.env.ENV_DATA_URL;
  if (!dataUrl) return res.status(500).json({ error: 'DATA_URL no configurada en Vercel.' });
  try {
    const [worksResponse, repairsResponse] = await Promise.all([
      fetchText(toSheetUrl(dataUrl, SHEETS.works)),
      fetchText(toSheetUrl(dataUrl, SHEETS.repairs))
    ]);
    if (worksResponse.status < 200 || worksResponse.status >= 300 || repairsResponse.status < 200 || repairsResponse.status >= 300) return res.status(502).json({ error: 'No fue posible consultar las pestañas de Obras.' });
    const [worksCsv, repairsCsv] = [worksResponse.text, repairsResponse.text];
    const works = pickColumns(parseCsv(worksCsv), [
      'PRESUPUESTO', 'LCL/ODM', 'Distrito', 'Empresa Colaboradora', 'Tipo de Obra',
      'Estado de Obra', 'Tipo de Trabajo', 'Ubicación', 'Fecha de Asignación'
    ]);
    const repairs = pickColumns(parseCsv(repairsCsv), [
      'LCL', 'Fecha de Rotura de Vereda', 'Fecha de Reparación de Vereda', 'Estado de Vereda',
      'Distrito', 'Empresa Colaboradora', 'Ubicación', 'Suministro Referencia', 'Sector',
      'Motivo Fuera de Plazo'
    ]);
    return res.status(200).json({ works, repairs });
  } catch (err) {
    return res.status(500).json({ error: `Error al cargar Obras: ${err.message}` });
  }
}
