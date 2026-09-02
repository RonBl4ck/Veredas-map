import { fetchText } from './http.js';
import { requireSession } from '../server/auth.js';

export default async function handler(req, res) {
  if (!requireSession(req, res)) return;
  const dataUrl = process.env.DATA_URL || process.env.ENV_DATA_URL;

  if (!dataUrl) {
    return res.status(500).json({
      error: "Variable de entorno DATA_URL o ENV_DATA_URL no configurada en Vercel."
    });
  }

  try {
    const fetchUrl = dataUrl + (dataUrl.includes('?') ? '&' : '?') + '_t=' + Date.now();
    const response = await fetchText(fetchUrl);

    if (response.status < 200 || response.status >= 300) {
      return res.status(response.status).json({
        error: `Error al consultar Google Sheets (${response.status})`
      });
    }

    const text = response.text;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(200).send(text);

  } catch (err) {
    return res.status(500).json({
      error: `Error interno de servidor: ${err.message}`
    });
  }
}
