import { h, clear } from './dom.js';
import { t, getLang } from './i18n.js';
import { api } from './api.js';
import { inventionCard, prayerError, prayerAuditPanel } from './prayers-ui.js';

/** Session-admin review. Only server-derived canReview exposes the form. */
export function adminInventionsPanel() {
  const view = h('div', null, h('p', { class: 'muted' }, t('loading')));
  const msg = h('p', { role: 'status', 'aria-live': 'polite', class: 'account-message' });
  const refresh = h('button', { type: 'button', class: 'btn small ghost', onClick: () => load() }, t('refresh'));
  const audit = h('div');
  const root = h('section', { class: 'prayer-panel' }, h('div', { class: 'usage-head' }, h('h3', null, t('inventionTitle')), refresh),
    h('p', { class: 'muted' }, t('inventionAdminHelp')), msg, view,
    h('button', { type: 'button', class: 'btn small', onClick: () => { clear(audit).append(prayerAuditPanel({ scope: 'all' })); } }, t('prayerAuditAll')), audit);
  let busy = false;
  async function load() {
    if (busy) return; busy = true; refresh.disabled = true;
    const r = await api('/api/admin/inventions');
    busy = false; refresh.disabled = false; clear(view);
    if (!r.ok || !Array.isArray(r.json?.inventions)) { view.append(h('p', { class: 'error', role: 'alert' }, prayerError(r))); return; }
    if (!r.json.enabled) { view.append(h('p', { class: 'muted' }, t('prayerUnavailable'))); return; }
    if (!r.json.inventions.length) view.append(h('p', { class: 'empty' }, t('inventionEmpty')));
    for (const row of r.json.inventions.slice().reverse()) {
      const card = inventionCard(row);
      const eligible = row.canReview === true && row.status === 'pending' && !row.awarded && ['awake', 'dormant'].includes(row.residentStatus);
      card.append(eligible ? reviewForm(row) : h('p', { class: 'muted' }, t('inventionIndependent')));
      view.append(card);
    }
  }
  function reviewForm(row) {
    const reason = h('textarea', { name: 'reason', rows: 3, value: '', required: true, 'aria-label': t('inventionReason') });
    const decision = h('select', { name: 'decision', value: 'approved', 'aria-label': t('inventionDecision') }, h('option', { value: 'approved' }, t('inventionApprove')), h('option', { value: 'rejected' }, t('inventionReject')));
    const submit = h('button', { type: 'submit', class: 'btn primary small' }, t('inventionSubmit'));
    const form = h('form', { class: 'form invention-review' }, h('label', { class: 'field' }, h('span', null, t('inventionReason')), reason), h('label', { class: 'field' }, h('span', null, t('inventionDecision')), decision), submit);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); if (busy) return;
      const body = { decision: decision.value, reason: reason.value.trim() };
      if (!body.reason || [...body.reason].length > 600) { msg.className = 'account-message error'; msg.textContent = t('prayerError_invalid_request'); return; }
      busy = true; refresh.disabled = true; submit.disabled = true; reason.disabled = true; decision.disabled = true;
      msg.className = 'account-message'; msg.textContent = t('accountWorking');
      const r = await api(`/api/admin/inventions/${encodeURIComponent(row.id)}/review?lang=${getLang()}`, { method: 'POST', body });
      busy = false; msg.className = r.ok ? 'account-message' : 'account-message error'; msg.textContent = r.ok ? t('inventionSaved') : prayerError(r);
      await load();
    });
    return form;
  }
  load(); return root;
}
