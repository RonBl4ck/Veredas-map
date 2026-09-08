import postgres from 'postgres';

import { requireSession } from './auth.js';

const MAX_BIGINT = 9223372036854775807n;
let databaseClient;

export function normalizeSupplyCode(value) {
  if (Array.isArray(value)) return null;
  const raw = String(value ?? '').trim();
  if (!/^\d{1,19}$/.test(raw)) return null;

  try {
    const numeric = BigInt(raw);
    if (numeric <= 0n || numeric > MAX_BIGINT) return null;
    return numeric.toString();
  } catch {
    return null;
  }
}

function getDatabaseClient() {
  if (databaseClient) return databaseClient;
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) throw new Error('POSTGRES_URL no configurada.');

  databaseClient = postgres(connectionString, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10
  });
  return databaseClient;
}

export async function findSupplyByCode(codigo) {
  const sql = getDatabaseClient();
  const rows = await sql`
    SELECT suministro, latitud, longitud
    FROM private.suministros
    WHERE suministro = ${codigo}::bigint
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export function createSupplyHandler({
  authorize = requireSession,
  findSupply = findSupplyByCode
} = {}) {
  return async function supplyHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Método no permitido.' });
    }

    if (!authorize(req, res)) return;

    const codigo = normalizeSupplyCode(req.query?.codigo);
    if (codigo === null) {
      return res.status(400).json({ error: 'Ingresa un código de suministro numérico válido.' });
    }

    try {
      const supply = await findSupply(codigo);
      if (!supply) return res.status(404).json({ error: 'Suministro no encontrado.' });

      const latitud = Number(supply.latitud);
      const longitud = Number(supply.longitud);
      if (!Number.isFinite(latitud) || !Number.isFinite(longitud)) {
        throw new Error('Coordenadas inválidas en la base.');
      }

      return res.status(200).json({
        suministro: String(supply.suministro),
        latitud,
        longitud
      });
    } catch (error) {
      console.error('Error al consultar suministro:', error?.name || 'Error');
      return res.status(500).json({ error: 'No se pudo consultar el suministro.' });
    }
  };
}
