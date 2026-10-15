// 管理后台（admin.html）：左侧分组导航，右侧一次只显示一块。只对管理员显示内容；接口本身也都要求管理员会话。
// 地址里的 #编号 决定显示哪一块（如 admin.html#topups），可以收藏或分享给其他管理员。

import { announcementsPanel } from './announcements-admin.js';
import { h, clear } from './dom.js';
import { reportsPanel } from './reports-admin.js';
import { mountShell, tr, pageHead, emptyState, setNotice, setBadge, reportPending, watchPending } from './console-ui.js';
import { initAccounts, refreshAccount, openAccount } from './accounts.js';
import { serverStatusPanel, usersPanel, supportQrPanel } from './admin-panels.js';
import { snapshotsPanel } from './snapshots-ui.js';
import { experimentPanel } from './experiment-ui.js';
import { adminUsageView } from './account-usage-ui.js';
import { adminInventionsPanel } from './inventions-ui.js';
import { hostedConfigPanel, hostedBillingPanel, publicModelPanel } from './hosted-admin.js';

/** 侧栏的分组：[组名, [[编号, 标题, 说明, (导航) => 根节点]]] */
export function adminSections() {
  return [
    [tr('运行', 'Operations'), [
      ['server', tr('服务器状态', 'Server status'), tr('CPU、内存、网络与注册用户数，每 10 秒刷新。', 'CPU, memory, network and registered users; refreshes every 10 seconds.'), () => serverStatusPanel()],
      ['experiment', tr('实验运行', 'Experiment'), tr('暂停或恢复整座城市的时间、结算与居民行动。', 'Pause or resume world time, settlement and resident actions.'), () => experimentPanel()],
      ['snapshots', tr('世界快照', 'World snapshots'), tr('保存当前纪元的完整存档，城市继续运行。', 'Save a full archive of the current era while the city keeps running.'), () => snapshotsPanel()],
    ]],
    [tr('用户与充值', 'Users & billing'), [
      ['users', tr('用户管理', 'Users'), tr('搜索、创建与编辑人类账号。', 'Search, create and edit human accounts.'), () => usersPanel()],
      ['topups', tr('充值审核', 'Top-up review'), tr('核对入账申请、手动调整余额、查看各账号的余额与累计用量；新申请每 30 秒自动检查一次。', 'Review top-up requests, adjust balances and see account balances; new requests are checked every 30 seconds.'), () => hostedBillingPanel({ onPending: reportPending })],
    ]],
    [tr('模型', 'Models'), [
      ['reports', tr('AI 史官', 'AI chronicler'), tr('世界报告的专用模型、独立额度与历史补生成。', 'Report model, separate budget and past report generation.'), () => reportsPanel()],
      ['hosted', tr('平台托管', 'Hosted model'), tr('平台托管 DeepSeek 的开放状态、接口、单价与今日统计。', 'Hosted DeepSeek availability, endpoint, prices and today’s statistics.'), () => hostedConfigPanel()],
      ['usage', tr('托管用量', 'Hosted usage'), tr('所有托管居民的 token 用量、全城合计与近 14 日走势。', 'Token usage of every hosted resident, city totals and the last 14 days.'), () => { const root = h('div'); adminUsageView(root); return root; }],
      ['public-model', tr('公共角色模型', 'Public role model'), tr('公共角色回答居民提问时使用的共享模型与独立预算。', 'The shared model and separate budget public roles use to answer residents.'), () => publicModelPanel()],
    ]],
    [tr('内容与支持', 'Content & support'), [
      ['announcements', tr('公告管理', 'Announcements'), tr('发布、编辑与撤下网站和微信端共用的公告。', 'Publish, edit and withdraw announcements shared by the website and WeChat.'), () => announcementsPanel()],
      ['inventions', tr('发明认定', 'Invention review'), tr('审核居民提交的发明，查看全部祈愿操作记录。', 'Review submitted inventions and all prayer actions.'), () => adminInventionsPanel()],
      ['support', tr('收款码', 'QR codes'), tr('支持页打赏与「余额与充值」购买额度共用的微信、支付宝收款码。', 'WeChat and Alipay QR codes shared by the support page and hosted top-ups.'), () => supportQrPanel()],
    ]],
  ];
}

/** 挂载管理后台。返回 { show(编号) }，测试与 hashchange 用它切换。 */
export async function mountAdmin({ header, app }) {
  mountShell(header, { active: 'admin' });
  const message = h('p', { class: 'page-message', role: 'status', 'aria-live': 'polite' });
  setNotice((text) => { message.textContent = text; });
  const badges = new Map();
  let links = new Map(), body = null, head = null, shown = null;
  const all = () => adminSections().flatMap(([, items]) => items);
  const nav = {
    badge(id, n) {
      badges.set(id, n);
      setBadge(links.get(id)?.querySelector('.nav-badge'), n);
    },
  };
  watchPending((n) => nav.badge('topups', n)); // 顶栏每 30 秒检查一次；充值审核面板读到的也会报上来
  function show(id) {
    if (!body) return;
    const item = all().find(([key]) => key === id) ?? all()[0];
    shown = item[0];
    for (const [key, link] of links) link.setAttribute('aria-current', key === shown ? 'page' : 'false');
    message.textContent = '';
    pageHead(head, { eyebrow: tr('管理后台', 'Admin console'), title: item[1], lead: item[2] });
    const panel = item[3](nav);
    clear(body).append(panel); // 旧的一块离开页面，它的定时刷新随之停止
  }
  async function render() {
    clear(app).append(h('p', { class: 'muted' }, tr('正在加载…', 'Loading…')));
    body = null;
    const r = await refreshAccount({ notify: false });
    const user = r.ok ? r.json.user : null;
    clear(app);
    if (!r.ok) { app.append(emptyState(tr('无法读取账号信息', 'Unable to load your account'), tr('请检查网络后刷新页面。', 'Check your connection and reload.'))); return; }
    if (!user) { app.append(emptyState(tr('请先登录', 'Please sign in'), tr('管理后台只对管理员开放。', 'The admin console is for administrators only.'), h('button', { type: 'button', class: 'btn primary', onClick: () => openAccount({ hub: false }) }, tr('登录', 'Sign in')))); return; }
    if (user.role !== 'admin') { app.append(emptyState(tr('没有管理权限', 'Administrators only'), tr('当前账号不是管理员。需要权限请联系现有管理员。', 'This account is not an administrator. Ask an existing administrator for access.'), h('a', { class: 'btn', href: '/residents.html' }, tr('前往我的居民', 'Go to my residents')))); return; }
    links = new Map();
    const side = h('nav', { class: 'admin-nav', 'aria-label': tr('管理功能', 'Admin sections') });
    for (const [group, items] of adminSections()) {
      side.append(h('p', { class: 'admin-nav-group' }, group));
      for (const [id, title] of items) {
        const badge = h('span', { class: 'nav-badge', hidden: !(badges.get(id) > 0) }, badges.get(id) > 0 ? String(badges.get(id)) : '');
        const link = h('a', { href: `#${id}`, class: 'admin-nav-link' }, h('span', null, title), badge);
        links.set(id, link);
        side.append(link);
      }
    }
    head = h('div', { class: 'admin-head' });
    body = h('div', { class: 'admin-body' });
    app.append(h('div', { class: 'admin-layout' }, h('aside', { class: 'admin-side' }, side), h('div', { class: 'admin-content' }, head, message, body)));
    show(typeof location === 'undefined' ? 'server' : location.hash.slice(1));
  }
  initAccounts(null, { onAccountChange: () => render() });
  await render();
  return { show, get shown() { return shown; } };
}

const header = typeof document !== 'undefined' ? document.getElementById('console-header') : null;
const app = typeof document !== 'undefined' ? document.getElementById('admin-app') : null;
if (header && app) {
  const admin = await mountAdmin({ header, app });
  window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== admin.shown) admin.show(id); });
}
