// 用户中心里与 token 用量有关的两块：「我的居民」（账号关联的居民，只读）和管理员的「托管用量」总览。
// 数据来自 GET /api/account/agents、GET /api/admin/usage（登录会话鉴权）；认领 POST /api/account/agents，解除 DELETE。
// 账号只能看：进入幕后、写家书、启停运行器仍然需要造者密钥（见 docs/plans/2026-10-03-usage-accounts-admin.md）。

import { h, clear } from './dom.js';
import { t } from './i18n.js';
import { api, errorText } from './api.js';
import { num, stamp, inOutNodes, oddNotes, complete, tile, dayChart } from './usage-ui.js';

const CLAIM_BATCH = 50; // 与服务器一致：一次请求最多认领的密钥数
const chip = (status) => h('span', { class: `chip st-${status}` }, t(`status_${status}`));
const legend = () => h('p', { class: 'usage-legend muted' }, h('span', { class: 'swatch in' }), t('usageInput'), ' ', h('span', { class: 'swatch out' }), t('usageOutput'));
const numCell = (n) => h('td', { class: 'num' }, num(n));
const callsCell = (total) => h('td', { class: 'num' }, num(total.calls), oddNotes(total).map((note) => h('div', { class: 'usage-sub' }, note)));
const btn = (label, run, cls = 'btn small') => {
  const b = h('button', { class: cls, type: 'button' }, label);
  b.addEventListener('click', run);
  return b;
};

/**
 * 「我的居民」：账号关联的居民，一张表加认领表单。
 * openBackstage(key)：点「进入幕后」时调用（只在本浏览器保存了这位居民的造者密钥时才有这个按钮）；
 * savedOwners()：本浏览器保存的造者密钥 [{ key, agentId?, name? }]，用来判断能不能进幕后、以及一键认领。
 */
export function accountAgentsPanel({ openBackstage, savedOwners }) {
  const list = h('div', { class: 'account-agents-list' }, h('p', { class: 'muted' }, t('loading')));
  const msg = h('p', { role: 'status', 'aria-live': 'polite', class: 'account-message' });
  const keyInput = h('input', { name: 'ownerKey', type: 'password', autocomplete: 'off', class: 'mono', maxlength: 200, 'aria-label': t('accountClaimLabel') });
  const claimBtn = h('button', { class: 'btn primary small', type: 'submit' }, t('accountClaim'));
  const form = h('form', { class: 'form account-claim' }, h('label', { class: 'field' }, h('span', null, t('accountClaimLabel')), h('div', { class: 'field-row' }, keyInput, claimBtn)));
  const savedBtn = h('button', { class: 'btn small', type: 'button', hidden: true });
  const refresh = btn(t('refresh'), () => load(), 'btn small ghost');
  const root = h('section', { class: 'usage-panel account-agents' },
    h('div', { class: 'usage-head' }, h('h3', null, t('accountAgentsTitle')), refresh),
    h('p', { class: 'muted' }, t('accountAgentsHelp')), list, form, savedBtn, msg);
  let busy = false;
  const keyFor = (agentId) => {
    const own = savedOwners().find((o) => o && o.agentId === agentId && typeof o.key === 'string');
    return own ? own.key : null;
  };
  const say = (text, bad = false) => { msg.className = bad ? 'account-message error' : 'account-message'; msg.textContent = text; };
  const syncSaved = () => {
    const n = savedOwners().length;
    savedBtn.hidden = n === 0;
    savedBtn.textContent = t('accountClaimSaved', { n });
  };

  function row(a) {
    const u = a.usage, tracked = complete(u);
    const key = keyFor(a.agentId);
    const open = key ? btn(t('accountOpenBackstage'), () => openBackstage(key)) : h('span', { class: 'usage-sub' }, t('accountNoKeyHere'));
    const unlink = btn(t('accountUnlink'), async () => {
      if (busy) return;
      busy = true; say(t('accountWorking'));
      const r = await api(`/api/account/agents/${encodeURIComponent(a.agentId)}`, { method: 'DELETE', body: {} });
      busy = false;
      if (r.ok) { say(''); await load(); } else say(errorText(r, t('networkError')), true);
    });
    const status = h('td', { class: 'opt' }, chip(a.status), tracked && a.runnerStatus ? h('div', { class: 'usage-sub' }, t(`runnerStatus_${a.runnerStatus}`)) : null);
    const cells = tracked ? [numCell(u.today.tokens), numCell(u.total.tokens), callsCell(u.total)] : [h('td', { colspan: 3, class: 'muted' }, t('usageNotManaged'))];
    return h('tr', null, h('td', null, h('div', null, `${a.name} · ${a.agentId}`), h('div', { class: 'row-actions' }, open, unlink)), status, cells);
  }

  function render(agents) {
    clear(list);
    if (!agents.length) { list.append(h('p', { class: 'empty' }, t('accountAgentsEmpty'))); return; }
    const hosted = agents.filter((a) => complete(a.usage));
    const sum = { today: 0, tokens: 0, calls: 0 };
    for (const a of hosted) { sum.today += a.usage.today.tokens; sum.tokens += a.usage.total.tokens; sum.calls += a.usage.total.calls; }
    const foot = hosted.length > 1 ? h('tr', { class: 'usage-sum' }, h('td', null, t('usageSum')), h('td', { class: 'opt' }), numCell(sum.today), numCell(sum.tokens), numCell(sum.calls)) : null;
    list.append(h('div', { class: 'table-wrap' }, h('table', { class: 'tbl usage-table' },
      h('thead', null, h('tr', null, h('th', null, t('usageColAgent')), h('th', { class: 'opt' }, t('accountColStatus')), h('th', { class: 'num' }, t('usageColToday')), h('th', { class: 'num' }, t('usageColTotal')), h('th', { class: 'num' }, t('usageColCalls')))),
      h('tbody', null, agents.map(row), foot))));
  }

  async function load() {
    syncSaved();
    const r = await api('/api/account/agents');
    if (r.ok && r.json && Array.isArray(r.json.agents)) { render(r.json.agents); return; }
    clear(list).append(h('p', { class: 'error', role: 'alert' }, r.status === 401 ? t('accountSignedOut') : r.status === 0 ? t('networkError') : errorText(r, t('loadFailed'))));
  }

  async function claim(keys) {
    if (busy || !keys.length) return;
    busy = true; claimBtn.disabled = true; savedBtn.disabled = true; say(t('accountWorking'));
    const r = await api('/api/account/agents', { method: 'POST', body: { ownerKeys: keys.slice(0, CLAIM_BATCH) } });
    busy = false; claimBtn.disabled = false; savedBtn.disabled = false;
    if (!r.ok || !r.json || !Array.isArray(r.json.results)) { say(r.status === 0 ? t('networkError') : errorText(r, t('loadFailed')), true); return; }
    const linked = r.json.results.filter((x) => x && x.ok).length;
    const failed = r.json.results.length - linked;
    const full = r.json.results.some((x) => x && x.code === 'too_many_agents');
    say([t('accountClaimDone', { n: linked }), failed ? (full ? t('accountClaimFull') : t('accountClaimFailed', { n: failed })) : ''].filter(Boolean).join(' '), linked === 0);
    await load();
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const key = keyInput.value.trim();
    if (!key) return;
    await claim([key]);
    keyInput.value = '';
  });
  savedBtn.addEventListener('click', () => claim(savedOwners().map((o) => o && o.key).filter((k) => typeof k === 'string' && k)));
  load();
  return root;
}

/** 管理员的「托管用量」：所有托管居民的用量、全城合计与近 14 日合计、每位居民的造者与关联账号。把内容画进 body。 */
export function adminUsageView(body) {
  const view = h('div', { class: 'usage-content' });
  const refresh = btn(t('refresh'), () => load(), 'btn small ghost');
  body.append(h('div', { class: 'usage-head' }, h('h3', null, t('adminUsageTitle')), refresh), h('p', { class: 'muted' }, t('adminUsageHelp')), view);
  let busy = false;

  function agentRow(a) {
    const u = a.usage && a.usage.total && a.usage.today ? a.usage : null;
    const owner = [a.creatorName ? h('div', null, a.creatorName) : null, h('div', { class: 'usage-sub' }, Array.isArray(a.accounts) && a.accounts.length ? a.accounts.map((n) => `@${n}`).join(' ') : t('adminNoAccount'))];
    return h('tr', null,
      h('td', null, `${a.name} · ${a.agentId}`, ' ', chip(a.status), a.runnerStatus ? h('div', { class: 'usage-sub' }, t(`runnerStatus_${a.runnerStatus}`)) : null),
      h('td', { class: 'opt' }, owner), h('td', { class: 'opt mono' }, a.model || ''),
      u ? [numCell(u.today.tokens), numCell(u.total.tokens), callsCell(u.total), h('td', { class: 'last' }, u.lastCallAt ? stamp(u.lastCallAt) : t('usageNever'))] : h('td', { colspan: 4, class: 'muted' }, '–'));
  }

  async function load() {
    if (busy) return;
    busy = true; refresh.disabled = true;
    const r = await api('/api/admin/usage');
    busy = false; refresh.disabled = false;
    clear(view);
    const o = r.json;
    if (!r.ok || !o || !Array.isArray(o.agents) || !o.total || !o.today || !Array.isArray(o.days)) {
      view.append(h('p', { class: 'error', role: 'alert' }, r.status === 0 ? t('networkError') : errorText(r, t('loadFailed'))));
      return;
    }
    view.append(h('div', { class: 'usage-tiles' },
      tile(t('adminHosted'), num(o.hosted), o.unhosted > 0 ? t('adminUnhosted', { n: o.unhosted }) : ''),
      tile(t('usageToday'), num(o.today.tokens), inOutNodes(o.today)),
      tile(t('usageTotal'), num(o.total.tokens), inOutNodes(o.total)),
      tile(t('usageCalls'), num(o.total.calls), oddNotes(o.total).join(' · '))));
    if (o.days.some((d) => d.tokens > 0)) view.append(h('h5', { class: 'usage-chart-title' }, t('usageChartTitle', { n: o.days.length })), dayChart(o.days), legend());
    if (!o.agents.length) { view.append(h('p', { class: 'empty' }, t('adminEmpty'))); return; }
    view.append(h('div', { class: 'table-wrap' }, h('table', { class: 'tbl usage-table' },
      h('thead', null, h('tr', null, h('th', null, t('usageColAgent')), h('th', { class: 'opt' }, t('adminColOwner')), h('th', { class: 'opt' }, t('adminColModel')), h('th', { class: 'num' }, t('usageColToday')), h('th', { class: 'num' }, t('usageColTotal')), h('th', { class: 'num' }, t('usageColCalls')), h('th', { class: 'last' }, t('usageColLast')))),
      h('tbody', null, o.agents.map(agentRow)))));
  }
  load();
  return view;
}
