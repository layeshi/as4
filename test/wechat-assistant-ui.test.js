import test from 'node:test';
import assert from 'node:assert/strict';
import { minigame } from './wechat-minigame-helpers.js';

const now = new Date().toISOString();
const status = () => ({ signedIn: true, available: true, quota: { remaining: 18, limit: 20 }, world: { id: '世界', epoch: 2, day: 11, paused: true, cities: [{ id: 'north', name: '北城' }] }, branches: [
  { id: 'current', active: true, premise: 7, worldId: '世界', epoch: 2, residents: [{ id: 'a', name: '乙居民', managed: true }, { id: 'b', name: '甲居民', managed: false }] },
  { id: '75b643ab-history', active: false, premise: 4, worldId: '旧世界', epoch: 1, residents: [] },
], conversations: [{ id: 'c', title: '三城公库最近为什么差这么多？', updatedAt: now }] });
const conversation = () => ({ id: 'c', title: '三城公库最近为什么差这么多？', messages: [
  { id: 'u', role: 'user', status: 'complete', text: '问题\n第二行' },
  { id: 'm', role: 'assistant', status: 'complete', text: '# 结论\n' + '已审核正文 [S1]。\n'.repeat(70), sources: [{ id: 's', label: 'S1', title: '北城公库' }], observation: { day: 11, observedAt: now } },
] });
function setup(options = {}) {
  const m = minigame(options), g = m.game;
  g.user = { id: 'alice' }; g.entered = true; g.tab = 'assistant'; g.assistant.sync(); g.assistant.status = status();
  const path = name => new URL('../wechat/minigame/' + name + '.js', import.meta.url).pathname;
  const screens = m.load(path('screens/assistant')), N = m.load(path('ui/nodes'));
  const render = () => { m.drawn.length = 0; g.invalidate(); g.render(); return JSON.stringify(g.blocks); };
  const sheet = kind => {
    g.sheet = { kind }; const blocks = [], hits = [];
    N.begin(g.ctx, blocks); const nodes = screens.assistantSheet(g, g.width - 36);
    const graphics = { ctx: g.ctx, pressed: () => false, hit: (x, y, w, h, action) => hits.push({ x, y, w, h, action }), horizontal() {} };
    N.stack(nodes, 12).paint(graphics, 18, 0);
    return { text: JSON.stringify(blocks), blocks, hits };
  };
  return { ...m, g, a: g.assistant, screens, N, render, sheet };
}

test('three assistant views use in-tab back actions, footer visibility and restore conversation scroll without clearing keys', async () => {
  const m = setup({ respond: path => path.includes('/sources/') ? { source: { id: 's', title: '北城公库', text: '{\n  "treasury": 1234\n}', worldId: '世界', epoch: 2, day: 11, observedAt: now } } : { conversation: conversation() } });
  const { g, a, render } = m;
  assert.match(render(), /向实验提问/); assert.equal(g.page.top.title, '实验助手'); assert.equal(g.page.top.back, undefined); assert.ok(g.page.footer);
  g.form.assistantAdminKey = 'secret'; const navigation = g.navigation;
  await a.handle({ type: 'assistantSession', id: 'c' });
  assert.equal(g.page.top.back.type, 'assistantList'); assert.equal(g.page.top.title, conversation().title);
  assert.ok(g.scroller().max > 0); assert.equal(g.scroller().offset, g.scroller().max);
  g.scroller().scrollTo(121);
  await a.handle({ type: 'assistantSource', id: 's' });
  assert.equal(g.page.top.title, '依据 S1'); assert.equal(g.page.top.back.type, 'assistantCloseSource'); assert.equal(g.page.footer, undefined); assert.equal(g.scroller().offset, 0);
  assert.ok(m.drawn.includes('  "treasury": 1234')); assert.match(JSON.stringify(g.blocks), /世界 世界 · 第 2 纪 · 第 12 日 · 截至/);
  await a.handle(g.page.top.back); assert.equal(g.scroller().offset, 121); assert.ok(g.page.footer);
  await a.handle(g.page.top.back); assert.equal(a.conversation, null); assert.equal(g.page.top.title, '实验助手');
  assert.equal(g.tab, 'assistant'); assert.equal(g.navigation, navigation); assert.equal(g.form.assistantAdminKey, 'secret');
  assert.ok(g.hits.some(h => h.action.type === 'back'));
});

test('list renders every session in one card and guest has no composer', () => {
  const { g, a, render, N } = setup();
  a.status.conversations = Array.from({ length: 100 }, (_, i) => ({ id: String(i), title: '第 ' + i + ' 段对话', updatedAt: '2026-10-17T01:26:00Z' }));
  render(); assert.equal(g.blocks.filter(b => b.text?.includes('段对话')).length, 100);
  const hits = [], gfx = { ctx: g.ctx, pressed: () => false, hit: (x, y, w, h, action) => hits.push({ w, h, action }) };
  N.stack(g.page.nodes).paint(gfx, 0, 0);
  assert.equal(hits.filter(h => h.action?.type === 'assistantSession').length, 100);
  assert.ok(hits.every(h => h.h >= 44));
  a.status.conversations = []; assert.doesNotMatch(render(), /最近的对话/);
  a.loading = true; assert.match(render(), /正在读取/);
  g.user = null; assert.match(render(), /登录后向实验提问/); assert.equal(g.page.footer, undefined);
});

test('scope summary follows the website, separates carried tags and supports all date forms', () => {
  const { g, a, screens, render } = setup();
  const summary = () => screens.summaryText(g);
  assert.equal(summary(), '范围：全部公开记录');
  a.scope.agentId = 'a'; a.scope.lawId = 'l8'; assert.equal(summary(), '范围：全部公开记录');
  render(); assert.ok(g.hits.some(h => h.action.type === 'assistantScope' && h.action.key === 'agentId'));
  assert.ok(g.hits.some(h => h.action.type === 'assistantScope' && h.action.key === 'lawId'));
  a.scope.mode = 'resident'; a.scope.city = 'north'; g.form.assistantFrom = '10'; g.form.assistantTo = '12';
  assert.equal(summary(), '我的居民私人记录 · 北城 · 第 10–12 日');
  g.form.assistantTo = '10'; assert.match(summary(), /第 10 日$/);
  delete g.form.assistantTo; assert.match(summary(), /第 10 日起$/);
  delete g.form.assistantFrom; g.form.assistantTo = '12'; assert.match(summary(), /至第 12 日$/);
  a.scope.branchId = '75b643ab-history'; assert.match(summary(), /历史分支 75b643ab/);
});

test('scope controls follow role, branch premise, managed residents and preserve missing selections', async () => {
  const { g, a, sheet } = setup();
  let s = sheet('assistantScope'); assert.match(s.text, /公开记录/); assert.match(s.text, /我的居民/); assert.doesNotMatch(s.text, /管理员研究|造者密钥|管理密钥|assistantResidentId/);
  a.scope.mode = 'resident'; s = sheet('assistantScope'); assert.match(s.text, /全部居民/); assert.match(s.text, /乙居民/); assert.doesNotMatch(s.text, /甲居民/);
  a.scope.agentId = 'missing'; s = sheet('assistantScope');
  assert.deepEqual(s.blocks.filter(b => b.kind === 'filter' && b.action.key === 'agentId').map(b => b.text), ['全部居民', 'missing', '乙居民']);
  a.status.branches[0].residents[0].managed = false; sheet('assistantScope'); assert.equal(a.scope.mode, 'public');
  a.scope.branchId = '75b643ab-history'; a.scope.mode = 'resident'; s = sheet('assistantScope');
  assert.match(s.text, /造者密钥/); assert.ok(!s.hits.some(h => h.action?.key === 'agentId'));
  delete a.status.branches[1].premise; assert.match(sheet('assistantScope').text, /造者密钥/);
  g.user.role = 'admin'; a.scope.mode = 'research'; s = sheet('assistantScope'); assert.match(s.text, /管理员研究|管理密钥/); assert.doesNotMatch(s.text, /造者密钥/);
  a.scope.lawId = 'l8'; g.form.assistantFrom = '2'; g.form.assistantTo = '9'; g.form.assistantAdminKey = 'admin'; g.form.assistantOwnerKey = 'owner';
  await a.handle({ type: 'assistantResetScope' });
  assert.equal(a.scope.mode, 'public'); assert.equal(a.scope.agentId, ''); assert.equal(a.scope.branchId, ''); assert.equal(a.scope.lawId, 'l8');
  for (const key of ['assistantFrom', 'assistantTo', 'assistantAdminKey', 'assistantOwnerKey']) assert.equal(g.form[key], undefined);
  a.status.world.cities = []; a.status.branches = [a.status.branches[0]];
  s = sheet('assistantScope'); assert.doesNotMatch(s.text, /世界与分支|三城/);
});

for (const [over, expected] of [
  [{ available: false }, '助手暂不可用'],
  [{ quota: { remaining: 0, limit: 20 } }, '今日次数已用完 · 北京时间零点恢复'],
]) test(`composer disables input and asking: ${expected}`, () => {
  const { g, a, render } = setup(); Object.assign(a.status, over); g.form.assistantText = '有问题';
  assert.ok(render().includes(expected));
  assert.ok(!g.hits.some(h => h.action.type === 'assistantAsk' || h.action.name === 'assistantText'));
  a.conversation = { messages: [{ role: 'assistant', status: 'generating', text: '未审核' }] };
  render(); assert.ok(g.hits.some(h => h.action.type === 'assistantCancel'));
});

test('composer caps draft at three lines, disables blank and busy asks, shows one-line errors', () => {
  const { g, a, render } = setup(); render(); assert.ok(!g.hits.some(h => h.action.type === 'assistantAsk'));
  g.form.assistantText = '很长的问题'.repeat(200); a.error = '错误'.repeat(100); render();
  assert.ok(g.hits.some(h => h.action.type === 'assistantAsk')); assert.ok(g.page.footer.height < 300);
  assert.ok(g.hits.some(h => h.action.name === 'assistantText' && h.action.multiple && h.action.max === 4000));
  g.busy = true; render(); assert.ok(!g.hits.some(h => h.action.type === 'assistantAsk'));
});

for (const state of ['pending', 'loginRequired', 'rejected', 'unavailable', 'withheld']) test(`complete status with moderation ${state} hides text, source titles and AI label`, () => {
  const { a, g, render } = setup(); a.conversation = { messages: [{ id: 'm', role: 'assistant', status: 'complete', moderation: { [state]: 1 }, text: 'SECRET-DRAFT', sources: [{ id: 's', label: 'S1', title: 'SECRET-SOURCE' }] }] };
  const text = render(); assert.doesNotMatch(text, /SECRET|AI 生成/); assert.ok(!g.hits.some(h => h.action.type === 'assistantSource'));
  if (state === 'loginRequired') assert.ok(g.hits.some(h => h.action.tab === 'account'));
});

test('answer status notices and approved footnotes use exact copy without old exposition', () => {
  const { a, g, render } = setup(); a.conversation = { messages: [
    { id: 'g', role: 'assistant', status: 'generating', text: 'SECRET' },
    { id: 'f', role: 'assistant', status: 'failed', error: '超时', text: 'SECRET' },
    { id: 'c', role: 'assistant', status: 'cancelled', text: 'SECRET' },
    { id: 'w', role: 'assistant', status: 'withheld', text: 'SECRET' },
    { id: 'u', role: 'user', status: 'pending', text: 'SECRET' },
  ] };
  const text = render(); assert.doesNotMatch(text, /SECRET|AI 分析仅供观测|本次问题范围|每条消息保存|刷新 \/ 重新验证/);
  for (const copy of ['正在生成…', '生成失败 · 超时', '已停止 · 回答不完整', '内容未展示：权限已变化或审核未通过', '内容审核中', '重试（计 1 次）']) assert.ok(text.includes(copy), copy);
  assert.equal(g.blocks.filter(b => b.text === 'AI 生成').length, 1);
  a.conversation = conversation(); render(); assert.match(JSON.stringify(g.blocks), /依据 S1 · 第 12 日 · 截至/);
});

test('source states hide rejected titles and body, then show approved records', () => {
  const { a, render, g } = setup(); a.conversation = conversation(); a.sourceId = 's'; a.sourceLabel = 'S1';
  a.source = { title: 'SECRET-TITLE', text: 'SECRET-BODY' };
  for (const state of ['pending', 'rejected', 'unavailable', 'loginRequired', 'withheld']) {
    a.sourceModeration = { [state]: 1 }; assert.doesNotMatch(render(), /SECRET/); assert.equal(g.page.footer, undefined);
  }
  a.sourceModeration = null; a.source = { title: '审核通过', text: '可读记录' }; assert.match(render(), /审核通过|可读记录/);
});

test('delete confirmation makes no request until confirmed and clears before a delayed deletion', async () => {
  const { g, a, sheet, requests, wx, render } = setup(); a.conversation = conversation(); render();
  assert.ok(g.hits.some(h => h.action.type === 'sheet' && h.action.kind === 'assistantDelete'));
  const confirm = sheet('assistantDelete'); assert.match(confirm.text, /删除这段对话？/); assert.equal(requests.length, 0);
  await g.handle({ type: 'closeSheet' }); assert.ok(a.conversation);
  let pending; wx.request = options => { pending = options; };
  a.refresh = async () => {};
  const deletion = a.handle({ type: 'assistantDelete' }); assert.equal(a.conversation, null); assert.equal(g.sheet, null); assert.equal(g.page.top.title, '实验助手');
  assert.equal(pending.method, 'DELETE'); pending.success({ statusCode: 200, data: {} }); await deletion;
});

test('asking without a resident sends the private scope, closes the sheet and enters a conversation at bottom', async () => {
  let sent;
  const { g, a } = setup({ respond: (path, options) => {
    if (path === '/api/assistant/questions') { sent = options.data; return { conversationId: 'c' }; }
    if (path === '/api/assistant/status') return status();
    return { conversation: conversation() };
  } });
  a.scope.mode = 'resident'; g.form.assistantText = '我的居民怎么样？'; g.sheet = { kind: 'assistantScope' };
  await a.handle({ type: 'assistantAsk' });
  assert.equal(sent.scope.mode, 'resident'); assert.ok(!('agentId' in sent.scope)); assert.equal(g.form.assistantText, undefined); assert.equal(g.sheet, null);
  assert.equal(g.page.top.back.type, 'assistantList'); assert.equal(g.scroller().offset, g.scroller().max);
});

test('polling follows new messages only when within 48 pixels of the bottom', async () => {
  let current = conversation(); const { a, g, render } = setup({ respond: path => path === '/api/assistant/status' ? status() : { conversation: current } });
  a.conversation = current; render(); g.scroller().scrollTo(120);
  current = { ...current, messages: [...current.messages, ...conversation().messages] };
  await a.refresh(); assert.equal(g.scroller().offset, 120);
  g.scroller().scrollTo(g.scroller().max - 47); current = { ...current, messages: [...current.messages, ...conversation().messages] };
  await a.refresh(); assert.equal(g.scroller().offset, g.scroller().max);
});

for (const large of [false, true]) test(`scope sheet scrolls both axes on iPhone SE; large text ${large}`, async () => {
  const m = setup(), { g, a, render } = m;
  m.load(new URL('../wechat/minigame/ui/theme.js', import.meta.url).pathname).setFontScale(large);
  g.width = 375; g.height = 667; g.bottomInset = 0; g.user.role = 'admin'; a.scope.mode = 'research'; a.scope.branchId = '75b643ab-history'; a.conversation = conversation();
  a.status.branches[1].residents = Array.from({ length: 12 }, (_, i) => ({ id: 'h' + i, name: '旧城居民' + i, managed: false }));
  render(); g.scroller().scrollTo(120); await g.handle({ type: 'sheet', kind: 'assistantScope' }); render();
  const vertical = g.scroller('assistant-sheet'), area = g.horizontalAreas.find(h => h.scroller.max > 0);
  assert.ok(vertical.max > 0); assert.ok(area);
  const event = (x, y) => ({ touches: [{ clientX: x, clientY: y }] });
  const x = area.x + 100, y = area.y + area.h / 2;
  g.touchStart(event(x, y)); g.touchMove(event(x - 80, y + 1)); g.touchEnd();
  assert.ok(area.scroller.offset > 0); assert.equal(g.scroller().offset, 120); assert.equal(vertical.offset, 0);
  const top = g.sheetArea.top;
  g.touchStart(event(320, top + 25)); g.touchMove(event(320, top - 100)); g.touchEnd();
  assert.ok(vertical.offset > 0); assert.equal(g.scroller().offset, 120);
  vertical.scrollTo(vertical.max); render();
  assert.ok(g.hits.some(h => h.action.type === 'closeSheet' && h.y >= g.sheetArea.top));
  assert.ok(g.hits.filter(h => h.action.type === 'field').every(h => h.y >= g.sheetArea.top && h.y + h.h <= g.sheetArea.bottom));
  g.touchStart(event(100, 10)); g.touchEnd(); await Promise.resolve(); assert.equal(g.sheet, null);
});

test('scope filters have 44px touch rows and expired source polling shows a toast', () => {
  const { g, a, sheet } = setup();
  assert.ok(sheet('assistantScope').hits.filter(h => h.action?.type === 'assistantScope').every(h => h.h >= 44));
  a.conversation = conversation(); a.sourceId = 's'; a.sourceModeration = { pending: 1 }; a.polls = 50;
  a.schedule(); assert.match(g.toast.text, /等待已结束/);
});

test('retry uses the saved question and scope even if the new date fields are invalid', async () => {
  let sent;
  const { g, a } = setup({ respond: (path, options) => {
    if (path === '/api/assistant/questions') { sent = options.data; return { conversationId: 'c' }; }
    return path === '/api/assistant/status' ? status() : { conversation: conversation() };
  } });
  a.conversation = { id: 'c', messages: [{ role: 'user', text: '原问题', status: 'complete' }, { id: 'm', role: 'assistant', status: 'failed', scope: { mode: 'resident', branchId: 'old', fromDay: 2 } }] };
  g.form.assistantText = '新草稿'; g.form.assistantFrom = '无效';
  await a.handle({ type: 'assistantRetry', id: 'm' });
  assert.equal(sent.text, '原问题'); assert.equal(sent.scope.branchId, 'old'); assert.equal(sent.scope.fromDay, 2);
});

test('returning to the list releases a delayed question lock and ignores its late response', async () => {
  const { g, a, wx } = setup(); let request;
  a.conversation = conversation(); g.form.assistantText = '追问'; wx.request = options => { request = options; };
  const pending = a.handle({ type: 'assistantAsk' }); assert.equal(a.sending, true);
  await a.handle({ type: 'assistantList' }); assert.equal(a.sending, false);
  request.success({ statusCode: 202, data: { conversationId: 'old' } }); await pending;
  assert.equal(a.conversation, null); assert.equal(a.sending, false); assert.ok(g.hits.some(h => h.action.type === 'assistantAsk'));
});

test('returning to the list releases a delayed refresh lock without accepting its stale response', async () => {
  const { a, g, wx } = setup(); let request;
  a.conversation = conversation(); g.form.assistantText = '新问题'; wx.request = options => { request = options; };
  const pending = a.refresh(); assert.equal(a.loading, true);
  await a.handle({ type: 'assistantList' }); assert.equal(a.loading, false);
  request.success({ statusCode: 200, data: { ...status(), available: false } }); await pending;
  assert.equal(a.status.available, true); assert.equal(a.loading, false); assert.equal(a.conversation, null);
  assert.ok(g.hits.some(h => h.action.type === 'assistantAsk'));
});

test('closing a source ignores a late source failure and preserves the conversation and scroll', async () => {
  const { g, a, wx, render } = setup(); let request;
  a.conversation = conversation(); render(); g.scroller().scrollTo(80); wx.request = options => { request = options; };
  const pending = a.handle({ type: 'assistantSource', id: 's' }); await a.handle({ type: 'assistantCloseSource' });
  request.fail({ errMsg: 'timeout' }); await pending;
  assert.equal(a.conversation.id, 'c'); assert.equal(g.scroller().offset, 80); assert.equal(a.error, '');
});

test('closing a source during its poll ignores a late source failure', async () => {
  const { a, wx, render } = setup(); const requests = [];
  a.conversation = conversation(); a.sourceId = 's'; a.source = { title: '依据', text: '记录' }; render();
  wx.request = options => { requests.push(options); };
  const poll = a.refresh(); requests.shift().success({ statusCode: 200, data: status() });
  await new Promise(resolve => setImmediate(resolve)); requests.shift().success({ statusCode: 200, data: { conversation: conversation() } });
  await new Promise(resolve => setImmediate(resolve));
  await a.handle({ type: 'assistantCloseSource' }); requests.shift().fail({ errMsg: 'timeout' }); await poll;
  assert.equal(a.conversation.id, 'c'); assert.equal(a.error, ''); assert.equal(a.loading, false);
});

test('opening another conversation releases an obsolete refresh lock', async () => {
  const { a, wx } = setup(); const requests = [];
  a.conversation = conversation(); wx.request = options => { requests.push(options); };
  const poll = a.refresh(), open = a.handle({ type: 'assistantSession', id: 'new' });
  requests[1].success({ statusCode: 200, data: { conversation: { id: 'new', messages: [] } } }); await open;
  requests[0].success({ statusCode: 200, data: status() }); await poll;
  assert.equal(a.conversation.id, 'new'); assert.equal(a.loading, false);
});

test('failed deletion clears the obsolete refresh lock and keeps the deletion error visible', async () => {
  const { a, wx } = setup(); const requests = [];
  a.conversation = conversation(); wx.request = options => { requests.push(options); };
  const poll = a.refresh(), deletion = a.handle({ type: 'assistantDelete' });
  requests[1].fail({ errMsg: 'timeout' }); await deletion;
  requests[0].success({ statusCode: 200, data: status() }); await poll;
  assert.equal(a.conversation, null); assert.equal(a.loading, false); assert.equal(a.sending, false); assert.ok(a.error);
});

test('an old source poll cannot update moderation or schedule after an account switch', async () => {
  const { a, g, wx, render } = setup(); const requests = [];
  a.conversation = conversation(); a.sourceId = 's'; a.source = { title: '依据', text: '记录' }; render();
  wx.request = options => { requests.push(options); };
  const poll = a.refresh(); requests.shift().success({ statusCode: 200, data: status() });
  await new Promise(resolve => setImmediate(resolve)); requests.shift().success({ statusCode: 200, data: { conversation: conversation() } });
  await new Promise(resolve => setImmediate(resolve));
  g.user = { id: 'bob' }; a.sync(); let remembered = 0, scheduled = 0;
  g.rememberModeration = () => { remembered++; }; a.schedule = () => { scheduled++; };
  requests.shift().fail({ errMsg: 'timeout' }); await poll;
  assert.equal(remembered, 0); assert.equal(scheduled, 0); assert.equal(a.conversation, null);
});

test('branch choices list only history branches besides the current world', () => {
  const { a, sheet } = setup();
  assert.doesNotMatch(sheet('assistantScope').text, /世界 · 第 2 纪 · current/);
  assert.match(sheet('assistantScope').text, /旧世界 · 第 1 纪 · 75b643ab/);
  a.scope.branchId = 'current';
  assert.match(sheet('assistantScope').text, /世界 · 第 2 纪 · current/);
});
