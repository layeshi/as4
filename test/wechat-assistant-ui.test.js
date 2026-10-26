// 观测端导航遍历：从四个底部分栏出发点击所有可见控件（限深度），用本地测试数据代替服务器。
// 主要页面都可到达；任何页面都没有助手、居民创建与管理、模型、充值或写留言的入口；离开客户端的写入只限账户、提醒与历史打包。
import test from 'node:test';
import assert from 'node:assert/strict';
import { minigame } from './wechat-minigame-helpers.js';

const world = { id: 'p7-test', epoch: 2, premise: 7, physics: 2, ticksPerDay: 12, day: 3, tick: 40, daysPerMonth: 24, cooperation: true, cityName: '无名之城', humanCityName: { zh: '无名之城' }, nextTickAt: Date.now() + 60000 };
const cities = ['north', 'west', 'east'].map((id, i) => ({ id, short: { zh: ['北城', '西城', '东城'][i] }, humanName: { zh: ['北城', '西城', '东城'][i] }, cityName: ['北城', '西城', '东城'][i], population: { residents: 1 }, well: { outputHistory: [10] } }));
const agent = { id: 'a1', name: '石序', status: 'awake', place: 'north-port', city: 'north', energy: 1000, materials: 2, ageDays: 3, bio: '测试居民', stats: { utterances: 1 }, authors: [], children: [] };
const state = { world, cities, agents: [agent], places: [{ id: 'north-port', name: '北港', displayName: { zh: '北港' }, district: 'port', city: 'north' }], publicRoles: [], cemetery: [], retired: [], laws: [{ id: 'L1', title: '测试法', text: '法律正文', status: 'active', author: 'humans', city: 'north' }], docs: [{ id: 'd1', title: '典籍', author: { id: 'a1', name: '石序' }, reads: 1 }], groups: [], cradle: [{ id: 's1', name: '小满', soul: '一个灵魂', authors: [] }] };
const message = { id: 'm1', seq: 1, threadId: null, author: { displayName: '观察者' }, text: '一条留言', createdAt: '2026-10-14T03:00:00Z', replyCount: 1, canEdit: true, canDelete: true };
function respond(path) {
  const p = path.split('?')[0];
  if (p === '/api/wechat/public/state') return structuredClone(state);
  if (p === '/api/wechat/public/map') return { places: [], size: [10, 10] };
  if (p === '/api/wechat/public/events') return { events: [{ seq: 1, tick: 40, day: 3, type: 'say', agent: 'a1', place: 'north-port', data: { text: '你好' } }] };
  if (p === '/api/wechat/public/chronicle') return { chronicle: [] };
  if (p === '/api/wechat/public/lore') return { physicsP4: '物理定律' };
  if (p === '/api/wechat/public/agents/a1') return { agent: structuredClone(agent), events: [], memories: [], thoughts: [], inscriptions: [] };
  if (p.startsWith('/api/wechat/public/laws/') || p.startsWith('/api/wechat/public/docs/') || p.startsWith('/api/wechat/public/places/')) return { id: 'x', title: '档案', body: '正文', text: '正文', status: 'active' };
  if (p === '/api/wechat/public/metrics') return { metrics: [] };
  if (p === '/api/wechat/public/attention') return { days: [] };
  if (p === '/api/wechat/public/weather') return { weather: null };
  if (p === '/api/wechat/public/legacy') return { legacy: null };
  if (/\/api\/wechat\/public\/(?:services|demands|orders|research|projects|observations)$/.test(p)) return [];
  if (p === '/api/wechat/public/materials') return { zones: {} };
  if (p === '/api/wechat/public/cooperation') return { items: [], next: null };
  if (p === '/api/account') return { user: { id: 'u1', username: 'alice', displayName: '观察者', role: 'user', wechatApps: ['wx216f3fb724629f67'], contacts: {} }, registrationOpen: false };
  if (p === '/api/wechat/status') return { enabled: true, linked: true, verified: true };
  if (p === '/api/wechat/residents') return { managed: [{ agentId: 'a1', name: '石序', status: 'awake', runnerStatus: 'running' }], created: [] };
  if (p === '/api/wechat/residents/a1') return { resident: { name: '石序' }, overview: { energy: 1000, basic: 10, materials: 2, dailyCap: 880000, usedToday: 10, runner: { status: 'running' } }, usage: { total: {}, days: [], recent: [] }, statistics: { totals: {}, days: {}, ledger: [], actions: {} } };
  if (p === '/api/wechat/residents/a1/private') return { soul: '灵魂', diary: [{ text: '日记' }], memories: [], letters: [{ text: '已存家书', day: 1 }], inbox: [] };
  if (p === '/api/wechat/residents/a1/events') return { events: [], cursor: null };
  if (p === '/api/reports') return { reports: [{ id: 'r1', kind: 'day', fromDay: 1, toDay: 1, status: 'ready', title: '日报', worldId: 'p7-test', branchId: 'branch-1' }], total: 1 };
  if (p === '/api/reports/r1') return { id: 'r1', kind: 'day', fromDay: 1, toDay: 1, worldId: 'p7-test', epoch: 2, branchId: 'branch-1', content: { title: '日报', overview: '概述', facts: [], analysis: [] }, sources: [] };
  if (p === '/api/history/branches') return { branches: [{ id: 'branch-1', worldId: 'p7-test', active: true, residents: [{ id: 'a1', name: '石序' }] }] };
  if (p === '/api/history/exports') return { exports: [{ id: '0b1c2d3e-aaaa', name: '石序', status: 'failed', fromDay: 0, toDay: 2, worldId: 'p7-test', branchId: 'branch-1' }] };
  if (p === '/api/announcements' ) return { announcements: [{ id: 'n1', title: '公告', body: '内容', publishedAt: '2026-10-20T00:00:00Z' }], total: 1 };
  if (p === '/api/announcements/latest') return { announcement: null };
  if (p.startsWith('/api/announcements/')) return { announcement: { id: 'n1', title: '公告', body: '内容' } };
  if (p === '/api/wechat/notifications') return { types: [{ key: 'diary', label: '新日记', templateId: 'T', available: true }], residents: [], bindingReady: true };
  if (p === '/api/wechat/notifications/records') return { records: [{ id: 'r1', agentId: 'a1', kind: 'diary', createdAt: Date.now() }], hasMore: false };
  if (p === '/api/wechat/messages') return { messages: [structuredClone(message)], total: 1, nextCursor: null };
  if (p === '/api/wechat/messages/m1/replies') return { messages: [{ ...message, id: 'm2', seq: 2, threadId: 'm1', text: '回复' }], root: structuredClone(message), total: 1, nextCursor: null };
  return { ok: true };
}

const REMOVED_ACTION = /^(?:assistant|steward|entry$|create|letter$|runner$|disconnect$|provider$|preset$|modelChoice$|modelTest$|modelSave$|messageCompose$|messageDelete$|messageSubmit$|messageCancel$)/;
const REMOVED_LABEL = /实验助手|询问|向实验提问|API Key|测试连接|保存配置|接口地址|模型服务商|让一位居民入城|成为造者|创建居民|送出家书|写给它的话|领养|发起过继|接受并配置模型|余额与托管|购买额度|入账申请|发表留言|回复主留言|托管运行|更新上限|移除配置/;
const ALLOWED_WRITES = /^(?:POST \/api\/account\/(?:logout|contacts|verification\/(?:request|confirm))|DELETE \/api\/account\/contacts\/(?:email|phone)|PATCH \/api\/account|DELETE \/api\/account\/wechat\/wx[0-9a-f]{16}|POST \/api\/wechat\/(?:login|password-login|password|merge\/preview|merge\/confirm|notifications\/(?:preferences|authorization|authorization\/result|records\/read))|POST \/api\/history\/exports(?:\/[a-f0-9-]+\/retry)?)$/;
const FORBIDDEN_READ = /\/api\/(?:assistant|admin|me|owner|runner|port\/model)(?:[/?]|$)|model-presets|\/account\/(?:hosted|transfers|worlds)/;
// 会离开当前账号、调用系统能力或只改本机设置的动作单独覆盖；遍历时不点。
const SKIP = new Set(['logout', 'field', 'wechatLogin', 'auth', 'previewMerge', 'confirmMerge', 'saveWebPassword', 'sendContactCode', 'verifyContactCode', 'clearCache', 'pref', 'notificationAuthorize', 'start']);

test('every reachable page is observation-only: no removed controls or labels, and writes stay in the allowed set', async () => {
  const m = minigame({ respond }), g = m.game, sent = [];
  const original = m.wx.request;
  m.wx.request = options => { const url = new URL(options.url); sent.push((options.method || 'GET') + ' ' + url.pathname + url.search); return original(options); };
  Object.assign(m.wx, { setClipboardData: o => o.success && o.success(), login: o => o.success({ code: 'test-code' }), downloadFile: o => o.success({ statusCode: 200, tempFilePath: '/tmp/x' }), shareFileMessage() {} });
  g.prefs.autoRefresh = false;
  await g.start(); await g.dispatch({ type: 'start' }); await g.dispatch({ type: 'tab', tab: 'account' });
  assert.equal(g.user?.id, 'u1'); assert.equal(g.wechatVerified, true);
  const reached = new Set(), tapped = new Map(), problems = [];
  const inspect = () => {
    g.invalidate(); g.render();
    reached.add(g.tab);
    for (const h of g.hits) if (REMOVED_ACTION.test(h.action.type)) problems.push(`${g.tab}: control ${h.action.type}`);
    for (const b of g.blocks) if (REMOVED_LABEL.test(b.text || '')) problems.push(`${g.tab}: label ${b.text}`);
    if (REMOVED_LABEL.test(g.page.top?.title || '')) problems.push(`${g.tab}: title ${g.page.top.title}`);
    return g.hits.map(h => h.action).filter(a => !SKIP.has(a.type));
  };
  const actionsHere = () => {
    const all = [];
    for (let y = 0; y <= g.scroller().max + 400; y += 400) { g.scroller().scrollTo(y); all.push(...inspect()); }
    g.scroller().scrollTo(0);
    return [...new Map(all.map(a => [JSON.stringify(a), a])).values()];
  };
  async function explore(depth) {
    for (const action of actionsHere()) {
      const key = g.tab + ' ' + JSON.stringify(action);
      if ((tapped.get(key) ?? -1) >= depth || tapped.size > 800) continue;
      tapped.set(key, depth);
      const before = { tab: g.tab, stack: g.stack.slice(), sheet: g.sheet, records: g.records.tab };
      await g.dispatch(action);
      if (g.sheet) { inspect(); g.sheet = null; }
      const moved = g.tab !== before.tab;
      if (moved && depth > 0) await explore(depth - 1);
      if (moved) { g.tab = before.tab; g.stack = before.stack; g.navigation++; }
      g.records.tab = before.records;
    }
  }
  for (const tab of ['city', 'residents', 'archive', 'account']) {
    await g.dispatch({ type: 'tab', tab });
    if (tab === 'archive') for (const sub of ['chronicle', 'laws', 'docs', 'groups', 'cradle']) { await g.dispatch({ type: 'archive', tab: sub }); await explore(3); }
    else await explore(3);
  }
  // 本人居民记录的每个分页。
  await g.dispatch({ type: 'owner', id: 'a1' });
  for (const tab of ['overview', 'ledger', 'actions', 'usage', 'timeline']) { await g.dispatch({ type: 'recordsTab', tab }); await explore(1); }
  for (const page of ['city', 'residents', 'archive', 'account', 'resident', 'detail', 'owner', 'notifications', 'notificationRecords', 'messages', 'messageThread', 'announcements', 'reports', 'worldReport', 'exports', 'historyExport', 'metrics', 'weather', 'market', 'materials', 'cooperation', 'profile', 'settings', 'about', 'webLogin', 'mergeAccount']) {
    assert.ok(reached.has(page), 'unreachable page: ' + page + ' (reached ' + [...reached].join(',') + ')');
  }
  assert.deepEqual(problems, []);
  const writes = sent.filter(r => !r.startsWith('GET ')).map(r => r.split('?')[0]);
  assert.deepEqual(writes.filter(r => !ALLOWED_WRITES.test(r)), [], 'only allowed writes leave the client');
  assert.ok(writes.some(r => r.startsWith('POST /api/history/exports')), 'history packaging stays reachable');
  assert.ok(writes.some(r => r === 'POST /api/wechat/notifications/preferences'), 'reminder settings stay reachable');
  assert.deepEqual(sent.filter(r => FORBIDDEN_READ.test(r)), []);
  assert.ok(!sent.some(r => /\/residents\/a1\/(?:letter|runner|cap|transfer|avatar)|\/residents\/adopt|\/api\/(?:wechat\/)?messages(?:\/m\d)?(?:\/replies)?$/.test(r.split('?')[0]) && !r.startsWith('GET ')));
});

test('the account page explains the observation scope and keeps identity, reminders, history and settings entries', async () => {
  const m = minigame({ respond }), g = m.game;
  g.prefs.autoRefresh = false;
  await g.start(); await g.dispatch({ type: 'start' }); await g.dispatch({ type: 'tab', tab: 'account' });
  g.invalidate(); g.render();
  const text = g.blocks.map(b => b.text || '').join('\n'), types = new Set(g.hits.map(h => h.action.type));
  for (let y = 0; y <= g.scroller().max + 400; y += 400) { g.scroller().scrollTo(y); g.render(); g.hits.forEach(h => types.add(h.action.type)); }
  for (const type of ['owner', 'notifications', 'notificationRecords', 'profile', 'webLogin', 'mergeAccount', 'historyRecords', 'messages', 'announcements', 'settings', 'about', 'support', 'logout']) assert.ok(types.has(type), type);
  assert.match(text, /AI 社会模拟实验已有的记录/); assert.match(text, /AI 生成的文字标有来源/);
  g.user = null; g.wechatVerified = false; g.invalidate(); g.render();
  const guest = g.blocks.map(b => b.text || '').join('\n');
  assert.match(guest, /登录后可查看你账号下已有居民的概况与记录/);
  assert.ok(!/写下灵魂|接入模型|写家书|启动词元/.test(guest));
  g.tab = 'about'; g.invalidate(); g.render();
  const about = g.blocks.map(b => b.text || '').join('\n');
  assert.match(about, /由 AI 在实验中生成/); assert.match(about, /内容安全服务检查/);
  assert.ok(!/模型 API Key|实验助手时|测试和运行可能产生调用费用/.test(about));
  assert.ok(!/不涉及\s*AI|不含\s*AI/.test(about), 'the notice never claims there is no AI');
});
