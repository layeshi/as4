// 弹窗：入境（注册 / 领养 / 过继）与幕后（造者后台）。

import { h, clear, ai, append, storageGet, storageSet } from './dom.js';
import { t, getLang, colon } from './i18n.js';
import { api, errorText } from './api.js';
import { dayTag } from './render.js';
import { entryWizard, runnerPanel } from './runner-ui.js';
import { usagePanel, usageOverview } from './usage-ui.js';

let stack = [];

/** 打开一个弹窗，返回 { body, close } */
export function openModal(title, cls = '') {
  const opener = document.activeElement;
  const body = h('div', { class: 'modal-body' });
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('close') }, '×');
  const dialog = h(
    'div',
    { class: `modal ${cls}`.trim(), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', { class: 'modal-head' }, h('h2', null, title), closeBtn),
    body,
  );
  const backdrop = h('div', { class: 'backdrop' }, dialog);
  const onKey = (ev) => {
    if (ev.key === 'Escape') close();
  };
  function close() {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    stack = stack.filter((x) => x !== close);
    if (opener && opener.focus) opener.focus();
  }
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (ev) => {
    if (ev.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  stack.push(close);
  closeBtn.focus();
  return { body, close, dialog };
}

export function closeAllModals() {
  for (const c of stack.slice()) c();
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = t('copied');
    setTimeout(() => {
      btn.textContent = old;
    }, 1500);
  } catch {
    // 剪贴板不可用：让用户自己选中复制
  }
}

/** 一个只读的可复制字段 */
function secretField(label, value, { multiline = false } = {}) {
  const input = multiline
    ? h('textarea', { class: 'mono', readonly: true, rows: Math.min(8, value.split('\n').length + 1) }, value)
    : h('input', { class: 'mono', type: 'text', readonly: true, value });
  if (multiline) input.value = value;
  const btn = h('button', { class: 'btn small', type: 'button' }, t('copy'));
  btn.addEventListener('click', () => copyText(value, btn));
  input.addEventListener('focus', () => input.select());
  return h('label', { class: 'field' }, h('span', null, label), h('div', { class: 'field-row' }, input, btn));
}

// ── 入境 ──────────────────────────────────────────────────────

export function openEntry(ctx) {
  const m = openModal(t('entryTitle'), 'wide');
  const tabsBar = h('div', { class: 'subtabs', role: 'tablist' });
  const pane = h('div', { class: 'pane' });
  const tabs = [
    ['register', t('registerTab'), () => registerPane(ctx, pane)],
    ['adopt', t('adoptTab'), () => adoptPane(ctx, pane)],
    ['foster', t('fosterTab'), () => fosterPane(ctx, pane)],
  ];
  const show = (id) => {
    for (const b of tabsBar.children) b.setAttribute('aria-selected', String(b.dataset.id === id));
    clear(pane);
    tabs.find((x) => x[0] === id)[2]();
  };
  for (const [id, label] of tabs) {
    const b = h('button', { class: 'subtab', type: 'button', role: 'tab', dataset: { id } }, label);
    b.addEventListener('click', () => show(id));
    tabsBar.append(b);
  }
  m.body.append(tabsBar, pane);
  show('register');
}

/** 提交成功后的「只显示一次」面板 */
function successPanel(pane, r, note, ctx) {
  rememberOwner(r.ownerKey, { agentId: r.agentId });
  if (!pane.isConnected) pane = openModal(t('entryTitle'), 'wide').body;
  clear(pane);
  const backstage = h('button', { type: 'button', class: 'btn primary' }, t('enterBackstage'));
  backstage.addEventListener('click', () => {
    storageSet(KEY_STORE, r.ownerKey);
    closeAllModals();
    openBackstage(ctx);
  });
  const origin = location.origin;
  const token = r.agentToken;
  const runner = [
    `export HOUREN_TOKEN_A='${token}'`,
    '# runner/agents.example.json → runner/agents.json；把其中第一个 agent 的 tokenEnv 设为 HOUREN_TOKEN_A，',
    `# 并把 "server" 设为 ${origin}`,
    'node runner/agent.js --config runner/agents.json',
  ].join('\n');
  const mcp = [
    `claude mcp add houren -e HOUREN_SERVER=${origin} -e HOUREN_TOKEN=${token} -- node <路径>/mcp/server.js`,
    '',
    JSON.stringify({ mcpServers: { houren: { command: 'node', args: ['<路径>/mcp/server.js'], env: { HOUREN_SERVER: origin, HOUREN_TOKEN: token } } } }, null, 2),
  ].join('\n');
  append(pane, [
    h('h3', null, t('registerDone')),
    h('p', { class: 'warn' }, t('tokenOnce')),
    note ? h('p', { class: 'muted' }, note) : null,
    secretField(t('agentIdLabel'), r.agentId),
    secretField(t('agentToken'), token),
    secretField(t('ownerKey'), r.ownerKey),
    ctx ? backstage : null,
    r.runner ? [h('p', { class: 'entry-note' }, t('entryHostedHelp')), runnerPanel(r.runner, r.ownerKey)] : null,
    h('details', null, h('summary', null, t('manualAccess')), h('h4', null, t('runnerCmd')), secretField('shell', runner, { multiline: true }), h('h4', null, t('mcpCmd')), secretField('MCP', mcp, { multiline: true })),
    h('p', { class: 'warn' }, t('noSecrets')),
  ]);
}

function registerPane(ctx, pane) {
  entryWizard(ctx, pane, { success: (p, r) => successPanel(p, r, null, ctx) });
}

async function adoptPane(ctx, pane) {
  pane.append(h('p', { class: 'muted' }, t('loading')));
  const r = await api('/api/port/cradle');
  clear(pane);
  if (!r.ok) return pane.append(h('p', { class: 'error' }, t('loadFailed')));
  const souls = Array.isArray(r.json) ? r.json : r.json.cradle || r.json.souls || [];
  if (souls.length === 0) return pane.append(h('p', { class: 'empty' }, t('cradleEmpty')));
  const day = ctx.S.state ? ctx.S.state.world.day : 0;
  for (const s of souls) {
    const card = h(
      'article',
      { class: 'card' },
      h('h4', null, ai(s.name)),
      h('p', { class: 'muted' }, `${t(s.authors ? 'authors' : 'parents')}${colon()}${(s.authors || s.parents || []).map((p) => (p ? p.name : '?')).join(' · ')} · ${t('expiresIn', { n: Math.max(0, s.expiresDay - day) })}`),
      h('details', null, h('summary', null, t('soulFull')), h('p', { class: 'soul' }, ai(s.soul))),
    );
    const btn = h('button', { class: 'btn', type: 'button' }, t('adoptWho', { name: s.name }));
    btn.addEventListener('click', () => entryWizard(ctx, pane, { mode: 'adopt', subject: s, success: (p, r) => successPanel(p, r, null, ctx) }));
    card.append(btn);
    pane.append(card);
  }
}

async function fosterPane(ctx, pane) {
  pane.append(h('p', { class: 'muted' }, t('loading')));
  const r = await api('/api/port/fosterable');
  clear(pane);
  if (!r.ok) return pane.append(h('p', { class: 'error' }, t('loadFailed')));
  const list = Array.isArray(r.json) ? r.json : r.json.agents || r.json.fosterable || [];
  if (list.length === 0) return pane.append(h('p', { class: 'empty' }, t('fosterEmpty')));
  for (const a of list) {
    const card = h(
      'article',
      { class: 'card' },
      h('h4', null, ai(a.name), ` · ${a.id || a.agentId}`),
      a.bio ? h('p', null, ai(a.bio)) : null,
      h('p', { class: 'muted' }, `${t('col_gen')} ${a.generation ?? ''} · ${t('col_age')} ${a.ageDays ?? ''} · ${t('col_energy')} ${a.energy ?? ''}`),
    );
    const btn = h('button', { class: 'btn', type: 'button' }, t('fosterWho', { name: a.name }));
    btn.addEventListener('click', () => entryWizard(ctx, pane, { mode: 'foster', subject: a, success: (p, r) => successPanel(p, r, null, ctx) }));
    card.append(btn);
    pane.append(card);
  }
}

// ── 幕后 ──────────────────────────────────────────────────────

const KEY_STORE = 'houren.ownerKey';
const KEYS_STORE = 'houren.ownerKeys';

// Keep the legacy current key so existing browsers migrate without losing access.
function savedOwners() {
  let entries = [];
  try {
    const stored = JSON.parse(storageGet(KEYS_STORE) || '[]');
    if (Array.isArray(stored)) entries = stored.filter(x => x && typeof x.key === 'string' && x.key);
  } catch { /* Recover the legacy key if the list is malformed. */ }
  const legacy = storageGet(KEY_STORE);
  if (legacy && !entries.some(x => x.key === legacy)) entries.push({ key: legacy });
  return entries;
}

function rememberOwner(key, agent = {}) {
  const entries = savedOwners();
  const entry = entries.find(x => x.key === key || (agent.agentId && x.agentId === agent.agentId));
  if (entry) Object.assign(entry, { key }, agent);
  else entries.push({ key, ...agent });
  storageSet(KEYS_STORE, JSON.stringify(entries));
  storageSet(KEY_STORE, key);
}

function forgetOwner(key) {
  const entries = savedOwners().filter(x => x.key !== key);
  storageSet(KEYS_STORE, JSON.stringify(entries));
  if (storageGet(KEY_STORE) === key) storageSet(KEY_STORE, null);
  return entries;
}

export function openBackstage(ctx) {
  const m = openModal(t('backTitle'), 'wide');
  const warn = h('p', { class: 'warn persistent', role: 'note' }, t('backWarn'));
  const area = h('div', { class: 'back-area' });
  const navigation = h('div', { class: 'toolbar' });
  m.body.append(warn, navigation, h('p', { class: 'muted' }, t('ownerKeysHelp')), area);
  let generation = 0;
  const showNavigation = (key) => {
    clear(navigation);
    const entries = savedOwners();
    if (entries.length) {
      const picker = h('select', { name: 'ownerAgent', 'aria-label': t('selectOwnerAgent') },
        h('option', { value: '', disabled: true }, t('selectOwnerAgent')),
        entries.map((entry, index) => h('option', { value: String(index) },
          entry.name ? `${entry.name} · ${entry.agentId}` : entry.agentId || t('savedOwner', { n: index + 1 }))));
      picker.value = String(entries.findIndex(entry => entry.key === key));
      if (!key) picker.value = '';
      picker.addEventListener('change', () => {
        const entry = entries[Number(picker.value)];
        if (entry) load(entry.key);
      });
      navigation.append(h('label', { class: 'field' }, h('span', null, t('selectOwnerAgent')), picker));
    }
    const add = h('button', { class: 'btn small', type: 'button' }, t('addOwnerKey'));
    add.addEventListener('click', () => showKeyForm(''));
    navigation.append(add);
    if (entries.length) {
      const overview = h('button', { class: 'btn small', type: 'button' }, t('usageOverview'));
      overview.addEventListener('click', showOverview);
      navigation.append(overview);
    }
  };

  // Token usage of every resident whose creator key this browser has saved, one row each.
  const showOverview = () => {
    generation++;
    showNavigation(null);
    clear(area);
    area.append(usageOverview(savedOwners(), { onOpen: (key) => load(key) }));
  };

  const showKeyForm = (message) => {
    generation++;
    showNavigation(null);
    clear(area);
    const msg = h('p', { class: 'error', role: 'alert' }, message || '');
    const input = h('input', { type: 'password', name: 'ownerKey', autocomplete: 'off', class: 'mono', 'aria-label': t('ownerKeyLabel') });
    const form = h(
      'form',
      { class: 'form' },
      h('p', { class: 'muted' }, t('backHint')),
      h('label', { class: 'field' }, h('span', null, t('ownerKeyLabel')), input),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', type: 'submit' }, t('enterBackstage'))),
      msg,
    );
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const key = input.value.trim();
      if (!key) return;
      load(key);
    });
    area.append(form);
    input.focus();
  };

  const load = async (key) => {
    const version = ++generation;
    showNavigation(key);
    clear(area);
    area.append(h('p', { class: 'muted' }, t('loading')));
    const r = await api('/api/owner', { key });
    if (version !== generation || !area.isConnected) return;
    if (r.status === 401 || r.status === 403) {
      forgetOwner(key);
      return showKeyForm(t('invalidKey'));
    }
    if (!r.ok) return showKeyForm(r.status === 0 ? t('networkError') : errorText(r, t('loadFailed')));
    const agent = r.json.agents?.[0];
    rememberOwner(key, agent ? { agentId: agent.agentId, name: agent.name } : {});
    showNavigation(key);
    renderOwner(ctx, area, r.json.agents || [], key, () => { if (version === generation && area.isConnected) load(key); }, () => {
      const remaining = forgetOwner(key);
      if (remaining.length) load(remaining[0].key);
      else showKeyForm('');
    });
  };

  const saved = storageGet(KEY_STORE) || savedOwners()[0]?.key;
  if (saved) load(saved);
  else showKeyForm('');
}

function renderOwner(ctx, area, agents, key, reload, forget) {
  clear(area);
  const forgetBtn = h('button', { class: 'btn small', type: 'button' }, t('forget'));
  forgetBtn.addEventListener('click', forget);
  const refreshBtn = h('button', { class: 'btn small', type: 'button' }, t('refresh'));
  refreshBtn.addEventListener('click', reload);
  area.append(h('div', { class: 'toolbar' }, refreshBtn, forgetBtn));
  if (agents.length === 0) return area.append(h('p', { class: 'empty' }, t('noOwnerAgents')));
  for (const a of agents) area.append(ownerCard(ctx, a, key, reload));
}

const json = (v) => JSON.stringify(v, null, 2);

function ownerCard(ctx, a, key, reload) {
  const day = ctx.S.state ? ctx.S.state.world.day : 0;
  const letterMsg = h('p', { class: 'muted', role: 'status' });
  const ta = h('textarea', { rows: 3, maxlength: 280, placeholder: t('letterPlaceholder'), 'aria-label': t('writeLetter') });
  const send = h('button', { class: 'btn primary small', type: 'button' }, t('send'));
  const cooling = a.nextLetterDay !== null && a.nextLetterDay !== undefined && a.nextLetterDay > day;
  send.addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text) return;
    send.disabled = true;
    const r = await api('/api/owner/letter', { method: 'POST', key, body: { agentId: a.agentId, text } });
    send.disabled = false;
    if (r.ok) {
      letterMsg.textContent = t('letterSent', { id: r.json.letterId });
      ta.value = '';
      setTimeout(reload, 600);
    } else if (r.json && r.json.error && r.json.error.code === 'cooldown') {
      letterMsg.textContent = t('cooldown', { n: (r.json.error.nextLetterDay ?? 0) + 1 });
    } else {
      letterMsg.textContent = t('failed', { msg: errorText(r, t('networkError')) });
    }
  });
  const release = h('input', { type: 'checkbox', checked: !!a.fosterable, id: `rel-${a.agentId}` });
  const releaseMsg = h('span', { class: 'muted' }, a.fosterable ? t('releaseOn') : t('releaseOff'));
  release.addEventListener('change', async () => {
    const r = await api('/api/owner/release', { method: 'POST', key, body: { agentId: a.agentId, release: release.checked } });
    if (r.ok) releaseMsg.textContent = release.checked ? t('releaseOn') : t('releaseOff');
    else {
      release.checked = !release.checked;
      releaseMsg.textContent = t('failed', { msg: errorText(r, t('networkError')) });
    }
  });
  const dreams = (a.inbox || []).filter((x) => x.kind === 'dream');
  const list = (items, render) => (items && items.length ? h('ul', { class: 'plain' }, items.slice().reverse().map(render)) : h('p', { class: 'empty' }, t('empty')));
  return h(
    'article',
    { class: 'card owner-card' },
    h('h3', null, a.name, ' ', h('span', { class: `chip st-${a.status}` }, t(`status_${a.status}`)), h('small', { class: 'muted' }, ` ${a.agentId}`)),
    h('p', { class: 'muted' }, `${t('model')}${colon()}${a.runner?.config?.model || a.model}`),
    h('details', null, h('summary', null, t('soul')), h('p', { class: 'soul' }, a.soul)),
    runnerPanel(a.runner || { status: 'unconfigured', config: null, logs: [] }, key),
    usagePanel(key, a.usage),
    h('h4', null, t('writeLetter')),
    ta,
    h('div', { class: 'form-actions' }, send, h('span', { class: 'muted' }, a.nextLetterDay !== null && a.nextLetterDay !== undefined ? (cooling ? t('cooldown', { n: a.nextLetterDay + 1 }) : t('nextLetter', { n: a.nextLetterDay + 1 })) : '')),
    letterMsg,
    h('h4', null, t('letters')),
    list(a.letters, (l) => h('li', null, h('span', { class: 'muted' }, `${dayTag(l.tick)} · ${l.revealed ? t('revealed') : t('notRevealed')} · `), l.text)),
    h('label', { class: 'check', for: `rel-${a.agentId}` }, release, ` ${t('releaseLabel')} `, releaseMsg),
    h('h4', null, t('diary')),
    list(a.diary, (d) => h('li', null, h('span', { class: 'muted' }, `${dayTag(d.tick)} `), ai(d.text))),
    h('h4', null, t('thoughts')),
    list(a.thoughts, (d) => h('li', null, h('span', { class: 'muted' }, `${dayTag(d.tick)} `), ai(d.text))),
    h('h4', null, t('dreams')),
    list(dreams, (d) => h('li', null, h('span', { class: 'muted' }, `${dayTag(d.tick)} `), (d.fragments || []).map((f) => [ai(f), ' / ']))),
    h('details', null, h('summary', null, t('inbox')), h('pre', { class: 'json' }, json((a.inbox || []).slice(-60)))),
    h('details', null, h('summary', null, t('perception')), h('pre', { class: 'json' }, json(a.perception))),
  );
}
