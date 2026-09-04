import { fetchText } from './http.js';
import { requireSession } from '../server/auth.js';

const GID_OBRAS = '383449825';

function toSheetUrl(dataUrl, gid) {
  const url = new URL(dataUrl);
  url.searchParams.set('gid', gid);
  url.searchParams.set('single', 'true');
  url.searchParams.set('output', 'csv');
  url.searchParams.set('_t', Date.now().toString());
  return url.toString();
}

export default async function handler(req, res) {
  if (!requireSession(req, res)) return;
  const dataUrl = process.env.DATA_URL || process.env.ENV_DATA_URL;

  if (!dataUrl) {
    return res.status(500).json({
      error: 'Variable de entorno DATA_URL o ENV_DATA_URL no configurada en Vercel.'
    });
  }

  try {
    const fetchUrl = toSheetUrl(dataUrl, GID_OBRAS);
    const response = await fetchText(fetchUrl);

    if (response.status < 200 || response.status >= 300) {
      return res.status(response.status).json({
        error: `Error al consultar la pestaña BASE_OBRAS (${response.status})`
      });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(200).send(response.text);

  } catch (err) {
    return res.status(500).json({
      error: `Error al cargar BASE_OBRAS: ${err.message}`
    });
  }
}
