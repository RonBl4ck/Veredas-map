const clean = (value) => String(value ?? '').trim();

/**
 * Calculates the average days taken to close orders per contractor.
 * Orders must have valid start and finish dates, or interval hours.
 */
export function calculateContractorAvgDays(rows) {
  const companyDaysMap = {};

  rows.forEach((r) => {
    const c = clean(r.contratista) || 'Sin contratista';
    let days = null;
    if (r.fecha_inicio_date && r.fecha_fin_date) {
      const [y1, m1, d1] = clean(r.fecha_inicio_date).split('-').map(Number);
      const [y2, m2, d2] = clean(r.fecha_fin_date).split('-').map(Number);
      if (y1 && m1 && d1 && y2 && m2 && d2) {
        const start = new Date(y1, m1 - 1, d1);
        const end = new Date(y2, m2 - 1, d2);
        days = Math.max(0, Math.floor((end - start) / (1000 * 60 * 60 * 24)));
      }
    } else if (r.intervalo_hours > 0) {
      days = Math.round(r.intervalo_hours / 24);
    }

    if (days !== null && Number.isFinite(days)) {
      if (!companyDaysMap[c]) companyDaysMap[c] = { totalDays: 0, count: 0 };
      companyDaysMap[c].totalDays += days;
      companyDaysMap[c].count += 1;
    }
  });

  return Object.entries(companyDaysMap)
    .map(([company, stat]) => ({
      company,
      avgDays: Number((stat.totalDays / Math.max(1, stat.count)).toFixed(1)),
      count: stat.count
    }))
    .sort((a, b) => a.avgDays - b.avgDays);
}

/**
 * Filters rows by exact dates (dateFrom/dateTo) and month / month range (month, monthFrom/monthTo).
 */
export function filterReportRowsByDate(rows, filters = {}) {
  const { dateFrom = '', dateTo = '', month = '', monthFrom = '', monthTo = '', tipo = 'Ejecutado' } = filters;
  const hasAnyDateFilter = Boolean(dateFrom || dateTo || month || monthFrom || monthTo);

  return rows.filter((r) => {
    const targetDate = tipo === 'Ejecutado' ? r.fecha_fin_date : r.fecha_inicio_date;
    if (tipo === 'Ejecutado' && hasAnyDateFilter && !targetDate) return false;

    // Rango de fechas por día
    if (dateFrom && targetDate && targetDate < dateFrom) return false;
    if (dateTo && targetDate && targetDate > dateTo) return false;

    // Filtro por Mes o Rango de Meses
    const targetMonth = targetDate ? targetDate.slice(0, 7) : '';
    if (month && (!targetMonth || targetMonth !== month)) return false;
    if (monthFrom && (!targetMonth || targetMonth < monthFrom)) return false;
    if (monthTo && (!targetMonth || targetMonth > monthTo)) return false;

    return true;
  });
}
