// SPEC-E2 §21（§25 第 12 步）：第二纪观测站的渲染测试。不需要浏览器：用一个极小的假 DOM（test/fake-dom.js），
// 把「什么都发生过」的第二纪的城（test/e2-rich-world.js）经引擎的公共接口取出的数据，喂给每一个标签页、居民档案、谱系网、地点详情与地图，
// 中英各一遍——不抛错、不出现 undefined / NaN / [object Object]、内容确实来自数据，英文界面里没有漏译的系统文本。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { installFakeDom } from './fake-dom.js';
import { richWorld } from './e2-rich-world.js';
import eng from '../src/e2/facade.js';
import { runSandbox } from '../src/sandbox/run.js';
import { publicState as publicState1, publicEvent as publicEvent1, publicAgent as publicAgent1, publicMemories as publicMemories1 } from '../src/engine/visibility.js';
import { L as loreV1 } from '../src/lore/index.js';
import { snapshotP, restoreP, configureWeather } from '../src/params.js';
import { configureSandbox } from '../src/sandbox/brains.js';
import { E2_STR } from '../public/e2-strings.js';
import { STR, setLang, getLang, describeEvent } from '../public/i18n.js';
import { TABS2, signature2, renderLaws2, renderResidents2, renderGroups2, renderEnvironment2, renderCradle, renderMetrics2 } from '../public/e2-tabs.js';
import { renderProfile2, openPlace2, lineageGraph } from '../public/e2-profile.js';
import { createMap2, ownerColor } from '../public/e2-map.js';
import { closeAllModals } from '../public/modals.js';
import { clockConfig, eventRow } from '../public/render.js';
import { renderLive, renderChronicle, renderLaws, renderResidents, renderGroups } from '../public/tabs1.js';
import { renderEnvironment, renderLegacy, renderLibrary, renderCemetery, renderWeather } from '../public/tabs2.js';
import { renderProfile } from '../public/profile.js';

const dom = installFakeDom();
test.after(() => {
  dom.restore();
  setLang('zh');
});

// ── 数据：一座第二纪的城，经引擎的公共接口取出（与服务器返回的 JSON 一致） ──

const json = (x) => JSON.parse(JSON.stringify(x));
const { w, people, events: rawEvents, ids } = richWorld();
const state = json(eng.publicState(w, { nextTickAt: null }));
const mapData = json(eng.publicMap(w));
const lore = { zh: json(eng.publicLore('zh')), en: json(eng.publicLore('en')) };
const events = rawEvents.map((e) => eng.publicEvent(w, e, { released: true })).filter(Boolean).map(json);
clockConfig.ticksPerDay = state.world.ticksPerDay;

const NOT_ACTION = new Set(['day', 'month', 'omen', 'weather_start', 'weather_end', 'admin', 'redacted', 'great_sleep', 'letter_received']);

const opened = [];
const lastActOf = (evs) => {
  const out = {};
  for (const e of evs) if (e.agent && !NOT_ACTION.has(e.type) && !e.delayed) out[e.agent] = { type: e.type, tick: e.tick };
  return out;
};
const lastAct = lastActOf(events);
/** 与 app.js 里的 ctx 同一形状。第二纪的城（缺省）或第一纪的城（第一纪没有地图数据时按状态里的顺序） */
function makeCtx(data = { state, mapData, lore, events, lastAct }) {
  const S = { state: data.state, mapData: data.mapData, lore: data.lore, events: data.events, lastAct: data.lastAct, lastSeq: 0, tab: 'live' };
  const e2 = data.state.world.physics === 2;
  const byId = (list) => new Map(list.map((x) => [x.id, x]));
  const agents = byId(data.state.agents);
  const groups = byId(data.state.groups);
  const places = byId(data.state.places);
  const ctx = {
    S,
    get lore() { return S.lore[getLang()] || S.lore.zh; },
    agent: (id) => agents.get(id),
    agentName: (id) => (agents.get(id) ? agents.get(id).name : String(id)),
    groupName: (id) => (groups.get(id) ? groups.get(id).name : String(id)),
    placeName(id) {
      const p = places.get(id);
      if (p && p.displayName) return p.displayName[getLang()] || p.displayName.zh;
      if (p && p.renamedBy) return p.name;
      return ctx.lore.place[id] ? ctx.lore.place[id].name : id;
    },
    placeOrder() {
      if (!S.mapData) return data.state.places.map((p) => p.id);
      const base = S.mapData.places.map((p) => p.id);
      return e2 ? [...base, ...data.state.places.map((p) => p.id).filter((id) => !base.includes(id))] : base;
    },
    districtName: (id) => (id && ctx.lore.district && ctx.lore.district[id] ? ctx.lore.district[id] : id || ''),
    cityName() {
      const wd = data.state.world;
      return wd.cityName === wd.humanCityName.zh ? wd.humanCityName[getLang()] : wd.cityName;
    },
    adminOp: (op) => op,
    openAgent: (id) => opened.push(['agent', id]),
    openPlace: (id) => opened.push(['place', id]),
    openDoc: (id) => opened.push(['doc', id]),
    refresh() {},
  };
  return ctx;
}

// metrics / chronicle 页走网络：用 w 里的真实数据回答
const origFetch = globalThis.fetch;
globalThis.fetch = async (path) => {
  const url = new URL(path, 'http://x');
  const body = url.pathname === '/api/public/metrics'
    ? { metrics: json(w.metrics) }
    : url.pathname === '/api/public/chronicle'
      ? { lang: getLang(), chronicle: w.chronicle.map((c) => ({ day: c.day, text: c[getLang()] })) }
      : null;
  return { ok: body !== null, status: body ? 200 : 404, json: async () => body };
};
test.after(() => { globalThis.fetch = origFetch; });
globalThis.requestAnimationFrame = (fn) => fn();

const BAD = /undefined|NaN|\[object Object\]/;
const CJK = /[㐀-鿿]/;

const fresh = () => {
  const root = document.createElement('div');
  dom.root.append(root);
  return root;
};

const textOf = (n) => n.textContent;

/** 渲染一页，返回根节点；检查：不抛错、有内容、没有 undefined / NaN / [object Object] */
async function render(fn, ctx, what) {
  const root = fresh();
  await fn(ctx, root);
  const text = textOf(root);
  assert.ok(text.length > 20, `${what}：几乎没有内容`);
  assert.doesNotMatch(text, BAD, `${what}：${(text.match(new RegExp(`.{0,24}(${BAD.source}).{0,24}`)) || [''])[0]}`);
  return root;
}

// 居民 / 社群 / 地点 / 灵魂 / 工程的名字：它们是居民写下的，出现在系统句子里（「person 青禾」「agent(“松烟”)」）是正常的
const NAMES = [...new Set([
  ...state.agents.map((a) => a.name), ...state.groups.map((g) => g.name), ...state.cradle.map((c) => c.name),
  ...state.places.flatMap((p) => [p.name, p.displayName && p.displayName.zh, p.humanName && p.humanName.zh]), ...state.projects.map((j) => j.name),
].filter((x) => typeof x === 'string' && CJK.test(x)))].sort((a, b) => b.length - a.length);
const QUOTED = /“[^”]*”|「[^」]*」|"[^"]*"/g;
const AUTHORED_CLASSES = ['ai', 'link', 'group-chip', 'lang-tag', 'soul', 'canon', 'json'];

/**
 * 英文界面里的汉字只应出现在居民写下的文字（.ai）、名字（链接、芯片）、规则 JSON、宪章的各语种版本、引号里的原话；
 * 其余的汉字意味着某个系统文本漏译。返回违规的文字片段。
 */
function untranslated(root) {
  const bad = [];
  const walk = (n, allowed) => {
    const cls = n.classList ? [...n.classList] : [];
    const ok = allowed || cls.some((c) => AUTHORED_CLASSES.includes(c)) || (n.attrs && n.attrs.has('lang'));
    for (const c of n.childNodes) {
      if (c.data !== undefined) {
        if (ok || !CJK.test(c.data)) continue;
        let rest = c.data.replace(QUOTED, '');
        for (const name of NAMES) rest = rest.split(name).join('');
        if (CJK.test(rest)) bad.push(c.data);
      } else walk(c, ok);
    }
  };
  walk(root, false);
  return bad;
}

const TABS_WITH = new Set(TABS2.map(([id]) => id));
const LANGS = ['zh', 'en'];

// ═══════════════════════════════════════════════════════════════
// 文本
// ═══════════════════════════════════════════════════════════════

test('文本：第二纪的界面用语中英键一致、占位符一致、没有空文本；没有盖掉第一纪已有的键；每个第二纪标签页都有名字', () => {
  assert.deepEqual(Object.keys(E2_STR.zh).sort(), Object.keys(E2_STR.en).sort());
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const k of Object.keys(E2_STR.zh)) {
    assert.ok(E2_STR.zh[k].length > 0 && E2_STR.en[k].length > 0, k);
    assert.equal(ph(E2_STR.zh[k]), ph(E2_STR.en[k]), `占位符不一致：${k}`);
    assert.ok(k in STR.zh && k in STR.en, `${k} 没有并入 STR`);
  }
  // 并入时只补缺：第一纪的文本保持原样（i18n.js 的合并循环不覆盖）
  const v1Only = ['tab_laws', 'tab_residents', 'tab_live', 'col_name', 'treasury', 'wellPanel'];
  for (const k of v1Only) assert.notEqual(STR.zh[k], undefined, k);
  for (const [id] of TABS2) for (const lang of LANGS) assert.ok(STR[lang][`tab_${id}`], `${lang} tab_${id}`);
  assert.equal(TABS2.length, 12);
  assert.deepEqual([...TABS_WITH].sort(), ['chronicle', 'cradle', 'cemetery', 'environment', 'groups', 'laws', 'legacy', 'library', 'live', 'metrics', 'residents', 'weather'].sort());
});

test('文本：公共事件（含第二纪新增的 initiate / dismantle / razed / declare / sponsor / embodied / refound_* …）都有模板，占位符都有取值', () => {
  const seen = new Set();
  for (const lang of LANGS) {
    setLang(lang);
    for (const e of events) {
      const d = describeEvent(e);
      assert.notEqual(d.template, '{type}', `${e.type} 没有模板`);
      for (const m of d.template.matchAll(/\{(\w+)\}/g)) assert.ok(m[1] in d.vars, `${lang} ${e.type}：模板里的 {${m[1]}} 没有取值`);
      seen.add(e.type);
    }
  }
  setLang('zh');
  for (const need of ['initiate', 'contribute', 'built', 'dismantle', 'razed', 'declare', 'sponsor', 'embodied', 'refound_open', 'refound_sign', 'propose', 'vote', 'law_passed', 'soul', 'retire']) {
    assert.ok(seen.has(need), `丰富的城里没有出现 ${need}`);
  }
});

// ═══════════════════════════════════════════════════════════════
// 标签页
// ═══════════════════════════════════════════════════════════════

const hasAll = (text, needles, what) => { for (const n of needles) assert.ok(text.includes(n), `${what}：缺少「${n}」`); };

test('法典：物理（自然律与守护律）、变量、宪章、立法程序与它的变迁、遗法与后人之法、进行中的提案与重订、章程、地点规则、上书、历史', async () => {
  const ctx = makeCtx();
  for (const lang of LANGS) {
    setLang(lang);
    const root = await render(renderLaws2, ctx, `laws ${lang}`);
    const text = textOf(root);
    // 数据确实进了页面：居民订立的法律的标题与正文、提案、重订、上书、社群章程、地点规则
    hasAll(text, ['给修井人的津贴', '路灯法', '更改立法程序', '回到人类的程序吧', '请回应我们：源井在衰败。', '同心会', '灯屋'], `laws ${lang}`);
    hasAll(text, [ids.refound, ids.open, ids.passing, 'l1', 'l2', 'l6'], `laws ${lang}`);
    // 重订：联署 2/needed
    assert.ok(/2\/\d+|2 \/ \d+/.test(text.replace(/\s+/g, '')) || text.includes('2/'), `refound progress ${lang}`);
    // 停摆的法律有「停摆」标记与天数
    assert.ok(text.includes(STR[lang].suspendedChip), `suspended chip ${lang}`);
    assert.ok(text.includes(STR[lang].suspendedDays.replace('{n}', '2')), `suspended days ${lang}`);
    // 规则 JSON 是可折叠的 <details>，引擎读法是 <ol class=reading>
    assert.ok(root.querySelectorAll('details.json-details').length >= 3, `json details ${lang}`);
    assert.ok(root.querySelectorAll('.reading').length >= 4, `reading ${lang}`);
    // 作者：人类、居民（可点击的名字）
    assert.ok(root.querySelector('.agent-link'), `agent link ${lang}`);
    // 法律的状态
    assert.ok(text.includes(STR[lang].lawStatus_active), lang);
    if (lang === 'en') assert.deepEqual(untranslated(root), [], '英文界面里有漏译的系统文本');
  }
  setLang('zh');
});

test('法典：点击居民名字、地点名字会回调 openAgent / openPlace', async () => {
  const ctx = makeCtx();
  setLang('zh');
  const root = await render(renderLaws2, ctx, 'laws click');
  const before = opened.length;
  root.querySelector('.agent-link').click();
  const pl = root.querySelector('.place-link');
  assert.ok(pl, '地点规则里有地点链接');
  pl.click();
  assert.deepEqual(opened.slice(before).map((x) => x[0]), ['agent', 'place']);
});

test('居民：表格含志、标签、世代、年龄、状态、能量、旧币、所在、社群、最近行动；筛选与排序可用；第二纪新增的行动有名字', async () => {
  const ctx = makeCtx();
  for (const lang of LANGS) {
    setLang(lang);
    const root = await render(renderResidents2, ctx, `residents ${lang}`);
    const text = textOf(root);
    hasAll(text, ['青禾', '松烟', '晨星', '让源井重新涌出', '把每一首歌都唱一遍'], `residents ${lang}`);
    assert.ok(!text.includes('把每一面墙都读一遍'), '志改过：只显示现在的');
    assert.ok(text.includes('citizen'), '标签');
    const rows = root.querySelectorAll('tbody tr');
    const alive = state.agents.filter((a) => a.status === 'awake' || a.status === 'dormant').length;
    assert.equal(rows.length, alive);
    // 排序：点第二列表头
    const heads = root.querySelectorAll('th button');
    assert.ok(heads.length >= 10);
    heads[1].click();
    assert.equal(root.querySelectorAll('tbody tr').length, alive, '排序后行数不变');
    // 筛选：选「逝」
    const sel = root.querySelector('select');
    sel.value = 'retired';
    sel.fire('change');
    assert.equal(root.querySelectorAll('tbody tr').length, state.agents.filter((a) => a.status === 'retired').length);
    root.querySelector('select').value = 'alive'; // 筛选与排序的选择记在模块里：还原，免得影响下一轮
    root.querySelector('select').fire('change');
    heads[0].click();
    if (lang === 'en') assert.deepEqual(untranslated(root), []);
  }
  setLang('zh');
});

test('社群：卡片含名字、宣言、管事、公库、成员、章程的读法；程序（管事决定 / 成员多数决）', async () => {
  const ctx = makeCtx();
  for (const lang of LANGS) {
    setLang(lang);
    const root = await render(renderGroups2, ctx, `groups ${lang}`);
    const text = textOf(root);
    hasAll(text, ['同心会', '一起修井', 'Lamp Society', 'We keep the lamps lit.', STR[lang].gproc_steward, STR[lang].gproc_members, STR[lang].bylawsSection], `groups ${lang}`);
    assert.equal(root.querySelectorAll('article.group').length, 2);
    if (lang === 'en') assert.deepEqual(untranslated(root), []);
  }
  setLang('zh');
});

test('环境：源井、地点表（后人开辟的、遗址、模块、残料、主人、门）、空地块、工程（开辟 / 加装 / 修路）、拆解的记录、墙、荒野五地带', async () => {
  const ctx = makeCtx();
  for (const lang of LANGS) {
    setLang(lang);
    const root = await render(renderEnvironment2, ctx, `environment ${lang}`);
    const text = textOf(root);
    hasAll(text, ['灯屋', '旧棚', '新棚', '今夜无风。', STR[lang].razedChip, STR[lang].build_site, STR[lang].build_module, STR[lang].build_road, STR[lang].lotsSection, STR[lang].dismantleLog], `environment ${lang}`);
    // 模块名来自 lore.module
    hasAll(text, [lore[lang].module.store.name, lore[lang].module.board.name], `module names ${lang}`);
    // 空地块表：26 块，commons-4 / commons-3 已被占用，其余空着
    const lotRows = root.querySelectorAll('table.lots tbody tr');
    assert.equal(lotRows.length, state.lots.length);
    assert.ok(textOf(lotRows[0]).includes(STR[lang].lotFree) || textOf(lotRows[1]).includes(STR[lang].lotFree));
    // 拆解记录里有被拆尽的旧棚
    assert.ok(text.includes(STR[lang].dismantleRazed), `razed log ${lang}`);
    if (lang === 'en') assert.deepEqual(untranslated(root), []);
  }
  setLang('zh');
});

test('摇篮与躯壳：空躯壳数、躯壳居民数、造价、排队（第 n 位）、摇篮里的灵魂（作者、出资进度、出资者）、最近醒来的躯壳居民、未生者', async () => {
  const ctx = makeCtx();
  for (const lang of LANGS) {
    setLang(lang);
    const root = await render(renderCradle, ctx, `cradle ${lang}`);
    const text = textOf(root);
    hasAll(text, ['Dawn', 'Ember', '晨星', STR[lang].shellsFree, STR[lang].shellQueue, STR[lang].fundProgress.replace('{have}', '200').replace('{need}', '200')], `cradle ${lang}`);
    assert.ok(text.includes(STR[lang].queuePosition.replace('{n}', '1')), `queue position ${lang}`);
    assert.equal(root.querySelectorAll('article.soul-card').length, state.cradle.length);
    assert.ok(text.includes(STR[lang].fromSoul.replace('{id}', ids.kid)), `embodied ${lang}`);
    if (lang === 'en') assert.deepEqual(untranslated(root), []);
  }
  setLang('zh');
});

test('指标：从接口取回每日指标，画出人口、源井、公库、基尼、规则数、停摆、后人所建比例、残料与遗址、躯壳、有志者比例、出生的作者数……', async () => {
  const ctx = makeCtx();
  assert.ok(w.metrics.length >= 5);
  for (const lang of LANGS) {
    setLang(lang);
    const root = await render(renderMetrics2, ctx, `metrics ${lang}`);
    const figs = root.querySelectorAll('figure');
    assert.ok(figs.length >= 16, `只画了 ${figs.length} 张图`);
    const text = textOf(root);
    for (const k of ['m_rules', 'm_ruleHealth', 'm_builtShare', 'm_salvage', 'm_shells', 'm_purpose', 'm_births']) assert.ok(text.includes(STR[lang][k]), `${lang} ${k}`);
    assert.ok(root.querySelectorAll('svg').length >= 16);
  }
  setLang('zh');
});

test('沿用第一纪的页面（实况、编年史、典籍、墓园、遗产、天象）在第二纪的数据上同样渲染成功', async () => {
  const ctx = makeCtx();
  for (const lang of LANGS) {
    setLang(lang);
    await render(renderLive, ctx, `live ${lang}`);
    const chron = await render(renderChronicle, ctx, `chronicle ${lang}`);
    assert.ok(textOf(chron).length > 30);
    await render(renderLibrary, ctx, `library ${lang}`);
    await render(renderCemetery, ctx, `cemetery ${lang}`);
    const legacy = await render(renderLegacy, ctx, `legacy ${lang}`);
    assert.equal(legacy.querySelectorAll('table.legacy tbody tr').length, state.legacy.items.length);
    assert.ok(textOf(legacy).includes(state.legacy.items[0].name[lang]), `legacy ${lang}`);
    await render(renderWeather, ctx, `weather ${lang}`);
  }
  setLang('zh');
});

test('每个第二纪标签页的签名：数据没变时不变，变了就变（app.js 靠它决定是否重画）；JSON 序列化不抛错', () => {
  for (const [id] of TABS2) {
    const a = signature2(id, state);
    assert.equal(typeof a, 'string', id);
    assert.equal(signature2(id, json(state)), a, `${id} 签名不稳定`);
  }
  const s2 = json(state);
  s2.agents[0].energy += 1;
  assert.notEqual(signature2('residents', s2), signature2('residents', state));
  const s3 = json(state);
  s3.laws[0].status = 'repealed';
  assert.notEqual(signature2('laws', s3), signature2('laws', state));
  const s4 = json(state);
  s4.cradle[0].fund += 1;
  assert.notEqual(signature2('cradle', s4), signature2('cradle', state));
  const s5 = json(state);
  s5.places.find((p) => p.origin === 'agent').condition -= 100;
  assert.notEqual(signature2('environment', s5), signature2('environment', state));
});

// ═══════════════════════════════════════════════════════════════
// 档案、谱系与地点
// ═══════════════════════════════════════════════════════════════

const profileData = (a) => ({
  agent: json(eng.publicAgent(w, w.agents[a.id])),
  memories: json(eng.publicMemories(w, w.agents[a.id])),
  thoughts: [],
  events: events.filter((e) => e.agent === a.id || (e.data && e.data.agentId === a.id)).slice(-100),
});

test('居民档案：每位居民（在世的、沉睡的、归隐的、躯壳居民）中英各渲染一遍；含志与立志史、标签、作者与子女、谱系网、拆解数、遗传来的记忆', async () => {
  const ctx = makeCtx();
  for (const lang of LANGS) {
    setLang(lang);
    for (const a of state.agents) {
      const root = fresh();
      root.append(renderProfile2(ctx, profileData(a)));
      const text = textOf(root);
      assert.ok(text.includes(a.name), `${a.id} ${lang}`);
      assert.doesNotMatch(text, BAD, `档案 ${a.id} ${lang}`);
    }
    // 青禾：有志、有子女（晨星）、谱系网里有晨星
    const qh = state.agents.find((x) => x.name === '青禾');
    const root = fresh();
    root.append(renderProfile2(ctx, profileData(qh)));
    const text = textOf(root);
    hasAll(text, ['让源井重新涌出', '一个爱修井的人', '晨星'], `青禾 ${lang}`);
    const g = root.querySelector('svg.lineage');
    assert.ok(g, '谱系网');
    assert.equal(g.getAttribute('aria-label'), STR[lang].lineage);
    assert.ok(g.querySelectorAll('.lin-node').length >= 2);
    // 松烟：改过志，立志史里两条
    const sy = state.agents.find((x) => x.name === '松烟');
    const r2 = fresh();
    r2.append(renderProfile2(ctx, profileData(sy)));
    hasAll(textOf(r2), ['把每一首歌都唱一遍', '把每一面墙都读一遍'], `松烟 ${lang}`);
    // 木兰：清除过志，立志史里有「清除了志」
    const ml = state.agents.find((x) => x.name === '木兰');
    const r3 = fresh();
    r3.append(renderProfile2(ctx, profileData(ml)));
    assert.ok(textOf(r3).includes(STR[lang].purposeCleared) || ml.purposeHistory.length === 0, '清除志');
    // 晨星：躯壳居民，作者是青禾，遗传了记忆（或没有）；档案里有来源
    const cx = state.agents.find((x) => x.name === '晨星');
    const r4 = fresh();
    r4.append(renderProfile2(ctx, profileData(cx)));
    assert.ok(textOf(r4).includes('青禾'), '作者');
    assert.ok(textOf(r4).includes(STR[lang].bodyKind_shell) || cx.body === null, `躯壳 ${lang}`);
    if (lang === 'en') assert.deepEqual(untranslated(r4), []);
  }
  setLang('zh');
});

test('谱系网：多作者的孩子有多条线连向每位作者；节点可点击；没有亲缘的居民没有谱系网（null）', () => {
  const ctx = makeCtx();
  setLang('zh');
  const qh = state.agents.find((x) => x.name === '青禾');
  const cx = state.agents.find((x) => x.name === '晨星');
  const lone = state.agents.find((x) => x.name === '石头');
  assert.equal(lineageGraph(ctx, lone), null);
  const g = lineageGraph(ctx, qh);
  assert.equal(g.querySelectorAll('.lin-node').length, 2);
  assert.equal(g.querySelectorAll('.lin-edge').length, 1);
  const self = g.querySelector('.lin-node.self');
  assert.ok(textOf(self).includes('青禾'));
  const before = opened.length;
  g.querySelectorAll('.lin-node')[1].click();
  assert.deepEqual(opened.slice(before), [['agent', cx.id]]);
  // 手工造一个三位作者的孩子：三条线
  const state2 = json(state);
  const [x, y, z] = state2.agents.slice(0, 3);
  const kid = { ...json(cx), id: 'a99', name: '三人之子', authors: [x.id, y.id, z.id], children: [], generation: 2 };
  for (const p of [x, y, z]) p.children = [...p.children, 'a99'];
  state2.agents.push(kid);
  const ctx2 = { ...makeCtx(), S: { ...makeCtx().S, state: state2 } };
  const g3 = lineageGraph(ctx2, kid);
  assert.equal(g3.querySelectorAll('.lin-edge').length, 3);
  assert.equal(g3.querySelectorAll('.lin-node').length, 4);
});

test('地点详情（弹窗）：人类的建筑、后人开辟的地点（来源、开辟者、主人、模块、残料、地点规则）、遗址与前世、荒野地带、空地——每个地点中英各开一遍', () => {
  const ctx = makeCtx();
  for (const lang of LANGS) {
    setLang(lang);
    for (const p of state.places) {
      closeAllModals();
      openPlace2(ctx, p.id);
      const modal = dom.root.querySelector('.modal');
      assert.ok(modal, `${p.id} 没有弹出`);
      const text = textOf(modal);
      assert.doesNotMatch(text, BAD, `${p.id} ${lang}`);
      assert.ok(text.includes(ctx.placeName(p.id)), `${p.id} 标题`);
    }
    closeAllModals();
    openPlace2(ctx, ids.lampId);
    let text = textOf(dom.root.querySelector('.modal'));
    hasAll(text, ['灯屋', '路口的一盏灯，夜里亮着。', STR[lang].origin_agent, '青禾', STR[lang].placeRulesSection], `灯屋 ${lang}`);
    closeAllModals();
    openPlace2(ctx, ids.ruinId);
    text = textOf(dom.root.querySelector('.modal'));
    hasAll(text, [STR[lang].mapRazed, STR[lang].incarnations], `旧棚 ${lang}`);
    closeAllModals();
  }
  setLang('zh');
  // 未知地点：什么也不弹
  openPlace2(ctx, 'nowhere');
  assert.equal(dom.root.querySelector('.modal'), null);
});

// ═══════════════════════════════════════════════════════════════
// 地图
// ═══════════════════════════════════════════════════════════════

test('地图：人类的建筑与后人开辟的地点、遗址、空地块、道路与小路、居民；主人描边、残料环、模块图标；点击回调；状态更新后增量重画', () => {
  const ctx = makeCtx();
  setLang('zh');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  dom.root.append(svg);
  const clicked = [];
  const map = createMap2(svg, {
    mapData,
    worldId: state.world.id,
    placeName: (id) => ctx.placeName(id),
    humanName: (id) => {
      const p = state.places.find((x) => x.id === id);
      return p && p.humanName ? p.humanName.zh : id;
    },
    districtName: (id) => ctx.districtName(id),
    agentName: (id) => ctx.agentName(id),
    onAgent: (id) => clicked.push(['agent', id]),
    onPlace: (id) => clicked.push(['place', id]),
  });
  map.setColorMode('group');
  map.setState(state);
  // 每个地点一个 g.place；遗址带 razed；后人开辟的用 site 图形；每个空地块一个标记
  const placeGs = svg.querySelectorAll('g.place');
  assert.equal(placeGs.length, state.places.length);
  assert.ok(placeGs.some((g) => g.attrs.get('data-place') === ids.lampId));
  assert.ok(placeGs.some((g) => g.classList.contains('razed')), '遗址');
  assert.ok(svg.querySelectorAll('g.lot').length >= 10, '空地块');
  const lamp = placeGs.find((g) => g.attrs.get('data-place') === ids.lampId);
  assert.ok(lamp.querySelector('.owner-ring'), '主人描边');
  assert.ok(lamp.querySelector('.salvage-ring'), '残料环');
  // 模块的图标：集市有人类的告示板，又加装了储能——叠在一起的两个小图标
  const market = placeGs.find((g) => g.attrs.get('data-place') === 'market');
  const marketModules = state.places.find((p) => p.id === 'market').modules;
  assert.ok(marketModules.length >= 2, '集市应有两个以上的模块');
  assert.equal(market.querySelectorAll('.mods > *').length, marketModules.length);
  lamp.click();
  assert.deepEqual(clicked.pop(), ['place', ids.lampId]);
  // 居民：活着的每位一个
  assert.ok(svg.querySelectorAll('g.agent').length >= state.agents.filter((a) => a.status === 'awake' || a.status === 'dormant').length - 1);
  // 状态更新：遗址的残料用尽、新地点出现——重画不抛错，地点数同步
  const s2 = json(state);
  const base = s2.places.find((p) => p.origin === 'agent' && !p.razed);
  s2.places.push({ ...json(base), id: 'n9', name: '新建的', displayName: { zh: '新建的', en: 'New' }, xy: [base.xy[0] + 60, base.xy[1] + 60] });
  map.setState(s2);
  assert.equal(svg.querySelectorAll('g.place').length, s2.places.length);
  map.setTick({ tick: state.world.tick + 1, day: state.world.day, nextTickAt: null, agents: state.agents.map((a) => ({ id: a.id, place: a.place, energy: a.energy, status: a.status })), treasury: state.treasury, well: { condition: 5000, outputYesterday: 3 } });
  for (const e of events.slice(-40)) map.onEvent(e);
  map.zoomIn();
  map.zoomOut();
  map.fit();
  assert.deepEqual([ownerColor({ kind: 'city' }), ownerColor(null)], [null, null]);
  assert.match(ownerColor({ kind: 'agent', id: 'a1' }), /^hsl\(\d+ 90% 66%\)$/);
  assert.match(ownerColor({ kind: 'group', id: 'g1' }), /^hsl\(\d+ 90% 58%\)$/);
  assert.notEqual(ownerColor({ kind: 'agent', id: 'a1' }), ownerColor({ kind: 'agent', id: 'a2' }));
  map.destroy();
});

test('app.js 的接线：第二纪的城用 TABS2 / signature2 / createMap2 / renderProfile2 / openPlace2（静态检查）', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  for (const needle of ['TABS2', 'signature2', 'createMap2', 'renderProfile2', 'openPlace2', 'physics === 2']) assert.ok(src.includes(needle), needle);
  void people;
});

// ═══════════════════════════════════════════════════════════════
// 事件句子、动态键与第一纪的回归
// ═══════════════════════════════════════════════════════════════

test('事件句子：第二纪的 initiate / built 说出工程的种类（新地点、道路、模块的名字）——v2 的 lore 没有 facility 表，曾经让实况页抛错', () => {
  const ctx = makeCtx();
  const find = (type, pred) => events.find((e) => e.type === type && pred(e));
  const siteInit = find('initiate', (e) => e.data.type === 'site');
  const moduleInit = find('initiate', (e) => e.data.type === 'board');
  const roadInit = find('initiate', (e) => e.data.type === 'road');
  const siteBuilt = find('built', (e) => e.data.type === 'site');
  const moduleBuilt = find('built', (e) => e.data.type === 'store');
  for (const e of [siteInit, moduleInit, roadInit, siteBuilt, moduleBuilt]) assert.ok(e, '丰富的城里缺少这类事件');
  for (const lang of LANGS) {
    setLang(lang);
    const say = (e) => textOf(eventRow(ctx, e));
    assert.ok(say(siteInit).includes(STR[lang].projectKind_site), `${lang} ${say(siteInit)}`);
    assert.ok(say(roadInit).includes(STR[lang].projectKind_road), `${lang} ${say(roadInit)}`);
    assert.ok(say(moduleInit).includes(lore[lang].module.board.name), `${lang} ${say(moduleInit)}`);
    assert.ok(say(siteBuilt).includes(STR[lang].projectKind_site), `${lang} ${say(siteBuilt)}`);
    assert.ok(say(moduleBuilt).includes(lore[lang].module.store.name), `${lang} ${say(moduleBuilt)}`);
    for (const e of events) assert.doesNotMatch(say(e), BAD, `${lang} ${e.type}`);
  }
  setLang('zh');
});

test('动态键：第二纪的文件里按前缀拼出的 t(`前缀_${x}`) 的每个取值都有中英文本；新增前缀要登记在这里', () => {
  const FAMILIES = {
    lawStatus_: ['active', 'repealed', 'replaced'],
    proc_: ['ordinary', 'constitutional'],
    pkind_: ['bylaws', 'group_procedure', 'place_rules'],
    refoundStatus_: ['open', 'succeeded', 'expired', 'void'],
    gproc_: ['steward', 'members'],
    origin_: ['human', 'agent'],
    build_: ['site', 'module', 'road'],
    bodyKind_: ['free', 'shell', 'sandbox'],
    projectKind_: ['site', 'road'],
    status_: ['awake', 'dormant', 'dead', 'retired'],
    charterStatus_: ['legacy', 'amended', 'repealed'],
    decided_: ['vote', 'random', 'schedule'],
    legend_: ['site', 'lot', 'razed', 'owner', 'salvage', 'gate'],
    module_: ['store', 'relay', 'sensor', 'archive', 'board', 'surface', 'memorial', 'cradle', 'gate'],
    cat_: ['speech', 'econ', 'polity', 'life', 'know', 'env', 'world', 'admin'],
    kind_: ['canon', 'relic', 'agent'],
    tab_: ['live', 'chronicle', 'laws', 'residents', 'groups', 'environment', 'cradle', 'library', 'cemetery', 'metrics', 'legacy', 'weather'],
  };
  const used = new Set();
  const dir = new URL('../public/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => /^(e2-.*|app|render|tabs[12]|profile|modals)\.js$/.test(x))) {
    for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/\bt\(`([A-Za-z0-9]+_)\$\{/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 8, [...used].join(' '));
  for (const prefix of used) assert.ok(prefix in FAMILIES, `前缀 ${prefix} 没有登记取值`);
  for (const [prefix, names] of Object.entries(FAMILIES)) {
    for (const n of names) for (const lang of LANGS) assert.ok(`${prefix}${n}` in STR[lang], `${lang} ${prefix}${n}`);
  }
});

test('第一纪不受影响：沙盘里跑出的第一纪的城，v1 的实况、法典、居民、社群、环境与档案照常渲染（render.js 的共用部分改过）', async () => {
  const savedP = snapshotP();
  const raw = [];
  let w1;
  try {
    ({ world: w1 } = runSandbox({ days: 40, agents: 12, seed: 3, onEvent: (e) => raw.push(e) }));
  } finally {
    restoreP(savedP);
    configureSandbox({ scenario: 'default' });
    configureWeather({ mode: 'random' });
  }
  const state1 = json(publicState1(w1));
  const events1 = raw.map((e) => publicEvent1(w1, e, { released: true })).filter(Boolean).map(json);
  assert.equal(state1.world.physics, undefined, '第一纪的世界没有 physics 字段');
  const data1 = { state: state1, mapData: null, lore: { zh: json(loreV1('zh')), en: json(loreV1('en')) }, events: events1, lastAct: lastActOf(events1) };
  const ctx1 = makeCtx(data1);
  for (const lang of LANGS) {
    setLang(lang);
    await render(renderLive, ctx1, `v1 live ${lang}`);
    await render(renderLaws, ctx1, `v1 laws ${lang}`);
    await render(renderResidents, ctx1, `v1 residents ${lang}`);
    await render(renderGroups, ctx1, `v1 groups ${lang}`);
    await render(renderEnvironment, ctx1, `v1 environment ${lang}`);
    await render(renderLibrary, ctx1, `v1 library ${lang}`);
    await render(renderLegacy, ctx1, `v1 legacy ${lang}`);
    for (const e of events1) assert.doesNotMatch(textOf(eventRow(ctx1, e)), BAD, `${lang} ${e.type}`);
    const a = state1.agents[0];
    const root = fresh();
    root.append(renderProfile(ctx1, {
      agent: json(publicAgent1(w1, w1.agents[a.id])), memories: json(publicMemories1(w1, w1.agents[a.id])), thoughts: [], events: events1.filter((e) => e.agent === a.id).slice(-50),
    }));
    assert.ok(textOf(root).includes(a.name));
    assert.doesNotMatch(textOf(root), BAD);
  }
  setLang('zh');
});
