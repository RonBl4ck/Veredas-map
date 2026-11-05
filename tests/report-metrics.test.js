import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateContractorAvgDays,
  filterReportRowsByDate
} from '../js/report-metrics.js';

test('calculateContractorAvgDays calcula el promedio exacto y ordena de menor a mayor', () => {
  const rows = [
    { contratista: 'PA', fecha_inicio_date: '2026-10-01', fecha_fin_date: '2026-10-03' }, // 2 días
    { contratista: 'PA', fecha_inicio_date: '2026-10-01', fecha_fin_date: '2026-10-05' }, // 4 días -> avg: 3.0
    { contratista: 'LARI', fecha_inicio_date: '2026-10-01', fecha_fin_date: '2026-10-11' }, // 10 días
    { contratista: 'LARI', fecha_inicio_date: '2026-10-01', fecha_fin_date: '2026-10-15' }, // 14 días -> avg: 12.0
    { contratista: 'COBRA', fecha_inicio_date: '2026-10-01', fecha_fin_date: '2026-10-02' } // 1 día -> avg: 1.0
  ];

  const results = calculateContractorAvgDays(rows);

  assert.equal(results.length, 3);
  assert.equal(results[0].company, 'COBRA');
  assert.equal(results[0].avgDays, 1.0);
  assert.equal(results[0].count, 1);

  assert.equal(results[1].company, 'PA');
  assert.equal(results[1].avgDays, 3.0);
  assert.equal(results[1].count, 2);

  assert.equal(results[2].company, 'LARI');
  assert.equal(results[2].avgDays, 12.0);
  assert.equal(results[2].count, 2);
});

test('calculateContractorAvgDays omite órdenes sin fecha válida y maneja registros vacíos', () => {
  const rows = [
    { contratista: 'PA', fecha_inicio_date: '', fecha_fin_date: '' },
    { contratista: 'PA', fecha_inicio_date: '2026-10-01', fecha_fin_date: '' },
    { contratista: 'CAM', intervalo_hours: 48 } // Fallback: 48 horas = 2 días
  ];

  const results = calculateContractorAvgDays(rows);
  assert.equal(results.length, 1);
  assert.equal(results[0].company, 'CAM');
  assert.equal(results[0].avgDays, 2.0);

  assert.deepEqual(calculateContractorAvgDays([]), []);
});

test('filterReportRowsByDate filtra por mes específico basado en fecha de ingreso', () => {
  const rows = [
    { orden: 'O-1', tipo: 'Ejecutado', fecha_inicio_date: '2026-08-15' },
    { orden: 'O-2', tipo: 'Ejecutado', fecha_inicio_date: '2026-09-02' },
    { orden: 'O-3', tipo: 'Ejecutado', fecha_inicio_date: '2026-09-28' },
    { orden: 'O-4', tipo: 'Ejecutado', fecha_inicio_date: '2026-10-05' }
  ];

  const sept = filterReportRowsByDate(rows, { month: '2026-09' });
  assert.deepEqual(sept.map(r => r.orden), ['O-2', 'O-3']);
});

test('filterReportRowsByDate filtra por rango de meses basado en fecha de ingreso', () => {
  const rows = [
    { orden: 'O-1', tipo: 'Ejecutado', fecha_inicio_date: '2026-07-20' },
    { orden: 'O-2', tipo: 'Ejecutado', fecha_inicio_date: '2026-08-10' },
    { orden: 'O-3', tipo: 'Ejecutado', fecha_inicio_date: '2026-09-15' },
    { orden: 'O-4', tipo: 'Ejecutado', fecha_inicio_date: '2026-10-01' },
    { orden: 'O-5', tipo: 'Ejecutado', fecha_inicio_date: '2026-11-02' }
  ];

  const range = filterReportRowsByDate(rows, { monthFrom: '2026-08', monthTo: '2026-10' });
  assert.deepEqual(range.map(r => r.orden), ['O-2', 'O-3', 'O-4']);
});

test('filterReportRowsByDate omite órdenes sin fecha inicio cuando hay filtros activos', () => {
  const rows = [
    { orden: 'O-Valida', tipo: 'Ejecutado', fecha_inicio_date: '2026-10-15' },
    { orden: 'O-SinFecha', tipo: 'Ejecutado', fecha_inicio_date: '' }
  ];

  const filtered = filterReportRowsByDate(rows, { month: '2026-10' });
  assert.deepEqual(filtered.map(r => r.orden), ['O-Valida']);

  // Sin filtros activos conserva ambas
  const all = filterReportRowsByDate(rows, {});
  assert.deepEqual(all.map(r => r.orden), ['O-Valida', 'O-SinFecha']);
});
