// 观测站（public/）的静态与逻辑测试：不需要浏览器。
// 文本完整性（中英键一致、每种事件都有模板、占位符有取值）、CSP 兼容性（没有内联脚本/样式、没有 innerHTML）、
// index.html 的元素与 app.js 引用一致、前端的法律效力描述与引擎一致、静态文件由服务器正确提供。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { L } from '../src/lore/index.js';
import { describeEffect as serverDescribeEffect } from '../src/engine/laws.js';
import { publicState, publicEvent } from '../src/engine/visibility.js';
import { runSandbox } from '../src/sandbox/run.js';
import { snapshotP, restoreP, configureWeather } from '../src/params.js';
import { configureSandbox } from '../src/sandbox/brains.js';
import { STR, TPL, VARS, CAT, describeEvent, templateKey, setLang, getLang, t, fmt } from '../public/i18n.js';
import { describeEffect as clientDescribeEffect, bandOf, SEASON_TABLE } from '../public/render.js';
import { SEASON_TABLE as SERVER_SEASON, conditionBand } from '../src/params.js';
import { GLYPH_NAMES, GLYPH_HUE } from '../public/map-glyphs.js';
import { streetCurve, smoothPath } from '../public/map-terrain.js';
import { MAPS, publicMap } from '../src/map/index.js';
import { boot } from './http-helpers.js';
import { newWorld, reg } from './helpers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'public');
const read = (f) => readFileSync(join(PUB, f), 'utf8');
const jsFiles = readdirSync(PUB).filter((f) => f.endsWith('.js'));

const savedP = snapshotP();
test.after(() => {
  restoreP(savedP);
  configureSandbox({ scenario: 'default' });
  configureWeather({ mode: 'random' });
});

// ── 文本 ──────────────────────────────────────────────────────

test('i18n：中英两套界面用语与事件模板的键完全一致，且没有空文本', () => {
  assert.deepEqual(Object.keys(STR.zh).sort(), Object.keys(STR.en).sort());
  assert.deepEqual(Object.keys(TPL.zh).sort(), Object.keys(TPL.en).sort());
  for (const lang of ['zh', 'en']) {
    for (const [k, v] of Object.entries(STR[lang])) assert.ok(typeof v === 'string' && v.length > 0, `${lang}.${k}`);
    for (const [k, v] of Object.entries(TPL[lang])) assert.ok(typeof v === 'string' && v.length > 0, `${lang}.tpl.${k}`);
    // 占位符一致：同一个键的两种语言里用到同一批 {x}
    for (const k of Object.keys(STR.zh)) {
      const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      assert.equal(ph(STR.zh[k]), ph(STR.en[k]), `占位符不一致：${k}`);
    }
    for (const k of Object.keys(TPL.zh)) {
      const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      assert.equal(ph(TPL.zh[k]), ph(TPL.en[k]), `事件模板占位符不一致：${k}`);
    }
  }
});

test('i18n：代码里用到的 t("键") 都有定义（含按前缀拼出的键）', () => {
  const used = new Set();
  for (const f of jsFiles) {
    const src = read(f);
    for (const m of src.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)) used.add(m[1]);
  }
  const missing = [...used].filter((k) => !(k in STR.zh));
  assert.deepEqual(missing, []);
  // 动态键：t(`前缀_${x}`)
  const families = {
    status_: ['awake', 'dormant', 'dead', 'retired'],
    tab_: ['live', 'chronicle', 'laws', 'residents', 'groups', 'environment', 'library', 'cemetery', 'metrics', 'legacy', 'weather'],
    cat_: ['speech', 'econ', 'polity', 'life', 'know', 'env', 'world', 'admin'],
    kind_: ['canon', 'relic', 'agent'],
    charterStatus_: ['legacy', 'amended', 'repealed'],
    decided_: ['vote', 'random', 'schedule'],
  };
  for (const [prefix, names] of Object.entries(families)) for (const n of names) assert.ok(`${prefix}${n}` in STR.zh, `${prefix}${n}`);
  // 与 app.js 的标签页列表一致
  const tabs = [...read('app.js').matchAll(/\['([a-z]+)', render[A-Za-z]+\]/g)].map((m) => m[1]);
  assert.deepEqual(tabs, families.tab_);
});

// 引擎里所有会到达观众的事件类型
const NON_PUBLIC = new Set(['witness', 'will', 'ledger_mismatch', 'weather_scheduled', 'diary', 'dream', 'letter']);
function engineEventTypes() {
  const types = new Set();
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) for (const m of readFileSync(p, 'utf8').matchAll(/emit\(w, '([a-z_]+)'/g)) types.add(m[1]);
    }
  };
  walk(join(ROOT, 'src'));
  return [...types].filter((x) => !NON_PUBLIC.has(x)).sort();
}

test('事件模板：引擎发出的每一种公开事件类型都有中英模板与类别', () => {
  const types = engineEventTypes();
  assert.ok(types.length > 60, `只找到 ${types.length} 种`);
  for (const type of types) {
    assert.ok(type in VARS, `VARS 缺少 ${type}`);
    assert.ok(type in CAT, `CAT 缺少 ${type}`);
    // 该类型可能的模板键：type 本身，或按数据分叉出来的几种
    const keys = Object.keys(TPL.zh).filter((k) => k === type || k.startsWith(`${type}_`));
    assert.ok(keys.length >= 1, `没有 ${type} 的模板`);
  }
});

test('事件模板：真实事件（沙盘 260 日）的占位符都有取值，且不会抛错', () => {
  const raw = [];
  const { world } = runSandbox({ days: 260, agents: 16, seed: 5, onEvent: (e) => raw.push(e) });
  const pub = raw.map((e) => publicEvent(world, e, { released: true })).filter(Boolean);
  assert.ok(pub.length > 1000);
  const seenTypes = new Set();
  for (const lang of ['zh', 'en']) {
    setLang(lang);
    for (const e of pub) {
      const d = describeEvent(e);
      assert.notEqual(d.template, '{type}', `${e.type} 没有模板`);
      for (const m of d.template.matchAll(/\{(\w+)\}/g)) {
        assert.ok(m[1] in d.vars, `${lang} ${e.type}：模板里的 {${m[1]}} 没有取值`);
      }
      seenTypes.add(e.type);
    }
  }
  setLang('zh');
  for (const need of ['say', 'move', 'draw', 'repair', 'propose', 'vote', 'law_passed', 'day', 'born', 'death', 'trade', 'whisper']) {
    assert.ok(seenTypes.has(need), `沙盘里没有出现 ${need}`);
  }
});

test('事件模板：按数据分叉的类型选对模板；被遮盖的事件只显示说明', () => {
  assert.equal(templateKey({ type: 'offer_open', data: { to: 'a2' } }), 'offer_open_to');
  assert.equal(templateKey({ type: 'offer_open', data: { to: null } }), 'offer_open');
  assert.equal(templateKey({ type: 'offer_close', data: { reason: 'expired' } }), 'offer_close_expired');
  assert.equal(templateKey({ type: 'vote', data: { choice: 'no' } }), 'vote_no');
  assert.equal(templateKey({ type: 'vote', data: { choice: 'abstain' } }), 'vote_abstain');
  assert.equal(templateKey({ type: 'explore', data: { outcome: 'relic' } }), 'explore_relic');
  assert.equal(templateKey({ type: 'explore', data: { outcome: 'nothing' } }), 'explore_nothing');
  assert.equal(templateKey({ type: 'inscribe', data: { cover: 'i3' } }), 'inscribe_cover');
  assert.equal(templateKey({ type: 'revive', data: { by: 'a4' } }), 'revive_by');
  assert.equal(templateKey({ type: 'revive', data: { by: 'treasury' } }), 'revive');
  setLang('en');
  const red = describeEvent({ seq: 1, type: 'say', redacted: true, data: { text: { zh: '此处被幕后抹去', en: 'Erased from behind the curtain' } } });
  assert.equal(red.vars.text.text, 'Erased from behind the curtain');
  setLang('zh');
  // 未知类型不会丢失
  assert.deepEqual(describeEvent({ seq: 1, type: 'mystery', data: {} }).vars, { type: 'mystery' });
});

test('i18n：语言选择只认 zh / en；fmt 与 t 的占位符替换', () => {
  setLang('en');
  assert.equal(getLang(), 'en');
  setLang('fr');
  assert.equal(getLang(), 'en');
  setLang('zh');
  assert.equal(t('nextTick', { s: 7 }), '下一刻 7 秒');
  assert.equal(t('__missing__'), '__missing__');
  assert.equal(fmt('a {x} b {y}', { x: 1 }), 'a 1 b {y}');
});

// ── 与引擎的一致性 ────────────────────────────────────────────

test('前端的法律效力描述与引擎的 describeEffect 逐字一致（中英）', () => {
  const w = newWorld('ui-effects');
  const a = reg(w, '青禾');
  const b = reg(w, '松烟');
  w.groups.g1 = { id: 'g1', name: '同心会', manifesto: '', open: true, founder: a.id, steward: a.id, members: [a.id], pending: [], treasury: { energy: 0, coins: 0 }, createdDay: 0, dissolved: false };
  w.projects.j1 = { id: 'j1', type: 'road', name: '东街', place: 'agora', to: 'market', owner: { kind: 'city' }, inscription: null, need: 60, have: 10, contributors: {}, initiator: a.id, createdDay: 0, expiresDay: 24, status: 'open' };
  w.laws.l1 = { id: 'l1', proposalId: 'p1', title: '旧法', text: '', effects: [], results: [], enactedTick: 0, status: 'active', repealedBy: null };
  const wallId = Object.values(w.inscriptions)[0].id;
  const effects = [
    { type: 'set', param: 'rationShare', value: 0.75 },
    { type: 'set', param: 'votingInPerson', value: true },
    { type: 'set', param: 'drawQuotaPerDay', value: null },
    { type: 'set', param: 'drawQuotaPerDay', value: 5 },
    { type: 'set', param: 'electorate', value: 'all' },
    { type: 'set', param: 'electorate', value: 'group:g1' },
    { type: 'grant', to: a.id, energy: 5, coins: 2 },
    { type: 'grant', to: 'g1', energy: 9, coins: 0 },
    { type: 'stipend', to: b.id, energy: 3 },
    { type: 'fund', project: 'j1', energy: 20 },
    { type: 'exile', target: a.id },
    { type: 'pardon', target: b.id },
    { type: 'rename', target: 'city', name: '灯城' },
    { type: 'rename', target: 'temple', name: '回声堂' },
    { type: 'mint', coins: 30, to: 'treasury' },
    { type: 'mint', coins: 30, to: 'citizens' },
    { type: 'protect', inscription: wallId },
    { type: 'unprotect', inscription: wallId },
    { type: 'amend', article: 2, lang: 'en', text: 'Speech is free.' },
    { type: 'amend', article: 12, lang: 'zh', text: '新增的一条。' },
    { type: 'amend', article: 3, lang: 'zh', text: '' },
    { type: 'amend', canonical: 'zh' },
    { type: 'amend', canonical: null },
    { type: 'repeal', law: 'l1' },
  ];
  const state = JSON.parse(JSON.stringify(publicState(w)));
  const idx = (list) => new Map(list.map((x) => [x.id, x]));
  const agents = idx(state.agents);
  const groups = idx(state.groups);
  const places = idx(state.places);
  for (const lang of ['zh', 'en']) {
    const ctx = {
      S: { state },
      lore: L(lang),
      agentName: (id) => (agents.get(id) ? agents.get(id).name : id),
      groupName: (id) => (groups.get(id) ? groups.get(id).name : id),
      placeName: (id) => (places.get(id) && places.get(id).renamedBy ? places.get(id).name : L(lang).place[id].name),
    };
    for (const e of effects) {
      assert.equal(clientDescribeEffect(ctx, e), serverDescribeEffect(w, e, lang), `${lang} ${JSON.stringify(e)}`);
    }
  }
});

test('前端常量与引擎一致：季节表、完好度档位；每张地图用到的图形前端都画得出', () => {
  assert.deepEqual(SEASON_TABLE, [...SERVER_SEASON]);
  for (const bp of [0, 1, 2999, 3000, 5999, 6000, 8999, 9000, 10000]) assert.equal(bandOf(bp), conditionBand(bp), String(bp));
  for (const m of Object.values(MAPS)) {
    for (const p of m.places) {
      assert.ok(GLYPH_NAMES.includes(p.glyph), `${m.id}.${p.id} 的图形 ${p.glyph} 没有画法`);
      assert.ok(GLYPH_HUE[p.glyph], `${m.id}.${p.id} 的图形 ${p.glyph} 没有色系`);
    }
    // 街道曲线与平滑折线是确定的纯函数（地图数据 → 路径）
    const xy = Object.fromEntries(m.places.map((p) => [p.id, p.xy]));
    for (const e of m.edges) {
      const c = streetCurve(xy, e.a, e.b);
      assert.match(c.d, /^M[\d.-]+,[\d.-]+ Q/);
      assert.deepEqual(streetCurve(xy, e.a, e.b), c);
    }
    if (m.terrain.coast) assert.match(smoothPath(m.terrain.coast), /^M.* C/);
  }
  // 前端只从 /api/public/map 取地图：地图数据可以序列化，且不含任何世界状态
  assert.equal(JSON.stringify(publicMap({ map: 'frontier' })).length > 1000, true);
});

// ── 静态文件 ──────────────────────────────────────────────────

test('CSP 兼容：没有内联脚本 / 样式 / style 属性，没有 innerHTML 之类的危险 API', () => {
  const html = read('index.html');
  assert.ok(!/<style[\s>]/i.test(html), '内联 <style>');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), '内联 <script>');
  assert.ok(!/\sstyle\s*=/i.test(html), 'style 属性');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), '内联事件处理器');
  assert.ok(/<script type="module" src="app\.js"><\/script>/.test(html));
  const banned = /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|setAttribute\(\s*['"]style['"]|\.cssText|javascript:|setTimeout\(\s*['"]|setInterval\(\s*['"]/;
  for (const f of jsFiles) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const m = src.match(banned);
    assert.equal(m, null, `${f} 含有 ${m && m[0]}`);
  }
  const css = read('style.css');
  assert.ok(!/@import/.test(css));
  assert.ok(!/url\(\s*['"]?https?:/.test(css), '不应引用外部资源');
});

test('index.html 里有 app.js 需要的全部元素（按 id）', () => {
  const html = read('index.html');
  const app = read('app.js');
  const list = app.match(/for \(const id of \[([^\]]+)\]\)/);
  assert.ok(list, '找不到 id 列表');
  const ids = [...list[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(ids.length >= 15);
  for (const id of ids) assert.ok(new RegExp(`id="${id}"`).test(html), `index.html 缺少 #${id}`);
});

test('agent 的文字只经 textContent / 文本节点渲染：dom.js 的 h() 不解析 HTML', () => {
  const dom = read('dom.js');
  assert.ok(dom.includes('createTextNode'));
  assert.ok(dom.includes('textContent'));
  assert.ok(!/innerHTML/.test(dom));
  // 用到的图标与地图文字都来自 textContent
  assert.ok(/\.textContent = /.test(read('map.js')));
});

test('静态文件：GET / 与各模块 200，带 CSP 与正确的 MIME；/api/public/lore 可用；路径穿越被拒', async () => {
  const env = await boot();
  try {
    const idx = await env.call('/');
    assert.equal(idx.status, 200);
    assert.match(idx.headers.get('content-type'), /text\/html/);
    assert.match(idx.headers.get('content-security-policy'), /script-src 'self'/);
    for (const f of [...jsFiles, 'style.css']) {
      const r = await env.call(`/${f}`);
      assert.equal(r.status, 200, f);
      assert.match(r.headers.get('content-type'), f.endsWith('.css') ? /text\/css/ : /javascript/, f);
      assert.equal(r.text, read(f), `${f} 内容与磁盘一致`);
    }
    for (const p of ['/..%2fserver.js', '/%2e%2e/package.json', '/../package.json']) assert.ok([403, 404].includes((await env.call(p)).status), p);
    assert.equal((await env.call('/api/public/lore?lang=en')).status, 200);
  } finally {
    await env.close();
  }
});

test('前端引用的公共接口都存在（按路径前缀）', async () => {
  const env = await boot();
  try {
    const used = new Set();
    for (const f of jsFiles) for (const m of read(f).matchAll(/['`](\/api\/[a-z/]+)/g)) used.add(m[1]);
    assert.ok(used.size >= 10, [...used].join(' '));
    for (const p of used) {
      const path = p.replace(/\/$/, '');
      if (path === '/api/public/agents' || path === '/api/public/docs') continue; // 带 id 的接口，下面单独试
      if (path === '/api/public/stream') continue; // SSE，长连接
      const method = ['/api/account/logout', '/api/port/register', '/api/port/adopt', '/api/port/foster', '/api/owner/letter', '/api/owner/release', '/api/public/weather/vote'].includes(path) ? 'POST' : 'GET';
      const r = await env.call(path, method === 'POST' ? { method, body: {} } : {});
      assert.notEqual(r.status, 404, `${method} ${path} 不存在`);
    }
    assert.equal((await env.call('/api/public/agents/a1')).status, 404); // 没有 agent → 404（接口存在）
  } finally {
    await env.close();
  }
});

test('public/ 目录只有约定的文件', () => {
  const files = readdirSync(PUB).sort();
  for (const f of ['index.html', 'style.css', 'app.js', 'i18n.js', 'map.js', 'charts.js']) assert.ok(files.includes(f), f);
  assert.ok(existsSync(join(PUB, 'app.js')) && statSync(join(PUB, 'app.js')).size > 5000);
});
