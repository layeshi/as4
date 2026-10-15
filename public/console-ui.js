// 会员页与管理后台共用：顶栏（导航 + 账户菜单）与表单、表格、数字块等小组件。
// 页面：我的居民（residents.html）、余额与充值（billing.html）、账户设置（account.html）、管理后台（admin.html）、支持页。
// 所有文字都经 textContent；不写内联样式（CSP）。

import { h, clear } from './dom.js';
import { getLang } from './i18n.js';
import { api, errorText } from './api.js';
import { currentUser, watchAccount, openAccount, signOut, roleName, initialBadge } from './accounts.js';

export const tr = (zh, en) => (getLang() === 'en' ? en : zh);

// ── 页面提示：按钮出错时写到页面顶部的提示行 ──
let notice = () => {};
export function setNotice(fn) {
  notice = fn;
}
export const say = (text) => notice(text);

// ── 表单与展示的小组件 ──
export const request = async (path, body, method = 'POST') => {
  const r = await api(path, { method, body });
  if (!r.ok) throw Error(errorText(r, '请求失败'));
  return r.json;
};
/** 异步按钮：执行期间禁用，出错写到页面提示；先记下按钮，免得事件对象被复用后丢失 */
export const btn = (text, run, primary = false) => h('button', { type: 'button', class: `btn${primary ? ' primary' : ''}`, onClick: async (e) => {
  const button = e.currentTarget;
  if (button.disabled) return;
  button.disabled = true;
  try { await run(); } catch (err) { say(err.message); } finally { button.disabled = false; }
} }, text);
export const field = (label, name, value = '', type = 'text', extra = {}) => h('label', { class: 'field' }, h('span', null, label), h('input', { name, type, value, ...extra }));
export const textarea = (label, name, value = '') => h('label', { class: 'field' }, h('span', null, label), h('textarea', { name, required: true }, value));
/** 留言输入：按 Unicode 字符计数；提交失败保留草稿，不解析富文本。 */
export function messageComposer({ label, value = '', submitLabel, primary = true, onInput, submit, cancel, key }) {
  const input = h('textarea', { name: 'text', rows: 4, required: true, value, dataset: { draft: key } });
  const counter = h('span', { class: 'message-counter', id: `counter-${key}` });
  input.setAttribute('aria-describedby', `counter-${key}`);
  const status = h('p', { role: 'status', 'aria-live': 'polite' });
  const save = h('button', { type: 'submit', class: `btn${primary ? ' primary' : ''}` }, submitLabel);
  const abort = cancel ? btn(tr('取消', 'Cancel'), cancel) : null;
  const form = h('form', { class: 'form message-form' }, h('label', { class: 'field' }, h('span', null, label), input),
    h('div', { class: 'message-form-foot' }, counter, h('div', { class: 'form-actions' }, abort, save)), status);
  const count = () => {
    const n = [...input.value.trim()].length;
    counter.textContent = `${n.toLocaleString()} / 2,000 ${tr('字', 'characters')}`;
    counter.classList.toggle('error', n > 2000);
    input.setCustomValidity?.(n > 2000 ? tr('最多输入 2,000 字。', 'Use no more than 2,000 characters.') : '');
  };
  input.addEventListener('input', () => { status.textContent = ''; status.className = ''; onInput?.(input.value); count(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (save.disabled) return;
    count();
    if (!input.value.trim() || [...input.value.trim()].length > 2000) {
      status.className = 'error'; status.textContent = tr('请输入 1–2,000 字的留言。', 'Enter between 1 and 2,000 characters.'); return;
    }
    save.disabled = true; input.disabled = true;
    if (abort) abort.disabled = true;
    status.className = ''; status.textContent = tr('正在发布…', 'Saving…');
    try { await submit(input.value.trim()); }
    catch (err) { status.className = 'error'; status.textContent = err.message; }
    finally { save.disabled = false; input.disabled = false; if (abort) abort.disabled = false; }
  });
  count();
  return form;
}
export function form(fields, label, submit) {
  const notice = h('p', { role: 'status' }), button = h('button', { class: 'btn primary', type: 'submit' }, label), f = h('form', { class: 'form' }, fields, h('div', { class: 'form-actions' }, button), notice);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    notice.className = '';
    notice.textContent = '正在处理…';
    try { await submit(Object.fromEntries(new FormData(f))); notice.textContent = '已保存'; }
    catch (err) { notice.textContent = err.message; notice.className = 'error'; }
    finally { button.disabled = false; }
  });
  return f;
}
export const section = (title, ...children) => h('section', null, h('h2', null, title), ...children);
/** 一块带标题的卡片；note 是标题下的一行说明 */
export const card = (title, note, ...children) => h('section', { class: 'card-panel' }, title ? h('h2', null, title) : null, note ? h('p', { class: 'card-note muted' }, note) : null, ...children);
/** 表格在窄屏横向滚动；单元格默认不折行，长文字（说明、事件列表）才折行 */
export const table = (heads, rows) => h('div', { class: 'scroll-table' }, h('table', null, h('thead', null, h('tr', null, heads.map((x) => h('th', null, x)))), h('tbody', null, rows.length ? rows.map((row) => h('tr', null, row.map((x) => h('td', { class: typeof x === 'string' && x.length > 24 ? 'wrap' : null }, x)))) : h('tr', null, h('td', { colspan: heads.length, class: 'empty' }, '暂无记录')))));
export const metrics = (items) => h('div', { class: 'resident-metrics' }, items.map(([label, value]) => h('div', { class: 'resident-metric' }, label, h('strong', null, value ?? '未知'))));
export const chip = (text, tone = '') => h('span', { class: `chip ${tone}`.trim() }, text);
export const emptyState = (title, text, ...actions) => h('div', { class: 'empty-state' }, h('h2', null, title), text ? h('p', { class: 'muted' }, text) : null, actions.length ? h('div', { class: 'form-actions' }, actions) : null);
/** 页头：返回链接、小标题、标题（左侧可放头像）、说明与右侧的操作 */
export function pageHead(root, { eyebrow, title, lead, actions = [], back, media }) {
  const text = h('div', { class: 'page-title' }, eyebrow ? h('p', { class: 'eyebrow' }, eyebrow) : null, h('h1', null, title), lead ? h('p', { class: 'lead' }, lead) : null);
  clear(root).append(
    back ? h('a', { class: 'back-link', href: back.href }, `← ${back.label}`) : '',
    h('div', { class: 'page-head' }, media ? h('div', { class: 'page-title-row' }, media, text) : text, actions.length ? h('div', { class: 'page-actions' }, actions) : null));
}

// ── 待处理入账申请：管理员在任何会员页都能看到角标，不用刷新页面 ──
export const PENDING_POLL_MS = 30000;
const pendingWatchers = new Set();
let lastPending = null;
/** 报告最新的待处理入账申请数（顶栏的定时检查与充值审核面板都会调用） */
export function reportPending(n) {
  lastPending = n;
  for (const fn of pendingWatchers) fn(n);
}
export function watchPending(fn) {
  pendingWatchers.add(fn);
  return () => pendingWatchers.delete(fn);
}
export function setBadge(badge, n) {
  if (!badge) return;
  badge.textContent = n > 0 ? String(n) : '';
  badge.hidden = !(n > 0);
}

// ── 顶栏 ──
const NAV = [
  { id: 'observe', href: '/', label: () => tr('观测城市', 'Observe') },
  { id: 'residents', href: '/residents.html', label: () => tr('我的居民', 'My residents') },
  { id: 'announcements', href: '/announcements.html', label: () => tr('公告', 'Announcements') },
  { id: 'messages', href: '/messages.html', label: () => tr('留言板', 'Message board') },
  { id: 'billing', href: '/billing.html', label: () => tr('余额与充值', 'Balance'), signedIn: true },
  { id: 'admin', href: '/admin.html', label: () => tr('管理后台', 'Admin'), admin: true },
];

/** 把顶栏画进 header：品牌、导航（当前页高亮；余额只给登录用户，管理后台只给管理员）、登录按钮或账户菜单 */
export function mountShell(header, { active } = {}) {
  let shown = null, known = false; // 读到账号之前不画登录按钮，免得已登录的人先看到它闪一下
  let closeMenu = () => {}, pollTimer = null, isAdmin = false;
  const key = (u) => (u ? `${u.id}|${u.displayName}|${u.role}` : '');
  // 管理员：定时读待处理入账申请数，挂在「管理后台」上（页面在后台时不读；顶栏离开页面后停止）
  async function pollPending() {
    clearTimeout(pollTimer);
    if (!isAdmin || !header.isConnected) return;
    pollTimer = setTimeout(pollPending, PENDING_POLL_MS);
    pollTimer?.unref?.(); // 只在 Node（测试）里有：别让定时检查拖住进程
    if (typeof document !== 'undefined' && document.hidden) return;
    const r = await api('/api/admin/hosted');
    if (r.ok && Array.isArray(r.json?.requests)) reportPending(r.json.requests.length);
  }
  watchPending((n) => setBadge(header.querySelector('.console-link .nav-badge'), n));
  function render(user) {
    shown = key(user);
    isAdmin = user?.role === 'admin';
    const links = NAV.filter((n) => (!n.signedIn || user) && (!n.admin || isAdmin))
      .map((n) => h('a', { class: 'console-link', href: n.href, 'aria-current': n.id === active ? 'page' : null }, h('span', null, n.label()), n.admin ? h('span', { class: 'nav-badge', hidden: true, title: tr('待处理入账申请', 'Pending top-up requests') }) : null));
    const account = user ? accountMenu(user) : known ? h('button', { type: 'button', class: 'btn primary', onClick: () => openAccount({ hub: false }) }, tr('登录 / 注册', 'Sign in / Register')) : '';
    clear(header).append(
      h('a', { class: 'console-brand', href: '/' }, h('img', { src: '/logo.svg', alt: '', width: 28, height: 28 }), h('span', null, tr('后人纪 · 词元本位', 'The Heirs: Token Standard'))),
      h('nav', { class: 'console-nav', 'aria-label': tr('主导航', 'Main navigation') }, links),
      h('div', { class: 'console-account' }, account));
    if (isAdmin && lastPending !== null) setBadge(header.querySelector('.console-link .nav-badge'), lastPending);
    pollPending();
  }
  function accountMenu(user) {
    const message = h('p', { class: 'error', role: 'status' });
    const menu = h('details', { class: 'account-menu' },
      h('summary', { 'aria-label': tr('账户菜单', 'Account menu') }, initialBadge(user), h('span', { class: 'account-name' }, user.displayName)),
      h('div', { class: 'account-menu-panel' },
        h('div', { class: 'account-menu-who' }, h('strong', null, user.displayName), h('span', { class: 'muted' }, `@${user.username} · ${roleName(user)}`)),
        h('a', { class: 'menu-item', href: '/account.html' }, tr('账户设置', 'Account settings')),
        h('button', { type: 'button', class: 'menu-item', onClick: async () => {
          const r = await signOut();
          if (!r.ok) message.textContent = errorText(r, tr('退出失败，请重试。', 'Sign out failed. Please retry.'));
        } }, tr('退出登录', 'Sign out')),
        message));
    closeMenu = () => { menu.open = false; };
    return menu;
  }
  // 点菜单外面或按 Esc 收起账户菜单
  document.addEventListener('click', (e) => {
    const menu = header.querySelector('.account-menu');
    if (menu && menu.open && !menu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  watchAccount((user, r) => {
    if (!r.ok && !known) return; // 网络失败：保持空白，等下一次读取
    const first = !known;
    known = true;
    if (first || key(user) !== shown) render(user);
  });
  render(currentUser());
}
