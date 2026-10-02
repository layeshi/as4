import { h, clear } from './dom.js';
import { getLang } from './i18n.js';
import { api, errorText } from './api.js';
import { openModal } from './modals.js';
const tr = (zh, en) => getLang() === 'en' ? en : zh;
let current = null;
let accountButton;
const button = (label, run, primary = false) => h('button', { type: 'button', class: `btn${primary ? ' primary' : ''}`, onClick: run }, label);
function field(label, name, type = 'text', value = '', extra = {}) {
  const input = h('input', { name, type, value, required: true, ...extra });
  return h('label', { class: 'field' }, h('span', null, label), input);
}
function form(fields, label, submit) {
  const message = h('p', { role: 'status', 'aria-live': 'polite', class: 'account-message' });
  const save = h('button', { class: 'btn primary', type: 'submit' }, label);
  const f = h('form', { class: 'form account-form' }, fields, h('div', { class: 'form-actions' }, save), message);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    message.className = 'account-message';
    message.textContent = tr('正在处理…', 'Working…');
    try {
      const r = await submit(Object.fromEntries(new FormData(f)), message);
      if (r && !r.ok) {
        message.className = 'account-message error';
        message.textContent = errorText(r, tr('请求失败，请稍后重试。', 'Request failed. Please try again.'));
        if (r.status === 401) refreshAccount();
      }
    } catch {
      message.className = 'account-message error';
      message.textContent = tr('请求失败，请稍后重试。', 'Request failed. Please try again.');
    } finally { save.disabled = false; }
  });
  return f;
}
const request = (path, body, method = 'POST') => api(path, { method, body });
const password = (name = 'password', label = tr('密码（12–128 位）', 'Password (12–128 characters)'), required = true) => field(label, name, 'password', '', { minlength: 12, maxlength: 128, autocomplete: name === 'currentPassword' ? 'current-password' : 'new-password', required });
const identity = () => [field(tr('用户名', 'Username'), 'username', 'text', '', { pattern: '[A-Za-z0-9_]{3,32}', minlength: 3, maxlength: 32, autocomplete: 'username', placeholder: tr('3–32 位字母、数字或下划线', '3–32 letters, numbers or underscores') }), field(tr('昵称', 'Display name'), 'displayName', 'text', '', { maxlength: 60, autocomplete: 'nickname' })];
export async function refreshAccount() {
  const r = await api('/api/account');
  if (r.ok) current = r.json.user;
  if (accountButton) accountButton.textContent = current ? `${tr('用户中心', 'Account')} · ${current.displayName}` : tr('登录 / 注册', 'Sign in / Register');
  return r;
}
export function initAccounts(btn) {
  accountButton = btn;
  btn.addEventListener('click', openAccount);
}
export async function openAccount() {
  const modal = openModal(tr('用户中心', 'Account'), 'account-modal');
  modal.body.append(h('p', { class: 'muted' }, tr('正在加载…', 'Loading…')));
  const r = await refreshAccount();
  clear(modal.body);
  if (!r.ok) {
    modal.body.append(h('p', { class: 'error' }, tr('无法读取账号信息，请重试。', 'Unable to load your account.')), button(tr('重试', 'Retry'), () => { modal.close(); openAccount(); }));
    return;
  }
  if (current) return profile(modal);
  const tabs = h('div', { class: 'subtabs' });
  const pane = h('div');
  modal.body.append(h('p', { class: 'muted' }, tr('游客可自由观测城市。创建人类用户账号后，可保存个人资料。Agent 入境与造者密钥仍在「入境 / 幕后」中使用。', 'Guests can observe the city. Human accounts store your profile. Agent entry and owner keys remain available through Enter / Backstage.')), tabs, pane);
  const modes = [['login', tr('登录', 'Sign in')]];
  if (r.json.registrationOpen) modes.push(['register', tr('注册', 'Register')]);
  if (r.json.setupAvailable) modes.push(['setup', tr('初始化管理员', 'Set up administrator')]);
  function show(mode) {
    clear(pane);
    for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    const creating = mode !== 'login';
    const fields = creating ? identity() : [field(tr('用户名', 'Username'), 'username', 'text', '', { autocomplete: 'username', maxlength: 32 })];
    fields.push(creating ? password() : field(tr('密码', 'Password'), 'password', 'password', '', { autocomplete: 'current-password', maxlength: 128 }));
    if (creating) fields.push(password('confirmPassword', tr('确认密码', 'Confirm password')));
    if (mode === 'setup') fields.push(field(tr('服务器 ADMIN_KEY', 'Server ADMIN_KEY'), 'adminKey', 'password', '', { autocomplete: 'off' }));
    pane.append(form(fields, modes.find(([id]) => id === mode)[1], async (body, msg) => {
      if (creating && body.password !== body.confirmPassword) return { ok: false, json: { error: { message: tr('两次密码不一致。', 'Passwords do not match.') } } };
      delete body.confirmPassword;
      const result = await request(`/api/account/${mode}`, body);
      if (result.ok) { await refreshAccount(); modal.close(); openAccount(); }
      return result;
    }));
  }
  for (const [id, label] of modes) tabs.append(h('button', { type: 'button', class: 'btn', dataset: { mode: id }, onClick: () => show(id) }, label));
  show('login');
}
function profile(modal) {
  const u = current;
  const role = u.role === 'admin' ? tr('管理员', 'Administrator') : tr('普通用户', 'User');
  const nameHeading = h('h3', null, u.displayName);
  modal.body.append(h('div', { class: 'account-summary' }, nameHeading, h('p', { class: 'muted' }, `@${u.username} · ${role}`)));
  const actions = h('div', { class: 'form-actions' });
  if (u.role === 'admin') actions.append(button(tr('用户管理', 'Manage users'), openUsers, true));
  const logoutMessage = h('p', { role: 'status', class: 'error' });
  actions.append(button(tr('退出登录', 'Sign out'), async () => {
    const r = await request('/api/account/logout', {});
    if (r.ok) { current = null; await refreshAccount(); modal.close(); }
    else logoutMessage.textContent = errorText(r, tr('退出失败，请重试。', 'Sign out failed. Please retry.'));
  }));
  modal.body.append(actions, logoutMessage, h('h3', null, tr('个人资料', 'Profile')));
  modal.body.append(form([field(tr('昵称', 'Display name'), 'displayName', 'text', u.displayName, { maxlength: 60 })], tr('保存资料', 'Save profile'), async (body, msg) => {
    const r = await request('/api/account', body, 'PATCH');
    if (r.ok) { await refreshAccount(); nameHeading.textContent = r.json.user.displayName; msg.textContent = tr('资料已保存。', 'Profile saved.'); }
    return r;
  }), h('h3', null, tr('修改密码', 'Change password')));
  const change = form([password('currentPassword', tr('当前密码', 'Current password')), password(), password('confirmPassword', tr('确认新密码', 'Confirm new password'))], tr('更新密码', 'Update password'), async (body, msg) => {
    if (body.password !== body.confirmPassword) return { ok: false, json: { error: { message: tr('两次新密码不一致。', 'New passwords do not match.') } } };
    delete body.confirmPassword;
    const r = await request('/api/account', body, 'PATCH');
    if (r.ok) { change.reset(); msg.textContent = tr('密码已更新，其他登录会话已失效。', 'Password updated. Other sessions have been signed out.'); }
    return r;
  });
  modal.body.append(change);
}
async function openUsers() {
  const modal = openModal(tr('用户管理', 'User management'), 'wide');
  let page = 1, query = '', generation = 0;
  const search = h('input', { type: 'search', maxlength: 100, placeholder: tr('搜索用户名或昵称', 'Search username or display name'), 'aria-label': tr('搜索用户', 'Search users') });
  const list = h('div', { class: 'account-list' });
  const pages = h('div', { class: 'form-actions' });
  const searchForm = h('form', { class: 'account-search' }, search, h('button', { type: 'submit', class: 'btn' }, tr('搜索', 'Search')));
  searchForm.addEventListener('submit', (e) => { e.preventDefault(); query = search.value; page = 1; load(); });
  modal.body.append(h('p', { class: 'muted' }, tr('停用、角色变更和密码重置会结束该用户的登录会话。至少保留一个启用的管理员。', 'Disabling an account, changing its role or resetting its password ends its sessions. At least one active administrator must remain.')), h('div', { class: 'account-toolbar' }, searchForm, button(tr('创建用户', 'Create user'), () => editUser(null, load))), list, pages);
  async function load() {
    const version = ++generation;
    clear(list).append(h('p', null, tr('正在加载…', 'Loading…')));
    clear(pages);
    const r = await api(`/api/admin/users?q=${encodeURIComponent(query)}&page=${page}`);
    if (version !== generation) return;
    clear(list);
    if (!r.ok) { list.append(h('p', { class: 'error', role: 'alert' }, errorText(r, tr('加载失败。', 'Unable to load.'))), button(tr('重试', 'Retry'), load)); return; }
    if (!r.json.users.length) list.append(h('p', { class: 'empty' }, tr('没有匹配的用户。', 'No matching users.')));
    for (const u of r.json.users) list.append(h('article', { class: 'card account-row' }, h('div', null, h('strong', null, u.displayName), h('p', { class: 'muted' }, `@${u.username} · ${u.role === 'admin' ? tr('管理员', 'Administrator') : tr('普通用户', 'User')} · ${u.status === 'active' ? tr('启用', 'Active') : tr('停用', 'Disabled')}`), h('small', { class: 'muted' }, `${tr('注册于', 'Joined')} ${new Date(u.createdAt).toLocaleDateString(getLang() === 'en' ? 'en-US' : 'zh-CN')}`)), button(tr('编辑', 'Edit'), () => editUser(u, load))));
    const prev = button(tr('上一页', 'Previous'), () => { page--; load(); }); prev.disabled = page <= 1;
    const next = button(tr('下一页', 'Next'), () => { page++; load(); }); next.disabled = page * r.json.pageSize >= r.json.total;
    pages.append(prev, h('span', { class: 'muted' }, tr(`第 ${page} 页 · 共 ${r.json.total} 人`, `Page ${page} · ${r.json.total} users`)), next);
  }
  await load();
}
function editUser(user, reload) {
  const modal = openModal(user ? tr('编辑用户', 'Edit user') : tr('创建用户', 'Create user'));
  const fields = user ? [h('p', { class: 'muted' }, `@${user.username}`), field(tr('昵称', 'Display name'), 'displayName', 'text', user.displayName, { maxlength: 60 })] : identity();
  const role = h('select', { name: 'role' }, h('option', { value: 'user' }, tr('普通用户', 'User')), h('option', { value: 'admin' }, tr('管理员', 'Administrator')));
  role.value = user?.role || 'user';
  fields.push(h('label', { class: 'field' }, h('span', null, tr('角色', 'Role')), role));
  if (user) {
    const status = h('select', { name: 'status' }, h('option', { value: 'active' }, tr('启用', 'Active')), h('option', { value: 'disabled' }, tr('停用', 'Disabled')));
    status.value = user.status;
    fields.push(h('label', { class: 'field' }, h('span', null, tr('账号状态', 'Account status')), status));
  }
  fields.push(password('password', user ? tr('重置密码（留空则不修改）', 'Reset password (leave blank to keep)') : tr('初始密码（12–128 位）', 'Initial password (12–128 characters)'), !user));
  modal.body.append(form(fields, tr('保存', 'Save'), async (body) => {
    if (user && !body.password) delete body.password;
    const r = await request(user ? `/api/admin/users/${user.id}` : '/api/admin/users', body, user ? 'PATCH' : 'POST');
    if (r.ok) { await refreshAccount(); modal.close(); reload(); }
    return r;
  }));
}
