import { byId } from './dom.js';

/** Vincula eventos de los tableros fuera del HTML. */
export function bindDashboardActions(actions) {
  const on = (id, event, handler) => byId(id)?.addEventListener(event, handler);

  on('kpiDueSoonPendiente', 'click', () => actions.setSlaFilter('urgente'));
  on('btnDownloadPendiente', 'click', () => actions.downloadCurrentTable('Pendiente'));
}
