// 账户设置（account.html）：个人资料、修改密码、我的祈愿操作记录。

import { clear } from './dom.js';
import { mountShell, setNotice, say, btn, emptyState, pageHead, tr } from './console-ui.js';
import { initAccounts, refreshAccount, openAccount, settingsPanel } from './accounts.js';

const header = document.getElementById('console-header'), head = document.getElementById('page-head'), message = document.getElementById('message'), content = document.getElementById('content');
let generation = 0;

mountShell(header, { active: 'account' });
setNotice((text) => { message.textContent = text; });
initAccounts(null, { onAccountChange: () => load() });

export async function load() {
  const version = ++generation;
  pageHead(head, { eyebrow: tr('账户', 'Account'), title: tr('账户设置', 'Account settings'), lead: tr('管理联系方式、登录方式与祈愿操作记录。', 'Manage contacts, sign-in methods, and prayer records.') });
  clear(content);
  say(tr('正在加载…', 'Loading…'));
  const account = await refreshAccount({ notify: false });
  if (version !== generation) return;
  say('');
  const user = account.json?.user;
  if (!account.ok) { content.append(emptyState(tr('无法读取账号信息', 'Unable to load your account'), tr('请检查网络后刷新页面。', 'Check your connection and reload.'))); return; }
  if (!user) { content.append(emptyState(tr('请先登录', 'Please sign in'), tr('登录后可以修改昵称与密码。', 'Sign in to change your display name and password.'), btn(tr('登录 / 注册', 'Sign in / Register'), () => openAccount({ hub: false }), true))); return; }
  content.append(settingsPanel(user));
}

await load();
