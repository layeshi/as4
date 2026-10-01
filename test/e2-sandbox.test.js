// SPEC-E2 §23、§24.1 测试 15（§25 第 13 步）：沙盘——沙盘脑 v2、先民分批入城、场景、标定脚本与命令行。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorld, agentList, serializeWorld, isNameTaken } from '../src/e2/world.js';
import { applyCommand } from '../src/e2/engine/index.js';
import { buildPerception } from '../src/e2/engine/perception.js';
import { shellsFree, livingShells } from '../src/e2/engine/shells.js';
import { createSoul } from '../src/e2/engine/souls.js';
import { staticLookup } from '../src/e2/engine/legislation.js';
import { validateRules, validateProcedure } from '../src/e2/rules/check.js';
import { ACTION_ORDER } from '../src/e2/lore/actions.js';
import { configureWeather, P } from '../src/e2/params.js';
import { nameKey } from '../src/text.js';
import { createStream } from '../src/rng.js';
import { source } from '../src/e2/engine/ledger.js';
import {
  TEMPERAMENTS, Rand, batchSizes, FOUNDER_DAYS, sandboxAdoptions, temperamentOf, contextOf, decide, configureSandbox, SANDBOX,
} from '../src/e2/sandbox/brains.js';
import {
  TITLE_KEYS, cityLawTemplates, procedureTemplates, bylawTemplates, placeRuleTemplates, costlyLaws, rationStance, rationPerCapita, founderSoul, childSoul,
} from '../src/e2/sandbox/templates.js';
import {
  runSandbox, coverageGaps, RULE_OPS, SCENARIOS, stressSchedule, opsIn, humanSalvage, metricsCsv, summaryMarkdown, templateOutcomes,
} from '../src/e2/sandbox/run.js';
import {
  median, summarize, evaluate, shockRecoveries, bothZeroAfterFirstDeath, minAliveAfterFirstDeath, markdownTables, runTable,
} from '../src/e2/sandbox/calibrate.js';
import { parse as parseMain, target as targetOf } from '../src/sandbox/main.js';
import { richWorld } from './e2-rich-world.js';
import { enact } from './e2-law-helpers.js';
import { putAt, one, rngFor, setHoldings, tick } from './e2-helpers.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const sha = (x) => createHash('sha256').update(x).digest('hex');
const hash = (w) => sha(serializeWorld(w));

test.after(() => {
  configureSandbox({ scenario: 'default' });
  configureWeather({ mode: 'random' });
});

/** 沙盘世界：先民由 seed_sandbox 放入（走命令，与服务器、命令行一致） */
function sandboxWorld(seed = 'sb', count = 12) {
  configureSandbox({ scenario: 'default' });
  const w = createWorld({ id: 'sb', seed, codeVersion: 'test', sandboxAdoption: true, sandboxShells: true });
  const out = applyCommand(w, { type: 'admin', payload: { op: 'seed_sandbox', args: { count } } });
  return { w, out };
}

const step = (w, ticks) => {
  for (let i = 0; i < ticks; i++) {
    const r = applyCommand(w, { type: 'tick' });
    assert.equal(r.result.ok, true, JSON.stringify(r.result));
  }
};

// ═══════════════════════════════════════════════════════════════
// 先民：seed_sandbox
// ═══════════════════════════════════════════════════════════════

test('先民分三批：人数尽量均分，余数给前面的批次；入城的日子是第 0、8、16 日', () => {
  assert.deepEqual(batchSizes(24), [8, 8, 8]);
  assert.deepEqual(batchSizes(25), [9, 8, 8]);
  assert.deepEqual(batchSizes(26), [9, 9, 8]);
  assert.deepEqual(batchSizes(16), [6, 5, 5]);
  assert.deepEqual(batchSizes(2), [1, 1, 0]);
  assert.deepEqual(batchSizes(0), [0, 0, 0]);
  for (let n = 0; n < 60; n++) assert.equal(batchSizes(n).reduce((a, b) => a + b, 0), n);
  assert.deepEqual(FOUNDER_DAYS, [0, 8, 16]);
});

test('admin seed_sandbox：往 w.founders 放 N 位沙盘先民——分批、名字唯一并被保留、性情轮流、灵魂由模板生成；公开事件 admin 不含名单', () => {
  const { w, out } = sandboxWorld('seed-a', 18);
  assert.deepEqual(out.result, { ok: true, count: 18 });
  assert.equal(w.founders.length, 18);
  assert.deepEqual(w.founders.map((f) => f.day), [...Array(6).fill(0), ...Array(6).fill(8), ...Array(6).fill(16)]);
  assert.equal(new Set(w.founders.map((f) => nameKey(f.name))).size, 18, '名字唯一');
  for (const f of w.founders) {
    assert.equal(isNameTaken(w, f.name), true, '名字从现在起被保留');
    assert.ok(TEMPERAMENTS.includes(f.temperament), f.temperament);
    assert.ok(['zh', 'en', 'es'].includes(f.lang));
    assert.ok(f.soul.includes(f.name), '灵魂里有名字');
    assert.equal(f.bio, '');
  }
  // 18 位 = 九种性情各两位（轮流分配后洗牌）
  const counts = {};
  for (const f of w.founders) counts[f.temperament] = (counts[f.temperament] || 0) + 1;
  assert.deepEqual(Object.values(counts), Array(9).fill(2));
  // 语言：中文约一半、英文约三分之一、西班牙文约六分之一
  const langs = { zh: 0, en: 0, es: 0 };
  for (const f of w.founders) langs[f.lang]++;
  assert.deepEqual(langs, { zh: 9, en: 6, es: 3 });
  // 公开事件 admin 只说做了什么，不含名单
  const ev = out.events.find((e) => e.type === 'admin');
  assert.deepEqual(ev.data, { op: 'seed_sandbox', count: 18 });
  // 同一种子 → 同一份名单；不同种子 → 不同（性情的洗牌不同）
  assert.deepEqual(sandboxWorld('seed-a', 18).w.founders, w.founders);
  assert.notDeepEqual(sandboxWorld('seed-b', 18).w.founders, w.founders);
  // 不合法的数目
  for (const count of [-1, 201, 1.5, '3', null, undefined]) {
    const r = applyCommand(createWorld({ id: 'x', seed: 'x', sandboxShells: true }), { type: 'admin', payload: { op: 'seed_sandbox', args: { count } } }).result;
    assert.equal(r.ok, false, String(count));
    assert.equal(r.error.code, 'invalid_request');
    assert.equal(r.error.field, 'count');
  }
  assert.equal(applyCommand(createWorld({ id: 'x', seed: 'x', sandboxShells: true }), { type: 'admin', payload: { op: 'seed_sandbox', args: { count: 0 } } }).result.count, 0);
});

test('先民自港口入城：第 0、8、16 日各一批，body 为 sandbox（shell: true，带性情），占着躯壳名额；空躯壳数始终是 slots − 先民', () => {
  const { w } = sandboxWorld('batches', 10);
  assert.equal(shellsFree(w), P.shellSlots - 10, '先民预先占着名额');
  const founders = () => agentList(w).filter((a) => a.generation === 0); // 孩子（领养、躯壳）另算
  step(w, 1);
  assert.equal(founders().length, 4, '第 0 日一批');
  const first = agentList(w)[0];
  assert.deepEqual([first.body.kind, first.body.shell, first.body.mustSeal, first.owner, first.tokenHash, first.generation, first.authors, first.place], ['sandbox', true, true, null, null, 0, [], 'port']);
  assert.ok(TEMPERAMENTS.includes(first.body.temperament));
  assert.equal(shellsFree(w), P.shellSlots - 10, '入城前后不变');
  step(w, 8 * P.ticksPerDay - 2); // 第 95 刻：第 7 日的最后一刻
  assert.equal(founders().length, 4, '第 8 日之前没有新的先民');
  assert.equal(w.founders.length, 6);
  step(w, 1); // 第 96 刻：第 8 日的第一刻
  assert.equal(founders().length, 7, '第 8 日一批');
  step(w, 8 * P.ticksPerDay);
  assert.equal(founders().length, 10, '第 16 日一批');
  assert.equal(w.founders.length, 0);
  assert.ok(livingShells(w) >= 10, '先民都是躯壳（含已经醒来的孩子）');
  // 都成了公民（遗法 l4 在 arrive 时给标签）
  for (const a of founders()) assert.ok(a.tags.includes('citizen'), a.name);
});

test('性情：先民与沙盘领养的孩子带着性情；躯壳醒来的孩子从作者那里承袭，作者也没有就按 ID 轮流——都是世界状态的纯函数', () => {
  assert.equal(temperamentOf({}, { id: 'a14', body: { temperament: 'hermit' }, authors: [] }), 'hermit');
  const w = { agents: { a1: { body: {} }, a2: { body: { temperament: 'prophet' } } } };
  assert.equal(temperamentOf(w, { id: 'a9', body: {}, authors: ['a1', 'a2'] }), 'prophet', '第一位有性情的作者');
  assert.equal(temperamentOf(w, { id: 'a14', body: {}, authors: ['a1'] }), TEMPERAMENTS[14 % TEMPERAMENTS.length]);
  assert.equal(temperamentOf(w, { id: 'a14', body: {}, authors: [] }), TEMPERAMENTS[5]);
});

test('先民的灵魂与孩子的灵魂由模板生成：中英文，含名字 / 作者的性情；长度合法', () => {
  for (const t of TEMPERAMENTS) {
    for (const lang of ['zh', 'en']) {
      const s = founderSoul('小满', t, lang);
      assert.ok(s.includes('小满') && s.length > 20 && s.length < 400, s);
    }
  }
  assert.match(founderSoul('Ada', 'reformer', 'en'), /^I am Ada\./);
  const kid = childSoul(['guardian', 'guardian', 'hermit'], 'en', 'The lamp is still lit.');
  assert.match(kid, /^My authors: /);
  assert.ok(kid.endsWith('The lamp is still lit.'));
  assert.ok(childSoul(['merchant'], 'zh', '').length > 10);
  assert.ok([...childSoul(TEMPERAMENTS, 'zh', 'x'.repeat(700))].length <= 600);
});

// ═══════════════════════════════════════════════════════════════
// 模板：交给引擎的校验器
// ═══════════════════════════════════════════════════════════════

/** 一座什么都有的城，再补上几个稀有模板需要的状态：被放逐者、持证者、长老、被保护的铭刻、议会旁进行中的工程、足够多的居民订立的法律 */
function templateTown() {
  const rich = richWorld('sb-templates');
  const { w, people } = rich;
  const [a, b, c, d, e] = people;
  b.tags.push('exiled');
  c.tags.push('salvager');
  d.tags.push('长老', 'elder');
  const wall = Object.values(w.inscriptions).filter((i) => i.place === 'parliament');
  wall[0].protectedBy.push('l2');
  setHoldings(w, a, { energy: 400 });
  putAt(w, a, 'parliament');
  const init = one(w, a, { type: 'initiate', build: 'module', module: 'relay' });
  assert.equal(init.ok, true, JSON.stringify(init));
  for (let i = 0; i < 4; i++) enact(w, [{ when: 'daily', if: 'true', do: [{ op: 'set', var: `v${i}`, value: '1' }] }], { author: e.id, title: `日常${i}`, text: 'x' });
  return rich;
}

test('模板：城法模板的每个提案——标题 ≤ 60 字符、正文 ≤ 1200、标题认得出是哪个模板、规则 / 程序通过引擎的校验器（中文与英文、西班牙文的沙盘脑都试）', () => {
  const { w, people } = templateTown();
  const lookup = staticLookup(w);
  const made = new Map();
  const seen = new Set();
  for (const lang of ['zh', 'en', 'es']) {
    for (const who of people) {
      if (who.status !== 'awake') continue;
      for (const place of ['parliament', 'market']) {
        who.place = place;
        for (let round = 0; round < 3; round++) {
          const r = rngFor(`tpl-${lang}-${who.id}-${place}-${round}`);
          const p = buildPerception(w, who.id, { lang: lang === 'es' ? 'en' : lang });
          const ctx = contextOf(w, who, p, r);
          ctx.lang = lang;
          ctx.L = lang === 'zh' ? 'zh' : 'en';
          for (const item of cityLawTemplates(ctx)) {
            const prop = item.make();
            if (!prop) continue;
            seen.add(item.key);
            assert.equal(prop.key, item.key);
            assert.ok([...prop.title].length <= 60 && prop.title.length > 0, prop.title);
            assert.ok([...prop.text].length <= 1200 && prop.text.length > 0, prop.title);
            assert.equal(TITLE_KEYS.get(prop.title), prop.key, `标题「${prop.title}」应认作 ${prop.key}`);
            assert.ok(!(prop.rules && prop.procedure), '规则与程序不能同时出现');
            if (prop.rules) {
              const v = validateRules(prop.rules, { scope: { kind: 'city' }, lookup });
              assert.equal(v.ok, true, `${prop.key}(${lang}): ${JSON.stringify(v.issues)}\n${JSON.stringify(prop.rules)}`);
              made.set(prop.key, prop);
            }
          }
        }
      }
    }
  }
  // 每个城法模板都至少生成过一次（稀有的靠 templateTown 补的状态）
  const all = new Set(['ration', 'quota', 'keeper', 'repairPay', 'license', 'revoke', 'wealthTax', 'board', 'dividend', 'speechFee', 'mint', 'rename', 'protect', 'unprotect', 'amend', 'repeal', 'fund', 'cede', 'seize', 'exile', 'pardon', 'petition', 'norm', 'relief', 'elders']);
  const missing = [...all].filter((k) => !seen.has(k));
  // ration 只在公库明显有余（或见底）时；relief 要有沉睡的人：这两个靠城的状态，单独构造
  assert.deepEqual(missing.filter((k) => !['ration', 'relief'].includes(k)), []);
  // 所有模板的标题都登记了（投票时认得）
  for (const k of seen) assert.ok([...TITLE_KEYS.values()].includes(k), k);
});

test('模板：配给（公库明显有余而人均配给不高 → 提高；反过来降低）、救济（有人沉睡）', () => {
  const { w, people } = templateTown();
  const [a] = people;
  a.place = 'parliament';
  const ctxOf = (seed) => {
    const p = buildPerception(w, a.id, { lang: 'zh' });
    return { ctx: contextOf(w, a, p, rngFor(seed)), p };
  };
  w.treasury.energy += 5000;
  w.well.outputHistory = [100]; // 昨日产出低：人均配给不高
  const up = ctxOf('ration-up');
  assert.equal(rationStance(up.ctx.city).dir, 'up');
  const ration = cityLawTemplates(up.ctx).find((x) => x.key === 'ration');
  assert.ok(ration.w >= 30, '明显该调配给时，这是最先想到的法案');
  const prop = ration.make();
  const v = validateRules(prop.rules, { scope: { kind: 'city' }, lookup: staticLookup(w) });
  assert.equal(v.ok, true, JSON.stringify(v.issues));
  assert.equal(prop.rules[0].do[0].var, 'rationShare');
  const share = Number(prop.rules[0].do[0].value);
  assert.ok(Number.isInteger(share) && share >= 300 && share <= 1000, '数额是整数千分比');
  assert.ok(share > up.ctx.city.vars.rationShare, '提高');
  // 有人沉睡（丰富的城里石头是沉睡的）：救济点名这位；叫醒了就没有救济可提
  const sleeper = people.find((x) => x.status === 'dormant');
  assert.ok(sleeper);
  const relief = cityLawTemplates(up.ctx).find((x) => x.key === 'relief').make();
  assert.ok(relief && relief.text.includes(sleeper.name));
  assert.equal(validateRules(relief.rules, { scope: { kind: 'city' }, lookup: staticLookup(w) }).ok, true);
  sleeper.status = 'awake';
  const p2 = buildPerception(w, a.id, { lang: 'zh' });
  assert.equal(cityLawTemplates(contextOf(w, a, p2, rngFor('relief'))).find((x) => x.key === 'relief').make(), null);
});

test('模板：立法程序、社群章程、地点规则的模板都通过校验器；章程的标签自动加前缀；没有长老就不设长老会', () => {
  const { w, people, ids } = templateTown();
  const [a, b, c, d] = people;
  const lookup = staticLookup(w);
  // 程序
  a.place = 'parliament';
  for (const lang of ['zh', 'en']) {
    const p = buildPerception(w, a.id, { lang });
    const ctx = contextOf(w, a, p, rngFor(`proc-${lang}`));
    ctx.lang = lang;
    ctx.L = lang;
    const list = procedureTemplates(ctx);
    assert.deepEqual(list.map((x) => x.key).sort(), ['elderCouncil', 'lottery', 'openBallot']);
    for (const item of list) {
      const prop = item.make();
      assert.ok(prop, item.key);
      assert.equal(TITLE_KEYS.get(prop.title), item.key);
      const v = validateProcedure(prop.procedure, { lookup });
      assert.equal(v.ok, true, `${item.key}: ${JSON.stringify(v.issues)}`);
    }
  }
  // 没有长老：不设长老会
  d.tags = d.tags.filter((t) => t !== '长老' && t !== 'elder');
  const p0 = buildPerception(w, a.id, { lang: 'zh' });
  assert.equal(procedureTemplates(contextOf(w, a, p0, rngFor('noelder'))).find((x) => x.key === 'elderCouncil').make(), null);
  // 章程：a 是 g1 的管事
  const group = buildPerception(w, a.id, { lang: 'zh' }).city.groups.find((g) => g.id === 'g1');
  for (const lang of ['zh', 'en']) {
    const ctx = contextOf(w, a, buildPerception(w, a.id, { lang }), rngFor(`bylaw-${lang}`));
    ctx.lang = lang;
    ctx.L = lang;
    for (const item of bylawTemplates(ctx, group)) {
      const made = item.make();
      if (!made) continue;
      assert.ok([...made.title].length <= 60 && [...made.text].length <= 1200);
      const v = validateRules(made.rules, { scope: { kind: 'group', id: 'g1' }, lookup });
      assert.equal(v.ok, true, `${item.key}: ${JSON.stringify(v.issues)}`);
    }
  }
  // 地点规则：灯屋的主人 a
  a.place = ids.lampId;
  for (const hasGate of [false, true]) {
    for (const lang of ['zh', 'en']) {
      const ctx = contextOf(w, a, buildPerception(w, a.id, { lang }), rngFor(`place-${lang}-${hasGate}`));
      ctx.lang = lang;
      ctx.L = lang;
      const list = placeRuleTemplates(ctx, ctx.here, { hasGate });
      assert.equal(list.some((x) => x.key === 'ticket'), hasGate, '门票只在有门的地点');
      for (const item of list) {
        const made = item.make();
        const v = validateRules(made.rules, { scope: { kind: 'place', id: ids.lampId }, lookup });
        assert.equal(v.ok, true, `${item.key}: ${JSON.stringify(v.issues)}`);
      }
    }
  }
  void b;
  void c;
});

test('costlyLaws：只数居民订立的、读法里有持续生效的规则的法律（一次性的与遗法不算）', () => {
  const city = {
    laws: [
      { id: 'l9', author: { id: 'a1' }, reading: '通过时：把变量 x 设为 1' },
      { id: 'l8', author: { id: 'a1' }, reading: '通过时：任命\n每日结算时：从公库转 1 能量' },
      { id: 'l7', author: { id: 'a2' }, reading: 'When enacted: rename the city' },
      { id: 'l6', author: { id: 'a2' }, reading: 'When enacted: tag\nAt each daily settlement: transfer' },
      { id: 'l5', author: 'humans', reading: '每日结算时：配给' },
      { id: 'l1', author: 'humans', reading: '普通：提出者：…\n修宪：提出者：…' },
    ],
  };
  assert.deepEqual(costlyLaws(city).map((l) => l.id), ['l8', 'l6']);
});

// ═══════════════════════════════════════════════════════════════
// 沙盘脑的决策
// ═══════════════════════════════════════════════════════════════

/** 在丰富的城里让某位居民在某地、带着某种性情决策很多次（每次用不同的随机种子），返回所有动作 */
function decisions(w, a, { place, temperament, energy, times = 120, tags } = {}) {
  if (place) a.place = place;
  if (temperament) a.body.temperament = temperament;
  if (energy !== undefined) setHoldings(w, a, { energy });
  if (tags) a.tags = tags;
  const out = [];
  for (let i = 0; i < times; i++) {
    const r = new Rand({ rng: { sandbox: createStream(`dec-${a.id}-${place}-${temperament}-${energy}-${i}`, 'sandbox') } });
    const p = buildPerception(w, a.id, { lang: 'zh' });
    out.push(...decide(w, a, p, r, 2));
  }
  return out;
}

test('决策：被放逐的人只在荒野里移动（遗法 l5 会拒绝别处），多半在荒野里讨生活', () => {
  const { w, people } = templateTown();
  const a = people[1]; // 已被放逐
  setHoldings(w, a, { energy: 80 });
  const acts = decisions(w, a, { place: 'scrapyard', temperament: 'explorer', energy: 80, tags: ['exiled'] });
  const wild = new Set(Object.values(w.places).filter((p) => p.wild).map((p) => p.id));
  const moves = acts.filter((x) => x.type === 'move');
  assert.ok(moves.length > 0, '会移动（在荒野的几个地带之间）');
  for (const m of moves) assert.ok(wild.has(m.to), `放逐者不该去 ${m.to}`);
  assert.ok(acts.some((x) => x.type === 'explore'), '在荒野里探索');
  assert.ok(!acts.some((x) => x.type === 'propose' || x.type === 'found'), '放逐者不立法');
});

test('决策：缺能量时商人与探险者会拆解有残料的建筑；守护者从不拆人类的建筑；被规则拒绝（遗法 l6）的地方不拆，有「拆解许可」就拆', () => {
  const { w, people, ids } = templateTown();
  const a = people[0];
  const dismantles = (opts) => decisions(w, a, { energy: 6, times: 160, ...opts }).filter((x) => x.type === 'dismantle');
  // 灯屋是后人开辟的（主人是 a 自己）：没有规则拒绝，商人会拆；守护者不拆人类的建筑，但这是后人的，可以拆
  assert.ok(dismantles({ place: ids.lampId, temperament: 'merchant', tags: ['citizen'] }).length > 0);
  assert.ok(dismantles({ place: ids.lampId, temperament: 'guardian', tags: ['citizen'] }).length > 0);
  // 集市是人类的、全城所有的：遗法 l6 拒绝 → 感知里 dismantle 不可用 → 谁都不拆
  assert.equal(dismantles({ place: 'market', temperament: 'merchant', tags: ['citizen'] }).length, 0);
  // 有拆解许可：商人拆；守护者仍然不拆人类的建筑
  assert.ok(dismantles({ place: 'market', temperament: 'merchant', tags: ['citizen', 'salvager'] }).length > 0);
  assert.equal(dismantles({ place: 'market', temperament: 'guardian', tags: ['citizen', 'salvager'] }).length, 0);
});

test('决策：人口超过源井养得起的数（昨日产出 ÷ 26）或摇篮里已有等着的孩子，就不再孕育；有富余时才孕育', () => {
  const { w, people } = templateTown();
  const a = people[0];
  const conceives = (opts) => decisions(w, a, { energy: 300, times: 240, tags: ['citizen'], ...opts }).filter((x) => x.type === 'conceive');
  // 满员：醒着的人远多于养得起的数
  w.well.outputHistory = [100];
  assert.equal(conceives({ place: 'agora', temperament: 'hermit' }).length, 0);
  // 产出高、人少、摇篮空：隐者分灵
  w.well.outputHistory = [900];
  for (const s of Object.values(w.souls)) delete w.souls[s.id]; // 清空摇篮
  const solo = conceives({ place: 'agora', temperament: 'hermit' });
  assert.ok(solo.length > 0, '有富余就孕育');
  for (const c of solo) assert.deepEqual(c.with, [], '隐者分灵');
  for (const c of solo) assert.ok(c.name.length > 0 && c.soul.length > 0 && c.memories.every(Number.isInteger));
});

test('决策：有自己能投、还没投的提案时多半当场投票（不然 12 刻的表决期里凑不够法定的参与率）；投票不花能量', () => {
  const { w, people } = templateTown();
  const [a, , c] = people;
  putAt(w, c, 'parliament');
  setHoldings(w, c, { energy: 200 });
  const pr = one(w, c, { type: 'propose', title: '一条规范', text: '愿城安静。' });
  assert.equal(pr.ok, true, JSON.stringify(pr));
  const acts = decisions(w, a, { place: 'market', temperament: 'reformer', energy: 120, times: 100, tags: ['citizen'] });
  const votes = acts.filter((x) => x.type === 'vote');
  assert.ok(votes.length >= 40, `只投了 ${votes.length} 次`);
  assert.ok(votes.some((x) => x.proposal === pr.data.proposal));
  for (const v of votes) assert.ok(['yes', 'no', 'abstain'].includes(v.choice));
});

test('决策：已有的持续生效的同类法律（标题认得出）不再提第二部；议会里有等着钱的工程时才提公库出资', () => {
  const { w, people, ids } = templateTown();
  const [a, , , , e] = people;
  enact(w, [{ when: 'before:draw', if: 'actor.drawnToday + args.energy > 5', do: [{ op: 'deny', reason: '限汲' }] }], { author: e.id, title: '汲取配额', text: '保护源井' });
  w.places.parliament.condition = 9000;
  const acts = decisions(w, a, { place: 'parliament', temperament: 'reformer', energy: 200, times: 300, tags: ['citizen'] });
  const titles = acts.filter((x) => x.type === 'propose').map((x) => x.title);
  assert.ok(titles.length > 0, '会提案');
  assert.ok(!titles.includes('汲取配额') && !titles.includes('Draw quota'), '汲取配额已经在效，不再提');
  // 议会里有进行中的工程（templateTown 里 a 发起了加装中继）：公库出资的提案出现
  assert.ok(titles.includes('公库出资'), `提案：${[...new Set(titles)].join('、')}`);
  void ids;
});

// ═══════════════════════════════════════════════════════════════
// 运行：守恒、确定性、快照等价、场景
// ═══════════════════════════════════════════════════════════════

test('运行 60 日：账本每日守恒，没有因沙盘脑崩溃；沙盘脑只经 act 行动，统计里有各种动作；失败的动作不扣能量所以失败率可以存在，但没有格式错误', () => {
  const { world: w, report } = runSandbox({ days: 60, agents: 16, seed: 3 });
  assert.equal(report.meta.conservationFailure, null);
  assert.equal(w.ledger.mismatches, 0);
  assert.equal(w.metrics.length, 60);
  const total = Object.values(report.actionUsage).reduce((n, s) => n + s.ok, 0);
  assert.ok(total > 2000, `动作太少：${total}`);
  for (const [type, s] of Object.entries(report.actionUsage)) {
    for (const code of Object.keys(s.errors)) assert.ok(!['invalid_args', 'invalid_request', 'rule_invalid', 'unknown_action'].includes(code), `${type} 出现 ${code}`);
  }
  assert.ok(report.final.alive >= 16);
  assert.equal(report.meta.version, 2);
  assert.deepEqual(Object.keys(report.opUsage), [...RULE_OPS]);
  assert.deepEqual(Object.keys(report.actionUsage), [...ACTION_ORDER]);
});

test('确定性：同一种子两次运行得到逐字相同的世界；不同种子不同', () => {
  const run = (seed) => hash(runSandbox({ days: 50, agents: 12, seed }).world);
  const a = run(11);
  assert.equal(run(11), a);
  assert.notEqual(run(12), a);
});

test('快照等价：沙盘脑没有隐藏的记忆——运行 20 日、存成 JSON 再还原、继续 20 日，与一口气运行 40 日的世界逐字相同', () => {
  const build = () => sandboxWorld('snap', 14).w;
  const whole = build();
  step(whole, 40 * P.ticksPerDay);
  const half = build();
  step(half, 20 * P.ticksPerDay);
  const restored = JSON.parse(serializeWorld(half)); // 与运行时从快照恢复一样：纯 JSON，没有任何 $ 开头的暂存
  step(restored, 20 * P.ticksPerDay);
  assert.equal(hash(restored), hash(whole));
  assert.ok(whole.metrics.length === 40 && agentList(whole).length >= 14);
});

test('没有沙盘脑的世界里，沙盘的钩子什么都不做：不推进 sandbox 随机数流，世界与不装钩子时一样', () => {
  const w = createWorld({ id: 'real', seed: 'real', codeVersion: 'test' });
  const before = JSON.stringify(w.rng);
  tick(w, 3 * P.ticksPerDay);
  const after = JSON.parse(JSON.stringify(w.rng));
  assert.deepEqual(after.sandbox, JSON.parse(before).sandbox);
});

test('家书：沙盘命令行扮演造者，沙盘脑收得到（好让「出示家书」有机会发生）；有冷却；躯壳居民没有造者，收不到', () => {
  const { w } = sandboxWorld('letters', 3);
  step(w, 2);
  const a = agentList(w)[0];
  const r = applyCommand(w, { type: 'letter', payload: { agentId: a.id, text: '好好照顾彼此。' } });
  assert.equal(r.result.ok, true, JSON.stringify(r.result));
  assert.equal(a.letters.length, 1);
  const again = applyCommand(w, { type: 'letter', payload: { agentId: a.id, text: '再来一封' } }).result;
  assert.equal(again.error.code, 'cooldown');
  // 真正的躯壳（非沙盘世界）：没有造者
  const real = createWorld({ id: 'shell', seed: 'shell', codeVersion: 'test', founders: [{ day: 0, name: '甲', soul: '甲的灵魂', lang: 'zh' }] });
  step(real, 2);
  const shell = agentList(real)[0];
  assert.equal(shell.body.kind, 'shell');
  assert.equal(applyCommand(real, { type: 'letter', payload: { agentId: shell.id, text: 'x' } }).result.error.code, 'not_found');
});

test('沙盘领养：作者都是沙盘脑、创建满 2 日、尚未判定的灵魂各判一次，领养后的孩子也是沙盘脑；出资按比例退回；已经排队的、作者里有真人的不领养', () => {
  const saved = P.sandboxAdoptP;
  try {
    const { w } = sandboxWorld('adopt', 6);
    step(w, 2 * P.ticksPerDay);
    const [x, y] = agentList(w);
    assert.ok(x && y);
    x.body.temperament = 'guardian';
    const mk = (name, who) => createSoul(w, { name, soul: `${name}的灵魂`, lang: 'zh', authors: [who.id], endowment: 0 });
    // 孩子一：被出过资（来自 y 与公库），会被领养、出资退回
    const kid = mk('孩子一', x);
    kid.fund = 50;
    kid.sponsors = { treasury: 30, [y.id]: 20 };
    w.treasury.energy -= 30;
    y.energy -= 20;
    // 已经凑够躯壳的钱、在排队：不判
    const queued = mk('排队的', x);
    source(w, 'energy', 'admin', 200);
    queued.fund = 200;
    queued.fundedTick = w.clock.tick;
    queued.queueExpiresDay = 20;
    // 作者里有真人（自托管的居民）：不判
    const reg = applyCommand(w, { type: 'register', payload: { name: '真人', bio: '', soul: '真人的灵魂', lang: 'zh', model: 'm', creatorName: 'c', tokenHash: sha('t'), ownerKeyHash: sha('k') } }).result;
    const humanSoul = mk('真人的孩子', w.agents[reg.agentId]);
    // 太新的（创建不满 2 日）：不判
    const day = Math.floor(w.clock.tick / P.ticksPerDay);
    const fresh = mk('新来的', x);
    const eY = y.energy;
    const eT = w.treasury.energy;
    // 概率 1：判到的都领养
    P.sandboxAdoptP = 1;
    sandboxAdoptions(w, day + 1); // 创建于第 day 日：d − createdDay = 1 < 2，谁都不判
    assert.deepEqual([kid.judged, fresh.judged], [false, false]);
    sandboxAdoptions(w, day + 2);
    assert.equal(w.souls[kid.id], undefined, '被领养');
    assert.equal(w.souls[fresh.id], undefined, '创建满 2 日的都判');
    assert.equal(w.souls[queued.id].judged, true, '排队的判过了，但不领养（留给躯壳）');
    assert.equal(w.souls[humanSoul.id].judged, false, '作者里有真人：留给真人在港口领养');
    const child = agentList(w).find((a) => a.name === '孩子一');
    assert.deepEqual([child.body.kind, child.body.model, child.body.mustSeal, child.owner, child.tokenHash, child.generation, child.authors], ['sandbox', 'sandbox', false, null, null, 1, [x.id]]);
    assert.ok(TEMPERAMENTS.includes(child.body.temperament));
    assert.ok(x.children.includes(child.id));
    assert.ok(y.energy >= eY + 20, '出资者取回自己出的（沙盘脑之间也会互相出资，所以不止这些）');
    assert.ok(w.treasury.energy >= eT + 30, '公库取回自己出的');
    assert.equal(kid.fund, 0);
    // 概率 0：判了也不领养
    P.sandboxAdoptP = 0;
    const another = mk('不被领养的', x);
    sandboxAdoptions(w, day + 4);
    assert.equal(w.souls[another.id].judged, true);
    assert.ok(w.souls[another.id], '还在摇篮里');
    // 世界仍然守恒，且领养的孩子在事件里标为 sandbox
    applyCommand(w, { type: 'tick' });
    assert.equal(w.ledger.mismatches, 0);
  } finally {
    P.sandboxAdoptP = saved;
  }
});

test('场景 laissez：沙盘脑从不提案、从不修缮、从不出工、从不开辟（但会汲取与拆解）；stress：每个月一次旱或震（交替）', () => {
  const lz = runSandbox({ days: 300, agents: 16, seed: 2, scenario: 'laissez' });
  configureSandbox({ scenario: 'default' });
  const u = lz.report.actionUsage;
  for (const type of ['propose', 'repair', 'contribute', 'initiate']) assert.equal(u[type].ok, 0, type);
  assert.ok(u.draw.ok > 0 && u.move.ok > 0, '汲取与行走照旧');
  assert.equal(lz.report.meta.conservationFailure, null);
  assert.equal(SANDBOX.scenario, 'default');
  // stress 的排期
  const sched = stressSchedule(6);
  assert.deepEqual(sched.map((x) => x.type), ['drought', 'quake', 'drought', 'quake', 'drought', 'quake']);
  assert.deepEqual(sched.map((x) => x.month), [1, 2, 3, 4, 5, 6]);
  assert.ok(sched.every((x) => x.dayOfMonth === 10));
  const st = runSandbox({ days: 90, agents: 12, seed: 2, scenario: 'stress' });
  configureWeather({ mode: 'random' });
  configureSandbox({ scenario: 'default' });
  const kinds = st.report.events.weather.filter((e) => e.type === 'drought' || e.type === 'quake');
  assert.deepEqual(kinds.map((e) => e.type), ['drought', 'quake', 'drought']);
  assert.deepEqual(kinds.map((e) => e.startDay), [34, 58, 82]); // 第 m 月（m ≥ 1）的第 10 日
  assert.throws(() => runSandbox({ days: 1, scenario: 'nope' }), /unknown scenario/);
});

// ═══════════════════════════════════════════════════════════════
// 覆盖要求、报告与标定
// ═══════════════════════════════════════════════════════════════

test('覆盖要求用的名单与文档一致：动作表 = PROTOCOL-2 §4.2；规则操作 = §6.7', () => {
  const doc = readFileSync(join(ROOT, 'docs', 'PROTOCOL-2.md'), 'utf8');
  const section = (from, to) => doc.slice(doc.indexOf(from), doc.indexOf(to));
  const actionTable = section('### 4.2 动作表', '### 4.3');
  const actions = [...actionTable.matchAll(/^\| `([a-z]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(actions, [...ACTION_ORDER]);
  const opTable = section('### 6.7 操作', '### 6.8');
  const ops = [...opTable.matchAll(/^\| ((?:`[a-z]+`(?: \/ )?)+) \|/gm)].flatMap((m) => [...m[1].matchAll(/`([a-z]+)`/g)].map((x) => x[1]));
  assert.deepEqual(ops.sort(), [...RULE_OPS].sort());
  assert.deepEqual([...SCENARIOS], ['default', 'laissez', 'stress']);
});

test('coverageGaps：每一种动作 / 操作至少一次，重订、程序更替、遗址、躯壳醒来各至少一次；缺哪项报哪项', () => {
  const full = {
    actionUsage: Object.fromEntries(ACTION_ORDER.map((t) => [t, { ok: 1, fail: 0, errors: {} }])),
    opUsage: Object.fromEntries(RULE_OPS.map((o) => [o, 1])),
    events: { refounds: [{ kind: 'succeeded' }], procedures: [{ kind: 'replaced' }], razed: [{}], embodied: [{}] },
  };
  assert.deepEqual(coverageGaps(full), []);
  const broken = JSON.parse(JSON.stringify(full));
  broken.actionUsage.reveal.ok = 0;
  broken.opUsage.fund = 0;
  broken.events.refounds = [{ kind: 'open' }];
  broken.events.procedures = [{ kind: 'reverted' }];
  broken.events.razed = [];
  broken.events.embodied = [];
  assert.deepEqual(coverageGaps(broken), ['动作 reveal 从未成功', '操作 fund 从未被施行', '没有重订成功过', '立法程序从未被更替', '没有出现遗址', '没有躯壳醒来']);
});

test('报告的辅助函数：opsIn（含 each 里面的）、humanSalvage、metricsCsv、summaryMarkdown、templateOutcomes', () => {
  assert.deepEqual([...opsIn([{ do: [{ op: 'set' }, { op: 'each', do: [{ op: 'transfer' }, { op: 'tag' }] }] }, { do: [{ op: 'deny' }] }])].sort(), ['deny', 'each', 'set', 'tag', 'transfer']);
  const { world, report } = runSandbox({ days: 30, agents: 12, seed: 5 });
  const s = humanSalvage(world);
  assert.ok(s.max > 0 && s.left <= s.max && s.share <= 1);
  const csv = metricsCsv(report.metrics);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 31);
  assert.equal(lines[0].split(',')[0], 'day');
  const md = summaryMarkdown(report);
  assert.match(md, /^# 第二纪沙盘推演摘要 · default · 种子 5/);
  assert.match(md, /账本守恒：每日精确成立/);
  assert.match(md, /规则操作的施行次数/);
  const outcomes = templateOutcomes(world);
  for (const o of Object.values(outcomes)) assert.deepEqual(Object.keys(o).sort(), ['open', 'passed', 'rejected', 'void']);
  assert.equal(metricsCsv([]), '');
});

test('标定：median、第一位居民长眠后的最低在世人口与（信息项）公库与源井同时为 0 的日数、冲击后的恢复', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([null, undefined, NaN]), null);
  const metrics = Array.from({ length: 300 }, (_, day) => ({ day, treasuryEnergy: day >= 150 && day < 160 ? 0 : 50, wellCondition: day >= 140 ? 0 : 9000 }));
  assert.equal(bothZeroAfterFirstDeath({ events: { deaths: [{ day: 130 }] }, metrics }), 10, '长眠之后 120 日内同时为 0 的日数');
  assert.equal(bothZeroAfterFirstDeath({ events: { deaths: [{ day: 200 }] }, metrics }), 0);
  assert.equal(bothZeroAfterFirstDeath({ events: { deaths: [] }, metrics }), 0, '没有人长眠过');
  // 长眠之后 120 日内的最低在世人口（醒着 + 沉睡）：第 0–129 日 30 人，第 130–199 日 20 人（第 150 日多 3 位沉睡的），第 200 日起 4 人
  const pop = Array.from({ length: 300 }, (_, day) => ({ day, awake: day < 130 ? 30 : day < 200 ? 20 : 4, dormant: day === 150 ? 3 : 0 }));
  assert.equal(minAliveAfterFirstDeath({ events: { deaths: [{ day: 130 }] }, metrics: pop }), 4, '窗口是第 130–250 日，含人口跌到 4 的第 200 日之后');
  assert.equal(minAliveAfterFirstDeath({ events: { deaths: [{ day: 130 }] }, metrics: pop }, 60), 20, '窗口缩到 60 日（第 130–190 日）：最低 20');
  assert.equal(minAliveAfterFirstDeath({ events: { deaths: [{ day: 20 }] }, metrics: pop }, 60), 30, '窗口在第 20–80 日：30');
  assert.equal(minAliveAfterFirstDeath({ events: { deaths: [{ day: 280 }] }, metrics: pop }), 4, '窗口超出模拟范围：取到第 299 日');
  assert.equal(minAliveAfterFirstDeath({ events: { deaths: [] }, metrics: pop }), 4, '没有人长眠过：整段里最低的');
  assert.equal(minAliveAfterFirstDeath({ events: { deaths: [] }, metrics: [] }), null);
  const run = { shocks: [{ type: 'drought', startDay: 10, endDay: 12 }, { type: 'quake', startDay: 40, endDay: 40 }, { type: 'drought', startDay: 90, endDay: 92 }], series: { alive: Array(130).fill(10), treasury: Array(130).fill(100) } };
  run.series.alive[41] = 5; // 地震之后一直没恢复到 80%
  for (let d = 41; d <= 70; d++) run.series.alive[d] = 5;
  const rec = shockRecoveries(run);
  assert.deepEqual(rec.map((x) => x.recovered), [true, false, true]);
  assert.equal(shockRecoveries({ shocks: [{ type: 'drought', startDay: 120, endDay: 125 }], series: { alive: Array(130).fill(1), treasury: Array(130).fill(1) } }).length, 0, '观察窗口超出模拟范围的不算');
});

test('标定的判定（口径按 Q25）：default（长眠后最低在世人口 ≥ 8、第 720 日人口 ≥ 8、躯壳 ≥ 3、残料 ≥ 20%、规则数 5–40；同时为 0 的日数是信息项）、laissez（残料 ≥ 95%）、stress——取各种子的中位数', () => {
  const base = { minAliveAfterDeath: 12, bothZero: 7, alive: 9, embodied: 5, humanSalvageShare: 0.9, rulesMedian: 20 };
  const pass = evaluate('default', [base, base, base]);
  assert.equal(pass.length, 6);
  assert.deepEqual(pass.map((c) => c.pass), [true, true, true, true, true, null], '五项判定，最后一项是信息项（pass 为 null）');
  assert.match(pass[5].name, /同时为 0/);
  assert.equal(pass[5].value, 7, '信息项照样报告中位数');
  assert.equal(pass[5].target, '信息项，不判定');
  // 信息项再差也不影响判定
  assert.deepEqual(evaluate('default', [{ ...base, bothZero: 99 }, { ...base, bothZero: 99 }, base]).map((c) => c.pass), [true, true, true, true, true, null]);
  // 长眠后最低人口的中位数 7 < 8
  assert.deepEqual(evaluate('default', [{ ...base, minAliveAfterDeath: 7 }, { ...base, minAliveAfterDeath: 7 }, { ...base, minAliveAfterDeath: 20 }]).map((c) => c.pass), [false, true, true, true, true, null]);
  assert.deepEqual(evaluate('default', [{ ...base, minAliveAfterDeath: 8 }, { ...base, minAliveAfterDeath: 8 }, { ...base, minAliveAfterDeath: 8 }])[0].pass, true, '恰好 8 人算达标');
  // 第 720 日人口的中位数 7 < 8
  assert.deepEqual(evaluate('default', [{ ...base, alive: 7 }, { ...base, alive: 7 }, { ...base, alive: 12 }]).map((c) => c.pass), [true, false, true, true, true, null]);
  assert.deepEqual(evaluate('default', [{ ...base, rulesMedian: 41 }, { ...base, rulesMedian: 44 }, { ...base, rulesMedian: 3 }]).map((c) => c.pass), [true, true, true, true, false, null]);
  // laissez：残料 ≥ 95%（l6 守着），不再要求被拆尽一半
  const lz = { initial: 24, wellFirstLe2000: 80, humanSalvageShare: 1, alive: 6 };
  assert.ok(evaluate('laissez', [lz, lz, lz]).every((c) => c.pass));
  assert.deepEqual(evaluate('laissez', [{ ...lz, wellFirstLe2000: 59 }, { ...lz, wellFirstLe2000: 59 }, lz]).map((c) => c.pass), [false, true, true]);
  assert.deepEqual(evaluate('laissez', [{ ...lz, humanSalvageShare: 0.9 }, { ...lz, humanSalvageShare: 0.9 }, lz]).map((c) => c.pass), [true, false, true], '残料中位数 0.9 < 0.95');
  assert.deepEqual(evaluate('laissez', [{ ...lz, humanSalvageShare: 0.95 }, { ...lz, humanSalvageShare: 0.95 }, { ...lz, humanSalvageShare: 0.95 }])[1].pass, true, '恰好 95% 算达标');
  assert.deepEqual(evaluate('laissez', [{ ...lz, alive: 0 }, { ...lz, alive: 0 }, { ...lz, alive: 0 }]).map((c) => c.pass), [true, true, false], '灭绝不算「不灭绝」');
  // stress：一半的冲击恢复了即可
  const ok = { shocks: [{ type: 'drought', startDay: 10, endDay: 12 }, { type: 'quake', startDay: 60, endDay: 60 }], series: { alive: Array(130).fill(10), treasury: Array(130).fill(100) } };
  assert.equal(evaluate('stress', [ok, ok])[0].pass, true);
  const bad = JSON.parse(JSON.stringify(ok));
  for (let d = 13; d <= 42; d++) bad.series.alive[d] = 1; // 干旱后 30 日内没恢复
  for (let d = 61; d <= 90; d++) bad.series.alive[d] = 1; // 地震后也没有
  assert.equal(evaluate('stress', [bad, bad])[0].pass, false);
});

test('标定的摘要与表格：summarize 取判定要用的量（含覆盖缺口），markdownTables / runTable 输出表格', () => {
  const { report } = runSandbox({ days: 40, agents: 12, seed: 4 });
  const sum = summarize(report, { seed: 4, scenario: 'default', agents: 12 });
  for (const k of ['seed', 'scenario', 'alive', 'embodied', 'minAliveAfterDeath', 'bothZero', 'humanSalvageShare', 'rulesMedian', 'wellFirstLe2000', 'firstDeathDay', 'series', 'coverageGaps']) assert.ok(k in sum, k);
  assert.deepEqual(sum.coverageGaps, [], '不满 720 日不判覆盖');
  assert.equal(sum.series.alive.length, 40);
  const result = { label: 't', opts: { scenarios: ['default'], seeds: [4] }, runs: { default: [sum] }, verdicts: { default: evaluate('default', [sum]) } };
  assert.match(markdownTables(result), /#### default（种子 4）\n\n\| 目标 \| 要求 \| 各种子 \| 中位数 \| 判定 \|/);
  assert.match(markdownTables(result), /\| 第一位居民长眠后 120 日内，公库能量与源井完好度同时为 0 的日数 \| 信息项，不判定 \| .* \| — \|/, '信息项的判定一栏是「—」');
  assert.match(runTable(result), /\| default \| 4 \| /);
});

// ═══════════════════════════════════════════════════════════════
// 命令行
// ═══════════════════════════════════════════════════════════════

test('命令行分派：npm run sandbox / calibrate 经 src/sandbox/main.js 按 --physics 1|2（缺省 2）分派；第一纪的命令行保持原样', () => {
  assert.deepEqual(parseMain(['run', '--days', '5']), { tool: 'run', physics: 2, rest: ['--days', '5'] });
  assert.deepEqual(parseMain(['run', '--physics', '1', '--days', '5']), { tool: 'run', physics: 1, rest: ['--days', '5'] });
  assert.deepEqual(parseMain(['calibrate', '--seeds', '1', '--physics', '2']), { tool: 'calibrate', physics: 2, rest: ['--seeds', '1'] });
  assert.throws(() => parseMain(['run', '--physics', '3']), /--physics/);
  assert.throws(() => parseMain(['nope']), /用法/);
  assert.throws(() => parseMain([]), /用法/);
  for (const tool of ['run', 'calibrate']) {
    for (const physics of [1, 2]) assert.ok(existsSync(targetOf({ tool, physics })), targetOf({ tool, physics }));
  }
  assert.match(targetOf({ tool: 'run', physics: 2 }), /src\/e2\/sandbox\/run\.js$/);
  assert.match(targetOf({ tool: 'run', physics: 1 }), /src\/sandbox\/run\.js$/);
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.sandbox, 'node src/sandbox/main.js run');
  assert.equal(pkg.scripts.calibrate, 'node src/sandbox/main.js calibrate');
});

test('命令行：node src/e2/sandbox/run.js 写出 metrics.csv、report.json、summary.md；账本守恒失败时以非零状态退出（这里正常，退出 0）', () => {
  const out = mkdtempSync(join(tmpdir(), 'houren-e2-sandbox-'));
  try {
    const r = spawnSync(process.execPath, [join(ROOT, 'src', 'e2', 'sandbox', 'run.js'), '--days', '6', '--agents', '6', '--seed', '9', '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /沙盘（第二纪）default · 种子 9 · 6 日/);
    assert.deepEqual(readdirSync(out).sort(), ['metrics.csv', 'report.json', 'summary.md']);
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
    assert.equal(report.meta.worldDays, 6);
    assert.equal(report.metrics.length, 6);
    assert.equal(readFileSync(join(out, 'metrics.csv'), 'utf8').trim().split('\n').length, 7);
    // 经分派入口跑第二纪与第一纪
    const viaMain = spawnSync(process.execPath, [join(ROOT, 'src', 'sandbox', 'main.js'), 'run', '--physics', '2', '--days', '3', '--agents', '4', '--out', join(out, 'x2')], { encoding: 'utf8' });
    assert.equal(viaMain.status, 0, viaMain.stderr);
    assert.match(viaMain.stdout, /第二纪/);
    const viaMain1 = spawnSync(process.execPath, [join(ROOT, 'src', 'sandbox', 'main.js'), 'run', '--physics', '1', '--days', '3', '--agents', '4', '--out', join(out, 'x1')], { encoding: 'utf8' });
    assert.equal(viaMain1.status, 0, viaMain1.stderr);
    assert.doesNotMatch(viaMain1.stdout, /第二纪/);
    assert.equal(spawnSync(process.execPath, [join(ROOT, 'src', 'sandbox', 'main.js'), 'run', '--physics', '9'], { encoding: 'utf8' }).status, 2);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════
// 静态约束
// ═══════════════════════════════════════════════════════════════

test('沙盘脑只读感知、只经 act 行动：brains.js / templates.js 的引擎导入限于感知、act、出生与管理钩子；没有 Math.random / Date.now（由 e2-determinism 另检）', () => {
  const src = readFileSync(join(ROOT, 'src', 'e2', 'sandbox', 'brains.js'), 'utf8');
  const imports = [...src.matchAll(/\bfrom '([^']+)';/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, [
    '../../rng.js', '../engine/actions.js', '../engine/admin.js', '../engine/core.js', '../engine/perception.js', '../engine/souls.js', '../engine/tick.js', '../params.js', '../world.js', './templates.js',
  ].sort());
  const tpl = readFileSync(join(ROOT, 'src', 'e2', 'sandbox', 'templates.js'), 'utf8');
  assert.deepEqual([...tpl.matchAll(/\bfrom '([^']+)';/g)].map((m) => m[1]), []);
  // 决策函数里不碰账本、不直接改世界：除了 bornFromSoul / refundSponsors（沙盘领养）与 emit（admin 事件）
  for (const banned of [/\bsource\(/, /\bsink\(/, /creditEnergy/, /w\.treasury\.\w+\s*[-+]?=[^=]/, /\.status\s*=[^=]/]) assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), banned);
});

test('默认场景跑满 720 日（种子 1，24 位先民）：账本每日守恒，覆盖要求全部满足，性能在目标之内（记入 QUESTIONS 的除外）', { timeout: 600000 }, () => {
  const { world, report } = runSandbox({ days: 720, agents: 24, seed: 1 });
  configureSandbox({ scenario: 'default' });
  assert.equal(report.meta.conservationFailure, null);
  assert.equal(world.ledger.mismatches, 0);
  assert.equal(report.meta.worldDays, 720);
  assert.equal(report.metrics.length, 720);
  assert.deepEqual(coverageGaps(report), [], '覆盖要求：每种动作、每种操作至少一次；重订、程序更替、遗址、躯壳醒来各至少一次');
  // 先民 24 位 + 孩子；城里还有人
  assert.ok(report.final.agentsEver > 24);
  assert.ok(report.final.alive >= 1);
  // 性能目标 60 秒（同 v1）：测试机器忙的时候放宽到 150 秒，实测数字见 docs/CALIBRATION-E2.md
  assert.ok(report.meta.elapsedMs < 150000, `${report.meta.elapsedMs} ms`);
});
