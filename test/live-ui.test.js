import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { renderLive, liveAppend, refreshLive } from '../public/tabs1.js';
import { setLang } from '../public/i18n.js';

const event = (seq, extra = {}) => ({ seq, tick: 1, day: 0, type: 'say', agent: 'a1000', place: 'agora', data: { text: `消息${seq}` }, ...extra });

test('实况：1000 人分页搜索，相关居民与地点/类型组合筛选，更新与节点上限', () => {
  const dom = installFakeDom();
  setLang('zh');
  const agents = Array.from({ length: 1000 }, (_, i) => ({ id: `a${i + 1}`, name: `居民${i + 1}`, status: 'awake' }));
  const ctx = { S: { state: { agents }, events: [event(1), event(2, { agent: 'a1', data: { text: '收到', to: 'a1000' } }), event(3, { agent: 'a1' })] },
    agent: (id) => agents.find((a) => a.id === id),
    agentName: (id) => agents.find((a) => a.id === id)?.name || id, placeOrder: () => ['agora', 'well'], placeName: (id) => id,
    openAgent() {}, openPlace() {}, groupName: (id) => id };
  try {
    renderLive(ctx, dom.root);
    const picker = dom.root.querySelector('details');
    const options = () => picker.querySelectorAll('.live-resident-options > button');
    const paging = picker.querySelectorAll('.live-resident-pages > button');
    assert.equal(options().length, 20);
    assert.match(picker.textContent, /1000 位居民 · 1\/50 页/);
    paging[1].click();
    assert.match(options()[0].textContent, /居民21/);
    assert.equal(options().length, 20);
    const search = picker.querySelector('input');
    search.value = 'a1000'; search.fire('input');
    assert.equal(options().length, 1);
    options()[0].click();
    const rows = () => dom.root.querySelectorAll('.feed > li.ev');
    assert.deepEqual(rows().map((r) => r.dataset.seq), [2, 1], '包含该居民收到的消息');
    const selects = dom.root.querySelectorAll('select');
    selects[0].value = 'well'; selects[0].fire('change');
    assert.equal(rows().length, 0);
    liveAppend(ctx, event(4, { place: 'well' }));
    assert.deepEqual(rows().map((r) => r.dataset.seq), [4]);
    selects[1].value = 'econ'; selects[1].fire('change');
    liveAppend(ctx, event(5, { place: 'well' }));
    assert.equal(rows().length, 0, '实时追加也应用类型筛选');
    selects[0].value = ''; selects[0].fire('change');
    selects[1].value = ''; selects[1].fire('change');
    for (let seq = 10; seq < 410; seq++) liveAppend(ctx, event(seq));
    assert.equal(rows().length, 200);
    assert.equal(rows()[0].dataset.seq, 409);
    ctx.S.events = [event(500)]; refreshLive();
    assert.deepEqual(rows().map((r) => r.dataset.seq), [500], '重连补回窗口显示到当前页面');
    liveAppend(ctx, event(501, { agent: 'a1' }), [event(500)]);
    assert.equal(rows().length, 0, '不匹配的新消息也淘汰窗口外的旧消息');
    assert.ok(dom.root.querySelector('.feed .empty'));
    search.value = '不存在'; search.fire('input');
    assert.equal(options().length, 0);
    assert.match(picker.textContent, /没有找到居民/);
    agents.push({ id: 'a1001', name: '新居民', status: 'dormant' });
    search.value = '新居民'; search.fire('input');
    assert.equal(options().length, 1, '读取最新居民列表');
    picker.querySelector('.live-resident-menu > button').click();
    assert.match(picker.querySelector('summary').textContent, /全部/);
  } finally { dom.restore(); }
});
