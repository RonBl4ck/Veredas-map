import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SupplyLookupError,
  lookupSupply,
  normalizeSupplyInput
} from '../js/supply-search.js';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

test('normaliza el texto antes de construir la búsqueda', () => {
  assert.equal(normalizeSupplyInput(' 0000100 '), '100');
  assert.equal(normalizeSupplyInput('10A'), null);
  assert.equal(normalizeSupplyInput('0'), null);
});

test('consulta una sola URL canónica y devuelve coordenadas numéricas', async () => {
  const requested = [];
  const fetcher = async (url, options) => {
    requested.push([url, options]);
    return jsonResponse(200, { suministro: '100', latitud: '-12.030755', longitud: -77.0869366667 });
  };

  const result = await lookupSupply('0000100', fetcher);

  assert.deepEqual(requested, [[
    '/api/suministro?codigo=100',
    { credentials: 'same-origin', headers: { Accept: 'application/json' } }
  ]]);
  assert.deepEqual(result, { suministro: '100', latitud: -12.030755, longitud: -77.0869366667 });
});

test('rechaza entrada inválida antes de hacer una solicitud', async () => {
  await assert.rejects(
    lookupSupply('ABC', async () => assert.fail('no debe ejecutar fetch')),
    (error) => error instanceof SupplyLookupError && error.status === 400
  );
});

test('propaga el mensaje controlado del API para un suministro inexistente', async () => {
  await assert.rejects(
    lookupSupply('999', async () => jsonResponse(404, { error: 'Suministro no encontrado.' })),
    (error) => error instanceof SupplyLookupError
      && error.status === 404
      && error.message === 'Suministro no encontrado.'
  );
});

test('rechaza una respuesta exitosa con coordenadas fuera de Perú', async () => {
  await assert.rejects(
    lookupSupply('100', async () => jsonResponse(200, {
      suministro: '100',
      latitud: 40.7128,
      longitud: -74.006
    })),
    (error) => error instanceof SupplyLookupError
      && error.message === 'El suministro no tiene coordenadas válidas.'
  );
});
