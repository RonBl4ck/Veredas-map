/**
 * Configuración global del Frontend - Control de Veredas
 * 
 * Enlaces verificados de Google Sheets publicado como CSV y soporte para Vercel.
 */
window.APP_CONFIG = {
  // ID del libro de Google Sheets
  spreadsheetId: window.ENV_SPREADSHEET_ID || '1aIuwzxrOsaOr5SvnOa3gS6mvdletuKerHadmGyPcP7Q',

  // Pestaña con los datos operativos de veredas
  dataSheetName: 'BASE_VEREDAS',

  // Pestaña con la contraseña y configuración de acceso
  authSheetName: 'ACCESO',

  // URL directa de datos (CSV publicado en la web)
  dataCsvUrl: window.ENV_DATA_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQR-u2WM7H5JKzDykqVUKb3sCoZ9qNknBA5ZdfutnMYehSaEWaUOHZQrGjWC6-hHXCDhTxf7FMTAd7e/pub?gid=0&single=true&output=csv',

  // URL directa de clave de acceso (CSV de pestaña ACCESO)
  authCsvUrl: window.ENV_AUTH_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQR-u2WM7H5JKzDykqVUKb3sCoZ9qNknBA5ZdfutnMYehSaEWaUOHZQrGjWC6-hHXCDhTxf7FMTAd7e/pub?gid=1397868653&single=true&output=csv',

  // Contraseña de respaldo si no hay internet o falla Sheets
  fallbackPassword: 'veredas2026',

  // Archivo local de respaldo (fallback offline)
  localFallbackUrl: 'data/veredas.json',

  // Tamaño de página de la tabla
  pageSize: 25
};
