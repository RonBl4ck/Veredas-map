import { clearSession, createSession, hasValidSession, isValidPassword } from '../server/auth.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return res.status(200).json({ authenticated: hasValidSession(req) });
    if (req.method === 'DELETE') { clearSession(res); return res.status(204).end(); }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido.' });
    if (await isValidPassword(req.body?.password)) {
      createSession(res);
      return res.status(200).json({ authenticated: true });
    }
    return res.status(401).json({ error: 'Contrasena incorrecta.' });
  } catch (err) {
    return res.status(500).json({ error: `Error de autenticacion: ${err.message}` });
  }
}
