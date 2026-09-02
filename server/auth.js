import crypto from 'node:crypto';
import { fetchText } from '../api/http.js';

const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const COOKIE_NAME = 'veredas_session';

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET no configurada en Vercel.');
  return secret;
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

function sign(value) {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function readCookie(req, name) {
  const cookies = req.headers.cookie || '';
  return cookies.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

function sessionCookie(token, maxAge) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function createSession(res) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS })).toString('base64url');
  res.setHeader('Set-Cookie', sessionCookie(`${payload}.${sign(payload)}`, SESSION_MAX_AGE_SECONDS));
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', sessionCookie('', 0));
}

export function hasValidSession(req) {
  try {
    const token = readCookie(req, COOKIE_NAME);
    if (!token) return false;
    const [payload, signature] = token.split('.');
    if (!payload || !signature || !safeEqual(sign(payload), signature)) return false;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function requireSession(req, res) {
  if (hasValidSession(req)) return true;
  res.status(401).json({ error: 'No autorizado.' });
  return false;
}

export async function isValidPassword(password) {
  const authUrl = process.env.AUTH_URL || process.env.ENV_AUTH_URL;
  if (!authUrl) throw new Error('AUTH_URL no configurada en Vercel.');
  const response = await fetchText(`${authUrl}${authUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`);
  if (response.status < 200 || response.status >= 300) throw new Error(`Error al consultar acceso (${response.status}).`);
  const expected = parseCsv(response.text).map(row => {
    const key = String(row.PARAMETRO || row.parametro || Object.values(row)[0] || '').toUpperCase();
    return (key.includes('PASS') || key.includes('CLAVE') || key.includes('ACCESO'))
      ? String(row.VALOR || row.valor || Object.values(row)[1] || '').trim()
      : '';
  }).find(Boolean);
  return Boolean(expected) && safeEqual(String(password || '').trim(), expected);
}
