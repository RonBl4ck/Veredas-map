const MAX_BIGINT = 9223372036854775807n;

export class SupplyLookupError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'SupplyLookupError';
    this.status = status;
  }
}

export function normalizeSupplyInput(value) {
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

function isPeruCoordinate(latitud, longitud) {
  return Number.isFinite(latitud) && Number.isFinite(longitud)
    && latitud >= -18 && latitud <= 0
    && longitud >= -82 && longitud <= -68
    && !(latitud === 0 && longitud === 0);
}

export async function lookupSupply(value, fetcher = globalThis.fetch) {
  const codigo = normalizeSupplyInput(value);
  if (!codigo) {
    throw new SupplyLookupError('Ingresa un código de suministro numérico válido.', 400);
  }

  let response;
  try {
    response = await fetcher(`/api/suministro?codigo=${encodeURIComponent(codigo)}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
  } catch {
    throw new SupplyLookupError('No se pudo conectar con el buscador de suministros.');
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new SupplyLookupError(
      payload.error || 'No se pudo consultar el suministro.',
      response.status
    );
  }

  const latitud = Number(payload.latitud);
  const longitud = Number(payload.longitud);
  if (!isPeruCoordinate(latitud, longitud)) {
    throw new SupplyLookupError('El suministro no tiene coordenadas válidas.', 502);
  }

  return {
    suministro: String(payload.suministro),
    latitud,
    longitud
  };
}
