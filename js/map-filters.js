const clean = (value) => String(value ?? '').trim();

/**
 * Applies the map's shared filters. Obras stay visible when a date range is
 * selected because their operational dates belong to the Obras dashboard.
 */
export function filterMapRows(rows, filters = {}) {
  const {
    query = '',
    tipo = '',
    contractor = '',
    tension = '',
    district = '',
    dateFrom = '',
    dateTo = ''
  } = filters;
  const normalizedQuery = clean(query).toLowerCase();

  return rows.filter((row) => {
    if (tipo) {
      const fTipo = clean(tipo).toUpperCase();
      const rTipo = clean(row.tipo || row.TIPO).toUpperCase();
      if (fTipo === 'PENDIENTES ORM' || fTipo === 'PENDIENTE ORM') {
        if (rTipo !== 'PENDIENTES ORM' && !row.is_orm) return false;
      } else if (fTipo === 'PENDIENTE' || fTipo === 'PENDIENTES') {
        if (rTipo !== 'PENDIENTE' || row.is_orm || rTipo === 'PENDIENTES ORM') return false;
      } else if (fTipo === 'EJECUTADO' || fTipo === 'EJECUTADOS') {
        if (rTipo !== 'EJECUTADO') return false;
      } else if (fTipo !== 'TODOS' && fTipo !== '') {
        if (row.tipo !== tipo && row.TIPO !== tipo) return false;
      }
    }
    if (contractor && clean(row.contratista) !== contractor) return false;
    if (tension && clean(row.tension) !== tension) return false;
    if (district && clean(row.distrito) !== district) return false;

    // El rango de fechas del mapa corresponde a órdenes BT/AP, no a Obras.
    if (!row.es_obra) {
      const targetDate = row.tipo === 'Ejecutado' ? row.fecha_fin_date : row.fecha_inicio_date;
      if (row.tipo === 'Ejecutado' && (dateFrom || dateTo) && !targetDate) return false;
      if (dateFrom && targetDate && targetDate < dateFrom) return false;
      if (dateTo && targetDate && targetDate > dateTo) return false;
    }

    if (normalizedQuery) {
      const matches = [
        row.orden,
        row.orden_sistema_origen,
        row.lcl,
        row.sed,
        row.distrito,
        row.contratista,
        row.ubicacion_tecnica,
        row.tipo,
        row.TIPO,
        row.estado_original
      ].some((value) => clean(value).toLowerCase().includes(normalizedQuery));
      if (!matches) return false;
    }

    return true;
  });
}
