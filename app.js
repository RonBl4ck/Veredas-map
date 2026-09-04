import { initAuth as initAuthModule } from './js/auth.js';
import { bindDashboardActions } from './js/dashboard-actions.js';
import { byId } from './js/dom.js';

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
  authUrl: '/api/auth',
  pageSize: 25
};

const COMPANY_COLORS = {
  LARI: '#F8B319',     // Amarillo Solar Pluz
  PA: '#1B4E9B',       // Azul Cobalto Pluz
  COBRA: '#4DA338',    // Verde Energía Pluz
  DOMINION: '#EA580C', // Naranja Operativo
  INMEL: '#7C3AED'     // Violeta
};

const INTERVAL_ORDER = ['0 a 2 dias', '3 a 7 dias', '8 a 15 dias', '15 a mas', 'Sin intervalo'];
const SLA_HOURS = 48;

// Estado global
let allRows = [];
let mapRows = [];
let obrasRows = [];
let map = null;
let markerLayer = null;
let addressMarker = null;
const chartsInst = {};

// Estado de paginación, filtros y ordenamiento de dashboards
const reportState = {
  Pendiente: {
    page: 1,
    pageSize: 25,
    search: '',
    sort: { column: 'idx', direction: 'asc' },
    filters: { company: '', tension: '', district: '', interval: '', sla: '', dateFrom: '', dateTo: '' }
  },
  Ejecutado: {
    page: 1,
    pageSize: 25,
    search: '',
    sort: { column: 'idx', direction: 'asc' },
    filters: { company: '', tension: '', district: '', interval: '', dateFrom: '', dateTo: '' }
  }
};

const obrasState = {
  page: 1,
  pageSize: 50,
  search: '',
  subTab: 'Pendiente', // 'Pendiente' | 'Atendido' | 'Todos'
  filters: {
    dateFrom: '',
    dateTo: '',
    sla: '',
    company: '',
    district: '',
    type: '',
    geo: ''
  }
};

const $ = byId;
const clean = (val) => String(val ?? '').trim();
const escapeHtml = (val) => clean(val).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
const getCompanyColor = (company) => {
  const normalized = clean(company).toUpperCase();
  if (normalized.includes('PA PERU') || normalized === 'PA') return COMPANY_COLORS.PA;
  if (COMPANY_COLORS[normalized]) return COMPANY_COLORS[normalized];
  const hash = [...normalized].reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 0);
  return `hsl(${hash % 360} 58% 43%)`;
};

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

function getSlaInfo(record) {
  const start = record.fecha_inicio ? new Date(record.fecha_inicio) : null;
  const calculatedAge = start && !isNaN(start.getTime())
    ? Math.max(0, Math.floor((Date.now() - start.getTime()) / (1000 * 60 * 60)))
    : null;
  const ageHours = Number.isFinite(calculatedAge) ? calculatedAge : record.intervalo_hours;

  if (!Number.isFinite(ageHours)) {
    return { status: 'sin_dato', remainingHours: null, label: 'Sin dato de plazo' };
  }

  const remainingHours = SLA_HOURS - ageHours;
  if (remainingHours <= 0) return { status: 'vencida', remainingHours, label: `Vencida hace ${Math.abs(remainingHours)} h` };
  if (remainingHours <= 12) return { status: 'critica', remainingHours, label: `Crítica · ${remainingHours} h restantes` };
  if (remainingHours <= 24) return { status: 'por_vencer', remainingHours, label: `Atención · ${remainingHours} h restantes` };
  return { status: 'en_plazo', remainingHours, label: `En plazo · ${remainingHours} h restantes` };
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

function parseLocation(value) {
  const [latValue, lonValue] = clean(value).split(',').map(part => parseFloat(part.trim().replace(',', '.')));
  return { lat: Number.isFinite(latValue) ? latValue : null, lon: Number.isFinite(lonValue) ? lonValue : null };
}

function isPeruCoordinate(record) {
  return Number.isFinite(record.lat) && Number.isFinite(record.lon)
    && record.lat >= -18 && record.lat <= 0
    && record.lon >= -82 && record.lon <= -68
    && !(record.lat === 0 && record.lon === 0);
}

function formatShortDate(dateStr) {
  if (!dateStr) return '-';
  const cleanStr = String(dateStr).trim().split(' ')[0].split('T')[0];
  const parts = cleanStr.includes('/') ? cleanStr.split('/') : cleanStr.split('-');
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}`;
    }
    return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}`;
  }
  return cleanStr;
}

function getObrasSla(record) {
  const startStr = record.fecha_inicio_date || parseDateOnly(record.fecha_inicio);
  if (!startStr) return { status: 'sin_dato', label: 'Sin fecha', days: 0 };

  const [sy, sm, sd] = startStr.split('-').map(Number);
  const startDate = new Date(sy, sm - 1, sd);

  let targetDate;
  if (record.is_ejecutado) {
    const endStr = record.fecha_fin_date || parseDateOnly(record.fecha_fin);
    if (endStr) {
      const [ey, em, ed] = endStr.split('-').map(Number);
      targetDate = new Date(ey, em - 1, ed);
    } else {
      targetDate = startDate;
    }
  } else {
    const now = new Date();
    targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  const diffTime = targetDate.getTime() - startDate.getTime();
  const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

  if (record.is_ejecutado) {
    if (diffDays <= 2) {
      return { status: 'en_plazo', label: `Atendido en plazo (${diffDays}d)`, days: diffDays };
    }
    return { status: 'vencida', label: `Atendido fuera de plazo (${diffDays}d)`, days: diffDays };
  }

  // Pendiente: Plazo de 2 días
  // Día 0 (ingreso) y Día 1 -> En plazo
  if (diffDays <= 1) {
    return { status: 'en_plazo', label: `En plazo (${diffDays}d)`, days: diffDays };
  }
  // Día 2 -> Por vencer (vence hoy)
  if (diffDays === 2) {
    return { status: 'por_vencer', label: 'Vence hoy (Día 2)', days: diffDays };
  }
  // Día 3 en adelante -> Vencida / Fuera de plazo
  return { status: 'vencida', label: `Vencida (${diffDays}d)`, days: diffDays };
}

function mapObrasRow(r, index) {
  const lat = parseFloat(clean(r.LATITUD || r.lat || r.Latitud).replace(',', '.'));
  const lon = parseFloat(clean(r.LONGITUD || r.lon || r.Longitud).replace(',', '.'));
  const orden = clean(r.ORDEN || r.orden || r.LCL || r.lcl);
  const ordenOrigen = clean(r.ORDEN_ORIGEN || r.orden_origen || r.PRESUPUESTO || r.presupuesto);
  const tipoTrabajo = clean(r.TIPO_TRABAJO || r.tipo_trabajo);
  const isReparacion = tipoTrabajo.toUpperCase().includes('REPARAC');
  const source = isReparacion ? 'Reparación de veredas' : 'Obras georreferenciadas';
  const fechaInicio = clean(r.FECHA_INICIO || r.fecha_inicio);
  const fechaFin = clean(r.FECHA_FIN || r.fecha_fin);
  const estadoOriginal = clean(r.ESTADO_SAP || r.estado_sap || r.ESTADO || r.estado);
  const contratista = clean(r.CONTRATISTA || r.contratista) || 'Sin contratista';
  const distrito = clean(r.DISTRITO || r.distrito) || 'Sin distrito';
  const intervalo = clean(r.INTERVALO || r.intervalo);

  const rawTipo = clean(r.TIPO || r.tipo).toUpperCase();
  const isEjecutado = rawTipo === 'EJECUTADO' || Boolean(fechaFin);

  const record = {
    idx: index + 1,
    source,
    tipo: 'Obras',
    tension: 'OBRAS',
    is_ejecutado: isEjecutado,
    orden,
    lcl: orden,
    orden_sistema_origen: ordenOrigen,
    contratista,
    distrito,
    estado_original: estadoOriginal,
    tipo_trabajo: tipoTrabajo,
    tipo_obra: tipoTrabajo,
    fecha_inicio: fechaInicio,
    fecha_inicio_date: parseDateOnly(fechaInicio),
    fecha_fin: fechaFin,
    fecha_fin_date: parseDateOnly(fechaFin),
    intervalo,
    ubicacion_tecnica: '',
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null
  };

  record.sla = getObrasSla(record);
  return record;
}

async function loadObrasRows() {
  try {
    const res = await fetch(`/api/obras?_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
      throw new Error('Respuesta no es CSV (Pestaña no compartida públicamente)');
    }
    const raw = parseCsv(text);
    if (raw.length === 0) return [];
    return raw.map((r, idx) => mapObrasRow(r, idx));
  } catch (err) {
    console.warn(`No se pudieron cargar las Obras (${err.message}).`);
    return [];
  }
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
    throw new Error(`Error al cargar los datos protegidos: ${err.message}`);
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

function worksIconWithSla(color, slaStatus) {
  const ringClass = slaStatus ? `sla-ring-${slaStatus}` : 'sla-ring-en_plazo';
  return `
    <div class="works-marker-wrapper ${ringClass}">
      <div class="works-halo-ring"></div>
      <svg viewBox="0 0 40 34" class="works-helmet-svg" aria-label="Obras">
        <path d="M8 18c0-7 5.4-12 12-12s12 5 12 12v2H8z" fill="${color}" stroke="#17384D" stroke-width="1.6"/>
        <path d="M5 21h30v5H5z" fill="${color}" stroke="#17384D" stroke-width="1.6"/>
        <path d="M20 6v15M11 17h18" stroke="#17384D" stroke-width="1.4"/>
      </svg>
    </div>
  `;
}

function initMap() {
  if (map) return;
  map = L.map('map', { zoomControl: true }).setView([-11.99, -77.05], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);

  markerLayer = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 40,
    spiderfyOnMaxZoom: true,
    spiderfyDistanceMultiplier: 1.5,
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
    $('mapFilterTipo').value = '';
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
  const companies = [...new Set(mapRows.map(r => clean(r.contratista)).filter(Boolean))].sort();
  const voltages = [...new Set(mapRows.map(r => clean(r.tension)).filter(Boolean))].sort();
  const districts = [...new Set(mapRows.map(r => clean(r.distrito)).filter(Boolean))].sort();

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

  const visible = mapRows.filter(r => {
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
      const match = [r.orden, r.orden_sistema_origen, r.lcl, r.sed, r.distrito, r.contratista, r.ubicacion_tecnica]
        .some(v => clean(v).toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  const bounds = [];
  const coordCount = new Map();

  visible.forEach(r => {
    if (!isPeruCoordinate(r)) return;

    const isObra = r.tipo === 'Obras';
    const slaStatus = isObra ? (r.sla?.status || 'en_plazo') : null;

    const icon = L.divIcon({
      className: 'custom-map-icon',
      html: isObra
        ? worksIconWithSla(getCompanyColor(r.contratista), slaStatus)
        : iconSvg(r.tension, getCompanyColor(r.contratista)),
      iconSize: isObra ? [34, 30] : [32, 28],
      iconAnchor: isObra ? [17, 24] : [16, 24]
    });

    // Anti-solapamiento de coordenadas idénticas (SEDs / misma ubicación)
    const coordKey = `${r.lat.toFixed(5)},${r.lon.toFixed(5)}`;
    const cIdx = coordCount.get(coordKey) || 0;
    coordCount.set(coordKey, cIdx + 1);

    let drawLat = r.lat;
    let drawLon = r.lon;
    if (cIdx > 0) {
      // Dispersión suave de 6 a 10 metros para visualización contigua al acercar el zoom
      const angle = cIdx * 2.39996;
      const dist = 0.000045 * Math.sqrt(cIdx);
      drawLat += dist * Math.cos(angle);
      drawLon += dist * Math.sin(angle);
    }

    const m = L.marker([drawLat, drawLon], { icon });
    if (isObra) {
      const slaBadgeHtml = r.sla ? `
        <div style="margin-bottom:6px">
          <span class="deadline-badge ${r.sla.status === 'vencida' ? 'deadline-vencida' : r.sla.status === 'por_vencer' ? 'deadline-por_vencer' : 'deadline-en_plazo'}">
            ${escapeHtml(r.sla.label)}
          </span>
        </div>
      ` : '';

      const popupHtml = `
        <div style="min-width:260px;font-size:12px;line-height:1.4">
          <div style="font-weight:900;color:var(--navy);font-size:14px;margin-bottom:4px">⛑ ${escapeHtml(r.source)}</div>
          ${slaBadgeHtml}
          <div><b>LCL/ODM:</b> ${escapeHtml(r.lcl)}</div>
          <div><b>Estado:</b> ${escapeHtml(r.estado_original || '-')}</div>
          <div><b>Contratista:</b> <span style="color:${getCompanyColor(r.contratista)};font-weight:bold">${escapeHtml(r.contratista)}</span></div>
          <div><b>Distrito:</b> ${escapeHtml(r.distrito)} | <b>Tipo:</b> ${escapeHtml(r.tipo_trabajo || r.tipo_obra || '-')}</div>
          <div><b>Fecha Ingreso:</b> ${escapeHtml(formatShortDate(r.fecha_inicio))}</div>
          ${r.fecha_fin ? `<div><b>Fecha Atención:</b> ${escapeHtml(formatShortDate(r.fecha_fin))}</div>` : ''}
          <div><b>Duración:</b> ${escapeHtml(r.intervalo || (r.sla?.days ? `${r.sla.days}d` : '-'))}</div>
          <a class="gmaps-popup-btn" href="https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lon}" target="_blank">Abrir en Google Maps</a>
        </div>
      `;
      m.bindPopup(popupHtml);
      markerLayer.addLayer(m);
      bounds.push([drawLat, drawLon]);
      return;
    }

    const popupHtml = `
      <div style="min-width:260px;font-size:12px;line-height:1.4">
        <div style="font-weight:900;color:var(--navy);font-size:14px;margin-bottom:6px">
          ${escapeHtml(r.tipo)}: Orden ${escapeHtml(r.orden)}
        </div>
        <div><b>Orden Origen:</b> ${escapeHtml(r.orden_sistema_origen || '-')}</div>
        <div><b>SED:</b> ${escapeHtml(r.sed)} (${escapeHtml(r.distrito)})</div>
        <div><b>Contratista:</b> <span style="color:${getCompanyColor(r.contratista)};font-weight:bold">${escapeHtml(r.contratista)}</span></div>
        <div><b>Tensión:</b> ${escapeHtml(r.tension)} | <b>Estado SAP:</b> ${escapeHtml(r.estado_original)}</div>
        <div><b>Fecha Inicio:</b> ${escapeHtml(formatShortDate(r.fecha_inicio))}</div>
        <div><b>Fecha Fin Real:</b> ${escapeHtml(formatShortDate(r.fecha_fin))}</div>
        <div><b>Antigüedad:</b> ${escapeHtml(r.intervalo || '-')}</div>
        <div><b>Ubicación:</b> <small>${escapeHtml(r.ubicacion_tecnica || '-')}</small></div>
        <a class="gmaps-popup-btn" href="https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lon}" target="_blank">🗺 Abrir en Google Maps</a>
      </div>
    `;
    m.bindPopup(popupHtml);
    markerLayer.addLayer(m);
    bounds.push([drawLat, drawLon]);
  });

  const worksCount = visible.filter(record => record.tipo === 'Obras' && isPeruCoordinate(record)).length;
  const invalidGeoCount = visible.filter(record => !isPeruCoordinate(record)).length;
  $('mapStatusChip').textContent = `${bounds.length.toLocaleString('es-PE')} en mapa${worksCount ? ` · ${worksCount} obras` : ''}${invalidGeoCount ? ` · ${invalidGeoCount} sin ubicación válida` : ''}`;
  if (bounds.length > 0 && !addressMarker) {
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  }
}

async function searchAddressOnMap() {
  const rawQuery = clean($('mapAddressInput').value);
  if (!rawQuery) return;

  $('mapStatusChip').textContent = 'Buscando ubicación…';

  // 1. Detectar si el usuario ingresó coordenadas (ej. "-12.0463, -77.0423" o "-12.0463 -77.0423" o "-12.0463, -77.0423")
  const coordRegex = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/;
  const match = rawQuery.match(coordRegex);

  if (match) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);

    if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      if (addressMarker) map.removeLayer(addressMarker);
      addressMarker = L.marker([lat, lon], {
        icon: L.divIcon({ className: 'custom-map-icon', html: '📍', iconSize: [32, 32], iconAnchor: [16, 32] })
      }).addTo(map);

      map.setView([lat, lon], 17);
      addressMarker.bindPopup(`
        <div style="font-size:12px;min-width:200px">
          <b style="color:var(--navy)">📍 Coordenadas Ingresadas:</b><br>
          Latitud: ${lat}<br>
          Longitud: ${lon}
        </div>
      `).openPopup();

      $('btnClearAddressPin').style.display = 'block';
      $('mapStatusChip').textContent = 'Coordenadas ubicadas';
      return;
    }
  }

  // 2. Búsqueda por texto (colegios, avenidas, lugares de interés) en Nominatim
  try {
    // Si la búsqueda incluye una coma o ya menciona Lima/Perú, usamos el query directo; de lo contrario anexamos ", Lima, Perú"
    const searchQuery = /peru|perú|lima/i.test(rawQuery) ? rawQuery : `${rawQuery}, Lima, Perú`;
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`;
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
          <b style="color:var(--navy)">📍 Lugar Encontrado:</b><br>
          ${escapeHtml(first.display_name)}
        </div>
      `).openPopup();

      $('btnClearAddressPin').style.display = 'block';
      $('mapStatusChip').textContent = 'Ubicación encontrada';
    } else {
      $('mapStatusChip').textContent = 'Ubicación no encontrada';
    }
  } catch (e) {
    $('mapStatusChip').textContent = 'Error al buscar ubicación';
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
  const defaultColors = ['#1B4E9B', '#F8B319', '#4DA338', '#0284C7', '#EA580C', '#7C3AED'];

  chartsInst[canvasId] = new Chart(ctx, {
    type: type,
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: options.backgroundColor || (type === 'bar' ? defaultColors : 'rgba(27, 78, 155, 0.10)'),
        borderColor: options.borderColor || '#1B4E9B',
        borderWidth: type === 'line' ? 2.5 : 0,
        borderRadius: type === 'bar' ? 6 : 0,
        fill: type === 'line',
        tension: 0.3,
        pointRadius: type === 'line' ? 4 : 0,
        pointHoverRadius: type === 'line' ? 6 : 0,
        pointBackgroundColor: type === 'line' ? '#1B4E9B' : undefined
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
          color: type === 'bar' ? (isHorizontalBar ? '#0F2338' : '#ffffff') : '#0F2338',
          font: { weight: '800', size: 10, family: "'Plus Jakarta Sans', sans-serif" },
          anchor: isHorizontalBar ? 'end' : (type === 'line' ? 'end' : 'center'),
          align: isHorizontalBar ? 'right' : (type === 'line' ? 'top' : 'center'),
          formatter: (v) => (v > 0 ? v.toLocaleString('es-PE') : '')
        }
      },
      scales: isHorizontalBar ? {
        x: { beginAtZero: true, grid: { color: '#E2E8F0', drawBorder: false }, ticks: { precision: 0, font: { family: "'Plus Jakarta Sans', sans-serif", size: 10 } } },
        y: { grid: { display: false }, ticks: { font: { family: "'Plus Jakarta Sans', sans-serif", size: 10, weight: '700' } } }
      } : type === 'bar' ? {
        x: { grid: { display: false }, ticks: { font: { family: "'Plus Jakarta Sans', sans-serif", size: 10, weight: '700' } } },
        y: { beginAtZero: true, grid: { color: '#E2E8F0', drawBorder: false }, ticks: { precision: 0, font: { family: "'Plus Jakarta Sans', sans-serif", size: 10 } } }
      } : type === 'line' ? {
        x: { ticks: { autoSkip: true, maxTicksLimit: 16, font: { family: "'Plus Jakarta Sans', sans-serif", size: 9 } }, grid: { display: false } },
        y: { beginAtZero: true, grid: { color: '#E2E8F0', drawBorder: false }, ticks: { precision: 0, font: { family: "'Plus Jakarta Sans', sans-serif", size: 10 } } }
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
  const { company, tension, district, interval, sla, dateFrom, dateTo } = state.filters;

  return allRows.filter(r => {
    if (r.tipo !== tipo) return false;
    if (company && clean(r.contratista) !== company) return false;
    if (tension && clean(r.tension) !== tension) return false;
    if (district && clean(r.distrito) !== district) return false;
    if (interval && clean(r.intervalo_normalizado) !== interval) return false;
    if (tipo === 'Pendiente' && sla) {
      const slaInfo = getSlaInfo(r);
      const isUrgent = Number.isFinite(slaInfo.remainingHours) && slaInfo.remainingHours > 0 && slaInfo.remainingHours <= 24;
      if (sla === 'urgente' ? !isUrgent : slaInfo.status !== sla) return false;
    }

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

    if (column === 'sla') {
      const hoursA = getSlaInfo(a).remainingHours;
      const hoursB = getSlaInfo(b).remainingHours;
      const valueA = Number.isFinite(hoursA) ? hoursA : Number.MAX_SAFE_INTEGER;
      const valueB = Number.isFinite(hoursB) ? hoursB : Number.MAX_SAFE_INTEGER;
      return isAsc ? valueA - valueB : valueB - valueA;
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
  const dueSoon = tipo === 'Pendiente'
    ? filtered.filter(r => {
      const { remainingHours } = getSlaInfo(r);
      return Number.isFinite(remainingHours) && remainingHours > 0 && remainingHours <= 24;
    }).length
    : 0;

  $(`kpiTotal${tipo}`).textContent = total.toLocaleString('es-PE');
  $(`kpiBt${tipo}`).textContent = bt.toLocaleString('es-PE');
  $(`kpiMt${tipo}`).textContent = mt.toLocaleString('es-PE');
  $(`kpiAp${tipo}`).textContent = ap.toLocaleString('es-PE');
  if (tipo === 'Pendiente') $(`kpiDueSoonPendiente`).textContent = dueSoon.toLocaleString('es-PE');

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
      borderColor: tipo === 'Pendiente' ? '#F8B319' : '#4DA338',
      backgroundColor: tipo === 'Pendiente' ? 'rgba(248, 179, 25, 0.12)' : 'rgba(77, 163, 56, 0.12)'
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
    const sla = tipo === 'Pendiente' ? getSlaInfo(r) : null;
    if (sla) tr.classList.add(`sla-${sla.status}`);
    
    let estadoBadge = escapeHtml(r.estado_original);
    const estUpper = clean(r.estado_original).toUpperCase();
    if (estUpper === 'CER') {
      estadoBadge = `<span class="badge-status-sap badge-sap-cer">CER</span>`;
    } else if (estUpper === 'LIB') {
      estadoBadge = `<span class="badge-status-sap badge-sap-lib">LIB</span>`;
    } else if (estUpper === 'ABI') {
      estadoBadge = `<span class="badge-status-sap badge-sap-abi">ABI</span>`;
    } else if (r.estado_original) {
      estadoBadge = `<span class="badge-status-sap badge-sap-lib">${escapeHtml(r.estado_original)}</span>`;
    }

    const tensionBadge = r.tension ? `<span class="badge-tension">${escapeHtml(r.tension)}</span>` : '-';
    const slaBadge = sla ? `<span class="deadline-badge deadline-${sla.status}">${escapeHtml(sla.label)}</span>` : '-';

    tr.innerHTML = `
      <td style="font-weight:700;color:var(--text-muted)">${start + idx + 1}</td>
      <td>${estadoBadge}</td>
      <td><strong style="color:var(--pluz-blue);font-size:12.5px">${escapeHtml(r.orden)}</strong></td>
      <td style="color:var(--text-secondary)">${escapeHtml(r.orden_sistema_origen || '-')}</td>
      <td><b style="color:var(--text-main)">${escapeHtml(r.sed)}</b></td>
      <td><span style="color:${getCompanyColor(r.contratista)};font-weight:800">${escapeHtml(r.contratista)}</span></td>
      <td>${escapeHtml(r.distrito)}</td>
      <td>${tensionBadge}</td>
      <td>${escapeHtml(tipo === 'Ejecutado' ? r.fecha_fin : r.fecha_inicio)}</td>
      <td style="font-weight:600">${escapeHtml(r.intervalo || '-')}</td>
      ${tipo === 'Pendiente' ? `<td>${slaBadge}</td>` : ''}
      <td><small style="color:var(--text-secondary)">${escapeHtml(r.ubicacion_tecnica || '-')}</small></td>
    `;
    tbody.appendChild(tr);
  });

  // Paginación
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  $(`pagination${tipo}`).innerHTML = `
    <button class="btn-secondary-sm" ${state.page <= 1 ? 'disabled' : ''} onclick="changeReportPage('${tipo}', -1)">◀ Anterior</button>
    <span style="font-weight:700;color:var(--text-secondary);padding:0 8px">Página <b style="color:var(--pluz-blue)">${state.page}</b> de <b>${totalPages}</b></span>
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
  state.filters.sla = tipo === 'Pendiente' ? $(`repFilterSlaPendiente`).value : '';
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
  if (tipo === 'Pendiente') $(`repFilterSlaPendiente`).value = '';
  $(`repDateFrom${tipo}`).value = '';
  $(`repDateTo${tipo}`).value = '';
  $(`tableSearch${tipo}`).value = '';
  state.search = '';
  state.filters = { company: '', tension: '', district: '', interval: '', sla: '', dateFrom: '', dateTo: '' };
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

  const headers = ['Orden', 'Orden Origen', 'Tipo', 'Estado SAP', 'Contratista', 'Tension', 'SED', 'Distrito', 'Latitud', 'Longitud', 'Fecha Inicio', 'Fecha Fin', 'Intervalo', 'Situacion SLA 48h', 'Horas restantes SLA', 'Ubicacion Tecnica'];
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
      tipo === 'Pendiente' ? getSlaInfo(r).label : '',
      tipo === 'Pendiente' ? getSlaInfo(r).remainingHours : '',
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

function setSlaFilter(status) {
  const select = $('repFilterSlaPendiente');
  if (!select) return;
  select.value = status;
  applyReportFilters('Pendiente');
}

function setObrasSubTab(subTab) {
  obrasState.subTab = subTab;
  obrasState.page = 1;
  document.querySelectorAll('#obrasSubTabGroup .btn-segmented').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.subtab === subTab);
  });
  if ($('chartDayObrasTitle')) {
    $('chartDayObrasTitle').textContent = subTab === 'Atendido'
      ? 'Línea de Tiempo por Fecha de Atención'
      : 'Línea de Tiempo por Fecha de Ingreso';
  }
  updateObrasView();
}

function populateObrasFilters() {
  const fill = (id, values) => {
    const element = $(id);
    if (!element) return;
    const firstOption = element.firstElementChild.outerHTML;
    element.innerHTML = firstOption + values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  };
  fill('obrasFilterCompany', [...new Set(obrasRows.map(row => row.contratista).filter(Boolean))].sort());
  fill('obrasFilterDistrict', [...new Set(obrasRows.map(row => row.distrito).filter(Boolean))].sort());
  fill('obrasFilterType', [...new Set(obrasRows.map(row => row.tipo_trabajo).filter(Boolean))].sort());
}

function getFilteredObrasRows() {
  const query = obrasState.search.toLowerCase();
  const { dateFrom, dateTo, sla, company, district, type, geo } = obrasState.filters;

  return obrasRows.filter(row => {
    // 1. SubTab (Pendiente, Atendido o Todos)
    if (obrasState.subTab === 'Pendiente' && row.is_ejecutado) return false;
    if (obrasState.subTab === 'Atendido' && !row.is_ejecutado) return false;

    // 2. Rango de Fechas (Desde / Hasta)
    const targetDate = (obrasState.subTab === 'Atendido' && row.fecha_fin_date)
      ? row.fecha_fin_date
      : row.fecha_inicio_date;
    if (dateFrom && targetDate && targetDate < dateFrom) return false;
    if (dateTo && targetDate && targetDate > dateTo) return false;

    // 3. Semáforo SLA
    if (sla && row.sla && row.sla.status !== sla) return false;

    // 4. Filtros dropdown
    if (company && row.contratista !== company) return false;
    if (district && row.distrito !== district) return false;
    if (type && row.tipo_trabajo !== type) return false;
    if (geo === 'valid' && !isPeruCoordinate(row)) return false;
    if (geo === 'invalid' && isPeruCoordinate(row)) return false;

    // 5. Búsqueda por texto libre
    if (query && ![row.lcl, row.orden_sistema_origen, row.contratista, row.distrito, row.estado_original, row.tipo_trabajo, row.tipo_obra]
      .some(value => clean(value).toLowerCase().includes(query))) return false;

    return true;
  });
}

function countObrasBy(rows, getKey) {
  return rows.reduce((counts, row) => {
    const key = clean(getKey(row)) || 'Sin dato';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function updateObrasView() {
  const rows = getFilteredObrasRows();
  const total = rows.length;
  const enPlazo = rows.filter(r => r.sla && r.sla.status === 'en_plazo').length;
  const porVencer = rows.filter(r => r.sla && r.sla.status === 'por_vencer').length;
  const vencidas = rows.filter(r => r.sla && r.sla.status === 'vencida').length;

  $('kpiTotalObras').textContent = total.toLocaleString('es-PE');
  $('kpiEnPlazoObras').textContent = enPlazo.toLocaleString('es-PE');
  $('kpiPorVencerObras').textContent = porVencer.toLocaleString('es-PE');
  $('kpiVencidasObras').textContent = vencidas.toLocaleString('es-PE');

  const pct = (val) => total > 0 ? `${Math.round((val / total) * 100)}% del total` : '0%';
  $('kpiFootTotalObras').textContent = `${rows.filter(isPeruCoordinate).length} georreferenciadas`;
  $('kpiFootEnPlazoObras').textContent = `${pct(enPlazo)} · En plazo`;
  $('kpiFootPorVencerObras').textContent = `${pct(porVencer)} · Vence hoy (Día 2)`;
  $('kpiFootVencidasObras').textContent = `${pct(vencidas)} · Plazo superado`;

  const activeCount = Object.values(obrasState.filters).filter(Boolean).length + (obrasState.search ? 1 : 0);
  $('activeFilterCountObras').textContent = `${activeCount} filtro(s) activo(s)`;

  // Gráfico 1: Línea de tiempo por fechas (DD/MM)
  const isAtendido = obrasState.subTab === 'Atendido';
  const getDateLabel = r => formatShortDate(isAtendido && r.fecha_fin ? r.fecha_fin : r.fecha_inicio);
  const getIsoDate = r => (isAtendido && r.fecha_fin_date ? r.fecha_fin_date : r.fecha_inicio_date) || '';

  const dayCounts = countObrasBy(rows, getDateLabel);
  delete dayCounts['Sin dato'];
  delete dayCounts['-'];

  const dayDateMap = new Map();
  rows.forEach(r => {
    const lbl = getDateLabel(r);
    const iso = getIsoDate(r);
    if (lbl && lbl !== '-' && iso) {
      if (!dayDateMap.has(lbl) || iso < dayDateMap.get(lbl)) {
        dayDateMap.set(lbl, iso);
      }
    }
  });

  const sortedDays = Object.entries(dayCounts).sort((a, b) => {
    const dateA = dayDateMap.get(a[0]) || a[0];
    const dateB = dayDateMap.get(b[0]) || b[0];
    return dateA.localeCompare(dateB);
  });

  renderChartInstance(
    'chartDayObras',
    'line',
    sortedDays.map(item => item[0]),
    sortedDays.map(item => item[1]),
    {
      borderColor: isAtendido ? '#4DA338' : '#F8B319',
      backgroundColor: isAtendido ? 'rgba(77, 163, 56, 0.12)' : 'rgba(248, 179, 25, 0.12)',
      tension: 0.3,
      fill: true
    }
  );

  const companies = Object.entries(countObrasBy(rows, row => row.contratista)).sort((a, b) => b[1] - a[1]);
  const statuses = Object.entries(countObrasBy(rows, row => row.estado_original)).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const districts = Object.entries(countObrasBy(rows, row => row.distrito)).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const classifications = Object.entries(countObrasBy(rows, row => row.tipo_trabajo)).sort((a, b) => b[1] - a[1]);

  renderChartInstance('chartCompanyObras', 'bar', companies.map(item => item[0]), companies.map(item => item[1]));
  renderChartInstance('chartDistrictObras', 'bar', districts.map(item => item[0]), districts.map(item => item[1]), { indexAxis: 'y' });
  renderChartInstance('chartStatusObras', 'bar', statuses.map(item => item[0]), statuses.map(item => item[1]), { indexAxis: 'y' });
  renderChartInstance('chartTypeObras', 'bar', classifications.map(item => item[0]), classifications.map(item => item[1]));

  renderObrasTable(rows);
}

function renderObrasTable(rows) {
  const body = $('tableBodyObras');
  body.innerHTML = '';
  const totalPages = Math.max(1, Math.ceil(rows.length / obrasState.pageSize));
  obrasState.page = Math.min(obrasState.page, totalPages);
  const start = (obrasState.page - 1) * obrasState.pageSize;

  rows.slice(start, start + obrasState.pageSize).forEach((row, index) => {
    const tr = document.createElement('tr');
    if (row.sla && row.sla.status === 'vencida') tr.classList.add('sla-vencida');
    else if (row.sla && row.sla.status === 'por_vencer') tr.classList.add('sla-por_vencer');
    else if (row.sla && row.sla.status === 'en_plazo') tr.classList.add('sla-en_plazo');

    const badgeClass = !row.sla ? 'deadline-sin_dato' :
                       row.sla.status === 'vencida' ? 'deadline-vencida' :
                       row.sla.status === 'por_vencer' ? 'deadline-por_vencer' :
                       row.sla.status === 'en_plazo' ? 'deadline-en_plazo' : 'deadline-sin_dato';

    tr.innerHTML = `
      <td>${start + index + 1}</td>
      <td><strong style="color:var(--pluz-blue)">${escapeHtml(row.lcl)}</strong></td>
      <td><span class="deadline-badge ${badgeClass}">${escapeHtml(row.sla ? row.sla.label : 'Sin dato')}</span></td>
      <td><span style="color:${getCompanyColor(row.contratista)};font-weight:800">${escapeHtml(row.contratista)}</span></td>
      <td>${escapeHtml(row.distrito)}</td>
      <td>${escapeHtml(row.estado_original || '-')}</td>
      <td>${escapeHtml(row.tipo_trabajo || row.tipo_obra || '-')}</td>
      <td><b>${escapeHtml(formatShortDate(row.fecha_inicio))}</b></td>
      <td>${escapeHtml(row.intervalo || (row.sla?.days ? `${row.sla.days}d` : '-'))}</td>
      <td><span class="badge-status-sap ${isPeruCoordinate(row) ? 'badge-sap-cer' : 'badge-sap-lib'}">${isPeruCoordinate(row) ? 'Mapeado' : 'Sin ubicación'}</span></td>
    `;
    body.appendChild(tr);
  });

  $('tableCountObras').textContent = `${rows.length.toLocaleString('es-PE')} registros encontrados`;
  $('paginationObras').innerHTML = `
    <button class="btn-secondary-sm" ${obrasState.page <= 1 ? 'disabled' : ''} onclick="changeObrasPage(-1)">◀ Anterior</button>
    <span style="font-weight:700;color:var(--text-secondary);padding:0 8px">Página <b>${obrasState.page}</b> de <b>${totalPages}</b></span>
    <button class="btn-secondary-sm" ${obrasState.page >= totalPages ? 'disabled' : ''} onclick="changeObrasPage(1)">Siguiente ▶</button>
  `;
}

function changeObrasPage(delta) {
  obrasState.page += delta;
  updateObrasView();
}

function applyObrasFilters() {
  obrasState.filters.dateFrom = $('obrasDateFrom').value;
  obrasState.filters.dateTo = $('obrasDateTo').value;
  obrasState.filters.sla = $('obrasFilterSla').value;
  obrasState.filters.company = $('obrasFilterCompany').value;
  obrasState.filters.district = $('obrasFilterDistrict').value;
  obrasState.filters.type = $('obrasFilterType').value;
  obrasState.filters.geo = $('obrasFilterGeo').value;
  obrasState.page = 1;
  updateObrasView();
}

function resetObrasFilters() {
  $('obrasDateFrom').value = '';
  $('obrasDateTo').value = '';
  $('obrasFilterSla').value = '';
  $('obrasFilterCompany').value = '';
  $('obrasFilterDistrict').value = '';
  $('obrasFilterType').value = '';
  $('obrasFilterGeo').value = '';
  $('tableSearchObras').value = '';

  obrasState.search = '';
  obrasState.filters = {
    dateFrom: '',
    dateTo: '',
    sla: '',
    company: '',
    district: '',
    type: '',
    geo: ''
  };
  obrasState.page = 1;
  updateObrasView();
}

function downloadObrasTable() {
  const rows = getFilteredObrasRows();
  if (!rows.length) {
    alert('No hay registros de obras para descargar.');
    return;
  }
  const headers = ['#', 'LCL/ODM', 'Presupuesto/Ref', 'SubTab', 'Situacion SLA (2d)', 'Contratista', 'Distrito', 'Estado', 'Tipo Trabajo', 'Fecha Ingreso', 'Fecha Atencion', 'Duracion', 'Latitud', 'Longitud'];
  const csvLines = [headers.join(';')];
  rows.forEach((r, idx) => {
    const vals = [
      idx + 1,
      r.lcl,
      r.orden_sistema_origen,
      r.is_ejecutado ? 'Atendido' : 'Pendiente',
      r.sla ? r.sla.label : '',
      r.contratista,
      r.distrito,
      r.estado_original,
      r.tipo_trabajo,
      formatShortDate(r.fecha_inicio),
      r.fecha_fin ? formatShortDate(r.fecha_fin) : '',
      r.intervalo,
      r.lat,
      r.lon
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`);
    csvLines.push(vals.join(';'));
  });

  const blob = new Blob(["\ufeff" + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `Obras_${obrasState.subTab}_${new Date().toISOString().slice(0, 10)}.csv`;
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
      } else if (targetId === 'pageObras') {
        updateObrasView();
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

  $('tableSearchObras').addEventListener('input', (e) => {
    obrasState.search = e.target.value;
    obrasState.page = 1;
    updateObrasView();
  });
}

async function initApp() {
  try {
    setupNavigation();
    bindDashboardActions({ setSlaFilter, downloadCurrentTable });
    initMap();
    allRows = await loadRows();
    obrasRows = await loadObrasRows();
    mapRows = [...allRows, ...obrasRows];

    // Poblar componentes
    populateMapSelects();
    renderMap();

    populateReportFilters('Pendiente');
    populateReportFilters('Ejecutado');
    populateObrasFilters();

    updateReportView('Pendiente');
    updateReportView('Ejecutado');
    updateObrasView();

  } catch (err) {
    console.error('Error al inicializar aplicación:', err);
    $('lastUpdate').textContent = '❌ Error de carga';
  }
}

// Arranque inicial
document.addEventListener('DOMContentLoaded', () => {
  initAuthModule({ authUrl: CFG.authUrl, onAuthenticated: initApp }).catch((err) => {
    console.error('No se pudo iniciar la autenticacion:', err);
    $('authError').textContent = 'No se pudo validar la sesion. Intenta nuevamente.';
  });
});

// Compatibilidad temporal: los controles que aún están en el HTML siguen
// funcionando mientras se migran por grupos a listeners externos.
Object.assign(window, {
  applyObrasFilters,
  applyReportFilters,
  changeObrasPage,
  changeReportPage,
  downloadCurrentTable,
  downloadObrasTable,
  handleTableSort,
  resetObrasFilters,
  resetReportFilters,
  setObrasSubTab
});
