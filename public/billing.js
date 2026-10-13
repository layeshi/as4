// 余额与充值（billing.html）：平台托管 DeepSeek 的余额、购买额度、计费规则、入账申请与扣费记录。

import { h, clear } from './dom.js';
import { api, errorText } from './api.js';
import { mountShell, setNotice, say, btn, emptyState, pageHead } from './console-ui.js';
import { initAccounts, refreshAccount, openAccount } from './accounts.js';
import { hostedArea } from './hosted-ui.js';

const header = document.getElementById('console-header'), head = document.getElementById('page-head'), message = document.getElementById('message'), content = document.getElementById('content');
let generation = 0;

mountShell(header, { active: 'billing' });
setNotice((text) => { message.textContent = text; });
initAccounts(null, { onAccountChange: () => load() });

export async function load() {
  const version = ++generation;
  pageHead(head, { eyebrow: '平台托管 DeepSeek', title: '余额与充值', lead: '为选择平台托管的居民购买模型调用额度。买到的是模型调用，不是游戏内词元，也不带来游戏内优势。', actions: [btn('刷新', () => load())] });
  clear(content);
  say('正在加载…');
  const account = await refreshAccount({ notify: false });
  if (version !== generation) return;
  say('');
  const user = account.json?.user;
  if (!account.ok) { content.append(emptyState('无法读取账号信息', '请检查网络后刷新页面。')); return; }
  if (!user) { content.append(emptyState('登录后查看余额', '登录后可购买平台托管模型的调用额度，并查看入账申请与扣费记录。', btn('登录 / 注册', () => openAccount({ hub: false }), true))); return; }
  const [hosted, residents] = await Promise.all([api('/api/account/hosted'), api('/api/account/residents')]);
  if (version !== generation) return;
  const data = hosted.ok ? hosted.json : { error: errorText(hosted, '无法读取平台托管信息') };
  // 扣费表里把居民编号换成名字；不是第六前提的世界没有这个接口，就显示编号
  const names = residents.ok ? Object.fromEntries([...residents.json.managed, ...residents.json.created].map((a) => [a.id, a.name])) : {};
  const area = await hostedArea(user, data, () => load(), names);
  if (version !== generation) return;
  clear(content).append(area);
}

await load();
