// miniGame 0.3 界面：网站句式同源、事件流合并、换行规则、编年史拆分、未登录与审核中的降级。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { resolve, dirname } from 'node:path';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../wechat/minigame/', import.meta.url));
const feed = require('../wechat/minigame/utils/feed.js');
const text = require('../wechat/minigame/ui/text.js');
const { parseChronicle } = require('../wechat/minigame/utils/chronicle.js');
const fmt = require('../wechat/minigame/utils/format.js');

const ctx = { font: '', measureText: s => ({ width: Array.from(s).reduce((w, c) => w + (/[\x00-\x7f]/.test(c) ? 8 : 16), 0) }) };
const state = {
  world: { premise: 6, ticksPerDay: 12, day: 7, tick: 85, cityName: '无名之城', humanCityName: { zh: '无名之城', en: 'The Nameless City' } },
  agents: [{ id: 'a1', name: '石序', status: 'awake', place: 'well' }, { id: 'a3', name: '问潮', status: 'awake', place: 'wilds' }],
  places: [{ id: 'well', name: '源井', displayName: { zh: '源井' } }, { id: 'wilds', name: '近郊回收地', displayName: { zh: '近郊回收地' } }, { id: 'scrapyard', name: '废车场', displayName: { zh: '废车场' } }, { id: 'library', name: '档案馆', displayName: { zh: '档案馆' } }],
  publicRoles: [{ id: 'chronicler', name: '载简', duty: '史官', place: 'library', status: 'on_duty' }],
};
const ev = (seq, tick, type, data, extra = {}) => Object.assign({ seq, tick, day: Math.floor(tick / 12), type, data }, extra);

test('the miniGame event text module is generated from the website templates and stays in sync', async () => {
  const { buildSharedModule, SHARED_TARGET } = await import('../wechat/scripts/shared.mjs');
  assert.equal(readFileSync(resolve(root, SHARED_TARGET), 'utf8'), await buildSharedModule(), 'run: node wechat/scripts/shared.mjs');
  const shared = require('../wechat/minigame/utils/shared-text.js');
  const i18n = await import('../public/i18n.js');
  i18n.setLang('zh'); i18n.setPremise(6);
  for (const e of [ev(1, 85, 'explore', { outcome: 'energy', amount: 7332 }, { agent: 'a3', place: 'scrapyard' }), ev(2, 85, 'gather', { materials: 7, stock: 0 }, { agent: 'a3', place: 'scrapyard' }), ev(3, 84, 'day', { day: 6, output: 1025200, population: { awake: 5 } })]) {
    assert.deepEqual(shared.describe(e, 6), i18n.describeEvent(e), e.type);
  }
  assert.equal(shared.CATEGORY_LABELS.speech, '言语');
  assert.equal(shared.LORE.district.waterworks, '水脉');
});

test('the feed groups by tick, merges a resident\'s actions, summarizes exploration and folds the day end', () => {
  const events = [
    ev(1, 84, 'rule_op', { scope: 'city', owner: 'l3', op: 'share', from: 'treasury', among: 2, each: { energy: 123024 } }),
    ev(2, 84, 'material_regrowth', { zone: 'scrapyard', added: 7 }),
    ev(3, 84, 'material_regrowth', { zone: 'wilds', added: 20 }),
    ev(4, 84, 'day', { day: 6, output: 1025200, population: { awake: 2 } }),
    ev(5, 84, 'gather', { materials: 7, stock: 0 }, { agent: 'a3', place: 'scrapyard' }),
    ev(6, 84, 'move', { from: 'scrapyard', to: 'wilds' }, { agent: 'a3', place: 'wilds' }),
    ev(7, 85, 'explore', { outcome: 'energy', amount: 7332 }, { agent: 'a3', place: 'scrapyard' }),
    ev(8, 85, 'explore', { outcome: 'energy', amount: 20163 }, { agent: 'a3', place: 'scrapyard' }),
    ev(9, 85, 'say', { text: '我在源井。' }, { agent: 'a1', place: 'well' }),
    ev(10, 85, 'give', { from: 'a1', to: 'treasury', energy: 400000, materials: 0 }, { agent: 'a1', place: 'well' }),
    ev(11, 85, 'role_reply', { publicRoleId: 'chronicler', name: '载简', text: '今日无事。', source: 'fixed' }, { place: 'library' }),
    ev(12, 85, 'admin', { op: 'pause' }),
  ];
  const items = feed.buildFeed(events, state);
  const plain = segs => segs.map(s => s.text).join('');
  assert.deepEqual(items.filter(i => i.kind === 'group').map(i => i.label), ['第 8 日 · 第 2 刻', '第 8 日 · 第 1 刻']);
  const day = items.find(i => i.kind === 'day');
  assert.equal(day.title, '第 7 日结束');
  assert.deepEqual(day.facts.map(f => f.label + ' ' + f.value), ['源井出能 102.5万', '公民各得 12.3万', '回收地补充物料 27']);
  assert.ok(!items.some(i => i.type === 'rule_op' || i.type === 'material_regrowth'), 'folded into the day card');
  const merged = items.find(i => i.kind === 'merged');
  assert.equal(merged.count, 2); assert.deepEqual(merged.lines.map(plain), ['在废车场采集了 7 物料（余 0）。', '从废车场走向近郊回收地。']);
  const explore = items.find(i => i.icon === 'explore');
  assert.equal(plain(explore.sentence), '问潮 在废车场探索 2 次，共得 2.7万 词元。');
  const say = items.find(i => i.type === 'say');
  assert.equal(plain(say.header), '石序 在 源井 说'); assert.equal(say.text, '我在源井。'); assert.equal(say.ai, true);
  assert.equal(plain(items.find(i => i.type === 'give').sentence), '石序 给了 公库 40万 词元。', 'no "以及 0 物料"');
  const role = items.find(i => i.type === 'role_reply');
  assert.equal(role.ai, false, 'fixed role text is not AI output'); assert.equal(role.actor.role, 'chronicler');
  assert.ok(!items.some(i => i.type === 'admin'), 'backstage events stay hidden');
  assert.ok(feed.buildFeed(events, state, 'speech').every(i => i.kind === 'group' || i.cat === 'speech'));
});

test('withheld text becomes a locked bubble and neutral names, never a wall of placeholders', () => {
  const hidden = JSON.parse(JSON.stringify(state).replaceAll('"石序"', '"内容审核中"').replaceAll('"源井"', '"内容审核中"'));
  const items = feed.buildFeed([ev(1, 85, 'say', { text: '内容审核中' }, { agent: 'a1', place: 'well' }), ev(2, 85, 'move', { from: 'well', to: 'wilds' }, { agent: 'a1', place: 'wilds' })], hidden);
  const say = items.find(i => i.type === 'say'), move = items.find(i => i.type === 'move');
  assert.equal(say.locked, true);
  const all = JSON.stringify(items.map(i => [i.header, i.sentence, i.text]));
  assert.ok(!all.includes('内容审核中'), all);
  assert.equal(move.sentence.map(s => s.text).join(''), '一位居民 从某处走向近郊回收地。');
});

test('line breaking keeps closing punctuation off the line start, keeps English words whole and clamps with an ellipsis', () => {
  const lines = text.wrap(ctx, '甲乙丙丁戊己，庚辛', 96, '16px x');
  assert.ok(lines.every(l => !/^[，。、]/.test(l)), JSON.stringify(lines));
  const words = text.wrap(ctx, '共采 scrapyard 的集合', 120, '16px y');
  assert.ok(words.some(l => l.includes('scrapyard')), JSON.stringify(words));
  const clamped = text.clamp(ctx, '一二三四五六七八九十一二三四五六七八九十', 80, '16px z', 2);
  assert.equal(clamped.lines.length, 2); assert.ok(clamped.truncated); assert.ok(clamped.lines[1].endsWith('…'));
  const rich = text.wrapRich(ctx, [{ text: '问潮', font: 'a' }, { text: ' 在废车场采集了 7 物料。', font: 'b' }], 120);
  assert.equal(rich.map(r => r.runs.map(x => x.text).join('')).join(''), '问潮 在废车场采集了 7 物料。');
});

test('chronicle days split into stats, items, quotes and the chronicler\'s line', () => {
  const day = parseChronicle({ day: 6, text: '【第 7 日】源井出能 1025200，公民各得 123024。\n晦衡 在废车场拾得遗物。\n晦衡 在废车场拾得遗物。\n是日，有人在光伏遗址说：「同意共采安排。」\n史官曰：无事。无事亦是史。' });
  assert.equal(day.title, '第 7 日'); assert.equal(day.stats, '源井出能 102.5万，公民各得 12.3万。');
  assert.deepEqual(day.items, [{ text: '晦衡 在废车场拾得遗物。', count: 2 }]);
  assert.deepEqual(day.quotes, [{ place: '光伏遗址', text: '同意共采安排。' }]);
  assert.equal(day.coda, '无事。无事亦是史。');
  assert.equal(parseChronicle({ day: 1, text: '内容审核中' }).locked, true);
  assert.deepEqual([fmt.compact(2572279), fmt.compact(460000), fmt.compact(7332), fmt.pct(9220), fmt.dayTick(7, 85, 12)], ['257.2万', '46万', '7,332', '92%', '第 8 日 · 第 2 刻']);
});

test('the city screen shows system names and no placeholders when the projection withholds resident text', () => {
  const modules = new Map(), timers = [];
  const measure = new Proxy({ measureText: s => ({ width: Array.from(s).length * 8 }) }, { get: (t, k) => k in t ? t[k] : () => {}, set: () => true });
  const wx = { createCanvas: () => ({ getContext: () => measure }), getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 3, statusBarHeight: 47, safeArea: { bottom: 810 } }), getStorageSync: () => '' };
  function load(path) {
    path = resolve(path);
    if (modules.has(path)) return modules.get(path).exports;
    const module = { exports: {} }; modules.set(path, module);
    runInNewContext('(function(require,module,exports){' + readFileSync(path, 'utf8') + '\n})', { wx, setTimeout: f => timers.push(f), clearTimeout() {}, console })(name => load(resolve(dirname(path), name + '.js')), module, module.exports);
    return module.exports;
  }
  const { SocietyGame } = load(resolve(root, 'society.js'));
  const g = new SocietyGame();
  g.tab = 'city'; g.wechatVerified = false;
  g.state = JSON.parse(JSON.stringify(state).replaceAll('"无名之城"', '"内容审核中"').replaceAll('"石序"', '"内容审核中"'));
  g.state.well = { condition: 9220, outputHistory: [1025200] }; g.state.treasury = { energy: 2572279 };
  g.map = { size: [1200, 900], places: [{ id: 'well', xy: [600, 700] }], streets: [], terrain: {} };
  g.events = [ev(1, 85, 'say', { text: '内容审核中' }, { agent: 'a1', place: 'well' })];
  g.render();
  const shown = g.blocks.map(b => b.text).join('\n');
  assert.ok(!shown.includes('内容审核中'), shown);
  assert.ok(shown.includes('登录后可阅读居民的言论'));
  assert.equal(g.page.top.title, '后人纪');
  assert.ok(g.hits.some(h => h.action.type === 'sheet' && h.action.id === 'well'));
});
