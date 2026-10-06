// Public prayer records and scoped account replies. Authority is rechecked by the server.
import { h, clear } from './dom.js';
import { t, getLang } from './i18n.js';
import { api } from './api.js';
import { clockConfig } from './render.js';

const tickInDay = (tick) => (tick % clockConfig.ticksPerDay) + 1;
export const prayerDate = (row) => t('prayerDate', { day: (row.day ?? 0) + 1, tick: tickInDay(row.tick ?? 0) });
export function prayerError(r) {
  if (r.status === 0) return t('networkError');
  const e = r.json?.error;
  const key = `prayerError_${e?.code}`;
  return t(key) !== key ? t(key, { required: e?.required ?? '—', balance: e?.balance ?? '—' }) : t('loadFailed');
}
const message = () => h('p', { class: 'account-message', role: 'status', 'aria-live': 'polite' });
const say = (node, text, bad = false) => { node.className = bad ? 'account-message error' : 'account-message'; node.textContent = text; };
const details = (title, ...children) => h('details', { class: 'prayer-history' }, h('summary', null, title), children);
const field = (label, input) => h('label', { class: 'field' }, h('span', null, label), input);
const alive = (status) => status === 'awake' || status === 'dormant';

/** Safe public evidence/history shared with the administrator review panel. */
export function inventionCard(row) {
  const w = row.work;
  const work = !w ? h('p', { class: 'muted' }, t('inventionWorkMissing')) : w.kind === 'doc'
    ? h('div', null, h('strong', null, w.title || t('inventionRedacted')), h('p', { class: 'prayer-text' }, w.redacted ? t('inventionRedacted') : w.body || '—'))
    : h('div', null, h('strong', null, w.name || w.id), h('p', { class: 'prayer-text' }, w.description || ''),
      h('p', null, t('inventionProject', { ...w, result: w.result || '—' })),
      h('p', null, t('inventionContributors'), ': ', Object.entries(w.contributors || {}).map(([id, energy]) => `${id}: ${energy}`).join(' · ')));
  return h('article', { class: 'card invention-card' },
    h('h4', null, row.title), h('p', { class: 'muted' }, `${row.name || row.agentId} · ${row.id} · ${prayerDate(row)} · ${t(`invention_${row.status}`)}`),
    h('p', { class: 'prayer-text ai' }, row.text),
    details(`${t('inventionWork')} · ${row.ref.kind}:${row.ref.id}`, work),
    details(t('inventionHistory'), h('ol', { class: 'plain' }, (row.history || []).map((r) => h('li', null,
      `${prayerDate(r)} · `, r.kind === 'submission' ? [t('inventionSubmission'), ': ', h('strong', null, r.title), h('p', { class: 'prayer-text ai' }, r.text)]
        : [t(`invention_${r.decision}`), ': ', h('span', { class: 'prayer-text' }, r.reason)])))));
}

/** Live public section; readOnly suppresses all account requests and actions. */
export function prayerSection({ agentId, readOnly = false, onChange } = {}) {
  const view = h('div', null, h('p', { class: 'muted' }, t('loading'))), msg = message();
  const refresh = h('button', { class: 'btn small ghost', type: 'button', onClick: () => load() }, t('refresh'));
  const root = h('section', { class: 'prayer-panel' }, h('div', { class: 'usage-head' }, h('h3', null, t('prayerTitle')), refresh), msg, view);
  let busy = false;
  async function load() {
    if (busy) return;
    busy = true; refresh.disabled = true;
    const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
    const [r, session] = await Promise.all([api(`/api/public/prayers${query}`), readOnly ? Promise.resolve(null) : api('/api/account')]);
    const linked = session?.ok && session.json?.user ? await api('/api/account/agents') : null;
    busy = false; refresh.disabled = false; clear(view);
    if (!r.ok || !r.json || typeof r.json.enabled !== 'boolean') { view.append(h('p', { class: 'error', role: 'alert' }, prayerError(r))); return; }
    const data = r.json;
    if (!data.enabled) { view.append(h('p', { class: 'muted' }, t('prayerUnavailable'))); return; }
    if (![data.accounts, data.prayers, data.inventions, data.ledger].every(Array.isArray)) { view.append(h('p', { class: 'error' }, t('loadFailed'))); return; }
    const links = new Set(linked?.ok && Array.isArray(linked.json?.agents) ? linked.json.agents.map((a) => a.agentId) : []);
    const names = new Map(data.accounts.map((a) => [a.agentId, a.name || a.agentId]));
    view.append(h('p', { class: 'muted' }, t('prayerRules')), details(t('prayerPoints'), h('p', null, t('prayerEarn'))));
    for (const a of data.accounts) view.append(h('div', { class: 'prayer-balance' }, h('strong', null, t('prayerBalance', { name: names.get(a.agentId), n: a.balance })),
      h('p', { class: 'muted' }, t('prayerRemainders', { earned: a.autoEarned, repair: a.repairRemainder, project: a.projectRemainder }))));
    if (!data.prayers.length) view.append(h('p', { class: 'empty' }, t('prayerEmpty')));
    for (const p of data.prayers.slice().reverse()) {
      const account = data.accounts.find((a) => a.agentId === p.agentId);
      const card = h('article', { class: 'card prayer-card' }, h('h4', null, `${p.name || names.get(p.agentId) || p.agentId} · ${p.id}`),
        h('p', { class: 'muted' }, `${prayerDate(p)} · ${t(`prayer_${p.status}`)}`), h('p', { class: 'prayer-text ai' }, p.text));
      if (p.reply) card.append(h('div', { class: 'prayer-response' }, h('strong', null, t('prayerReply')), h('p', { class: 'prayer-text' }, p.reply.text || ''), h('p', { class: 'muted' }, `${prayerDate(p.reply)} · ${t('prayerAid', { n: p.reply.energy, cost: p.reply.cost })}`)));
      if (p.status === 'closed' && p.closedDay != null) card.append(h('p', { class: 'muted' }, t('prayerClosedAt', { day: p.closedDay + 1, tick: tickInDay(p.closedTick) })));
      if (p.status === 'pending' && alive(p.residentStatus)) {
        if (!readOnly && links.has(p.agentId) && account) card.append(replyForm(p, account.balance));
        else card.append(h('p', { class: 'muted' }, t(readOnly ? 'prayerReadOnly' : 'prayerLinkedOnly')));
      }
      view.append(card);
    }
    view.append(details(t('prayerLedger'), data.ledger.length ? h('ul', { class: 'plain' }, data.ledger.slice().reverse().map((l) => h('li', null, t('prayerLedgerRow', {
      date: prayerDate(l), name: names.get(l.agentId) || l.agentId, source: t(`prayer_source_${l.kind}`), amount: l.amount > 0 ? `+${l.amount}` : l.amount, balance: l.balance, ref: l.sourceId || '—',
    })))) : h('p', { class: 'empty' }, t('prayerLedgerEmpty'))));
    view.append(details(t('inventionTitle'), data.inventions.length ? data.inventions.slice().reverse().map(inventionCard) : h('p', { class: 'empty' }, t('inventionEmpty'))));
  }
  function replyForm(p, balance) {
    const text = h('textarea', { name: 'text', rows: 3, value: '', 'aria-label': t('prayerText') });
    const energy = h('input', { name: 'energy', type: 'number', min: 0, max: 1000000, step: 1, value: '0', 'aria-label': t('prayerEnergy') });
    const preview = h('p', { class: 'prayer-cost', role: 'status', 'aria-live': 'polite' });
    const submit = h('button', { type: 'submit', class: 'btn primary small' }, t('prayerSubmit'));
    const form = h('form', { class: 'form prayer-reply' }, field(t('prayerText'), text), field(t('prayerEnergy'), energy), preview, submit);
    const values = () => { const body = { text: text.value.trim() || null, energy: Number(energy.value || 0) }; return { body, cost: (body.text ? 1 : 0) + body.energy }; };
    const update = () => {
      const { body, cost } = values();
      preview.textContent = t('prayerCost', { text: body.text ? 1 : 0, energy: body.energy, cost, balance });
      submit.disabled = busy || cost <= 0 || cost > balance || !Number.isSafeInteger(body.energy) || body.energy < 0 || body.energy > 1000000 || [...(body.text || '')].length > 600;
    };
    text.addEventListener('input', update); energy.addEventListener('input', update); update();
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); update(); if (submit.disabled) return;
      busy = true; refresh.disabled = true; submit.disabled = true; text.disabled = true; energy.disabled = true;
      say(msg, t('accountWorking'));
      const r = await api(`/api/account/prayers/${encodeURIComponent(p.id)}/reply?lang=${getLang()}`, { method: 'POST', body: values().body });
      busy = false; say(msg, r.ok ? t('prayerSent') : prayerError(r), !r.ok);
      await load(); if (onChange) onChange();
    });
    return form;
  }
  load(); return root;
}

/** Private own records by default. Admin all scope is always explicit. */
export function prayerAuditPanel({ scope = 'own', agentId } = {}) {
  const view = h('div', null, h('p', { class: 'muted' }, t('loading')));
  const root = h('section', { class: 'prayer-panel prayer-audit' }, h('div', { class: 'usage-head' }, h('h3', null, t(scope === 'all' ? 'prayerAuditAll' : 'prayerAuditOwn')),
    h('button', { type: 'button', class: 'btn small ghost', onClick: () => load() }, t('refresh'))), h('p', { class: 'muted' }, t('prayerAuditHelp')), view);
  let busy = false;
  async function load() {
    if (busy) return; busy = true;
    const r = await api(`/api/account/prayers/audit?scope=${encodeURIComponent(scope)}${agentId ? `&agentId=${encodeURIComponent(agentId)}` : ''}`);
    busy = false; clear(view);
    if (!r.ok || !Array.isArray(r.json?.audit)) { view.append(h('p', { class: 'error', role: 'alert' }, prayerError(r))); return; }
    if (!r.json.enabled) { view.append(h('p', { class: 'muted' }, t('prayerUnavailable'))); return; }
    view.append(r.json.audit.length ? h('ul', { class: 'plain' }, r.json.audit.slice().reverse().map((r) => h('li', { class: 'prayer-text' }, t(r.kind === 'reply' ? 'prayerAuditReply' : 'prayerAuditReview', {
      ...r, actor: r.actorId, ref: `${r.agentId} / ${r.prayerId || r.inventionId}`, date: prayerDate(r), text: r.text || '—', decision: t(`invention_${r.decision}`),
    })))) : h('p', { class: 'empty' }, t('prayerAuditEmpty')));
  }
  load(); return root;
}
