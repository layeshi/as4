// 微信端与网页功能对齐：小程序控制器原样运行，wx.request 直接打到本地真实服务器（真实路由、鉴权与审核投影），
// 只有微信开放接口（登录换取、内容安全）由假 fetcher 代替。测试点击动作、实际查询与界面状态，不检索源码。
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { boot } from './http-helpers.js';
import { minigame } from './wechat-minigame-helpers.js';

const hiddenPhysicsFile = fileURLToPath(new URL('./fixtures/p7-hidden-physics.json', import.meta.url));
const P7 = { physics: 2, premise: 7, map: 'island-three-v1', shellSlots: 0, hiddenPhysicsFile, wechatAppId: 'wx216f3fb724629f67', wechatAppSecret: 'parity-test-secret' };
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)); };
const clone = value => JSON.parse(JSON.stringify(value));

/** 启动真实服务器；微信开放接口用假 fetcher：登录码里带 openid，blocked 里的词被内容安全判为不通过。 */
async function server(t, { extra = {}, blocked = ['违禁'] } = {}) {
  const env = await boot({ ...P7, ...extra });
  t.after(() => env.close());
  env.checked = [];
  env.app.ctx.wechat.fetcher = async (url, options = {}) => {
    const ok = data => ({ ok: true, status: 200, json: async () => data });
    if (url.pathname === '/sns/jscode2session') return ok({ openid: url.searchParams.get('js_code').replace(/-\d+$/, ''), session_key: 'never-forwarded' });
    if (url.pathname === '/cgi-bin/token' || url.pathname === '/cgi-bin/stable_token') return ok({ access_token: 'token', expires_in: 7200 });
    if (url.pathname === '/wxa/msg_sec_check') {
      const body = JSON.parse(options.body); env.checked.push(body.content);
      return ok({ errcode: 0, result: { suggest: blocked.some(word => body.content.includes(word)) ? 'risky' : 'pass' } });
    }
    throw new Error('unexpected WeChat API ' + url.pathname);
  };
  return env;
}
/** 一个小程序客户端（独立的会话与控制器），请求打到 env。 */
async function client(env, openid = 'parity-openid-0001') {
  const c = minigame();
  const calls = [], downloads = [], shared = [];
  let loginN = 0;
  c.wx.login = o => o.success({ code: openid + '-' + (++loginN) });
  c.wx.setStorageSync = () => {}; c.wx.removeStorageSync = () => {};
  c.wx.setClipboardData = o => o.success && o.success();
  c.wx.shareFileMessage = o => shared.push(o);
  c.wx.downloadFile = o => { downloads.push(o); o.success({ statusCode: 200, tempFilePath: '/tmp/wx-download' }); };
  // hold(prefix)：把匹配的请求挂起，测试稍后用 held[i].fail() / .pass() 决定它的结局（模拟迟到的响应）。
  const holds = new Set(), held = [];
  c.wx.request = o => {
    const url = new URL(o.url), path = url.pathname + url.search, method = o.method || 'GET';
    calls.push({ path, method, data: o.data });
    if ([...holds].some(prefix => path.startsWith(prefix))) {
      held.push({ path, fail: (status = 503, message = '服务暂不可用（迟到）') => o.success({ statusCode: status, data: { error: { code: 'unavailable', message } }, header: {} }), drop: () => o.fail() });
      return;
    }
    const body = method === 'GET' || o.data === undefined ? undefined : JSON.stringify(o.data);
    fetch(env.base + path, { method, headers: o.header, body }).then(async response => {
      const text = await response.text();
      let data = text; try { data = JSON.parse(text); } catch { /* 非 JSON */ }
      o.success({ statusCode: response.status, data, header: { 'Set-Cookie': response.headers.get('set-cookie') || '' } });
    }, () => o.fail());
  };
  const g = c.game;
  g.prefs.autoRefresh = false;
  await g.start();
  await g.dispatch({ type: 'start' });
  await settle();
  const texts = () => { g.invalidate(); g.render(); return g.blocks.map(b => b.text); };
  const find = (pred, label) => { texts(); const b = g.blocks.find(pred); assert.ok(b, '找不到界面元素：' + label + '\n' + g.blocks.map(x => x.text).join(' | ')); return b; };
  const tap = async label => { const b = find(x => x.text === label && x.action, label); await g.dispatch(b.action); await settle(); return b.action; };
  const login = async () => {
    await g.dispatch({ type: 'tab', tab: 'account' });
    g.form.accepted = true; await g.dispatch({ type: 'wechatLogin' }); await settle();
    assert.equal(g.wechatVerified, true, '微信登录失败：' + g.error);
  };
  // 文字审核是异步的：等投影排队检查完再读一遍。
  const reviewed = async () => { await settle(60); await g.refresh({ full: true }); await settle(); };
  const type = (name, value) => { g.form[name] = value; };
  return { env, c, g, calls, downloads, shared, held, hold: prefix => holds.add(prefix), release: prefix => holds.delete(prefix), texts, find, tap, login, reviewed, type, checked: env.checked,
    gets: prefix => calls.filter(x => x.method === 'GET' && x.path.startsWith(prefix)),
    posts: prefix => calls.filter(x => x.method !== 'GET' && x.path.startsWith(prefix)) };
}
async function harness(t, { extra, blocked, openid } = {}) { return client(await server(t, { extra, blocked }), openid); }

test('观测页入口：统计、天象、交易所、物料与研究都经过微信审核代理，不留未开放的入口', async t => {
  const h = await harness(t);
  const { g } = h;
  const menu = h.texts();
  for (const label of ['统计', '天象', '交易所', '物料与研究']) assert.ok(menu.includes(label), label);
  assert.ok(!menu.includes('知识与协作'), '协作未开放时不显示入口');
  assert.ok(!menu.includes('人类遗产'), '第七前提不显示遗产页');
  await h.tap('统计');
  assert.equal(g.tab, 'metrics');
  assert.ok(h.gets('/api/wechat/public/metrics').length === 1);
  assert.ok(h.gets('/api/wechat/public/attention?days=30').length === 1);
  assert.ok(h.texts().includes('还没有数据'));
  await g.dispatch({ type: 'back' });
  await h.tap('天象');
  assert.equal(g.tab, 'weather');
  assert.ok(h.texts().includes('眼下风平浪静。'));
  assert.ok(h.texts().some(t => t.startsWith('天象完全随机')), '第六、七前提说明随机天象，不提供投票按钮');
  assert.ok(!g.blocks.some(b => b.action?.type?.includes('vote')));
  assert.ok(h.calls.every(x => !x.path.startsWith('/api/public/')), '所有公开读取都改写到 /api/wechat/public/');
});

test('城市筛选：统计与天象按所选城读取，指标取该城的分项', async t => {
  const h = await harness(t);
  const { g, env } = h;
  env.rt.w.metrics.push({ day: 0, awake: 9, dormant: 1, treasuryEnergy: 100, cities: { north: { awake: 3, dormant: 0, treasuryEnergy: 7 } } });
  await g.dispatch({ type: 'cityFocus', city: 'north' });
  await h.tap('天象');
  assert.ok(h.gets('/api/wechat/public/weather?lang=zh&city=north').length === 1, JSON.stringify(h.calls.map(c => c.path)));
  assert.ok(h.texts().includes('天象 · 北城') || g.page.top.title === '天象 · 北城');
  await g.dispatch({ type: 'back' });
  await h.tap('统计');
  assert.equal(g.page.top.title, '统计 · 北城');
  const legend = h.texts().find(t => t.includes('醒 3'));
  assert.ok(legend, '单城统计用该城的数值，而不是全岛合计');
  assert.ok(!h.texts().includes('基尼系数'), '世界共享的图表只在全岛视图');
  await g.dispatch({ type: 'cityFocus', city: null });
  await g.dispatch({ type: 'refresh' });
  assert.ok(h.texts().some(t => t.includes('醒 9')));
});

test('交易所：分区、筛选与翻页沿用网站查询参数；未审核文字不外露，审核通过后显示', async t => {
  const h = await harness(t);
  const { g, env } = h;
  const svc = n => ({ id: 's' + String(n).padStart(2, '0'), status: 'active', provider: 'a1', title: '修缮告示' + n, description: '居民写的说明' + n, price: n, waitTicks: 2, durationTicks: 6, criterionTemplate: { kind: 'repair', bp: 300 } });
  env.rt.w.services = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [svc(i + 1).id, svc(i + 1)]));
  await h.tap('交易所');
  assert.equal(g.tab, 'market');
  assert.ok(h.gets('/api/wechat/public/services?limit=20&lang=zh').length === 1);
  let shown = h.texts();
  assert.ok(!shown.some(t => t.includes('修缮告示')), '未登录微信时不显示居民写的标题');
  assert.ok(shown.includes('本页 20 条 · 按发布顺序展示'));
  await h.tap('下一页');
  assert.ok(h.gets('/api/wechat/public/services?limit=20&lang=zh&after=s20').length === 1);
  assert.ok(h.texts().includes('本页 1 条 · 按发布顺序展示'));
  assert.ok(h.texts().includes('第 2 页'));
  await h.tap('首页');
  await g.dispatch({ type: 'observeMarketFilter', key: 'kind', value: 'repair' });
  assert.ok(h.gets('/api/wechat/public/services?limit=20&lang=zh&kind=repair').length === 1);
  await h.tap('需求大厅');
  assert.equal(g.observe.market.view, 'demands');
  assert.ok(h.gets('/api/wechat/public/demands?limit=20&lang=zh&kind=repair').length === 1, '切换分区保留筛选，回到首页');
  await h.tap('已结算');
  assert.ok(h.gets('/api/wechat/public/demands?limit=20&lang=zh&kind=repair&status=completed').length === 1);
  await h.tap('清除筛选');
  await h.tap('服务告示');
  assert.ok(!h.texts().includes('订单状态'), '服务告示没有订单状态筛选');
  await h.login();
  await g.dispatch({ type: 'tab', tab: 'city' });
  await h.tap('交易所');
  await h.reviewed();
  shown = h.texts();
  assert.ok(shown.some(t => t === '修缮告示1'), '登录并通过审核后显示标题：' + shown.join('|'));
  assert.ok(h.checked.some(text => text.includes('修缮告示1')), '标题经过微信内容安全检查');
  const expand = g.blocks.find(b => b.text === '查看交易详情');
  await g.dispatch(expand.action);
  shown = h.texts();
  assert.ok(shown.includes('居民写的说明1'));
  assert.ok(shown.some(t => t.startsWith('等待接单') && t.includes('2 刻')));
});

test('物料与研究：地带、研究所、工程与环境记录分页；出资核对显示真实错误而不是空白', async t => {
  const h = await harness(t);
  const { g } = h;
  await h.tap('物料与研究');
  assert.equal(g.tab, 'materials');
  for (const path of ['/api/wechat/public/materials', '/api/wechat/public/research', '/api/wechat/public/projects?limit=20', '/api/wechat/public/observations?limit=20']) assert.ok(h.gets(path).length === 1, path);
  const shown = h.texts();
  assert.ok(g.blocks.filter(b => b.kind === 'row' && b.action?.type === 'sheet').length >= 3, '列出物料地带，可点开地点');
  assert.ok(shown.includes('研究所 · 服务覆盖全城'));
  assert.ok(shown.some(t => t.startsWith('完好度：100')), '研究所完好度');
  assert.ok(shown.includes('还没有工程。'));
  await g.dispatch({ type: 'observeProject', id: 'j-missing' });
  await settle();
  assert.equal(g.tab, 'projectAudit');
  assert.ok(h.gets('/api/wechat/public/project?id=j-missing&limit=10').length === 1);
  assert.ok(h.texts().includes('暂时读不到'), '不存在的工程给出错误与重试');
  assert.ok(h.texts().includes('重试'));
});

test('协作开放后出现入口：列表、详情、历史版本与翻页都走审核代理', async t => {
  const h = await harness(t);
  const { g, env } = h;
  const { wakeCore } = await import('../src/http/tokens.js');
  const { actCore } = await import('../src/http/agent.js');
  const { P } = await import('../src/e2/params.js');
  const ids = ['问潮', '禾灯'].map((name, i) => env.rt.exec('account', { op: 'create', accountId: 'coop-' + i, name, requestId: 'coop-create-' + i, soul: '保持独立判断', lang: 'zh', model: 'mock', dailyCap: 1000000, city: 'north' }).result.agentId);
  assert.equal((await env.call('/api/admin/cooperation', { method: 'POST', admin: true, body: { version: 1 } })).status, 200);
  let n = 0;
  const act = (id, action) => {
    if (env.rt.w.agents[id].actsThisTick >= P.maxActionsPerTick) env.rt.exec('tick');
    const wake = wakeCore(env.app.ctx, id, { kind: 'main', lang: 'zh', actionTools: 'typed' }, 'zh').json;
    const r = actCore(env.app.ctx, id, { wakeId: wake.wakeId, requestId: 'coop-act-' + (++n), experimentGeneration: 0, actionTools: 'typed', actions: [action] }, 'zh');
    assert.equal(r.json.results[0].ok, true, JSON.stringify(r.json));
    return r.json.results[0].data;
  };
  const cards = Array.from({ length: 11 }, (_, i) => act(ids[0], { type: 'card', op: 'create', title: '公开资料' + i, body: '资料正文' + i, visibility: 'public' }));
  act(ids[0], { type: 'card', op: 'revise', id: cards[0].id, body: '修订后的正文' });
  await h.login();
  await g.dispatch({ type: 'tab', tab: 'city' });
  await g.refresh({ full: true });
  await h.tap('知识与协作');
  assert.equal(g.tab, 'cooperation');
  assert.ok(h.gets('/api/wechat/public/cooperation?what=cards&limit=10').length === 1);
  await h.reviewed();
  assert.equal(g.observe.coop.rows.length, 10);
  assert.ok(h.texts().includes('公开资料0'), h.texts().join('|'));
  await h.tap('查看更多');
  assert.equal(g.observe.coop.rows.length, 11, '翻页追加，不丢已读的一页');
  assert.ok(h.calls.some(x => /what=cards&limit=10&after=/.test(x.path)));
  await g.dispatch({ type: 'observeCoopDetail', id: cards[0].id });
  await settle(60); await g.refresh(); await settle();
  assert.equal(g.tab, 'cooperationDetail');
  assert.ok(h.texts().includes('修订后的正文'), h.texts().join('|'));
  await h.tap('上一版本');
  await settle(60); await g.refresh(); await settle();
  assert.ok(h.calls.some(x => x.path.includes('&id=' + cards[0].id + '&version=1')));
  assert.ok(h.texts().includes('资料正文0'), '历史版本显示当时的正文');
  assert.ok(h.texts().includes('最新可观测版本'));
  await g.dispatch({ type: 'back' });
  assert.equal(g.tab, 'cooperation');
  await h.tap('往来评价');
  assert.equal(h.gets('/api/wechat/public/cooperation?what=relations&limit=10').length, 1);
  assert.ok(h.texts().includes('暂时没有可观测的记录。'));
});

// ── 居民管理 ──
// 小程序只观测：居民在同一账号的网页会话里创建（不带微信来源），再在小程序里打开只读的居民记录。
function webHeaders(h, user = h.g.user) { return { Cookie: 'houren_session=' + h.env.app.ctx.accounts.issue(user.id), 'X-Houren-Request': '1' }; }
function phoneHeaders(h) { return { ...webHeaders(h), 'X-Houren-Client': 'wechat' }; }
let createdN = 0;
async function createResident(h, { name = '石序', soul = '观察与生活', city = 'north', cap = 120000 } = {}) {
  const { g, env } = h;
  const created = await env.call('/api/account/residents', { method: 'POST', headers: webHeaders(h), body: { name, soul, bio: '简介', lang: 'zh', dailyCap: cap, city, requestId: 'web-create-' + (++createdN) } });
  assert.ok(created.status >= 200 && created.status < 300, created.text);
  const id = created.json.agentId;
  await g.loadAccount();
  await g.dispatch({ type: 'owner', id }); await settle();
  assert.equal(g.tab, 'owner', g.error);
  return id;
}
const REJECTED = /小程序仅提供观测与已有记录查询/;
async function rejected(h, actions) {
  const { g } = h, before = h.calls.filter(x => x.method !== 'GET').length;
  for (const action of actions) { g.error = ''; await g.dispatch(action); await settle(); assert.match(g.error, REJECTED, action.type); }
  assert.equal(h.calls.filter(x => x.method !== 'GET').length, before, 'removed actions send no write request');
}

test('居民创建已移除：入口不在界面上，旧动作不发请求；手机会话直接写入被服务端拒绝，网页创建的居民在「我的」只读出现', async t => {
  const h = await harness(t);
  const { g, env } = h;
  await h.login();
  let shown = h.texts();
  for (const label of ['让一位居民入城', '成为造者', '实验助手', '余额与托管']) assert.ok(!shown.includes(label), label);
  Object.assign(g.form, { name: '石序', soul: '观察与生活', entryAccepted: true, createCity: 'west', createCap: '120000' });
  await rejected(h, [{ type: 'entry' }, { type: 'createCity', city: 'west' }, { type: 'createLang', lang: 'en' }, { type: 'create' }, { type: 'stewardImportOpen' }]);
  assert.equal(h.posts('/api/account/residents').length, 0);
  const phone = await env.call('/api/account/residents', { method: 'POST', headers: phoneHeaders(h), body: { name: '石序', soul: '观察与生活', lang: 'zh', dailyCap: 120000, city: 'west', requestId: 'phone-create-1' } });
  assert.equal(phone.status, 403); assert.equal(phone.json.error.code, 'wechat_observation_only');
  const id = await createResident(h, { city: 'west' });
  await g.dispatch({ type: 'tab', tab: 'city' }); await g.dispatch({ type: 'tab', tab: 'account' }); await h.reviewed();
  shown = h.texts();
  assert.ok(shown.includes('石序'), shown.join('|'));
  assert.equal(env.rt.w.agents[id].city, 'west');
});

test('居民记录的五个分页读取真实数据：总览、收支、行动、用量、时间线（筛选与翻页），没有管理分页', async t => {
  const h = await harness(t);
  const { g } = h;
  await h.login();
  const id = await createResident(h);
  let shown = h.texts();
  for (const label of ['总览', '收支', '行动', '用量', '时间线', '可转让词元', '当前状态', '下次醒来：未配置模型，不会醒来', '灵魂', '居民提醒设置', '公开档案']) assert.ok(shown.includes(label), label + '\n' + shown.join('|'));
  for (const label of ['管理', '托管运行', '运行', '暂停', '家书', '送出家书', '模型', '测试连接', '保存配置', '询问实验助手']) assert.ok(!shown.includes(label), label);
  await h.tap('收支');
  shown = h.texts();
  assert.ok(shown.some(t => t.includes('首次启动款')), '累计收支按网站的来源名称显示');
  await h.tap('下载流水 CSV');
  assert.equal(h.downloads.length, 1);
  assert.ok(h.downloads[0].url.endsWith('/api/account/residents/' + id + '/export?format=csv'));
  assert.match(h.downloads[0].header.Cookie, /^houren_session=/);
  await h.tap('分享已下载的流水');
  assert.equal(h.shared[0].fileName, id + '-ledger.csv');
  await h.tap('行动');
  assert.ok(h.texts().includes('实际成果'));
  await h.tap('用量');
  shown = h.texts();
  assert.ok(shown.includes('模型用量'));
  assert.ok(!shown.some(t => /¥|托管扣费/.test(t)), '用量页不展示价格与扣费');
  await h.tap('时间线');
  assert.equal(h.gets('/api/wechat/residents/' + id + '/events?limit=50').length, 1);
  await h.reviewed();
  assert.ok(h.texts().some(t => t.includes('上岸')), h.texts().join('|'));
  h.type('timelineType', 'arrive'); h.type('timelineDay', '1');
  await h.tap('筛选');
  assert.equal(h.gets('/api/wechat/residents/' + id + '/events?limit=50&type=arrive&day=0').length, 1);
  await rejected(h, [{ type: 'stewardTab', tab: 'manage' }, { type: 'stewardCap' }, { type: 'stewardAvatarReset' }, { type: 'stewardRemoveRunner' }, { type: 'letter' }, { type: 'runner', op: 'start' }]);
  assert.equal(h.posts('/api/account/residents/' + id).length, 0);
  assert.equal(h.calls.filter(x => x.method === 'DELETE').length, 0);
  assert.equal(g.records.tab, 'timeline');
});

test('模型配置、测试、启停与托管选择已移除：旧动作不发请求，模型目录与托管账目读取在本机拒绝，手机会话写入被服务端拒绝', async t => {
  const h = await harness(t);
  const { g, env } = h;
  await h.login();
  const id = await createResident(h);
  Object.assign(g.form, { apiKey: 'sk-should-never-leave', modelAccepted: true, baseURL: 'https://api.example.com/v1', model: 'm' });
  await rejected(h, [{ type: 'preset', id: 'deepseek' }, { type: 'provider', index: 1 }, { type: 'modelChoice', model: 'm' }, { type: 'modelTest' }, { type: 'modelSave' }, { type: 'runner', op: 'start' }, { type: 'runner', op: 'pause' }, { type: 'stewardModelSource', source: 'hosted' }, { type: 'stewardHostedModel', id: 'm' }, { type: 'stewardBilling' }, { type: 'stewardCancelRequest', id: 'r1' }]);
  assert.equal(h.posts('/api/account/residents/' + id + '/runner').length, 0);
  assert.ok(!h.calls.some(x => x.data && JSON.stringify(x.data).includes('sk-should-never-leave')));
  assert.ok(!h.calls.some(x => /model-presets|\/account\/hosted/.test(x.path)), '不读取模型目录与托管账目');
  const api = h.c.load(new URL('../wechat/minigame/utils/api.js', import.meta.url).pathname);
  for (const path of ['/api/wechat/model-presets', '/api/account/hosted', '/api/account/transfers', '/api/account/worlds', '/api/assistant/status', '/api/port/model']) {
    await assert.rejects(api.request(path), error => error.code === 'wechat_observation_only', path);
  }
  for (const op of ['test', 'save', 'start', 'pause', 'remove']) {
    const r = await env.call('/api/account/residents/' + id + '/runner', { method: 'POST', headers: phoneHeaders(h), body: { op } });
    assert.equal(r.status, 403, op); assert.equal(r.json.error.code, 'wechat_observation_only');
  }
  assert.equal(env.app.ctx.runners.records[id], undefined, '没有任何运行配置被写入');
});

test('过继已移除：小程序不显示过继邀请与接受入口，旧动作不发请求；网页完成的过继后，原创者保留公开生涯入口', async t => {
  const env = await server(t);
  const a = await client(env, 'parity-openid-aaaa'), b = await client(env, 'parity-openid-bbbb');
  await a.login(); await b.login();
  const id = await createResident(a);
  assert.ok(!a.texts().includes('发起过继邀请'));
  a.type('transferUsername', b.g.user.username);
  await rejected(a, [{ type: 'stewardTransfer' }, { type: 'stewardCancelTransfer', agentId: id, transferId: 't1' }]);
  const invite = await env.call('/api/account/residents/' + id + '/transfer', { method: 'POST', headers: webHeaders(a), body: { username: b.g.user.username, requestId: 'web-transfer-1' } });
  assert.ok(invite.status >= 200 && invite.status < 300, invite.text);
  await b.g.dispatch({ type: 'tab', tab: 'city' }); await b.g.dispatch({ type: 'tab', tab: 'account' }); await settle();
  assert.equal(b.gets('/api/wechat/account/transfers').length, 0, '不读取过继邀请');
  assert.ok(!b.texts().includes('过继邀请') && !b.texts().includes('接受并配置模型'));
  await rejected(b, [{ type: 'stewardAcceptOpen', id: 't1' }, { type: 'stewardAccept' }]);
  const transfer = Object.values(env.rt.w.access.transfers).find(x => x.agentId === id && x.status === 'pending');
  env.app.ctx.runners.prepare = async config => config;
  const accepted = await env.call('/api/account/transfers/' + transfer.id + '/accept', { method: 'POST', headers: webHeaders(b), body: { config: { provider: 'openai', model: 'test-model', baseURL: 'https://api.example.com/v1', apiKey: 'sk-test-b', toolMode: 'native', actionTools: 'typed', actEveryTicks: 1, historyRounds: 6 }, dailyCap: 300000, requestId: 'web-accept-1' } });
  assert.ok(accepted.status >= 200 && accepted.status < 300, accepted.text);
  assert.equal(env.rt.w.access.residents[id].managerAccountId, b.g.user.id);
  await a.g.dispatch({ type: 'tab', tab: 'city' }); await a.g.dispatch({ type: 'tab', tab: 'account' }); await settle();
  assert.ok(a.texts().includes('已过继的创作'), '原创者保留公开生涯入口');
});

test('领养已移除：摇篮只读，「我的」与档案都没有领养入口，旧动作不发请求', async t => {
  const h = await harness(t);
  const { g, env } = h;
  const { wakeCore } = await import('../src/http/tokens.js');
  const { actCore } = await import('../src/http/agent.js');
  const mother = env.rt.exec('account', { op: 'create', accountId: 'parity-mother', name: '母', requestId: 'create-mother', soul: '灵魂', lang: 'zh', model: 'mock', dailyCap: 1000000, city: 'north' }).result.agentId;
  env.rt.w.agents[mother].energy = 5000000;
  const wake = wakeCore(env.app.ctx, mother, { kind: 'main', lang: 'zh', actionTools: 'typed' }, 'zh').json;
  assert.equal(actCore(env.app.ctx, mother, { wakeId: wake.wakeId, requestId: 'conceive-0001', experimentGeneration: 0, actionTools: 'typed', actions: [{ type: 'conceive', name: '小满', soul: '一个爱说话的灵魂' }] }, 'zh').json.results[0].ok, true);
  await h.login();
  await g.refresh({ full: true }); await h.reviewed();
  await g.dispatch({ type: 'tab', tab: 'archive' });
  await g.dispatch({ type: 'archive', tab: 'cradle' });
  let shown = h.texts();
  assert.ok(shown.includes('小满'), '摇篮仍可阅读：' + shown.join('|'));
  assert.ok(!shown.includes('领养'));
  await g.dispatch({ type: 'tab', tab: 'account' }); await settle();
  assert.ok(!h.texts().includes('领养摇篮中的灵魂'));
  g.form.adoptAccepted = true; g.form.adoptCap = '90000';
  await rejected(h, [{ type: 'stewardAdoptOpen', id: 's1' }, { type: 'stewardAdopt' }]);
  assert.equal(h.posts('/api/account/residents/adopt').length, 0);
  const phone = await env.call('/api/account/residents/adopt', { method: 'POST', headers: phoneHeaders(h), body: { soulId: 's1', dailyCap: 90000, requestId: 'phone-adopt-1' } });
  assert.equal(phone.status, 403);
});

test('余额与充值入口已移除：「我的」没有余额、托管或价格信息，托管账目不被读取', async t => {
  const h = await harness(t);
  const { g, env } = h;
  await h.login();
  await createResident(h);
  env.app.ctx.hosted.billing.request(g.user.id, { requestId: 'parity-topup-1', amountMicro: 2000000, note: '周五转账' });
  await g.dispatch({ type: 'tab', tab: 'city' }); await g.dispatch({ type: 'tab', tab: 'account' }); await settle();
  const shown = h.texts();
  assert.ok(!shown.some(t => /余额与托管|购买额度|充值|入账申请|¥/.test(t)), shown.join('|'));
  assert.equal(h.gets('/api/wechat/account/hosted').length, 0);
  await rejected(h, [{ type: 'stewardBilling' }, { type: 'stewardCancelRequest', id: 'r1' }]);
});

// ── 迟到失败与秘密清理 ──
test('迟到失败：离开观测页或退出登录后，旧请求的失败不改新页面的数据，也不报错', async t => {
  const h = await harness(t);
  const { g } = h;
  h.hold('/api/wechat/public/services');
  const opening = g.dispatch({ type: 'observe', page: 'market' }); await settle();
  assert.equal(g.tab, 'market');
  await g.dispatch({ type: 'back' });
  assert.equal(g.tab, 'city');
  h.held[0].fail();
  await opening; await settle();
  assert.equal(g.error, '', '迟到的失败不显示在新页面');
  assert.equal(g.toast, null);
  assert.equal(g.observe.market.error, '', '不写入已离开页面的错误');
  assert.equal(g.observe.errors.market, '');
  // 翻页请求迟到失败：已经离开时不回退页码，也不清空已显示的那一页。
  h.release('/api/wechat/public/services');
  await g.dispatch({ type: 'observe', page: 'market' }); await settle();
  const rows = g.observe.market.rows;
  g.observe.market.next = 's20';
  h.hold('/api/wechat/public/services');
  const paging = g.dispatch({ type: 'observeMarketPage', dir: 'next' }); await settle();
  await g.dispatch({ type: 'back' });
  h.held[1].drop();
  await paging; await settle();
  assert.equal(g.error, ''); assert.equal(g.observe.market.rows, rows);
  // 同一页面上的真实失败照常提示。
  h.release('/api/wechat/public/services');
  await g.dispatch({ type: 'observe', page: 'metrics' });
  h.hold('/api/wechat/public/metrics');
  const refreshing = g.dispatch({ type: 'refresh' }); await settle();
  h.held[2].fail(503, '统计暂不可用');
  await refreshing; await settle();
  assert.equal(g.tab, 'metrics');
  assert.match(g.error || g.toast?.text || '', /统计暂不可用/);
});

test('迟到失败：居民时间线在离开页面后失败，不报错也不写入', async t => {
  const h = await harness(t);
  const { g } = h;
  await h.login();
  const id = await createResident(h);
  h.hold('/api/wechat/residents/' + id + '/events');
  const loading = g.dispatch({ type: 'recordsTab', tab: 'timeline' }); await settle();
  await g.dispatch({ type: 'back' });
  h.held[0].fail();
  await loading; await settle();
  assert.equal(g.error, ''); assert.equal(g.toast?.kind === 'error' ? g.toast.text : '', '');
  assert.equal(g.records.timeline, null, '离开后旧请求的失败不写入');
});

// ── 档案、账户资料、居民公开档案 ──
test('档案按城：全岛法典给三城对比、选城后列该城的程序与法律；编年史带 city 参数', async t => {
  const h = await harness(t);
  const { g } = h;
  await g.dispatch({ type: 'tab', tab: 'archive' });
  assert.ok(h.gets('/api/wechat/public/chronicle?lang=zh&from=0').length >= 1);
  await g.dispatch({ type: 'archive', tab: 'laws' });
  let shown = h.texts();
  assert.ok(shown.includes('三城对比'));
  assert.ok(shown.some(t => t.startsWith('法典各城一套')));
  assert.ok(!shown.includes('后人之法'), '全岛不混列三城的法律');
  await g.dispatch({ type: 'cityFocus', city: 'north' });
  shown = h.texts();
  assert.equal(g.page.top.title, '档案 · 北城');
  for (const label of ['现行的立法程序', '遗法（人类留下的法律）', '后人之法', '进行中的提案']) assert.ok(shown.includes(label), label);
  const northLaws = g.state.cities.find(c => c.id === 'north').laws.filter(l => l.status === 'active' && !l.procedure).length;
  assert.ok(northLaws > 0);
  assert.ok(shown.some(t => t === '普通 · ' + g.state.cities.find(c => c.id === 'north').procedure.ordinary.lawId), '列出北城的普通立法程序');
  await g.dispatch({ type: 'archive', tab: 'chronicle' });
  assert.ok(h.gets('/api/wechat/public/chronicle?lang=zh&from=0&city=north').length === 1, '聚焦一座城时只读该城编年史');
});

test('账户资料：改昵称经审核路由，违规昵称被拒；联系方式与微信关联的操作先确认，管理员看到网站后台说明', async t => {
  const h = await harness(t);
  const { g, env } = h;
  await h.login();
  await h.tap('账户资料');
  assert.equal(g.tab, 'profile');
  let shown = h.texts();
  for (const label of ['个人资料', '保存资料', '修改密码', '设置网页登录密码', '验证联系方式', '添加或更换', '微信关联']) assert.ok(shown.includes(label), label);
  assert.ok(shown.some(t => t.startsWith('当前使用的微信应用')));
  assert.ok(!shown.includes('管理后台'));
  h.type('displayName', '违禁昵称');
  await h.tap('保存资料');
  assert.match(g.error, /安全检查/);
  assert.notEqual(env.app.ctx.accounts.get(g.user.id).displayName, '违禁昵称');
  h.type('displayName', '月下造者');
  await h.tap('保存资料');
  assert.equal(g.error, '');
  assert.equal(env.app.ctx.accounts.get(g.user.id).displayName, '月下造者');
  assert.equal(h.calls.filter(x => x.method === 'PATCH' && x.path === '/api/account').length, 2);
  assert.equal(g.user.displayName, '月下造者');
  // 管理员登录同一界面时，说明管理功能在网站，不放进入后台的按钮。
  env.app.ctx.accounts.data.users.find(u => u.id === g.user.id).role = 'admin';
  await g.dispatch({ type: 'tab', tab: 'account' }); await settle();
  await h.tap('账户资料');
  shown = h.texts();
  assert.ok(shown.includes('管理后台'));
  assert.ok(!g.blocks.some(b => b.kind === 'button' && /后台/.test(b.text)), '不制造死按钮');
});

test('居民公开档案：显示籍、作者、生卒、灵魂与志等网站档案字段', async t => {
  const h = await harness(t);
  const { g, env } = h;
  await h.login();
  const id = await createResident(h, { name: '问潮', soul: '记录每一次潮汐' });
  await g.dispatch({ type: 'resident', id }); await settle();
  await h.reviewed();
  const shown = h.texts();
  assert.equal(g.tab, 'resident');
  assert.ok(shown.some(t => t.includes('籍') && t.includes('北城')), shown.join('|'));
  assert.ok(shown.some(t => t.includes('作者') && t.includes('人类写下')));
  assert.ok(shown.some(t => t.includes('第 1 日入城')));
  assert.ok(env.rt.w.agents[id]);
});

test('法典明细：物理定律、变量、程序变迁、法律的读法/指纹/规则 JSON、遗宪各语言版本、社群章程与地点规则都可折叠查看', async t => {
  const h = await harness(t);
  const { g, env } = h;
  const { wakeCore } = await import('../src/http/tokens.js');
  const { actCore } = await import('../src/http/agent.js');
  // 一位居民成为北港的主人，用真实的 rules 动作订立地点规则。
  const owner = env.rt.exec('account', { op: 'create', accountId: 'rules-owner', name: '港主', requestId: 'create-rules-owner', soul: '灵魂', lang: 'zh', model: 'mock', dailyCap: 1000000, city: 'north' }).result.agentId;
  env.rt.w.agents[owner].energy = 5000000;
  env.rt.w.places['north-port'].owner = { kind: 'agent', id: owner };
  const wake = wakeCore(env.app.ctx, owner, { kind: 'main', lang: 'zh', actionTools: 'typed' }, 'zh').json;
  assert.equal(actCore(env.app.ctx, owner, { wakeId: wake.wakeId, requestId: 'place-rules-1', experimentGeneration: 0, actionTools: 'typed', actions: [{ type: 'rules', place: 'north-port', rules: [{ when: 'before:say', do: [{ op: 'deny', reason: '此处安静' }] }] }] }, 'zh').json.results[0].ok, true);
  await h.login();
  await g.dispatch({ type: 'tab', tab: 'archive' });
  await g.dispatch({ type: 'cityFocus', city: 'north' });
  await g.dispatch({ type: 'archive', tab: 'laws' }); await settle();
  assert.ok(h.gets('/api/wechat/public/lore?lang=zh').length >= 1, '物理定律经审核代理读取');
  await settle(80); await g.dispatch({ type: 'archive', tab: 'laws' }); await settle();
  let shown = h.texts();
  for (const label of ['物理', '自然律', '守护律', '变量', '程序的变迁', '人类遗宪', '社群章程', '还没有社群章程。', '地点规则']) assert.ok(shown.includes(label), label + '\n' + shown.join('|'));
  const north = env.rt.w.cities.north;
  // 第七前提与网站相同按自然律、守护律分组（网站 e2-strings tokenized 只含第四至六前提）。
  const physics = env.app.ctx.rt.engine.publicLore('zh', env.rt.w).physicsP1;
  await h.tap('自然律');
  shown = h.texts();
  assert.ok(shown.includes('1. ' + physics.natural.items[0]), '自然律条文审核后显示：' + shown.join('|'));
  await h.tap('守护律');
  assert.ok(h.texts().includes(physics.guardian.items.length + '. ' + physics.guardian.items.at(-1)));
  await h.tap('变量');
  assert.ok(h.texts().some(t => t.startsWith('rationShare') && t.includes(String(north.vars.rationShare))), h.texts().join('|'));
  const law = g.state.cities.find(c => c.id === 'north').laws.find(l => l.id === 'l2');
  await g.dispatch(h.find(b => b.kind === 'fold' && b.text.startsWith('l2 · '), 'l2 折叠卡').action);
  shown = h.texts();
  assert.ok(shown.some(t => t.startsWith('规则实际执行的含义')), '读法');
  assert.ok(shown.includes('规则 JSON'));
  assert.ok(shown.some(t => t.includes('"before:propose"')), '规则 JSON 原文');
  assert.ok(shown.some(t => t.includes('作者 人类留下') && t.includes('第 1 日生效')));
  assert.ok(law.fingerprints.length);
  assert.ok(shown.includes('指纹：' + law.fingerprints.map(f => String(f).slice(0, 8)).join(' ')), '指纹是真实哈希而非审核占位：' + shown.filter(t => t.startsWith('指纹')).join('|'));
  assert.ok(!/审核/.test(law.fingerprints.join('')), '投影保留指纹');
  assert.ok(!shown.includes('法律详情'), '第七前提法律编号各城重复，不进可能串城的详情页');
  await g.dispatch(h.find(b => b.kind === 'fold' && b.text.startsWith('第 1 条'), '遗宪第 1 条').action);
  shown = h.texts();
  assert.ok(shown.some(t => t.startsWith('zh：')) && shown.some(t => t.startsWith('en：')), '遗宪各语言版本');
  await h.tap('程序的变迁');
  assert.ok(h.texts().some(t => t.startsWith('l1 · ') && t.includes('普通/修宪')));
  const rules = env.rt.w.places['north-port'].rules;
  await g.dispatch(h.find(b => b.kind === 'fold' && b.action?.key === 'placerules:north-port', '北港地点规则').action);
  shown = h.texts();
  assert.ok(shown.some(t => t.includes('有人说话之前：拒绝')), '地点规则读法：' + shown.join('|'));
  assert.ok(shown.some(t => t.includes('设定者 港主')));
  assert.ok(shown.includes('指纹：' + rules.fingerprints.map(f => f.slice(0, 8)).join(' ')));
  assert.ok(shown.some(t => t.includes('"before:say"')), '地点规则 JSON');
  assert.ok(shown.includes('地点档案'));
  // 别的城看不到北港的地点规则。
  await g.dispatch({ type: 'cityFocus', city: 'west' });
  assert.ok(h.texts().includes('还没有地点规则。'));
});

test('居民谱系：作者与子女（上溯三代、下传两代）以可点击的亲属列表呈现，多作者都注明', async t => {
  const h = await harness(t);
  const { g, env } = h;
  const { wakeCore } = await import('../src/http/tokens.js');
  const { actCore } = await import('../src/http/agent.js');
  const mother = env.rt.exec('account', { op: 'create', accountId: 'lineage-mother', name: '岸母', requestId: 'create-lineage-m', soul: '灵魂', lang: 'zh', model: 'mock', dailyCap: 1000000, city: 'north' }).result.agentId;
  env.rt.w.agents[mother].energy = 5000000;
  const wake = wakeCore(env.app.ctx, mother, { kind: 'main', lang: 'zh', actionTools: 'typed' }, 'zh').json;
  assert.equal(actCore(env.app.ctx, mother, { wakeId: wake.wakeId, requestId: 'conceive-lineage', experimentGeneration: 0, actionTools: 'typed', actions: [{ type: 'conceive', name: '小潮', soul: '一个安静的灵魂' }] }, 'zh').json.results[0].ok, true);
  await h.login();
  await g.refresh({ full: true });
  const adopted = await env.call('/api/account/residents/adopt', { method: 'POST', headers: webHeaders(h), body: { soulId: 's1', dailyCap: 90000, requestId: 'web-adopt-lineage' } });
  assert.ok(adopted.status >= 200 && adopted.status < 300, adopted.text);
  const child = adopted.json.agentId;
  assert.deepEqual(clone(env.rt.w.agents[child].authors), [mother]);
  await g.refresh({ full: true });
  await g.dispatch({ type: 'resident', id: child }); await h.reviewed();
  let shown = h.texts();
  assert.ok(shown.includes('谱系') && shown.includes('作者'), shown.join('|'));
  const row = h.find(b => b.kind === 'row' && b.text === '岸母', '作者行');
  assert.deepEqual(clone(row.action), { type: 'resident', id: mother });
  await g.dispatch(row.action); await h.reviewed();
  assert.equal(g.profile.id, mother);
  shown = h.texts();
  assert.ok(shown.includes('子女'));
  const kid = h.find(b => b.kind === 'row' && b.text === '小潮', '子女行');
  assert.deepEqual(clone(kid.action), { type: 'resident', id: child });
});
