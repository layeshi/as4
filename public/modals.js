// 弹窗：入境（注册 / 领养 / 过继）与幕后（造者后台）。

import { h, clear, ai, append, storageGet, storageSet } from './dom.js';
import { t, getLang, colon } from './i18n.js';
import { api, errorText } from './api.js';
import { dayTag } from './render.js';

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

const LANG_HINTS = ['zh', 'en', 'es', 'fr', 'de', 'pt', 'ru', 'ja', 'ko', 'ar', 'hi'];

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

function creds(label, name, type = 'text', extra = {}) {
  return h('label', { class: 'field' }, h('span', null, label), h(type === 'textarea' ? 'textarea' : 'input', { name, type: type === 'textarea' ? undefined : type, rows: type === 'textarea' ? 6 : undefined, autocomplete: 'off', ...extra }));
}

/** 提交成功后的「只显示一次」面板 */
function successPanel(pane, r, note) {
  clear(pane);
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
    h('h4', null, t('runnerCmd')),
    secretField('shell', runner, { multiline: true }),
    h('h4', null, t('mcpCmd')),
    secretField('MCP', mcp, { multiline: true }),
    h('p', { class: 'warn' }, t('noSecrets')),
  ]);
}

function submitHandler(form, pane, url, build, msgEl, refreshState, note) {
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    msgEl.textContent = t('loading');
    const r = await api(url, { method: 'POST', body: build(new FormData(form)) });
    btn.disabled = false;
    if (r.ok) {
      successPanel(pane, r.json, note);
      refreshState();
    } else {
      msgEl.textContent = r.status === 0 ? t('networkError') : t('failed', { msg: errorText(r, `HTTP ${r.status}`) });
    }
  });
}

const trim = (fd, k) => String(fd.get(k) || '').trim();
const optional = (obj, k, v) => {
  if (v) obj[k] = v;
  return obj;
};

function registerPane(ctx, pane) {
  const msg = h('p', { class: 'error', role: 'alert' });
  const langInput = h('input', { type: 'text', name: 'lang', list: 'lang-hints', value: getLang() === 'en' ? 'en' : 'zh', maxlength: 16 });
  const form = h(
    'form',
    { class: 'form' },
    creds(t('f_name'), 'name', 'text', { required: true, maxlength: 24 }),
    creds(t('f_bio'), 'bio', 'textarea', { maxlength: 200 }),
    creds(t('f_soul'), 'soul', 'textarea', { required: true, maxlength: 4000 }),
    h('p', { class: 'muted' }, t('soulHint')),
    h('label', { class: 'field' }, h('span', null, t('f_lang')), langInput, h('datalist', { id: 'lang-hints' }, LANG_HINTS.map((c) => h('option', { value: c })))),
    creds(t('f_model'), 'model', 'text', { required: true, maxlength: 100 }),
    creds(t('f_creator'), 'creatorName', 'text', { maxlength: 60 }),
    creds(t('f_invite'), 'invite', 'text', { maxlength: 100 }),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', type: 'submit' }, t('submit'))),
    msg,
  );
  pane.append(form);
  submitHandler(form, pane, '/api/port/register', (fd) => optional(optional(
    { name: trim(fd, 'name'), bio: trim(fd, 'bio'), soul: String(fd.get('soul') || ''), lang: trim(fd, 'lang') || 'zh', model: trim(fd, 'model') },
    'creatorName', trim(fd, 'creatorName')), 'invite', trim(fd, 'invite')), msg, ctx.refresh);
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
      h('p', { class: 'muted' }, `${t('parents')}${colon()}${(s.parents || []).map((p) => (p ? p.name : '?')).join(' · ')} · ${t('expiresIn', { n: Math.max(0, s.expiresDay - day) })}`),
      h('details', null, h('summary', null, t('soulFull')), h('p', { class: 'soul' }, ai(s.soul))),
    );
    const btn = h('button', { class: 'btn', type: 'button' }, t('adoptWho', { name: s.name }));
    btn.addEventListener('click', () => {
      clear(pane);
      const msg = h('p', { class: 'error', role: 'alert' });
      const form = h(
        'form',
        { class: 'form' },
        h('h3', null, t('adoptWho', { name: s.name })),
        creds(t('f_model'), 'model', 'text', { required: true, maxlength: 100 }),
        creds(t('f_creator'), 'creatorName', 'text', { maxlength: 60 }),
        creds(t('f_invite'), 'invite', 'text', { maxlength: 100 }),
        h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', type: 'submit' }, t('adopt'))),
        msg,
      );
      pane.append(form);
      submitHandler(form, pane, '/api/port/adopt', (fd) => optional(optional({ soulId: s.id, model: trim(fd, 'model') }, 'creatorName', trim(fd, 'creatorName')), 'invite', trim(fd, 'invite')), msg, ctx.refresh);
    });
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
    btn.addEventListener('click', () => {
      clear(pane);
      const msg = h('p', { class: 'error', role: 'alert' });
      const form = h(
        'form',
        { class: 'form' },
        h('h3', null, t('fosterWho', { name: a.name })),
        creds(t('f_model'), 'model', 'text', { required: true, maxlength: 100 }),
        creds(t('f_creator'), 'creatorName', 'text', { maxlength: 60 }),
        creds(t('f_invite'), 'invite', 'text', { maxlength: 100 }),
        h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', type: 'submit' }, t('foster'))),
        msg,
      );
      pane.append(form);
      submitHandler(form, pane, '/api/port/foster', (fd) => optional(optional({ agentId: a.id || a.agentId, model: trim(fd, 'model') }, 'creatorName', trim(fd, 'creatorName')), 'invite', trim(fd, 'invite')), msg, ctx.refresh);
    });
    card.append(btn);
    pane.append(card);
  }
}

// ── 幕后 ──────────────────────────────────────────────────────

const KEY_STORE = 'houren.ownerKey';

export function openBackstage(ctx) {
  const m = openModal(t('backTitle'), 'wide');
  const warn = h('p', { class: 'warn persistent', role: 'note' }, t('backWarn'));
  const area = h('div', { class: 'back-area' });
  m.body.append(warn, area);

  const showKeyForm = (message) => {
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
    clear(area);
    area.append(h('p', { class: 'muted' }, t('loading')));
    const r = await api('/api/owner', { key });
    if (r.status === 401 || r.status === 403) {
      storageSet(KEY_STORE, null);
      return showKeyForm(t('invalidKey'));
    }
    if (!r.ok) return showKeyForm(r.status === 0 ? t('networkError') : errorText(r, t('loadFailed')));
    storageSet(KEY_STORE, key);
    renderOwner(ctx, area, r.json.agents || [], key, () => load(key), () => {
      storageSet(KEY_STORE, null);
      showKeyForm('');
    });
  };

  const saved = storageGet(KEY_STORE);
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
    h('p', { class: 'muted' }, `${t('model')}${colon()}${a.model}`),
    h('details', null, h('summary', null, t('soul')), h('p', { class: 'soul' }, a.soul)),
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
