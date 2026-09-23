import assert from 'node:assert/strict';
import test from 'node:test';

import { filterMapRows } from '../js/map-filters.js';

test('el rango de fechas del mapa filtra BT/AP pero conserva las Obras', () => {
  const rows = [
    { orden: 'BT-fuera', tension: 'BT', tipo: 'Pendiente', fecha_inicio_date: '2026-09-01' },
    { orden: 'AP-dentro', tension: 'AP', tipo: 'Pendiente', fecha_inicio_date: '2026-09-22' },
    { orden: 'obra', tension: 'OBRAS', es_obra: true, tipo: 'Pendiente', fecha_inicio_date: '2026-09-01' }
  ];

  const visible = filterMapRows(rows, { dateFrom: '2026-09-20', dateTo: '2026-09-23' });

  assert.deepEqual(visible.map(row => row.orden), ['AP-dentro', 'obra']);
});
