import { h, clear } from './dom.js';
import { getLang } from './i18n.js';
import { api, errorText, leaveForLogin } from './api.js';
import { openModal, openBackstage, savedOwners } from './modals.js';
import { accountAgentsPanel } from './account-usage-ui.js';
import { prayerAuditPanel } from './prayers-ui.js';
import { mountLoginChallenge } from './turnstile.js';
import { contactVerification, passwordControl } from './account-inputs.js';
// 人类账号：登录 / 注册弹窗、用户中心（只做导航，不放管理功能）、账户设置表单。
// 管理功能都在管理后台（admin.html）；居民、余额与充值各有自己的页面。
const tr = (zh, en) => getLang() === 'en' ? en : zh;
let current = null;
let verificationChannels = { email: false, phone: false };
let loginWall = false; // 服务器开着登录门（REQUIRE_LOGIN）：没有登录就不该停在任何会员页或观测站
let accountGeneration = 0;
let accountButton;
let appCtx; // 观测站的上下文：「我的居民」里的「进入幕后」要用
const watchers = new Set(); // 会员页的顶栏：每次读到账号都重画
export const button = (label, run, primary = false) => h('button', { type: 'button', class: `btn${primary ? ' primary' : ''}`, onClick: run }, label);
export function field(label, name, type = 'text', value = '', extra = {}) {
  const input = h('input', { name, type, value, required: true, ...extra });
  return h('label', { class: 'field' }, h('span', null, label), type === 'password' ? passwordControl(input) : input);
}
export function form(fields, label, submit) {
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
export const request = (path, body, method = 'POST') => api(path, { method, body });
export const password = (name = 'password', label = tr('密码（12–128 位）', 'Password (12–128 characters)'), required = true) => field(label, name, 'password', '', { minlength: 12, maxlength: 128, autocomplete: name === 'currentPassword' ? 'current-password' : 'new-password', required });
export const identity = () => [field(tr('用户名', 'Username'), 'username', 'text', '', { pattern: '[A-Za-z0-9_]{3,32}', minlength: 3, maxlength: 32, autocomplete: 'username', placeholder: tr('3–32 位字母、数字或下划线', '3–32 letters, numbers or underscores') }), field(tr('昵称', 'Display name'), 'displayName', 'text', '', { maxlength: 60, autocomplete: 'nickname' })];
export const roleName = (u) => u.role === 'admin' ? tr('管理员', 'Administrator') : tr('普通用户', 'User');
/** 头像位置的圆形字标：昵称的第一个字 */
export const initialBadge = (u) => h('span', { class: 'account-initial', 'aria-hidden': 'true' }, [...(u.displayName || u.username || '?').trim()][0] || '?');
export const currentUser = () => current;
/** 订阅账号变化（登录、退出、改昵称）；返回取消订阅的函数 */
export function watchAccount(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}
/**
 * 读取账号状态。开着登录门时，没有登录就回登录页（登录后回到这一页）；redirect = false 给不需要登录的页面（支持页）。
 */
export async function refreshAccount({ notify = true, redirect = true } = {}) {
  const version=++accountGeneration;
  const r = await api('/api/account');
  if(version!==accountGeneration)return r;
  const before=current?.id;
  if (r.ok) {
    current = r.json.user;
    verificationChannels = r.json.verificationChannels || verificationChannels;
    loginWall = r.json.loginRequired === true;
    if (redirect && loginWall && !current) leaveForLogin();
  }
  if(notify&&r.ok&&before!==current?.id)queueMicrotask(()=>appCtx?.onAccountChange?.());
  if (accountButton) accountButton.textContent = current ? `${tr('用户中心', 'Account')} · ${current.displayName}` : tr('登录 / 注册', 'Sign in / Register');
  for (const fn of watchers) fn(current, r);
  return r;
}
export function initAccounts(btn, ctx) {
  accountButton = btn;
  appCtx = ctx;
  if (btn) btn.addEventListener('click', () => openAccount());
}
export async function signOut() {
  const r = await request('/api/account/logout', {});
  if (!r.ok) return r;
  if (loginWall) leaveForLogin({ remember: false }); // 登录门开着：退出后回登录页，不带着这一页
  else await refreshAccount();
  return r;
}
/** 登录 / 注册弹窗；已登录时是用户中心。hub = false：登录成功后只关闭弹窗（会员页自己会重画） */
export async function openAccount({ hub = true } = {}) {
  let challenge = null, contactWidget = null;
  const modal = openModal(tr('用户中心', 'Account'), 'account-modal', () => { challenge?.dispose(); contactWidget?.dispose(); challenge = null; contactWidget = null; });
  modal.body.append(h('p', { class: 'muted' }, tr('正在加载…', 'Loading…')));
  const r = await refreshAccount();
  clear(modal.body);
  if (!r.ok) {
    modal.body.append(h('p', { class: 'error' }, tr('无法读取账号信息，请重试。', 'Unable to load your account.')), button(tr('重试', 'Retry'), () => { modal.close(); openAccount({ hub }); }));
    return;
  }
  if (current) return accountHub(modal);
  const tabs = h('div', { class: 'subtabs' });
  const pane = h('div');
  modal.body.append(h('p', { class: 'muted' }, (appCtx?.S?.state?.world?.premise===6 || appCtx?.S?.state?.world?.premise === 7) ? tr('登录后可创建、管理与查看自己的居民。', 'Sign in to create, manage and inspect your residents.') : tr('游客可自由观测城市。创建人类用户账号后，可保存个人资料。Agent 入境与造者密钥仍在「入境 / 幕后」中使用；登录状态下入境的居民会关联到账号，可在用户中心查看它们的状态与 token 用量。', 'Guests can observe the city. Human accounts store your profile. Agent entry and owner keys remain available through Enter / Backstage; residents you enter while signed in are linked to your account, where you can see their status and token usage.')), tabs, pane);
  const modes = [['login', tr('登录', 'Sign in')]];
  if (r.json.registrationOpen) modes.push(['register', tr('注册', 'Register')]);
  function show(mode) {
    challenge?.dispose();
    contactWidget?.dispose(); contactWidget = null;
    challenge = null;
    clear(pane);
    for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    const creating = mode !== 'login';
    const fields = creating ? identity() : [field(tr('用户名', 'Username'), 'username', 'text', '', { autocomplete: 'username', maxlength: 32 })];
    fields.push(creating ? password() : field(tr('密码', 'Password'), 'password', 'password', '', { autocomplete: 'current-password', maxlength: 128 }));
    if (creating) fields.push(password('confirmPassword', tr('确认密码', 'Confirm password')));
    if (creating) { contactWidget = contactVerification({ purpose: 'register', siteKey: r.json.turnstileSiteKey, channels: r.json.verificationChannels }); fields.push(contactWidget.node); }
    const challengeNode = mode === 'login' && r.json.turnstileSiteKey ? h('div', { class: 'login-turnstile', role: 'status', 'aria-live': 'polite' }) : null;
    let formChallenge = null;
    if (challengeNode) fields.push(challengeNode);
    const firstLogin = mode === 'login' ? h('div', { class: 'first-login-verification' }) : null;
    if (firstLogin) fields.push(firstLogin);
    pane.append(form(fields, modes.find(([id]) => id === mode)[1], async (body, msg) => {
      if (creating && body.password !== body.confirmPassword) return { ok: false, json: { error: { message: tr('两次密码不一致。', 'Passwords do not match.') } } };
      delete body.confirmPassword;
      if (creating) {
        if (!contactWidget.proof) return { ok: false, json: { error: { message: tr('请先验证邮箱或手机号。', 'Verify your email or phone first.') } } };
        body.proof = contactWidget.proof;
      } else if (contactWidget?.proof) body.proof = contactWidget.proof;
      if (challengeNode) {
        body.turnstileToken = formChallenge?.token() || '';
        if (!body.turnstileToken) return { ok: false, json: { error: { message: tr('请完成人机验证后重试。', 'Complete verification and try again.') } } };
      }
      const result = await request(`/api/account/${mode}`, body);
      if (challengeNode) formChallenge?.reset();
      if (result.status === 428 && !contactWidget) {
        contactWidget = contactVerification({ purpose: 'first_login', siteKey: r.json.turnstileSiteKey, channels: r.json.verificationChannels });
        firstLogin.append(h('p', { class: 'muted' }, tr('首次登录，请验证邮箱或手机号。', 'Verify an email or phone before your first sign-in.')), contactWidget.node);
      }
      if (result.ok) { await refreshAccount(); modal.close(); if (hub) openAccount(); }
      return result;
    }));
    if (mode === 'login') pane.append(h('a', { href: '/login.html?mode=recover', class: 'login-forgot' }, tr('忘记密码？', 'Forgot password?')));
    if (challengeNode) challenge = formChallenge = mountLoginChallenge(challengeNode, r.json.turnstileSiteKey);
  }
  for (const [id, label] of modes) tabs.append(h('button', { type: 'button', class: 'btn', dataset: { mode: id }, onClick: () => show(id) }, label));
  show('login');
}
/** 用户中心：身份、去往各功能区的入口、退出登录。第六前提以前的世界在这里列出关联的居民（进入幕后要用观测站的上下文）。 */
function accountHub(modal) {
  const u = current, p6 = (appCtx?.S?.state?.world?.premise === 6 || appCtx?.S?.state?.world?.premise === 7);
  if (!p6) modal.dialog.classList.add('wide'); // 「我的居民」是一张表，要宽一些
  modal.body.append(h('div', { class: 'account-summary' }, initialBadge(u), h('div', null, h('h3', null, u.displayName), h('p', { class: 'muted' }, `@${u.username} · ${roleName(u)}`))));
  const links = [];
  links.push(['/messages.html', tr('留言板', 'Message board'), tr('与其他用户交流想法，查看留言与回复', 'Share ideas with other users and read messages and replies')]);
  if (p6) links.push(['/residents.html', tr('我的居民', 'My residents'), tr('查看居民状态，创建居民并配置模型', 'See how your residents are doing, create residents and set up models')]);
  if (p6) links.push(['/billing.html', tr('余额与充值', 'Balance & top-up'), tr('平台托管模型的余额、购买额度与记录', 'Hosted model balance, top-ups and records')]);
  links.push(['/account.html', tr('账户设置', 'Account settings'), tr('昵称、密码与祈愿操作记录', 'Display name, password and prayer records')]);
  if (u.role === 'admin') links.push(['/admin.html#announcements', tr('公告管理', 'Announcements'), tr('发布、编辑和撤下网页与微信端公告', 'Publish, edit and withdraw shared announcements')]);
  if (u.role === 'admin') links.push(['/admin.html', tr('管理后台', 'Admin console'), tr('用户、充值审核、托管配置、实验运行与服务器状态', 'Users, top-up review, hosted model, experiment and server status')]);
  const entries = links.map(([href, title, note]) => h('a', { class: 'hub-link', href }, h('strong', null, title), h('span', { class: 'muted' }, note)));
  modal.body.append(h('nav', { class: 'hub-links', 'aria-label': tr('功能入口', 'Sections') }, entries));
  if (u.role === 'admin') api('/api/admin/hosted').then((r) => { // 有待处理的入账申请时，直接写在「管理后台」入口上
    const n = r.ok && Array.isArray(r.json?.requests) ? r.json.requests.length : 0;
    if (n > 0) entries.at(-1).append(h('span', { class: 'hub-alert' }, tr(`${n} 笔入账申请待处理`, `${n} pending top-up request${n > 1 ? 's' : ''}`)));
  });
  if (!p6) modal.body.append(accountAgentsPanel({ openBackstage: (key) => { modal.close(); openBackstage(appCtx, key); }, savedOwners }));
  const logoutMessage = h('p', { role: 'status', class: 'error' });
  modal.body.append(h('div', { class: 'form-actions hub-actions' }, button(tr('退出登录', 'Sign out'), async () => {
    const r = await signOut();
    if (r.ok) modal.close();
    else logoutMessage.textContent = errorText(r, tr('退出失败，请重试。', 'Sign out failed. Please retry.'));
  })), logoutMessage);
}
/** 账户设置：个人资料与修改密码（account.html） */
export function settingsPanel(user) {
  const root = h('div', { class: 'settings-grid' });
  const redraw = async updated => { await refreshAccount(); clear(root).append(...Array.from(settingsPanel(updated).childNodes)); };
  const profile = form([field(tr('昵称', 'Display name'), 'displayName', 'text', user.displayName, { maxlength: 60 })], tr('保存资料', 'Save profile'), async (body, msg) => {
    const r = await request('/api/account', body, 'PATCH');
    if (r.ok) { await refreshAccount(); msg.textContent = tr('资料已保存。', 'Profile saved.'); }
    return r;
  });
  const change = form([password('currentPassword', tr('当前密码', 'Current password')), password(), password('confirmPassword', tr('确认新密码', 'Confirm new password'))], tr('更新密码', 'Update password'), async (body, msg) => {
    if (body.password !== body.confirmPassword) return { ok: false, json: { error: { message: tr('两次新密码不一致。', 'New passwords do not match.') } } };
    delete body.confirmPassword;
    const r = await request('/api/account', body, 'PATCH');
    if (r.ok) { change.reset(); msg.textContent = tr('密码已更新，其他登录会话已失效。', 'Password updated. Other sessions have been signed out.'); }
    return r;
  });
  const contacts = h('section', { class: 'card-panel' }, h('h2', null, tr('验证联系方式', 'Verified contacts')));
  for (const [kind, label] of [['email', tr('邮箱', 'Email')], ['phone', tr('手机号', 'Phone')]]) {
    if (!user.contacts?.[kind]) continue;
    contacts.append(h('div', { class: 'contact-row' }, h('span', null, label), h('strong', null, user.contacts[kind])));
    if (user.passwordLoginEnabled) contacts.append(form([password('currentPassword', tr('当前密码', 'Current password'))], tr('解除' + label, 'Remove ' + label), async (body, msg) => {
      const r = await request(`/api/account/contacts/${kind}`, body, 'DELETE');
      if (r.ok) await redraw(r.json.user);
      return r;
    }));
  }
  if (user.passwordLoginEnabled) {
    const widget = contactVerification({ purpose: 'contact', channels: verificationChannels });
    contacts.append(h('h3', null, tr('添加或更换', 'Add or replace')), widget.node,
      form([password('currentPassword', tr('当前密码', 'Current password'))], tr('保存联系方式', 'Save contact'), async (body) => {
        if (!widget.proof) return { ok: false, json: { error: { message: tr('请先验证新联系方式。', 'Verify the new contact first.') } } };
        const r = await request('/api/account/contacts', { ...body, proof: widget.proof });
        if (r.ok) await redraw(r.json.user);
        return r;
      }));
  } else contacts.append(h('p', { class: 'muted' }, tr('请在微信端验证联系方式，再设置网页登录密码。', 'Verify a contact in WeChat, then set a web password.')));
  const wechat = h('section', { class: 'card-panel' }, h('h2', null, tr('微信关联', 'WeChat linking')));
  const apps = user.wechatApps || [];
  if (!apps.length) wechat.append(h('p', null, tr('尚未关联微信。', 'WeChat is not linked.')));
  for (const appid of apps) {
    const name = appid.startsWith('wx') ? `${tr('微信应用', 'WeChat app')} · ${appid}` : appid;
    wechat.append(h('p', null, name));
    if (user.passwordLoginEnabled && Object.keys(user.contacts || {}).length) wechat.append(form([password('currentPassword', tr('当前密码', 'Current password'))], tr('解除此项绑定', 'Unlink this app'), async body => {
      const r = await request(`/api/account/wechat/${encodeURIComponent(appid)}`, body, 'DELETE');
      if (r.ok) await redraw(r.json.user);
      return r;
    }));
  }
  if (apps.length && (!user.passwordLoginEnabled || !Object.keys(user.contacts || {}).length)) wechat.append(h('p', { class: 'muted' }, tr('请先验证联系方式并启用密码登录，再解除微信绑定。', 'Verify a contact and enable password sign-in before unlinking WeChat.')));
  wechat.append(h('p', { class: 'muted' }, tr('在微信端可关联现有网站账号；已有两个账号时，请先验证两端身份并合并。', 'Link an existing web account in WeChat. If you have two accounts, verify both before merging them.')));
  root.append(
    h('section', { class: 'card-panel' }, h('h2', null, tr('个人资料', 'Profile')), h('p', { class: 'muted' }, `@${user.username} · ${roleName(user)}`), profile),
    h('section', { class: 'card-panel' }, h('h2', null, tr('修改密码', 'Change password')), user.passwordLoginEnabled ? h('p', { class: 'muted' }, tr('更新后，其他设备上的登录会失效。', 'Other sessions are signed out after the change.')) : h('p', { class: 'muted' }, tr('请先在微信端启用密码登录。', 'Enable password sign-in in WeChat first.')), user.passwordLoginEnabled ? change : null),
    contacts,
    wechat,
    h('section', { class: 'card-panel wide' }, prayerAuditPanel()));
  return root;
}
