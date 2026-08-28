/**
 * Aplicación Frontend - Control de Veredas
 * Pluz Energía / SAP IW39
 * 
 * Incluye:
 *  - Autenticación dinámica vía Google Sheets (Hoja ACCESO).
 *  - Carga de datos en vivo desde Google Sheets publicado en CSV (Hoja BASE_VEREDAS) con fallback local.
 *  - Vista 1: Mapa interactivo en pantalla completa con filtros, buscador de dirección independiente y rango de fechas.
 *  - Vista 2: Indicadores ejecutivos para Órdenes Pendientes con Chart.js, filtros de fecha de x a y, y tabla ordenable.
 *  - Vista 3: Indicadores ejecutivos para Órdenes Ejecutadas con Chart.js, filtros de fecha de x a y, y tabla ordenable.
 */

const CFG = window.APP_CONFIG || {
  dataCsvUrl: '/api/data',
  authCsvUrl: '/api/auth',
  fallbackPassword: 'veredas2026',
  localFallbackUrl: 'data/veredas.json',
  pageSize: 25
};

const COMPANY_COLORS = {
  LARI: '#F6C515',
  PA: '#0067A7',
  COBRA: '#35A853',
  DOMINION: '#F3A51B',
  INMEL: '#8B5CF6'
};

const INTERVAL_ORDER = ['0 a 2 dias', '3 a 7 dias', '8 a 15 dias', '15 a mas', 'Sin intervalo'];

// Estado global
let allRows = [];
let map = null;
let markerLayer = null;
let addressMarker = null;
let currentPassword = CFG.fallbackPassword;
const chartsInst = {};

// Estado de paginación, filtros y ordenamiento de dashboards
const reportState = {
  Pendiente: {
    page: 1,
    pageSize: 25,
    search: '',
    sort: { column: 'idx', direction: 'asc' },
    filters: { company: '', tension: '', district: '', interval: '', dateFrom: '', dateTo: '' }
  },
  Ejecutado: {
    page: 1,
    pageSize: 25,
    search: '',
    sort: { column: 'idx', direction: 'asc' },
    filters: { company: '', tension: '', district: '', interval: '', dateFrom: '', dateTo: '' }
  }
};

const $ = (id) => document.getElementById(id);
const clean = (val) => String(val ?? '').trim();
const escapeHtml = (val) => clean(val).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
const getCompanyColor = (company) => COMPANY_COLORS[clean(company).toUpperCase()] || '#6F8798';

// =============================================================
// 1. MÓDULO DE AUTENTICACIÓN (Google Sheets / Session)
// =============================================================

async function fetchRemotePassword() {
  try {
    let url = CFG.authCsvUrl || '/api/auth';
    url += (url.includes('?') ? '&' : '?') + '_t=' + Date.now();
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const rows = parseCsv(text);
    for (const r of rows) {
      const key = clean(r.PARAMETRO || r.parametro || Object.values(r)[0]).toUpperCase();
      const val = clean(r.VALOR || r.valor || Object.values(r)[1]);
      if (key.includes('PASS') || key.includes('CLAVE') || key.includes('ACCESO')) {
        if (val) {
          currentPassword = val;
          break;
        }
      }
    }
  } catch (err) {
    console.warn('No se pudo cargar contraseña remota; usando fallback.', err);
    currentPassword = CFG.fallbackPassword;
  }
}

function initAuth() {
  const isAuth = sessionStorage.getItem('veredas_auth') === 'true';
  const overlay = $('authOverlay');
  const errorEl = $('authError');
  const passInput = $('authPassword');
  const toggleBtn = $('btnTogglePwd');
  const logoutBtn = $('btnLogout');

  if (isAuth) {
    overlay.classList.add('hidden');
    initApp();
  } else {
    overlay.classList.remove('hidden');
    passInput.focus();
    fetchRemotePassword();
  }

  toggleBtn.addEventListener('click', () => {
    const isPass = passInput.type === 'password';
    passInput.type = isPass ? 'text' : 'password';
    toggleBtn.textContent = isPass ? '🔒' : '👁';
  });

  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = 'Verificando…';
    await fetchRemotePassword();

    const entered = clean(passInput.value);
    if (entered === currentPassword) {
      sessionStorage.setItem('veredas_auth', 'true');
      overlay.classList.add('hidden');
      errorEl.textContent = '';
      initApp();
    } else {
      errorEl.textContent = 'Contraseña incorrecta. Inténtalo de nuevo.';
      passInput.value = '';
      passInput.focus();
    }
  });

  logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem('veredas_auth');
    location.reload();
  });
}

// =============================================================
// 2. PARSER Y CARGA DE DATOS (Google Sheets CSV / Local JSON)
// =============================================================

function parseCsv(text) {
  const lines = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(cell.trim());
      if (row.some(c => c.length > 0)) lines.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some(c => c.length > 0)) lines.push(row);
  }

  if (lines.length < 2) return [];
  const headers = lines[0].map(h => h.replace(/^["']|["']$/g, '').trim());

  return lines.slice(1).map(line => {
    const item = {};
    headers.forEach((h, idx) => {
      let val = line[idx] ?? '';
      item[h] = val.replace(/^["']|["']$/g, '').trim();
    });
    return item;
  });
}

function normalizeIntervalString(intervalStr, fechaInicio, fechaFin, tipo) {
  if (intervalStr && !intervalStr.toLowerCase().includes('sin')) {
    const match = intervalStr.match(/(\d+)\s*d/i);
    if (match) {
      const days = parseInt(match[1], 10);
      if (days <= 2) return '0 a 2 dias';
      if (days <= 7) return '3 a 7 dias';
      if (days <= 15) return '8 a 15 dias';
      return '15 a mas';
    }
  }

  if (fechaInicio) {
    const start = new Date(fechaInicio);
    const end = (tipo === 'Ejecutado' && fechaFin) ? new Date(fechaFin) : new Date();
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      const diffDays = Math.max(0, Math.floor((end - start) / (1000 * 60 * 60 * 24)));
      if (diffDays <= 2) return '0 a 2 dias';
      if (diffDays <= 7) return '3 a 7 dias';
      if (diffDays <= 15) return '8 a 15 dias';
      return '15 a mas';
    }
  }
  return 'Sin intervalo';
}

function parseDateOnly(dateStr) {
  if (!dateStr) return '';
  const cleanStr = String(dateStr).trim().split(' ')[0].split('T')[0];
  // Si viene como DD/MM/YYYY
  if (cleanStr.includes('/')) {
    const parts = cleanStr.split('/');
    if (parts.length === 3) {
      const d = parts[0].padStart(2, '0');
      const m = parts[1].padStart(2, '0');
      const y = parts[2];
      return `${y}-${m}-${d}`;
    }
  }
  return cleanStr;
}

function mapCsvRowToRecord(r, originalIndex) {
  const lat = parseFloat(clean(r.LATITUD || r.lat || r.Latitud).replace(',', '.'));
  const lon = parseFloat(clean(r.LONGITUD || r.lon || r.Longitud).replace(',', '.'));
  const tipo = clean(r.TIPO || r.tipo || (clean(r.ESTADO_SAP).toUpperCase() === 'CER' ? 'Ejecutado' : 'Pendiente'));
  const fechaInicio = clean(r.FECHA_INICIO || r.fecha_inicio);
  const fechaFin = clean(r.FECHA_FIN || r.fecha_fin);
  const intervaloOriginal = clean(r.INTERVALO || r.intervalo);
  const intervaloNormalizado = normalizeIntervalString(intervaloOriginal, fechaInicio, fechaFin, tipo);

  const fechaReferencia = (tipo === 'Ejecutado' && fechaFin) ? fechaFin : fechaInicio;
  const diaKey = parseDateOnly(fechaReferencia) || 'Sin fecha';

  // Extraer horas/días numéricos para ordenamiento de antigüedad
  let intervalHours = 0;
  if (intervaloOriginal) {
    const dMatch = intervaloOriginal.match(/(\d+)\s*d/i);
    const hMatch = intervaloOriginal.match(/(\d+)\s*h/i);
    if (dMatch) intervalHours += parseInt(dMatch[1], 10) * 24;
    if (hMatch) intervalHours += parseInt(hMatch[1], 10);
  }

  return {
    idx: originalIndex + 1,
    orden: clean(r.ORDEN || r.orden),
    orden_sistema_origen: clean(r.ORDEN_ORIGEN || r.ORDEN_SISTEMA_ORIGEN || r.orden_sistema_origen),
    tipo: tipo === 'Ejecutado' ? 'Ejecutado' : 'Pendiente',
    estado_original: clean(r.ESTADO_SAP || r.estado_original),
    contratista: clean(r.CONTRATISTA || r.contratista) || 'Sin contratista',
    tension: clean(r.TENSION || r.tension) || 'Sin nivel',
    sed: clean(r.SED || r.sed) || 'Sin SED',
    distrito: clean(r.DISTRITO || r.distrito) || 'Sin distrito',
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    fecha_inicio: fechaInicio,
    fecha_fin: fechaFin,
    fecha_inicio_date: parseDateOnly(fechaInicio),
    fecha_fin_date: parseDateOnly(fechaFin),
    intervalo: intervaloOriginal,
    intervalo_normalizado: intervaloNormalizado,
    intervalo_hours: intervalHours,
    dia_key: diaKey,
    ubicacion_tecnica: clean(r.UBICACION_TECNICA || r.ubicacion_tecnica),
    grupo_hojas_ruta: clean(r.GRUPO_HOJAS_RUTA || r.grupo_hojas_ruta)
  };
}

async function loadRows() {
  let url = CFG.dataCsvUrl || '/api/data';
  url += (url.includes('?') ? '&' : '?') + '_t=' + Date.now();
  
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
      throw new Error('Respuesta no es CSV (Pestaña no compartida públicamente)');
    }
    const raw = parseCsv(text);
    if (raw.length === 0) throw new Error('CSV vacío');

    const records = raw.map((r, idx) => mapCsvRowToRecord(r, idx));
    $('lastUpdate').textContent = `🟢 En vivo (${records.length.toLocaleString('es-PE')} reg.)`;
    $('lastUpdate').title = 'Sincronizado en tiempo real desde Google Sheets';
    return records;

  } catch (err) {
    console.warn(`Error al conectar con Google Sheets (${err.message}). Cargando fallback local...`);
    try {
      const localRes = await fetch(CFG.localFallbackUrl, { cache: 'no-store' });
      if (!localRes.ok) throw new Error(`Local ${localRes.status}`);
      const json = await localRes.json();
      const records = json.map((r, idx) => mapCsvRowToRecord(r, idx));
      $('lastUpdate').textContent = `🟡 Copia local (${records.length.toLocaleString('es-PE')} reg.)`;
      $('lastUpdate').title = 'Datos cargados desde respaldo local';
      return records;
    } catch (localErr) {
      throw new Error(`Falló carga remota y local: ${err.message} | ${localErr.message}`);
    }
  }
}

// =============================================================
// 3. VISTA 1: MAPA EN PANTALLA COMPLETA
// =============================================================

function iconSvg(tension, color) {
  if (clean(tension).toUpperCase().includes('AP')) {
    return `<svg viewBox="0 0 32 34" aria-label="Alumbrado público"><path d="M16 2a9 9 0 0 0-5 16v5h10v-5a9 9 0 0 0-5-16Z" fill="${color}" stroke="#17384D" stroke-width="1.4"/><path d="M12 27h8M13.5 31h5" stroke="#17384D" stroke-width="2" stroke-linecap="round"/></svg>`;
  }
  return `<svg viewBox="0 0 42 34" aria-label="Camión"><path d="M2 7h25v17H2zM27 13h8l5 6v5H27z" fill="${color}" stroke="#17384D" stroke-width="1.4"/><circle cx="11" cy="28" r="3.5" fill="#17384D"/><circle cx="33" cy="28" r="3.5" fill="#17384D"/><path d="M30 15h4l3 4h-7z" fill="#EAF7FD"/></svg>`;
}

function initMap() {
  if (map) return;
  map = L.map('map', { zoomControl: true }).setView([-11.99, -77.05], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);

  markerLayer = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 50,
    disableClusteringAtZoom: 16,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false
  });
  map.addLayer(markerLayer);

  // Filtros de órdenes y opciones
  $('mapSearchInput').addEventListener('input', renderMap);
  $('mapFilterTipo').addEventListener('change', renderMap);
  $('mapFilterContratista').addEventListener('change', renderMap);
  $('mapFilterTension').addEventListener('change', renderMap);
  $('mapFilterDistrito').addEventListener('change', renderMap);
  $('mapDateFrom').addEventListener('change', renderMap);
  $('mapDateTo').addEventListener('change', renderMap);

  $('btnResetMapFilters').addEventListener('click', () => {
    $('mapSearchInput').value = '';
    $('mapFilterTipo').value = 'Pendiente';
    $('mapFilterContratista').value = '';
    $('mapFilterTension').value = '';
    $('mapFilterDistrito').value = '';
    $('mapDateFrom').value = '';
    $('mapDateTo').value = '';
    renderMap();
  });

  $('btnFitMapBounds').addEventListener('click', () => {
    if (markerLayer.getLayers().length > 0) {
      map.fitBounds(markerLayer.getBounds(), { padding: [40, 40] });
    }
  });

  // Buscador independiente de calle / dirección (NO filtra órdenes)
  $('btnMapSearchAddress').addEventListener('click', searchAddressOnMap);
  $('mapAddressInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchAddressOnMap();
  });

  $('btnClearAddressPin').addEventListener('click', () => {
    if (addressMarker) {
      map.removeLayer(addressMarker);
      addressMarker = null;
    }
    $('mapAddressInput').value = '';
    $('btnClearAddressPin').style.display = 'none';
  });
}

function populateMapSelects() {
  const companies = [...new Set(allRows.map(r => clean(r.contratista)).filter(Boolean))].sort();
  const voltages = [...new Set(allRows.map(r => clean(r.tension)).filter(Boolean))].sort();
  const districts = [...new Set(allRows.map(r => clean(r.distrito)).filter(Boolean))].sort();

  const fillSelect = (id, items) => {
    const el = $(id);
    const firstOpt = el.firstElementChild.outerHTML;
    el.innerHTML = firstOpt + items.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  };

  fillSelect('mapFilterContratista', companies);
  fillSelect('mapFilterTension', voltages);
  fillSelect('mapFilterDistrito', districts);

  // Leyenda de empresas
  $('legendCompanies').innerHTML = companies.map(c => `
    <div class="legend-row">
      <i class="dot" style="background:${getCompanyColor(c)}"></i>
      <span>${escapeHtml(c)}</span>
    </div>
  `).join('');
}

function renderMap() {
  if (!map) initMap();
  markerLayer.clearLayers();

  const q = clean($('mapSearchInput').value).toLowerCase();
  const fTipo = $('mapFilterTipo').value;
  const fComp = $('mapFilterContratista').value;
  const fVolt = $('mapFilterTension').value;
  const fDist = $('mapFilterDistrito').value;
  const fDateFrom = $('mapDateFrom').value;
  const fDateTo = $('mapDateTo').value;

  const visible = allRows.filter(r => {
    if (fTipo && r.tipo !== fTipo) return false;
    if (fComp && clean(r.contratista) !== fComp) return false;
    if (fVolt && clean(r.tension) !== fVolt) return false;
    if (fDist && clean(r.distrito) !== fDist) return false;

    // Filtro Rango de Fechas (Desde - Hasta)
    const targetDate = (r.tipo === 'Ejecutado' && r.fecha_fin_date) ? r.fecha_fin_date : r.fecha_inicio_date;
    if (fDateFrom && targetDate && targetDate < fDateFrom) return false;
    if (fDateTo && targetDate && targetDate > fDateTo) return false;

    // Búsqueda de órdenes/SED
    if (q) {
      const match = [r.orden, r.orden_sistema_origen, r.sed, r.distrito, r.contratista, r.ubicacion_tecnica]
        .some(v => clean(v).toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  const bounds = [];
  visible.forEach(r => {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return;

    const icon = L.divIcon({
      className: 'custom-map-icon',
      html: iconSvg(r.tension, getCompanyColor(r.contratista)),
      iconSize: [32, 28],
      iconAnchor: [16, 24]
    });

    const m = L.marker([r.lat, r.lon], { icon });
    const popupHtml = `
      <div style="min-width:260px;font-size:12px;line-height:1.4">
        <div style="font-weight:900;color:var(--navy);font-size:14px;margin-bottom:6px">
          ${escapeHtml(r.tipo)}: Orden ${escapeHtml(r.orden)}
        </div>
        <div><b>Orden Origen:</b> ${escapeHtml(r.orden_sistema_origen || '-')}</div>
        <div><b>SED:</b> ${escapeHtml(r.sed)} (${escapeHtml(r.distrito)})</div>
        <div><b>Contratista:</b> <span style="color:${getCompanyColor(r.contratista)};font-weight:bold">${escapeHtml(r.contratista)}</span></div>
        <div><b>Tensión:</b> ${escapeHtml(r.tension)} | <b>Estado SAP:</b> ${escapeHtml(r.estado_original)}</div>
        <div><b>Fecha Inicio:</b> ${escapeHtml(r.fecha_inicio || '-')}</div>
        <div><b>Fecha Fin Real:</b> ${escapeHtml(r.fecha_fin || '-')}</div>
        <div><b>Antigüedad:</b> ${escapeHtml(r.intervalo || '-')}</div>
        <div><b>Ubicación:</b> <small>${escapeHtml(r.ubicacion_tecnica || '-')}</small></div>
        <a class="gmaps-popup-btn" href="https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lon}" target="_blank">🗺 Abrir en Google Maps</a>
      </div>
    `;
    m.bindPopup(popupHtml);
    markerLayer.addLayer(m);
    bounds.push([r.lat, r.lon]);
  });

  $('mapStatusChip').textContent = `${bounds.length.toLocaleString('es-PE')} en mapa`;
  if (bounds.length > 0 && !addressMarker) {
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  }
}

async function searchAddressOnMap() {
  const query = clean($('mapAddressInput').value);
  if (!query) return;

  $('mapStatusChip').textContent = 'Buscando calle…';
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Lima, Peru')}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data && data.length > 0) {
      const first = data[0];
      const lat = parseFloat(first.lat);
      const lon = parseFloat(first.lon);

      if (addressMarker) map.removeLayer(addressMarker);
      addressMarker = L.marker([lat, lon], {
        icon: L.divIcon({ className: 'custom-map-icon', html: '📍', iconSize: [32, 32], iconAnchor: [16, 32] })
      }).addTo(map);

      map.setView([lat, lon], 16);
      addressMarker.bindPopup(`
        <div style="font-size:12px;min-width:200px">
          <b style="color:var(--navy)">📍 Dirección Ubicada:</b><br>
          ${escapeHtml(first.display_name)}
        </div>
      `).openPopup();

      $('btnClearAddressPin').style.display = 'block';
      $('mapStatusChip').textContent = 'Dirección ubicada';
    } else {
      $('mapStatusChip').textContent = 'Dirección no encontrada';
    }
  } catch (e) {
    $('mapStatusChip').textContent = 'Error al buscar dirección';
  }
}

// =============================================================
// 4. VISTAS 2 Y 3: TABLEROS DE INDICADORES (CHART.JS Y TABLAS)
// =============================================================

function renderChartInstance(canvasId, type, labels, data, options = {}) {
  if (chartsInst[canvasId]) {
    chartsInst[canvasId].destroy();
  }
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const isHorizontalBar = type === 'bar' && options.indexAxis === 'y';

  chartsInst[canvasId] = new Chart(ctx, {
    type: type,
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: options.backgroundColor || (type === 'bar' ? ['#0067A7', '#1487C9', '#35A853', '#F6C515', '#F3A51B', '#8B5CF6'] : 'rgba(0, 103, 167, 0.12)'),
        borderColor: options.borderColor || '#0067A7',
        borderWidth: type === 'line' ? 3 : 1,
        fill: type === 'line',
        tension: 0.25,
        pointRadius: type === 'line' ? 4 : 0,
        pointHoverRadius: type === 'line' ? 6 : 0
      }]
    },
    plugins: [ChartDataLabels],
    options: Object.assign({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true,
          color: type === 'bar' ? (isHorizontalBar ? '#17384D' : '#ffffff') : '#17384D',
          font: { weight: 'bold', size: 10 },
          anchor: isHorizontalBar ? 'end' : (type === 'line' ? 'end' : 'center'),
          align: isHorizontalBar ? 'right' : (type === 'line' ? 'top' : 'center'),
          formatter: (v) => (v > 0 ? v.toLocaleString('es-PE') : '')
        }
      },
      scales: isHorizontalBar ? {
        x: { beginAtZero: true, grid: { display: true }, ticks: { precision: 0 } },
        y: { grid: { display: false } }
      } : type === 'bar' ? {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { display: true }, ticks: { precision: 0 } }
      } : type === 'line' ? {
        x: { ticks: { autoSkip: true, maxTicksLimit: 20 }, grid: { display: false } },
        y: { beginAtZero: true, grid: { display: true }, ticks: { precision: 0 } }
      } : {}
    }, options)
  });
}

function populateReportFilters(tipo) {
  const rows = allRows.filter(r => r.tipo === tipo);
  const companies = [...new Set(rows.map(r => clean(r.contratista)).filter(Boolean))].sort();
  const voltages = [...new Set(rows.map(r => clean(r.tension)).filter(Boolean))].sort();
  const districts = [...new Set(rows.map(r => clean(r.distrito)).filter(Boolean))].sort();

  const fill = (id, items) => {
    const el = $(id);
    if (!el) return;
    const firstOpt = el.firstElementChild.outerHTML;
    el.innerHTML = firstOpt + items.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  };

  fill(`repFilterCompany${tipo}`, companies);
  fill(`repFilterTension${tipo}`, voltages);
  fill(`repFilterDistrict${tipo}`, districts);
}

function getFilteredReportRows(tipo) {
  const state = reportState[tipo];
  const q = state.search.toLowerCase();
  const { company, tension, district, interval, dateFrom, dateTo } = state.filters;

  return allRows.filter(r => {
    if (r.tipo !== tipo) return false;
    if (company && clean(r.contratista) !== company) return false;
    if (tension && clean(r.tension) !== tension) return false;
    if (district && clean(r.distrito) !== district) return false;
    if (interval && clean(r.intervalo_normalizado) !== interval) return false;

    // Filtro de Rango de Fechas (Desde - Hasta)
    const targetDate = (tipo === 'Ejecutado' && r.fecha_fin_date) ? r.fecha_fin_date : r.fecha_inicio_date;
    if (dateFrom && targetDate && targetDate < dateFrom) return false;
    if (dateTo && targetDate && targetDate > dateTo) return false;

    // Búsqueda en tabla
    if (q) {
      const match = [r.orden, r.orden_sistema_origen, r.sed, r.distrito, r.contratista, r.ubicacion_tecnica]
        .some(v => clean(v).toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });
}

function sortRows(rows, sortConfig) {
  const { column, direction } = sortConfig;
  const isAsc = direction === 'asc';

  return [...rows].sort((a, b) => {
    let valA = a[column];
    let valB = b[column];

    // Casos especiales de ordenamiento
    if (column === 'idx' || column === 'orden' || column === 'orden_sistema_origen') {
      const numA = parseInt(valA, 10) || 0;
      const numB = parseInt(valB, 10) || 0;
      return isAsc ? numA - numB : numB - numA;
    }

    if (column === 'intervalo') {
      const hA = a.intervalo_hours || 0;
      const hB = b.intervalo_hours || 0;
      return isAsc ? hA - hB : hB - hA;
    }

    if (column === 'fecha_inicio' || column === 'fecha_fin') {
      const dateA = a[column] ? new Date(a[column]).getTime() : 0;
      const dateB = b[column] ? new Date(b[column]).getTime() : 0;
      return isAsc ? dateA - dateB : dateB - dateA;
    }

    // Orden alfabético
    const strA = clean(valA).toLowerCase();
    const strB = clean(valB).toLowerCase();
    return isAsc ? strA.localeCompare(strB, 'es') : strB.localeCompare(strA, 'es');
  });
}

function updateReportView(tipo) {
  const filtered = getFilteredReportRows(tipo);
  const state = reportState[tipo];

  // 1. KPIs
  const total = filtered.length;
  const bt = filtered.filter(r => clean(r.tension).toUpperCase().includes('BT')).length;
  const mt = filtered.filter(r => clean(r.tension).toUpperCase().includes('MT')).length;
  const ap = filtered.filter(r => clean(r.tension).toUpperCase().includes('AP')).length;

  $(`kpiTotal${tipo}`).textContent = total.toLocaleString('es-PE');
  $(`kpiBt${tipo}`).textContent = bt.toLocaleString('es-PE');
  $(`kpiMt${tipo}`).textContent = mt.toLocaleString('es-PE');
  $(`kpiAp${tipo}`).textContent = ap.toLocaleString('es-PE');

  // Contador de filtros activos
  const activeCount = Object.values(state.filters).filter(Boolean).length + (state.search ? 1 : 0);
  $(`activeFilterCount${tipo}`).textContent = activeCount > 0 ? `${activeCount} filtro(s) activo(s)` : 'Sin filtros';

  // 2. Gráficos
  const countBy = (field) => filtered.reduce((acc, r) => {
    const k = clean(r[field]) || 'Sin dato';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  // Contratistas
  const compCounts = Object.entries(countBy('contratista')).sort((a, b) => b[1] - a[1]);
  renderChartInstance(`chartCompany${tipo}`, 'bar', compCounts.map(x => x[0]), compCounts.map(x => x[1]));

  // Tensión
  const voltCounts = Object.entries(countBy('tension')).sort((a, b) => b[1] - a[1]);
  renderChartInstance(`chartVoltage${tipo}`, 'bar', voltCounts.map(x => x[0]), voltCounts.map(x => x[1]));

  // Distritos (Top 10 Horizontal)
  const distCounts = Object.entries(countBy('distrito')).sort((a, b) => b[1] - a[1]).slice(0, 10);
  renderChartInstance(`chartDistrict${tipo}`, 'bar', distCounts.map(x => x[0]), distCounts.map(x => x[1]), { indexAxis: 'y' });

  // Día (Línea de evolución)
  const dayCounts = countBy('dia_key');
  delete dayCounts['Sin fecha'];
  const sortedDays = Object.entries(dayCounts).sort((a, b) => a[0].localeCompare(b[0]));
  renderChartInstance(
    `chartDay${tipo}`,
    'line',
    sortedDays.map(x => x[0]),
    sortedDays.map(x => x[1]),
    {
      borderColor: tipo === 'Pendiente' ? '#F3A51B' : '#35A853',
      backgroundColor: tipo === 'Pendiente' ? 'rgba(243, 165, 27, 0.12)' : 'rgba(53, 168, 83, 0.12)'
    }
  );

  // Intervalo / Antigüedad
  const intervalCounts = countBy('intervalo_normalizado');
  const intValues = INTERVAL_ORDER.map(label => intervalCounts[label] || 0);
  renderChartInstance(`chartInterval${tipo}`, 'bar', INTERVAL_ORDER, intValues);

  // 3. Renderizar Tabla Ordenable
  renderReportTable(tipo, filtered);
}

function handleTableSort(tipo, column) {
  const state = reportState[tipo];
  if (state.sort.column === column) {
    state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    state.sort.column = column;
    state.sort.direction = 'asc';
  }

  // Actualizar clases de encabezados
  const table = $(`table${tipo}`);
  table.querySelectorAll('th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === column) {
      th.classList.add(state.sort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });

  const filtered = getFilteredReportRows(tipo);
  renderReportTable(tipo, filtered);
}

function renderReportTable(tipo, filtered) {
  const state = reportState[tipo];
  const tbody = $(`tableBody${tipo}`);
  tbody.innerHTML = '';

  // Ordenar filas antes de paginar
  const sorted = sortRows(filtered, state.sort);

  const total = sorted.length;
  $(`tableCount${tipo}`).textContent = `${total.toLocaleString('es-PE')} registros encontrados`;

  const start = (state.page - 1) * state.pageSize;
  const pageRows = sorted.slice(start, start + state.pageSize);

  pageRows.forEach((r, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${start + idx + 1}</td>
      <td><b>${escapeHtml(r.estado_original)}</b></td>
      <td><b>${escapeHtml(r.orden)}</b></td>
      <td>${escapeHtml(r.orden_sistema_origen || '-')}</td>
      <td><b>${escapeHtml(r.sed)}</b></td>
      <td><span style="color:${getCompanyColor(r.contratista)};font-weight:bold">${escapeHtml(r.contratista)}</span></td>
      <td>${escapeHtml(r.distrito)}</td>
      <td>${escapeHtml(r.tension)}</td>
      <td>${escapeHtml(tipo === 'Ejecutado' ? r.fecha_fin : r.fecha_inicio)}</td>
      <td>${escapeHtml(r.intervalo || '-')}</td>
      <td><small>${escapeHtml(r.ubicacion_tecnica || '-')}</small></td>
    `;
    tbody.appendChild(tr);
  });

  // Paginación
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  $(`pagination${tipo}`).innerHTML = `
    <button class="btn-secondary-sm" ${state.page <= 1 ? 'disabled' : ''} onclick="changeReportPage('${tipo}', -1)">◀ Anterior</button>
    <span>Página ${state.page} de ${totalPages}</span>
    <button class="btn-secondary-sm" ${state.page >= totalPages ? 'disabled' : ''} onclick="changeReportPage('${tipo}', 1)">Siguiente ▶</button>
  `;
}

function changeReportPage(tipo, delta) {
  const state = reportState[tipo];
  state.page += delta;
  const filtered = getFilteredReportRows(tipo);
  renderReportTable(tipo, filtered);
}

function applyReportFilters(tipo) {
  const state = reportState[tipo];
  state.filters.company = $(`repFilterCompany${tipo}`).value;
  state.filters.tension = $(`repFilterTension${tipo}`).value;
  state.filters.district = $(`repFilterDistrict${tipo}`).value;
  state.filters.interval = $(`repFilterInterval${tipo}`).value;
  state.filters.dateFrom = $(`repDateFrom${tipo}`).value;
  state.filters.dateTo = $(`repDateTo${tipo}`).value;
  state.page = 1;
  updateReportView(tipo);
}

function resetReportFilters(tipo) {
  const state = reportState[tipo];
  $(`repFilterCompany${tipo}`).value = '';
  $(`repFilterTension${tipo}`).value = '';
  $(`repFilterDistrict${tipo}`).value = '';
  $(`repFilterInterval${tipo}`).value = '';
  $(`repDateFrom${tipo}`).value = '';
  $(`repDateTo${tipo}`).value = '';
  $(`tableSearch${tipo}`).value = '';
  state.search = '';
  state.filters = { company: '', tension: '', district: '', interval: '', dateFrom: '', dateTo: '' };
  state.page = 1;
  updateReportView(tipo);
}

function downloadCurrentTable(tipo) {
  const filtered = getFilteredReportRows(tipo);
  const rows = sortRows(filtered, reportState[tipo].sort);

  if (!rows.length) {
    alert('No hay registros para descargar.');
    return;
  }

  const headers = ['Orden', 'Orden Origen', 'Tipo', 'Estado SAP', 'Contratista', 'Tension', 'SED', 'Distrito', 'Latitud', 'Longitud', 'Fecha Inicio', 'Fecha Fin', 'Intervalo', 'Ubicacion Tecnica'];
  const csvLines = [headers.join(';')];

  rows.forEach(r => {
    const vals = [
      r.orden,
      r.orden_sistema_origen,
      r.tipo,
      r.estado_original,
      r.contratista,
      r.tension,
      r.sed,
      r.distrito,
      r.lat,
      r.lon,
      r.fecha_inicio,
      r.fecha_fin,
      r.intervalo,
      r.ubicacion_tecnica
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`);
    csvLines.push(vals.join(';'));
  });

  const blob = new Blob(["\ufeff" + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `Veredas_${tipo}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

// =============================================================
// 5. NAVEGACIÓN Y ARRANQUE
// =============================================================

function setupNavigation() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.page-view').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetId = tab.dataset.page;
      $(targetId).classList.add('active');

      if (targetId === 'pageMap' && map) {
        setTimeout(() => map.invalidateSize(), 150);
      } else if (targetId === 'pagePendientes') {
        updateReportView('Pendiente');
      } else if (targetId === 'pageEjecutados') {
        updateReportView('Ejecutado');
      }
    });
  });

  // Buscadores de tablas
  $('tableSearchPendiente').addEventListener('input', (e) => {
    reportState.Pendiente.search = e.target.value;
    reportState.Pendiente.page = 1;
    updateReportView('Pendiente');
  });

  $('tableSearchEjecutado').addEventListener('input', (e) => {
    reportState.Ejecutado.search = e.target.value;
    reportState.Ejecutado.page = 1;
    updateReportView('Ejecutado');
  });
}

async function initApp() {
  try {
    setupNavigation();
    initMap();
    allRows = await loadRows();

    // Poblar componentes
    populateMapSelects();
    renderMap();

    populateReportFilters('Pendiente');
    populateReportFilters('Ejecutado');

    updateReportView('Pendiente');
    updateReportView('Ejecutado');

  } catch (err) {
    console.error('Error al inicializar aplicación:', err);
    $('lastUpdate').textContent = '❌ Error de carga';
  }
}

// Arranque inicial
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
});
