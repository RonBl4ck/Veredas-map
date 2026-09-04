import { byId } from './dom.js';

/** Vincula eventos de los tableros fuera del HTML. */
export function bindDashboardActions(actions) {
  const on = (id, event, handler) => byId(id)?.addEventListener(event, handler);

  on('cardDueSoonPendiente', 'click', () => actions.setSlaFilter('por_vencer'));
  on('btnDownloadPendiente', 'click', () => actions.downloadCurrentTable('Pendiente'));
}
