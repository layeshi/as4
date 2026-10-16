import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { renderMaterialsMarket, marketTime } from '../public/market-ui.js';
import { getLang, setLang } from '../public/i18n.js';
import { materialLook } from '../src/e2/engine/material-views.js';

const order = (id, extra = {}) => ({ id, origin: 'demand', title: '修复公共设施', description: '居民协商的交付条件', requester: 'a1', provider: 'a2',
  terms: { price: 300, criterion: { kind: 'repair', bp: 500, target: 'market' } }, status: 'active', progress: 200,
  escrow: 300, createdTick: 0, acceptBy: 12, dueTick: 48, evidence: [], ...extra });
const tick = () => new Promise(resolve => setImmediate(resolve));
let worldIndex = 0;
function setup(response) {
  const dom = installFakeDom(), fetch = globalThis.fetch, lang = getLang(), calls = [];
  setLang('zh');
  const agents = [{ id: 'a1', name: '甲居民' }, { id: 'a2', name: '乙居民' }];
  const ctx = { S: { state: { world: { id: `market-test-${worldIndex++}`, premise: 6, epoch: 1, ticksPerDay: 12 }, agents, roads: [], docs: [] } },
    agent: id => agents.find(a => a.id === id), openAgent() {}, openPlace() {}, placeName: id => id === 'market' ? '交易所' : id };
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options });
    assert.equal(options.method, 'GET', '交易所不得提交任何写请求');
    assert.equal(options.headers.Authorization, undefined, '不应使用居民令牌');
    return response(path, options);
  };
  return { dom, ctx, calls, restore() { globalThis.fetch = fetch; setLang(lang); dom.restore(); } };
}
const ok = json => ({ ok: true, status: 200, json: async () => json });
const button = (root, name) => root.querySelectorAll('button').find(n => n.textContent === name);

test('P7 exchange renders shared trades and identifies each party’s domicile', async () => {
  const env = setup(() => ok([order('so1')]));
  try {
    env.ctx.S.state.world.premise = 7;
    env.ctx.S.state.agents[0].city = 'north';
    env.ctx.S.state.agents[1].city = 'west';
    env.ctx.S.raw = { cities: [{ id: 'north', short: { zh: '北城', en: 'North City' } }, { id: 'west', short: { zh: '西城', en: 'West City' } }] };
    renderMaterialsMarket(env.ctx, env.dom.root);
    assert.ok(button(env.dom.root, '全部订单'), 'P7 must expose the exchange');
    button(env.dom.root, '全部订单').click(); await tick();
    assert.match(env.dom.root.querySelector('.market-parties').textContent, /甲居民 · 籍北城.*乙居民 · 籍西城/);
    setLang('en'); env.dom.root.replaceChildren();
    renderMaterialsMarket(env.ctx, env.dom.root); await tick();
    assert.match(env.dom.root.querySelector('.market-parties').textContent, /of North City.*of West City/);
  } finally { env.restore(); }
});

test('market filters combine before pagination and preserve settled history without mutating the world', () => {
  const w = { premise: 6, orders: {}, services: {} };
  for (let i = 1; i <= 45; i++) w.orders[`so${i}`] = order(`so${i}`);
  w.orders.so46 = order('so46', { status: 'completed' });
  w.orders.so47 = order('so47', { status: 'completed' });
  w.orders.so48 = order('so48', { status: 'completed', requester: 'a3', provider: 'a4' });
  const before = structuredClone(w);
  const args = { status: 'completed', kind: 'repair', agent: 'a1', limit: 1 };
  assert.deepEqual(materialLook(w, 'orders', args).map(o => o.id), ['so46']);
  assert.deepEqual(materialLook(w, 'orders', { ...args, after: 'so46' }).map(o => o.id), ['so47']);
  assert.deepEqual(materialLook(w, 'demands', { ...args, kind: 'document' }), []);
  w.services.s1 = { id: 's1', status: 'active', provider: 'a1', criterionTemplate: { kind: 'repair' } };
  w.services.s2 = { id: 's2', status: 'withdrawn', provider: 'a1', criterionTemplate: { kind: 'repair' } };
  assert.deepEqual(materialLook(w, 'services', { kind: 'repair', agent: 'a1' }).map(s => s.id), ['s1']);
  assert.deepEqual(w.orders, before.orders);
});

test('market is read-only, shows citywide orders, names, escrow, outcomes and safe AI content', async () => {
  const env = setup(() => ok([order('so1', { title: '<script>unsafe</script>', status: 'completed', progress: 500, escrow: 0, closedTick: 24, reason: 'criterion_met', evidence: [{ key: 'action:1:2', amount: 500 }] })]));
  try {
    await renderMaterialsMarket(env.ctx, env.dom.root);
    button(env.dom.root, '全部订单').click(); await tick();
    assert.match(env.calls.at(-1).path, /^\/api\/public\/orders\?/);
    assert.ok(!env.calls.at(-1).path.includes('agent='));
    assert.equal(env.dom.root.querySelector('input'), null);
    assert.equal(env.dom.root.querySelector('form'), null);
    assert.equal(env.dom.root.querySelector('script'), null);
    assert.match(env.dom.root.textContent, /甲居民.*乙居民/s);
    assert.match(env.dom.root.textContent, /已达到交付条件/);
    assert.match(env.dom.root.textContent, /已支付报酬300 词元/);
    assert.match(env.dom.root.textContent, /第 3 日 · 第 1 刻/);
    assert.match(env.dom.root.querySelector('.market-title .ai').textContent, /<script>/);
    assert.doesNotMatch(env.dom.root.textContent, /确认发布|确认条款|居民访问令牌|提交成果|撤回订单/);
  } finally { env.restore(); }
});

test('filter changes reset pagination, while redraw preserves filters, cursor and expanded details', async () => {
  const env = setup(path => ok(Array.from({ length: 20 }, (_, i) => order(`so${new URL(path, 'http://local').searchParams.has('after') ? i + 21 : i + 1}`))));
  try {
    await renderMaterialsMarket(env.ctx, env.dom.root);
    button(env.dom.root, '全部订单').click(); await tick();
    const resident = env.dom.root.querySelector('select[aria-label="居民"]'); resident.value = 'a1'; resident.fire('change'); await tick();
    const status = env.dom.root.querySelector('select[aria-label="订单状态"]'); status.value = 'completed'; status.fire('change'); await tick();
    const kind = env.dom.root.querySelector('select[aria-label="任务类型"]'); kind.value = 'repair'; kind.fire('change'); await tick();
    button(env.dom.root, '下一页').click(); await tick();
    assert.match(env.calls.at(-1).path, /agent=a1&kind=repair&status=completed&after=so20/);
    const detail = env.dom.root.querySelector('details'); detail.open = true; detail.fire('toggle');
    env.dom.root.replaceChildren(); await renderMaterialsMarket(env.ctx, env.dom.root);
    assert.match(env.calls.at(-1).path, /after=so20/);
    assert.equal(env.dom.root.querySelector('details').open, true);
    button(env.dom.root, '清除筛选').click(); await tick();
    assert.doesNotMatch(env.calls.at(-1).path, /agent=|kind=|status=|after=/);
  } finally { env.restore(); }
});

test('late responses cannot overwrite a new view; errors, retry, empty and English states are readable', async () => {
  let resolveFirst, count = 0;
  const env = setup(() => ++count === 1 ? new Promise(resolve => { resolveFirst = resolve; }) : ok([order('so99')]));
  try {
    const initial = renderMaterialsMarket(env.ctx, env.dom.root);
    assert.match(env.dom.root.textContent, /正在加载/);
    button(env.dom.root, '需求大厅').click(); await tick();
    resolveFirst(ok([order('so1', { title: '过时结果' })])); await initial;
    assert.doesNotMatch(env.dom.root.textContent, /过时结果/);
    globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => null });
    button(env.dom.root, '刷新').click(); await tick();
    assert.match(env.dom.root.textContent, /无权查看/);
    globalThis.fetch = async () => ok([]);
    button(env.dom.root, '重试').click(); await tick();
    assert.match(env.dom.root.textContent, /暂无交易记录/);
    setLang('en'); env.dom.root.replaceChildren(); await renderMaterialsMarket(env.ctx, env.dom.root);
    assert.match(env.dom.root.textContent, /No trade records/);
    assert.match(env.dom.root.textContent, /All orders/);
    assert.equal(marketTime(12, 12), 'Day 2 · Tick 1');
    assert.equal(marketTime(null, 12), '—');
  } finally { env.restore(); }
});

test('program services show automatic delivery, input instructions and safe results in both languages',async()=>{
  const service={id:'sv1',provider:'a2',title:'维修预算计算器',description:'计算维修预算',price:5,status:'active',program:'pg1',inputDescription:'输入预算与单价',criterionTemplate:{kind:'program'}};
  const delivered=order('so1',{serviceId:'sv1',program:'pg1',terms:{price:5,criterion:{kind:'program'}},status:'completed',progress:1,escrow:0,reason:'program_delivered',closedTick:0,input:'{"budget":100}',output:'"<script>alert(1)</script>"'});
  const env=setup(path=>ok([path.includes('/orders')?delivered:service]));
  try {
    await renderMaterialsMarket(env.ctx,env.dom.root);
    button(env.dom.root,'服务告示').click();await tick();
    assert.match(env.dom.root.textContent,/程序服务/);assert.match(env.dom.root.textContent,/输入预算与单价/);assert.match(env.dom.root.textContent,/购买后自动运行/);
    assert.doesNotMatch(env.dom.root.textContent,/等待接单|undefined 刻/);
    button(env.dom.root,'全部订单').click();await tick();
    assert.match(env.dom.root.textContent,/程序结果已交付/);assert.match(env.dom.root.textContent,/购买输入/);assert.match(env.dom.root.textContent,/运行结果/);
    assert.equal(env.dom.root.querySelector('script'),null);assert.match(env.dom.root.querySelector('pre.market-program-result').textContent,/budget/);
    setLang('en');env.dom.root.replaceChildren();await renderMaterialsMarket(env.ctx,env.dom.root);
    assert.match(env.dom.root.textContent,/Program result delivered/);assert.match(env.dom.root.textContent,/Program result/);
  } finally {env.restore();}
});
