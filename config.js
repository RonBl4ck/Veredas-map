/**
 * Configuración del Frontend - Control de Veredas
 * 
 * Los enlaces reales a Google Sheets están 100% protegidos y se configuran
 * exclusivamente en las variables de entorno de Vercel (DATA_URL y AUTH_URL).
 */
window.APP_CONFIG = {
  // Endpoints seguros a través de Vercel Serverless (las URLs no son públicas en GitHub)
  dataCsvUrl: '/api/data',
  authCsvUrl: '/api/auth',

  // Fallback offline en caso de desarrollo local sin servidor Vercel
  localFallbackUrl: 'data/veredas.json',
  fallbackPassword: 'veredas2026',

  pageSize: 25
};
