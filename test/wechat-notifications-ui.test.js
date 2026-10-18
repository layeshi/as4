import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { minigame } from './wechat-minigame-helpers.js';
const require = createRequire(import.meta.url);
const { createPlatform } = require('../wechat/miniprogram-app/platform.js');

const user = { id: 'u1', username: 'alice', displayName: '造者', role: 'user' };
const managed = [{ agentId: 'a1', name: '阿青', status: 'awake' }, { agentId: 'a2', name: '白石', status: 'awake' }];
const TYPES = [
  { key: 'death', label: '居民死亡', templateId: 'TPL-DEATH', available: true },
  { key: 'diary', label: '新日记', templateId: 'TPL-DIARY', available: true },
  { key: 'runner_stopped', label: '托管异常停机', templateId: 'TPL-RUNNER', available: true },
  { key: 'balance_low', label: '托管余额不足', templateId: 'TPL-BALANCE', available: true },
];
const clone = value => JSON.parse(JSON.stringify(value));
// 控制器在独立 vm 上下文中运行，数组原型不同，比较前转成普通 JSON。
const same = (actual, expected, message) => assert.deepEqual(clone(actual), clone(expected), message);
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const record = (id, extra = {}) => ({ id, agentId: 'a1', kind: 'death', title: '阿青离世', createdAt: Date.UTC(2026, 9, 18, 4, 0), readAt: null, delivery: 'sent', count: 1, ...extra });

// 路由按 [状态码, 响应] 返回，便于模拟 403 等现有错误格式 {error:{code,message}}。
async function setup({ summary = {}, routes = () => null } = {}) {
  const calls = [];
  const state = { types: clone(TYPES), residents: [], bindingReady: true, needsAuthorization: false, ...summary };
  const c = minigame();
  c.wx.request = o => {
    const url = new URL(o.url), path = url.pathname + url.search, method = o.method || 'GET';
    calls.push({ path, method, data: o.data, header: o.header });
    Promise.resolve().then(() => routes(path, method, o.data, state)).then(custom => {
      let reply = custom;
      if (!reply) {
        if (path === '/api/account') reply = [200, { user, registrationOpen: true }];
        else if (path.startsWith('/api/wechat/status')) reply = [200, { linked: true, enabled: true, verified: true }];
        else if (path === '/api/wechat/residents') reply = [200, { managed: clone(managed), created: [] }];
        else if (path.startsWith('/api/wechat/notifications?') || path === '/api/wechat/notifications') reply = [200, clone(state)];
        else if (path === '/api/wechat/notifications/preferences') {
          state.residents = state.residents.filter(r => r.agentId !== o.data.agentId);
          if (o.data.types.length) state.residents.push({ agentId: o.data.agentId, types: o.data.types });
          reply = [200, { ok: true }];
        } else if (path === '/api/wechat/notifications/authorization') reply = [200, { ticket: 'ticket-' + calls.length, templates: o.data.types.map(k => TYPES.find(t => t.key === k).templateId) }];
        else reply = [200, { ok: true }];
      }
      o.success({ statusCode: reply[0], data: reply[1], header: {} });
    }, () => o.fail());
  };
  await c.game.start();
  Object.assign(c.game, { entered: true, tab: 'account', stack: [], user, wechatVerified: true, wechatLinked: true, linked: clone(managed) });
  c.game.invalidate(); c.game.render();
  return { ...c, calls, state, posts: path => calls.filter(x => x.path === path && x.method === 'POST') };
}
const texts = g => { g.invalidate(); g.render(); return g.blocks.map(b => b.text); };

test('“我的居民”可进入提醒设置与提醒记录；默认全部关闭，并沿用会话请求头', async () => {
  const c = await setup(); const g = c.game;
  assert.ok(texts(g).includes('居民提醒')); assert.ok(g.blocks.some(b => b.action?.type === 'notificationRecords'));
  await g.dispatch({ type: 'notifications' });
  assert.equal(g.tab, 'notifications');
  const read = c.calls.find(x => x.path.startsWith('/api/wechat/notifications'));
  assert.equal(read.method, 'GET'); assert.equal(read.header['X-Houren-Request'], '1'); assert.equal(read.header['Content-Type'], 'application/json');
  const shown = texts(g);
  for (const name of ['阿青', '白石']) assert.ok(shown.includes(name));
  const rows = g.blocks.filter(b => b.kind === 'menu' && b.action?.type === 'notificationToggle');
  assert.equal(rows.length, 8); assert.ok(rows.every(r => /· 微信$/.test(r.text)));
  assert.ok(g.notifications.subscribed('a1').length === 0 && g.notifications.subscribed('a2').length === 0);
  // 不展示模板编号、授权编号等内部字段。
  assert.ok(!shown.some(t => /TPL-|ticket|openid|OpenID|template/i.test(t)));
  g.tab = 'owner'; g.owner = { agentId: 'a1', name: '阿青', runner: {} }; g.stack = ['account']; assert.ok(texts(g).includes('居民提醒设置'));
});

test('按居民、按类型开关会完整替换该居民的订阅；全部关闭发送空数组', async () => {
  const c = await setup(); const g = c.game;
  await g.dispatch({ type: 'notifications' });
  await g.dispatch({ type: 'notificationToggle', agentId: 'a1', key: 'diary' });
  await g.dispatch({ type: 'notificationToggle', agentId: 'a1', key: 'death' });
  await g.dispatch({ type: 'notificationToggle', agentId: 'a2', key: 'balance_low' });
  const posts = c.posts('/api/wechat/notifications/preferences').map(x => x.data);
  same(posts.map(p => [p.agentId, p.types]), [['a1', ['diary']], ['a1', ['death', 'diary']], ['a2', ['balance_low']]]);
  same(g.notifications.subscribed('a1'), ['death', 'diary']);
  await g.dispatch({ type: 'notificationToggle', agentId: 'a1', key: 'diary' });
  same(c.posts('/api/wechat/notifications/preferences').at(-1).data.types, ['death']);
  texts(g); assert.ok(g.hits.some(h => h.action.type === 'notificationAllOff' && h.action.agentId === 'a1'));
  await g.dispatch({ type: 'notificationAllOff', agentId: 'a1' });
  same(c.posts('/api/wechat/notifications/preferences').at(-1).data, { agentId: 'a1', types: [] });
  same(g.notifications.subscribed('a1'), []); same(g.notifications.subscribed('a2'), ['balance_low']);
  await assert.rejects(g.notifications.toggle('gone', 'death'), /不再管理/);
});

test('未配置模板时仍可开启小程序内提醒，并明确微信通知不可用', async () => {
  const types = TYPES.map(t => ({ ...t, templateId: null, available: false }));
  const c = await setup({ summary: { types } }); const g = c.game;
  await g.dispatch({ type: 'notifications' });
  const shown = texts(g);
  assert.ok(shown.some(t => t.includes('暂时无法发送微信通知')));
  assert.ok(g.blocks.filter(b => b.action?.type === 'notificationToggle').every(b => b.text.endsWith('仅小程序内')));
  assert.ok(!g.blocks.some(b => b.action?.type === 'notificationPrepare'));
  await g.dispatch({ type: 'notificationToggle', agentId: 'a1', key: 'death' });
  same(g.notifications.subscribed('a1'), ['death']);
  await assert.rejects(g.notifications.prepare(), /开启至少一项|微信/);
  assert.equal(c.posts('/api/wechat/notifications/authorization').length, 0);
});

test('没有可用微信绑定时引导微信登录，不请求授权；查看与关闭已订阅项目不要求重新授权', async () => {
  const c = await setup({ summary: { bindingReady: false, residents: [{ agentId: 'a1', types: ['death'] }] } }); const g = c.game;
  await g.dispatch({ type: 'notifications' });
  texts(g);
  assert.ok(g.blocks.some(b => b.action?.type === 'wechatLogin'));
  assert.ok(!g.blocks.some(b => b.action?.type === 'notificationPrepare'));
  await g.dispatch({ type: 'notificationPrepare' }); assert.match(g.error, /微信登录/);
  await g.dispatch({ type: 'notificationToggle', agentId: 'a1', key: 'death' });
  same(c.posts('/api/wechat/notifications/preferences')[0].data.types, []);
  assert.equal(c.posts('/api/wechat/notifications/authorization').length, 0);
});

test('先准备授权编号，再在独立按钮的同步点击里调用订阅接口；拒绝不会反复弹窗', async () => {
  const c = await setup({ summary: { residents: [{ agentId: 'a1', types: ['death', 'diary'] }] } }); const g = c.game;
  const asked = [];
  c.wx.requestSubscribeMessage = o => { asked.push(o); };
  await g.dispatch({ type: 'notifications' });
  texts(g); assert.ok(g.blocks.some(b => b.action?.type === 'notificationPrepare'));
  await g.dispatch({ type: 'notificationPrepare' });
  same(c.posts('/api/wechat/notifications/authorization')[0].data.types, ['death', 'diary']);
  assert.equal(asked.length, 0, '准备阶段不能弹出微信授权');
  texts(g); assert.ok(g.blocks.some(b => b.text === '授权微信提醒' && b.action?.type === 'notificationAuthorize'));
  const pending = g.dispatch({ type: 'notificationAuthorize' });
  assert.equal(asked.length, 1, '必须在点击回调内同步调用 requestSubscribeMessage');
  same(asked[0].tmplIds, ['TPL-DEATH', 'TPL-DIARY']);
  asked[0].success({ errMsg: 'requestSubscribeMessage:ok', 'TPL-DEATH': 'reject', 'TPL-DIARY': 'reject', 'TPL-OTHER': 'accept' });
  await pending;
  const result = c.posts('/api/wechat/notifications/authorization/result')[0].data;
  assert.match(result.ticket, /^ticket-\d+$/);
  same(result.results, { 'TPL-DEATH': 'reject', 'TPL-DIARY': 'reject' });
  assert.equal(g.notifications.outcome, 'rejected'); assert.equal(g.notifications.auth.stage, 'idle');
  const shown = texts(g);
  assert.ok(shown.includes('你未同意本次微信提醒')); assert.ok(shown.some(t => t.includes('不会再自动弹出')));
  assert.ok(!shown.some(t => /永久授权|永久有效/.test(t)));
  await g.dispatch({ type: 'tab', tab: 'account' }); await g.dispatch({ type: 'notifications' }); await settle();
  assert.equal(asked.length, 1, '再次进入不会自动弹出授权');
});

test('超过 3 个模板分批授权；同意后保存结果并提示次数有限', async () => {
  const c = await setup({ summary: { residents: [{ agentId: 'a1', types: ['death', 'diary', 'runner_stopped'] }, { agentId: 'a2', types: ['balance_low'] }] } }); const g = c.game;
  const asked = []; c.wx.requestSubscribeMessage = o => { asked.push(o); };
  await g.dispatch({ type: 'notifications' });
  await g.dispatch({ type: 'notificationPrepare', restart: true });
  same(c.posts('/api/wechat/notifications/authorization')[0].data.types, ['death', 'diary', 'runner_stopped']);
  const first = g.dispatch({ type: 'notificationAuthorize' });
  assert.equal(asked[0].tmplIds.length, 3);
  asked[0].success({ 'TPL-DEATH': 'accept', 'TPL-DIARY': 'accept', 'TPL-RUNNER': 'accept' }); await first;
  assert.equal(g.notifications.outcome, 'accepted');
  texts(g); const next = g.blocks.find(b => b.action?.type === 'notificationPrepare');
  assert.equal(next.text, '继续授权其余提醒');
  await g.dispatch(next.action);
  same(c.posts('/api/wechat/notifications/authorization')[1].data.types, ['balance_low']);
  const second = g.dispatch({ type: 'notificationAuthorize' });
  same(asked[1].tmplIds, ['TPL-BALANCE']);
  asked[1].success({ 'TPL-BALANCE': 'ban' }); await second;
  assert.equal(g.notifications.outcome, 'banned');
  assert.ok(texts(g).some(t => t.includes('通知管理')));
  assert.ok(texts(g).some(t => t.includes('不承诺永久推送')));
});

test('授权编号为空时显示不可用；微信主开关关闭时不上报伪造结果', async () => {
  let empty = true;
  const c = await setup({ summary: { residents: [{ agentId: 'a1', types: ['death'] }] }, routes: path => path === '/api/wechat/notifications/authorization' && empty ? [200, { ticket: 't', templates: [] }] : null }); const g = c.game;
  const asked = []; c.wx.requestSubscribeMessage = o => { asked.push(o); };
  await g.dispatch({ type: 'notifications' });
  await g.dispatch({ type: 'notificationPrepare', restart: true });
  assert.equal(g.notifications.outcome, 'unavailable'); assert.equal(g.notifications.auth.stage, 'idle'); assert.equal(asked.length, 0);
  empty = false;
  await g.dispatch({ type: 'notificationPrepare', restart: true });
  const pending = g.dispatch({ type: 'notificationAuthorize' });
  asked[0].fail({ errCode: 20004, errMsg: 'requestSubscribeMessage:fail' }); await pending;
  assert.equal(g.notifications.outcome, 'switchOff');
  assert.equal(c.posts('/api/wechat/notifications/authorization/result').length, 0);
});

test('普通小程序由原生按钮的 bindtap 同步调用订阅接口，Canvas 点击只打开该按钮', () => {
  const page = { game: { editing: '' }, data: {}, setData(d) { Object.assign(this.data, d); } };
  const order = [];
  const native = { hideKeyboard() {}, requestSubscribeMessage: o => { order.push('request'); o.success({ T1: 'accept' }); } };
  const p = createPlatform(native, {}, page);
  let result;
  p.api.showSubscribe({ title: '授权微信提醒', body: '有限次数', label: '授权微信提醒', tmplIds: ['T1'], complete: r => { result = r; }, fail() {} });
  assert.equal(page.data.subscribing, true); assert.equal(page.data.subscribeLabel, '授权微信提醒');
  same(order, []);
  p.subscribe(); same(order, ['request']); same(result, { T1: 'accept' }); assert.equal(page.data.subscribing, false);
  p.subscribe(); same(order, ['request'], '同一次授权只调用一次');
  p.api.showSubscribe({ tmplIds: ['T1'], complete() {}, fail() {} }); p.cancelSubscribe(); assert.equal(page.data.subscribing, false);
  p.subscribe(); same(order, ['request']);
  assert.equal(createPlatform({}, {}, page).api.showSubscribe, undefined, '不支持订阅的基础库不显示原生按钮');
});

test('控制器在普通小程序中准备完成后打开原生授权按钮，并把结果回传服务端', async () => {
  const c = await setup({ summary: { residents: [{ agentId: 'a1', types: ['death'] }] } }); const g = c.game;
  let shown = null; c.wx.showSubscribe = o => { shown = o; }; c.wx.hideSubscribe = () => { shown = null; };
  c.wx.requestSubscribeMessage = () => { throw new Error('Canvas 触摸不能直接调用'); };
  await g.dispatch({ type: 'notifications' });
  await g.dispatch({ type: 'notificationPrepare', restart: true });
  assert.ok(shown); same(shown.tmplIds, ['TPL-DEATH']);
  const options = shown; shown = null;
  await g.dispatch({ type: 'notificationAuthorize' }); assert.ok(shown, 'Canvas 按钮重新打开原生授权按钮');
  await options.complete({ 'TPL-DEATH': 'accept' });
  same(c.posts('/api/wechat/notifications/authorization/result')[0].data.results, { 'TPL-DEATH': 'accept' });
  assert.equal(shown, null); assert.equal(g.notifications.outcome, 'accepted');
});

test('提醒记录分页、已读，点开详情时通过现有居民接口重新验证权限', async () => {
  let denied = false;
  const page1 = Array.from({ length: 30 }, (_, i) => record('r' + (40 - i), { createdAt: Date.UTC(2026, 9, 18, 4, 0) - i * 60000, readAt: i === 2 ? Date.UTC(2026, 9, 18, 5) : null }));
  page1[1] = { ...page1[1], kind: 'diary', title: '阿青有新日记', count: 3, delivery: 'pending' };
  page1[3] = { ...page1[3], agentId: 'a2', kind: 'balance_low', title: '白石托管余额不足', delivery: 'unavailable' };
  const c = await setup({ routes: (path, method) => {
    if (path === '/api/wechat/notifications/records?limit=30') return [200, { records: clone(page1), hasMore: true }];
    if (path === '/api/wechat/notifications/records?limit=30&before=r11') return [200, { records: [record('r10', { createdAt: 1 })], hasMore: false }];
    if (path.startsWith('/api/wechat/residents/a1')) return denied ? [403, { error: { code: 'forbidden', message: 'forbidden' } }] : [200, path.endsWith('/private') ? { diary: [], memories: [] } : { resident: { name: '阿青' }, overview: {}, usage: {} }];
    if (path === '/api/wechat/model-presets') return [200, { presets: [] }];
    return null;
  } }); const g = c.game;
  await g.dispatch({ type: 'notificationRecords' });
  assert.equal(g.tab, 'notificationRecords');
  let shown = texts(g);
  assert.ok(shown.includes('阿青离世')); assert.ok(shown.includes('阿青有新日记'));
  const metas = g.blocks.filter(b => b.kind === 'row').map(b => b.text);
  assert.equal(metas.length, 30); assert.equal(g.notifications.unread, 29);
  await g.dispatch({ type: 'notificationRecordsMore' });
  assert.ok(c.calls.some(x => x.path === '/api/wechat/notifications/records?limit=30&before=r11'));
  assert.equal(g.notifications.records.length, 31); assert.equal(g.notifications.hasMore, false);
  await g.dispatch({ type: 'notificationOpen', id: 'r40' });
  same(c.posts('/api/wechat/notifications/records/read')[0].data, { ids: ['r40'] });
  assert.ok(c.calls.some(x => x.path === '/api/wechat/residents/a1' && x.method === 'GET'));
  assert.ok(c.calls.some(x => x.path === '/api/wechat/residents/a1/private'));
  assert.equal(g.tab, 'owner'); assert.ok(g.notifications.records.find(r => r.id === 'r40').readAt);
  g.back(); denied = true;
  await g.dispatch({ type: 'notificationOpen', id: 'r39' });
  assert.match(g.error, /不再管理这位居民/); assert.equal(g.tab, 'notificationRecords');
  await g.dispatch({ type: 'notificationReadAll' });
  const ids = c.posts('/api/wechat/notifications/records/read').at(-1).data.ids;
  assert.equal(ids.length, 28); assert.ok(!ids.includes('r40') && !ids.includes('r39') && ids.includes('r10')); assert.equal(g.notifications.unread, 0);
  shown = texts(g); assert.ok(!shown.some(t => /TPL-|openid/i.test(t)));
  const sub = g.blocks.find(b => b.text === '阿青有新日记');
  assert.ok(sub);
});

test('普通退出不调用取消订阅接口，并清除本机提醒数据；换账号不残留旧记录', async () => {
  const c = await setup({ summary: { residents: [{ agentId: 'a1', types: ['death'] }] }, routes: path => path === '/api/wechat/notifications/records?limit=30' ? [200, { records: [record('r1', { title: '旧账号私密提醒' })], hasMore: false }] : null }); const g = c.game;
  await g.dispatch({ type: 'notifications' }); await g.dispatch({ type: 'notificationRecords' });
  assert.equal(g.notifications.records.length, 1);
  const before = c.calls.length;
  await g.dispatch({ type: 'logout' });
  const after = c.calls.slice(before).map(x => x.path);
  same(after.filter(p => p.includes('/notifications')), []);
  assert.equal(g.notifications.summary, null); assert.equal(g.notifications.records.length, 0);
  g.user = { id: 'u2', username: 'bob' }; g.notifications.sync(); assert.equal(g.notifications.records.length, 0);
  g.tab = 'notificationRecords'; assert.ok(!texts(g).includes('旧账号私密提醒'));
});

test('旧账号迟到的提醒响应不能写入新账号', async () => {
  let release;
  const c = await setup({ routes: path => path === '/api/wechat/notifications/records?limit=30' ? new Promise(resolve => { release = () => resolve([200, { records: [record('r1', { title: '旧账号私密提醒' })], hasMore: false }]); }) : null }); const g = c.game;
  g.notifications.sync(); g.tab = 'notificationRecords';
  const pending = g.notifications.loadRecords(); await settle();
  g.user = { id: 'u2', username: 'bob' }; g.notifications.sync();
  release(); await pending;
  assert.equal(g.notifications.records.length, 0); assert.ok(!texts(g).includes('旧账号私密提醒'));
});

test('需要补充授权时在“我的”中提示但不强制弹窗，可暂不处理；隐私说明写明加密保存接收标识', async () => {
  const c = await setup({ summary: { needsAuthorization: true, residents: [{ agentId: 'a1', types: ['death'] }] } }); const g = c.game;
  const asked = []; c.wx.requestSubscribeMessage = o => { asked.push(o); };
  await g.dispatch({ type: 'tab', tab: 'residents' }); await g.dispatch({ type: 'tab', tab: 'account' }); await settle();
  assert.ok(texts(g).includes('居民提醒需要补充微信授权')); assert.equal(asked.length, 0);
  await g.dispatch({ type: 'notificationPromptLater' });
  assert.ok(!texts(g).includes('居民提醒需要补充微信授权'));
  const copy = c.load(new URL('../wechat/minigame/copy.js', import.meta.url).pathname);
  const privacy = copy.PRIVACY.join('');
  assert.match(privacy, /加密并持久保存/); assert.match(privacy, /微信接收标识/); assert.match(privacy, /离线提醒/); assert.match(privacy, /普通退出登录不取消提醒/);
  g.tab = 'about'; assert.ok(texts(g).some(t => t.includes('微信接收标识')));
});

test('从微信通知打开：先进入城市，再拉取提醒记录并通过现有居民接口核验后打开详情', async () => {
  const opened = [];
  const c = await setup({ routes: (path, method) => {
    if (path === '/api/wechat/notifications/records?limit=30') return [200, { records: [record('r1')], hasMore: false }];
    if (path.startsWith('/api/wechat/residents/a2')) return [403, { error: { code: 'forbidden', message: 'forbidden' } }];
    if (path.startsWith('/api/wechat/residents/a1')) { opened.push(path); return [200, path.endsWith('/private') ? { diary: [] } : { resident: { name: '阿青' } }]; }
    if (path.startsWith('/api/wechat/public/') || path.startsWith('/api/announcements')) return [200, path.includes('events') ? { events: [] } : path.includes('/state') ? { world: { id: 'w', day: 0 }, agents: [], places: [] } : path.includes('/map') ? { places: [], size: [1, 1] } : {}];
    return null;
  } }); const g = c.game;
  Object.assign(g, { entered: false, tab: 'startup', user: null });
  g.setLaunch({ notification: 'r1', agentId: 'a1', extra: '<x>' });
  same(g.launch, { notification: 'r1', agentId: 'a1' });
  const before = c.calls.length; g.invalidate(); g.render(); assert.equal(c.calls.length, before, '进入城市前不联网');
  await g.dispatch({ type: 'start' });
  assert.equal(g.tab, 'owner'); assert.equal(g.launch, null);
  assert.ok(opened.includes('/api/wechat/residents/a1') && opened.includes('/api/wechat/residents/a1/private'));
  same(c.posts('/api/wechat/notifications/records/read')[0].data, { ids: ['r1'] });
  g.setLaunch({ notification: 'missing', agentId: 'a2' }); g.entered = false; g.tab = 'startup';
  await g.dispatch({ type: 'start' });
  assert.match(g.error, /不再管理这位居民/); assert.equal(g.tab, 'notificationRecords');
  g.setLaunch({ notification: '../../x', agentId: '' }); assert.equal(g.launch, null);
});

// 冷启动未登录：保留待打开的提醒，用户主动微信登录后重放，并由服务端核验权限。
function launchRoutes(flags, extra = () => null) {
  return (path, method, data) => {
    const custom = extra(path, method, data); if (custom) return custom;
    if (path === '/api/account') return [200, { user: flags.loggedIn ? user : null, registrationOpen: true }];
    if (path.startsWith('/api/wechat/status')) return [200, { linked: flags.loggedIn, enabled: true, verified: flags.loggedIn }];
    if (path === '/api/wechat/login') { flags.loggedIn = true; return [200, { ok: true }]; }
    if (path === '/api/wechat/notifications/records?limit=30') return flags.loggedIn ? [200, { records: [record('r1')], hasMore: false }] : [401, { error: { code: 'unauthorized', message: '请先登录' } }];
    if (path.startsWith('/api/wechat/residents/a1')) { flags.opened.push(path); return [200, path.endsWith('/private') ? { diary: [] } : { resident: { name: '阿青' } }]; }
    if (path.startsWith('/api/wechat/residents/a2')) { flags.opened.push(path); return [403, { error: { code: 'forbidden', message: 'forbidden' } }]; }
    if (path.startsWith('/api/wechat/public/') || path.startsWith('/api/announcements')) return [200, path.includes('events') ? { events: [] } : path.includes('/state') ? { world: { id: 'w', day: 0 }, agents: [], places: [] } : path.includes('/map') ? { places: [], size: [1, 1] } : {}];
    return null;
  };
}
async function coldStart(flags, query) {
  const c = await setup({ routes: launchRoutes(flags) }); const g = c.game;
  Object.assign(g, { entered: false, tab: 'startup', stack: [], user: null, wechatVerified: false, wechatLinked: false, linked: [] });
  c.wx.login = o => o.success({ code: 'wx-code' });
  assert.equal(g.setLaunch(query), true);
  await g.dispatch({ type: 'start' });
  return c;
}

test('未登录冷启动保留待打开的提醒，主动微信登录成功后重放并通过服务端核验打开居民详情', async () => {
  const flags = { loggedIn: false, opened: [] };
  const c = await coldStart(flags, { notification: 'r1', agentId: 'a1' }); const g = c.game;
  assert.equal(g.tab, 'account'); same(g.launch, { notification: 'r1', agentId: 'a1' });
  assert.deepEqual(flags.opened, []); assert.match(g.toast.text, /登录后将打开/);
  assert.ok(texts(g).includes('登录后打开居民提醒'));
  await g.dispatch({ type: 'tab', tab: 'city' }); same(g.launch, { notification: 'r1', agentId: 'a1' }, '浏览其他页面不丢失');
  await g.dispatch({ type: 'tab', tab: 'account' });
  g.form.accepted = true;
  await g.dispatch({ type: 'wechatLogin' });
  assert.equal(g.tab, 'owner'); assert.equal(g.launch, null);
  assert.ok(flags.opened.includes('/api/wechat/residents/a1') && flags.opened.includes('/api/wechat/residents/a1/private'));
  same(c.posts('/api/wechat/notifications/records/read')[0].data, { ids: ['r1'] });
  g.back(); assert.equal(g.tab, 'notificationRecords');
});

test('登录后的账号已失去管理权：服务端拒绝时提示，不打开详情且不再反复重放', async () => {
  const flags = { loggedIn: false, opened: [] };
  const c = await coldStart(flags, { notification: 'gone', agentId: 'a2' }); const g = c.game;
  g.form.accepted = true;
  await g.dispatch({ type: 'wechatLogin' });
  assert.ok(flags.opened.includes('/api/wechat/residents/a2'));
  assert.match(g.error, /不再管理这位居民/); assert.equal(g.tab, 'notificationRecords'); assert.equal(g.launch, null);
  const count = flags.opened.length;
  await g.dispatch({ type: 'tab', tab: 'account' }); await g.dispatch({ type: 'refresh' });
  assert.equal(flags.opened.length, count);
});

test('用户可放弃待打开的提醒；退出登录也会清除，不会在下次登录时重放', async () => {
  const flags = { loggedIn: false, opened: [] };
  const c = await coldStart(flags, { agentId: 'a1' }); const g = c.game;
  await g.dispatch({ type: 'launchCancel' }); assert.equal(g.launch, null);
  g.setLaunch({ agentId: 'a1' }); g.user = user; await g.dispatch({ type: 'logout' }); assert.equal(g.launch, null);
  flags.loggedIn = false; g.form.accepted = true; await g.dispatch({ type: 'wechatLogin' });
  assert.deepEqual(flags.opened, []);
});

test('小程序已在后台时点开新通知：已进入城市则直接核验打开；同一组参数不重复处理；未进入则遵守进入城市流程', async () => {
  const flags = { loggedIn: true, opened: [] };
  const c = await setup({ routes: launchRoutes(flags) }); const g = c.game;
  g.tab = 'city';
  c.wx.emitShow({ query: { notification: 'r1', agentId: 'a1' } }); await settle(); await settle();
  assert.equal(g.tab, 'owner'); assert.ok(flags.opened.length >= 2);
  const reads = c.posts('/api/wechat/notifications/records/read').length, stack = g.stack.join('>'), records = c.calls.filter(x => x.path.startsWith('/api/wechat/notifications/records?')).length;
  c.wx.emitShow({ query: { notification: 'r1', agentId: 'a1' } }); await settle(); await settle();
  // 旧参数只触发普通刷新（管理页照常重新读取居民），不再重新打开提醒。
  assert.equal(c.posts('/api/wechat/notifications/records/read').length, reads, '回到前台时重复给出的旧参数不会再次打开');
  assert.equal(c.calls.filter(x => x.path.startsWith('/api/wechat/notifications/records?')).length, records);
  assert.equal(g.stack.join('>'), stack); assert.equal(g.launch, null);
  // 处理中收到新通知：排队到当前操作结束后再打开。
  g.busy = true; c.wx.emitShow({ query: { notification: 'gone', agentId: 'a2' } }); assert.equal(g.launchQueued, true);
  g.busy = false; await g.dispatch({ type: 'notificationRefresh' }); await settle(); await settle();
  assert.ok(flags.opened.includes('/api/wechat/residents/a2')); assert.match(g.error, /不再管理/);
  // 仍在启动页：不联网，点「进入城市」后再打开。
  Object.assign(g, { entered: false, tab: 'startup', stack: [] });
  const before = c.calls.length;
  c.wx.emitShow({ query: { agentId: 'a1', notification: 'r1x' } }); await settle();
  assert.equal(c.calls.length, before); assert.equal(g.tab, 'startup'); same(g.launch, { notification: 'r1x', agentId: 'a1' });
  flags.opened.length = 0;
  await g.dispatch({ type: 'start' });
  assert.equal(g.tab, 'owner'); assert.ok(flags.opened.includes('/api/wechat/residents/a1'));
});

test('普通小程序页面 onShow 从本次进入参数取出通知参数并交给控制器', () => {
  const source = readFileSync(new URL('../wechat/miniprogram-app/pages/society/index.js', import.meta.url), 'utf8');
  let config, enter = { path: 'pages/society/index', query: { notification: 'r9', agentId: 'a1' } };
  const wx = { getEnterOptionsSync: () => enter };
  runInNewContext('(function(require){' + source + '\n})', { Page: c => { config = c; }, wx })(() => ({}));
  const emitted = [], page = { ...config, platform: { emit: (event, payload) => emitted.push([event, payload]) } };
  page.onShow();
  same(emitted.at(-1), ['Show', { query: { notification: 'r9', agentId: 'a1' } }]);
  enter = { path: '/pages/web-login/index', query: { notification: 'x' } }; page.onShow();
  same(emitted.at(-1), ['Show', {}]);
  wx.getEnterOptionsSync = () => { throw new Error('unsupported'); }; page.onShow();
  same(emitted.at(-1), ['Show', {}]);
  const fresh = { ...config, platform: null }; fresh.onShow(); assert.equal(emitted.length, 3);
});
