import https from 'node:https';

export function fetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'Control-Veredas/1.0' } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirects >= 5) return reject(new Error('Demasiadas redirecciones al consultar Google Sheets.'));
        return resolve(fetchText(new URL(response.headers.location, url).toString(), redirects + 1));
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode || 500, text: Buffer.concat(chunks).toString('utf8') }));
    });
    request.setTimeout(25000, () => request.destroy(new Error('Tiempo de espera al consultar Google Sheets.')));
    request.on('error', reject);
  });
}
