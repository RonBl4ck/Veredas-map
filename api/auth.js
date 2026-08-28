export default async function handler(req, res) {
  const authUrl = process.env.AUTH_URL || process.env.ENV_AUTH_URL;

  if (!authUrl) {
    return res.status(500).json({
      error: "Variable de entorno AUTH_URL o ENV_AUTH_URL no configurada en Vercel."
    });
  }

  try {
    const fetchUrl = authUrl + (authUrl.includes('?') ? '&' : '?') + '_t=' + Date.now();
    const response = await fetch(fetchUrl, { cache: 'no-store' });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Error al consultar pestaña de acceso en Google Sheets (${response.status})`
      });
    }

    const text = await response.text();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(200).send(text);

  } catch (err) {
    return res.status(500).json({
      error: `Error interno de servidor: ${err.message}`
    });
  }
}
