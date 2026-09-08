import assert from 'node:assert/strict';
import test from 'node:test';

import { createSupplyHandler, normalizeSupplyCode } from '../server/suministros.js';

function responseDouble() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}

test('normaliza un suministro numérico sin conservar ceros iniciales', () => {
  assert.equal(normalizeSupplyCode(' 0012345 '), '12345');
});

test('rechaza códigos vacíos, cero, no numéricos o fuera de bigint', () => {
  for (const value of ['', '0', 'ABC123', '12-34', '9223372036854775808']) {
    assert.equal(normalizeSupplyCode(value), null);
  }
});

test('rechaza métodos distintos de GET sin consultar autenticación ni base', async () => {
  let authorized = false;
  let queried = false;
  const handler = createSupplyHandler({
    authorize: () => { authorized = true; return true; },
    findSupply: async () => { queried = true; return null; }
  });
  const res = responseDouble();

  await handler({ method: 'POST', query: {} }, res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
  assert.deepEqual(res.body, { error: 'Método no permitido.' });
  assert.equal(authorized, false);
  assert.equal(queried, false);
});

test('conserva la respuesta 401 producida por la autenticación existente', async () => {
  const handler = createSupplyHandler({
    authorize: (_req, res) => {
      res.status(401).json({ error: 'No autorizado.' });
      return false;
    },
    findSupply: async () => assert.fail('no debe consultar la base')
  });
  const res = responseDouble();

  await handler({ method: 'GET', query: { codigo: '123' } }, res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'No autorizado.' });
});

test('devuelve 400 para un código inválido sin consultar la base', async () => {
  const handler = createSupplyHandler({
    authorize: () => true,
    findSupply: async () => assert.fail('no debe consultar la base')
  });
  const res = responseDouble();

  await handler({ method: 'GET', query: { codigo: '12A' } }, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Ingresa un código de suministro numérico válido.' });
});

test('devuelve 404 cuando el suministro no existe', async () => {
  const handler = createSupplyHandler({ authorize: () => true, findSupply: async () => null });
  const res = responseDouble();

  await handler({ method: 'GET', query: { codigo: '987654' } }, res);

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'Suministro no encontrado.' });
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('devuelve el suministro y coordenadas con tipos estables', async () => {
  const handler = createSupplyHandler({
    authorize: () => true,
    findSupply: async (codigo) => codigo === '12345'
      ? { suministro: 12345n, latitud: '-12.0464', longitud: -77.0428 }
      : null
  });
  const res = responseDouble();

  await handler({ method: 'GET', query: { codigo: '0012345' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { suministro: '12345', latitud: -12.0464, longitud: -77.0428 });
});

test('oculta detalles internos cuando falla la base', async () => {
  const handler = createSupplyHandler({
    authorize: () => true,
    findSupply: async () => { throw new Error('password=secreto host=interno'); }
  });
  const res = responseDouble();

  await handler({ method: 'GET', query: { codigo: '12345' } }, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'No se pudo consultar el suministro.' });
  assert.doesNotMatch(JSON.stringify(res.body), /secreto|interno/);
});
