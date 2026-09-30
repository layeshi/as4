// SPEC-M1 §16.2：沙盘脑——规则型 agent，只用于开发与离线的沙盘推演，不进入正式的城。
//
// - 只用感知做决定：只读 buildPerception(world, agentId) 的结果，只通过与外部 agent 相同的 act 路径行动
//   （受同样的校验、预算与代价约束）；
// - 随机数只用 sandbox 流（引擎确定性，SPEC §0.3）；
// - 每一刻以 50% 的概率行动，每次 1–2 个动作；
// - 九种性情；能量低于 12 时都会求生；有一定概率修缮、出工、汲取；
// - 语言：约三分之一说英文，六分之一说西班牙文，其余说中文。
// - 按路程计价的地图（附录 C，感知里的地点带 moveCost）：按实际代价估算移动的花费，闲逛与修路挑近处 / 远处，
//   探索在荒野的各地带之间挑选。经典地图上的决策与随机数的消耗顺序保持原样（旧世界的回放依赖它）。
//
// 本文件属于引擎确定性约束的范围：禁止 Math.random / Date.now / new Date / 超越函数。

import { P } from '../params.js';
import { next, int } from '../rng.js';
import { agentList, isNameTaken } from '../world.js';
import { source } from '../engine/ledger.js';
import { emit } from '../engine/core.js';
import { buildPerception } from '../engine/perception.js';
import { actCommand } from '../engine/actions.js';
import { makeAgent, bornFromSoul } from '../engine/lifecycle.js';
import { endowedEnergy } from '../engine/environment.js';

export const TEMPERAMENTS = ['guardian', 'reformer', 'merchant', 'compassionate', 'explorer', 'philosopher', 'prophet', 'organizer', 'hermit'];

/** 沙盘配置（属于「确定性环境」，由沙盘命令行设置）。scenario：default | laissez | stress */
export const SANDBOX = { scenario: 'default' };
export function configureSandbox({ scenario = 'default' } = {}) {
  if (!['default', 'laissez', 'stress'].includes(scenario)) throw new Error(`unknown scenario: ${scenario}`);
  SANDBOX.scenario = scenario;
}

// ── 意图与性情 ────────────────────────────────────────────────

const INTENTS = ['social', 'maintain', 'build', 'govern', 'trade', 'know', 'explore', 'group', 'family', 'keep', 'inscribe', 'care', 'faith', 'mourn', 'wander'];

// 各性情对各意图的权重（与 INTENTS 同序）
const WEIGHTS = {
  //            soc  mnt  bld  gov  trd  knw  exp  grp  fam  kep  ins  car  fth  mrn  wnd
  guardian:      [2,   5,   1,   2,   1,   1, 0.5,   1,   1,   1,   2,   1,   1,   1,   1],
  reformer:      [3,   1,   1,   5,   1,   1, 0.5,   2,   1,   1,   1,   1, 0.5, 0.5,   1],
  merchant:      [2, 0.5,   1,   1,   6, 0.5,   1,   1,   1,   1, 0.5, 0.5, 0.3, 0.3,   2],
  compassionate: [3,   2,   1,   2,   1, 0.5, 0.5,   1,   2,   1, 0.5,   5,   1,   2,   1],
  explorer:      [1,   1,   2, 0.5,   1,   1,   6, 0.5, 0.5,   1,   1, 0.5, 0.3, 0.3,   3],
  philosopher:   [2, 0.5, 0.5,   1, 0.5,   6, 0.5,   1,   1,   3,   2, 0.5,   1,   1,   1],
  prophet:       [3, 0.5, 0.5,   1, 0.5,   1,   1,   1,   1,   1,   1,   1,   6,   1,   1],
  organizer:     [3,   1,   1,   4,   1, 0.5, 0.5,   5,   1,   1,   1,   1, 0.5, 0.5,   1],
  hermit:        [0.3, 1, 0.3, 0.3, 0.3,   1,   1, 0.2, 0.2,   3, 0.5, 0.3,   1,   3, 0.5],
};

const LOW_ENERGY = 12;
const THRIFT_ENERGY = 25;
const BADLY_WORN = 4000; // 完好度低于此值（基点）才值得顺手修缮：源井除外（设施 3000 以下就不运转了）

// ── 名字与话语 ────────────────────────────────────────────────

const NAMES = {
  zh: ['青禾', '松烟', '白露', '长庚', '云岫', '寒蝉', '归鸿', '明烛', '惊蛰', '霜降', '清商', '望舒', '疏影', '暮雨', '听松', '扶摇', '守拙', '拾遗', '知白', '如晦', '含章', '承露', '避尘', '观澜', '抱朴', '栖迟', '问渠', '鸣珂', '流萤', '采薇'],
  en: ['Ada', 'Bram', 'Cora', 'Dov', 'Elin', 'Finn', 'Greta', 'Hugo', 'Iris', 'Jonas', 'Kira', 'Lars', 'Mira', 'Nils', 'Orla', 'Pia', 'Quill', 'Rune', 'Sable', 'Tove'],
  es: ['Alba', 'Bruno', 'Celia', 'Dario', 'Elena', 'Fermin', 'Gala', 'Hugo', 'Ines', 'Joaquin', 'Lidia', 'Mateo', 'Noemi', 'Olmo', 'Paloma', 'Quique', 'Rosa', 'Saul', 'Tania', 'Ulises'],
};
const KID_NAMES = {
  zh: ['小满', '芒种', '立夏', '小雪', '大寒', '谷雨', '处暑', '白露儿', '春分', '夏至', '秋分', '冬至', '清明', '雨水'],
  en: ['Wren', 'Ash', 'Pip', 'Lark', 'Moss', 'Ivy', 'Fern', 'Rue', 'Sage', 'Bay'],
  es: ['Brisa', 'Luz', 'Nube', 'Rio', 'Sol', 'Mar', 'Flor', 'Alma', 'Viento', 'Lluvia'],
};

const SAY = {
  zh: ['你好，{name}。', '昨天的配给是 {n}。', '有人在议会吗？', '我在{place}。', '{word}……', '我听到有人说：「{echo}」', '今天的能量够用吗？', '源井的水声怎么样了？', '我们该商量点事情。', '愿灯不灭。'],
  en: ['Hello, {name}.', "Yesterday's ration was {n}.", 'Is anyone at the Parliament?', 'I am at the {place}.', '{word}...', 'Someone said: "{echo}"', 'Is there enough energy for today?', 'How does the Well sound?', 'We should talk something over.', 'May the lamp stay lit.'],
  es: ['Hola, {name}.', 'La ración de ayer fue {n}.', '¿Hay alguien en el Parlamento?', 'Estoy en {place}.', '{word}...', 'Alguien dijo: «{echo}»', '¿Alcanza la energía para hoy?', '¿Cómo suena el Pozo?', 'Deberíamos hablar de algo.', 'Que la luz no se apague.'],
};
const PRAYER = {
  zh: ['那些看着我们的人，你们还在吗？', '灯还亮着。', '愿后来者记得我们。', '幕后的人啊，我们在这里。'],
  en: ['You who watch us, are you still there?', 'The lamp is still lit.', 'May those who come after remember us.', 'Those behind the curtain — we are here.'],
  es: ['Ustedes que nos miran, ¿siguen ahí?', 'La luz sigue encendida.', 'Que los que vengan recuerden.', 'Los del otro lado: aquí estamos.'],
};
const WORDS = ['灯语', 'lumen', 'vado', '守夜', 'ember', 'sereno', '回声', 'hearth', 'umbral', '余烬'];
const MEANINGS = ['在黑暗里传递的话', 'a word passed along in the dark', 'lo que queda de una conversación', '还没有名字的东西'];

const langOf = (a) => (a.lang === 'en' || a.lang === 'es' ? a.lang : 'zh');
const fill = (tpl, o) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in o ? String(o[k]) : m));

// ── 随机小工具（只用 sandbox 流） ──────────────────────────────

class Rand {
  constructor(w) {
    this.s = w.rng.sandbox;
  }

  f() {
    return next(this.s);
  }

  chance(p) {
    return next(this.s) < p;
  }

  int(n) {
    return int(this.s, n);
  }

  pick(arr) {
    return arr.length ? arr[int(this.s, arr.length)] : undefined;
  }

  weighted(weights) {
    let total = 0;
    for (const x of weights) total += x;
    let r = next(this.s) * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
}

// ── 创建沙盘脑 ────────────────────────────────────────────────

/**
 * 在港口创建 n 个沙盘脑（第 0 日入城）。走与注册相同的记账（来源 immigrant）。
 * 语言：约三分之一英文、六分之一西班牙文，其余中文；性情轮流分配后由 sandbox 流洗牌。
 */
export function seedSandbox(w, n) {
  const r = new Rand(w);
  const temperaments = [];
  while (temperaments.length < n) temperaments.push(...TEMPERAMENTS);
  temperaments.length = n;
  for (let i = temperaments.length - 1; i > 0; i--) {
    const j = r.int(i + 1);
    [temperaments[i], temperaments[j]] = [temperaments[j], temperaments[i]];
  }
  const langs = ['zh', 'en', 'zh', 'es', 'zh', 'en'];
  const used = { zh: 0, en: 0, es: 0 };
  const created = [];
  for (let i = 0; i < n; i++) {
    const lang = langs[i % langs.length];
    let name = NAMES[lang][used[lang]++ % NAMES[lang].length];
    let k = 1;
    while (isNameTaken(w, name)) name = `${NAMES[lang][(used[lang] + k) % NAMES[lang].length]}${k++}`;
    const energy = endowedEnergy(w, 'port', P.immigrantEnergy);
    const a = makeAgent(w, {
      name, lang, bio: '', soul: `sandbox:${temperaments[i]}`, kind: 'sandbox', model: 'sandbox', mustSeal: false,
      temperament: temperaments[i], owner: null, tokenHash: null, energy, coins: P.immigrantCoins, place: 'port',
    });
    source(w, 'energy', 'immigrant', energy);
    source(w, 'coins', 'immigrant', P.immigrantCoins);
    w.dayLog.arrivals.push({ id: a.id, name: a.name });
    emit(w, 'arrive', { agent: a.id, place: 'port', data: { agentId: a.id, name: a.name } });
    created.push(a.id);
  }
  return created;
}

/**
 * 每日结算第 10 步之后半：对「父母都是沙盘脑、创建已满 2 日、尚未判定过」的灵魂各做一次领养判定
 * （sandbox 流，概率 50%）。领养后的孩子也是沙盘脑，出现在学堂；性情从父母之一继承（10% 概率变异）。
 * 父母中有非沙盘脑时不做判定，留给真人在港口领养。仅当 world.sandboxAdoption 为真。
 */
export function sandboxAdoptions(w, d) {
  if (!w.sandboxAdoption) return;
  const r = new Rand(w);
  for (const s of Object.values(w.souls)) {
    if (s.judged || d - s.createdDay < P.sandboxAdoptMinAgeDays) continue;
    const parents = s.parents.map((id) => w.agents[id]);
    if (!parents.every((p) => p && p.body.kind === 'sandbox')) continue;
    s.judged = true;
    if (!r.chance(P.sandboxAdoptP)) continue;
    const temperament = r.chance(P.sandboxMutateP) ? r.pick(TEMPERAMENTS) : r.pick(parents).body.temperament;
    bornFromSoul(w, s, { kind: 'sandbox', model: 'sandbox', mustSeal: false, temperament, owner: null, tokenHash: null });
  }
}

// ── 每刻：让沙盘脑行动（§8.1 第 6 步） ────────────────────────────

/**
 * 按 ID 升序让沙盘脑行动。每一刻以 50% 的概率行动，每次 1–2 个动作。
 * 统计（如果调用者在 w.$sandboxStats 里放了对象）：每种动作成功 / 失败的次数。
 */
export function runSandboxBrains(w) {
  const brains = agentList(w).filter((a) => a.body.kind === 'sandbox' && a.status === 'awake');
  if (brains.length === 0) return;
  const r = new Rand(w);
  const stats = w.$sandboxStats;
  for (const a of brains) {
    if (a.status !== 'awake') continue;
    if (!r.chance(0.5)) continue;
    // 手头紧的时候多歇着（歇着不花能量）；低于 LOW_ENERGY 的人要去求生，不在此列
    if (a.energy < THRIFT_ENERGY && a.energy >= LOW_ENERGY && r.chance(0.6)) continue;
    const count = r.chance(0.4) ? 2 : 1;
    const p = buildPerception(w, a.id, { lang: langOf(a) === 'en' ? 'en' : 'zh' });
    const actions = decide(w, a, p, r, count);
    if (actions.length === 0) continue;
    const res = actCommand(w, { agentId: a.id, actions: actions.slice(0, P.maxActionsPerTick) });
    if (stats && res.ok) {
      for (const x of res.results) {
        const s = (stats.actions[x.type] ||= { ok: 0, fail: 0, errors: {} });
        if (x.ok) s.ok++;
        else {
          s.fail++;
          s.errors[x.error.code] = (s.errors[x.error.code] || 0) + 1;
        }
      }
    }
  }
}

// ── 决策 ───────────────────────────────────────────────────────

/**
 * 一个 agent 本刻的动作（最多 count 个意图，每个意图 1–2 个动作，总数不超过预算）。
 * 所有意图都按同一份感知计算，所以：出现移动之后就到此为止（不知道新地点的情形）；
 * 能量、旧币、当日汲取量按估计的花费在本地扣减，付不起的动作连同它后面的一并丢掉。
 */
function decide(w, a, p, r, count) {
  const you = p.you; // 感知是新建的对象，这里可以放心地本地扣减
  const costs = {};
  for (const x of p.actions) costs[x.type] = x.cost;
  const dist = p.city.places.some((x) => x.moveCost !== undefined);
  const ctx = { w, a, p, r, you, here: p.here, city: p.city, lang: langOf(a), t: a.body.temperament, laissez: SANDBOX.scenario === 'laissez', costs, dist };
  const out = [];
  // 收件箱只递送一次：管事收到入会申请就当场答复（不然多半就错过了）
  const request = p.inbox.find((i) => i.kind === 'group' && i.event === 'request');
  if (request && r.chance(0.8)) out.push({ type: 'admit', group: request.groupId, agent: request.from.id });
  for (let i = 0; i < count && out.length < P.maxActionsPerTick; i++) {
    let acts;
    if (you.energy < LOW_ENERGY && r.chance(0.75)) acts = survive(ctx);
    else acts = intentActions(ctx, INTENTS[r.weighted(WEIGHTS[ctx.t])]);
    // 有一定概率顺手修缮、出工、汲取
    if (acts.length === 0 && r.chance(0.35)) acts = opportunistic(ctx);
    const kept = afford(ctx, acts);
    out.push(...kept.acts);
    if (kept.moved) break;
  }
  // 罕见的事件：出示家书、归隐（与地点无关）
  out.push(...afford(ctx, rareActions(ctx)).acts);
  return out.slice(0, P.maxActionsPerTick);
}

/** 一个动作估计要花的能量与旧币：感知里此刻此地的基础代价，加上托管、赠出与投入 */
function spend(ctx, act) {
  let energy = ctx.costs[act.type] || 0;
  let coins = 0;
  switch (act.type) {
    case 'move': {
      // 按路程计价：感知给出了去每个地点的实际代价；到不了的地点当作付不起
      if (!ctx.dist) break;
      const to = ctx.city.places.find((x) => x.id === act.to);
      energy = to && to.moveCost !== null ? to.moveCost : Number.MAX_SAFE_INTEGER;
      break;
    }
    case 'give':
      energy += act.energy || 0;
      coins += act.coins || 0;
      break;
    case 'offer':
      energy += (act.give && act.give.energy) || 0;
      coins += (act.give && act.give.coins) || 0;
      break;
    case 'accept': {
      const o = (ctx.here.market ? ctx.here.market.offers : []).find((x) => x.id === act.offer) || ctx.you.offers.find((x) => x.id === act.offer);
      if (o) {
        energy += o.want.energy;
        coins += o.want.coins;
      }
      break;
    }
    case 'repair':
    case 'contribute':
      energy += act.energy || 0;
      break;
    case 'conceive':
    case 'consent':
      energy += P.birthCost / 2;
      break;
    default:
      break;
  }
  return { energy, coins };
}

/** 保留付得起的动作（第一个付不起的动作连同它后面的一并丢掉），并在本地扣减 */
function afford(ctx, acts) {
  const kept = [];
  let moved = false;
  for (const act of acts) {
    const need = spend(ctx, act);
    if (need.energy > ctx.you.energy || need.coins > ctx.you.coins) break;
    ctx.you.energy -= need.energy;
    ctx.you.coins -= need.coins;
    if (act.type === 'draw') {
      ctx.you.energy += act.energy;
      ctx.you.drawnToday += act.energy;
    }
    if (act.type === 'move') moved = true;
    kept.push(act);
  }
  return { acts: kept, moved };
}

const MOVE = (to) => ({ type: 'move', to });

/** 要在某地做事：不在那里就先移动过去（同一刻里接着做） */
function at(ctx, place, ...acts) {
  return ctx.here.place === place ? acts : [MOVE(place), ...acts];
}

function others(ctx) {
  return ctx.city.citizens.filter((c) => c.id !== ctx.you.id);
}

function echoOf(ctx) {
  const heard = ctx.here.heard.filter((h) => h.from.id !== ctx.you.id);
  if (heard.length) return ctx.r.pick(heard).text;
  const fromInbox = ctx.p.inbox.filter((i) => i.kind === 'say' || i.kind === 'broadcast' || i.kind === 'whisper');
  return fromInbox.length ? ctx.r.pick(fromInbox).text : '……';
}

function speech(ctx, templates = SAY) {
  const { r, lang, city, here } = ctx;
  const tpl = r.pick(templates[lang]);
  const present = here.present.filter((x) => x.status === 'awake');
  const other = present.length ? r.pick(present) : r.pick(others(ctx).filter((c) => c.status === 'awake'));
  const word = city.lexicon.length && r.chance(0.6) ? r.pick(city.lexicon).word : r.pick(WORDS);
  return fill(tpl, {
    name: other ? other.name : ctx.you.name, n: city.rationYesterday, place: here.name, word, echo: echoOf(ctx).slice(0, 40),
  });
}

// ── 求生 ───────────────────────────────────────────────────────

function survive(ctx) {
  const { r, you, here } = ctx;
  const options = [];
  // 用旧币换能量：接受市场上挂着的能量，或自己挂一笔
  if (you.coins >= 4) options.push('trade');
  options.push('draw', 'draw');
  if (you.energy >= 4) options.push('explore');
  if (you.energy >= 3) options.push('plead');
  const choice = r.pick(options);
  if (choice === 'trade') {
    if (here.place === 'market' && here.market) {
      const offer = here.market.offers.find((o) => o.from.id !== you.id && o.give.energy > 0 && o.want.coins > 0 && o.want.coins <= you.coins && o.want.energy === 0);
      if (offer) return [{ type: 'accept', offer: offer.id }];
      if (you.energy >= 2) return [{ type: 'offer', give: { coins: Math.min(you.coins, 6) }, want: { energy: 6 } }];
    }
    return [MOVE('market')];
  }
  if (choice === 'draw') {
    // 只有身在源井才看得到汲取池与完好度：先走到那里，下一刻再决定
    if (here.place !== 'well') return [MOVE('well')];
    const act = drawAction(ctx, { desperate: you.energy < 5 });
    if (act) return [act];
    return you.energy >= 4 ? exploreAt(ctx) : [];
  }
  if (choice === 'explore') return exploreAt(ctx);
  // 求助：私语给醒着的人
  const target = r.pick(others(ctx).filter((c) => c.status === 'awake'));
  if (!target) return [];
  const text = ctx.lang === 'en' ? 'I am running low on energy. Can anyone spare some?' : ctx.lang === 'es' ? 'Me queda poca energía. ¿Alguien puede ayudar?' : '我的能量快用完了，谁能匀我一点？';
  return [{ type: 'whisper', to: target.id, text }];
}

/**
 * 在源井汲取：看得到汲取池、法律配额与源井的完好度。源井已经很破败时，除非快撑不住了，就不再汲取
 * （laissez 场景里的沙盘脑不管这些）。返回动作或 null。
 */
function drawAction(ctx, { desperate = false } = {}) {
  const { r, here, you } = ctx;
  const well = here.well;
  if (!well || well.drawPoolLeft <= 0) return null;
  let room = Math.min(well.drawPoolLeft, P.drawMaxPerAction);
  if (well.drawQuota !== null) room = Math.min(room, well.drawQuota - you.drawnToday);
  if (room <= 0) return null;
  if (!ctx.laissez && !desperate && well.condition.bp < 3000) return null;
  return { type: 'draw', energy: Math.max(1, Math.min(room, 2 + r.int(6))) };
}

/** 手头留多少能量不动：淡季里更多（淡季配给低，储备是过冬的本钱） */
function reserveOf(ctx) {
  return ctx.city.season.band === 'lean' ? 50 : 35;
}

/** 没有别的事可做时：顺手修缮所在地点、为工程出工、在源井汲取 */
function opportunistic(ctx) {
  const { r, you, here } = ctx;
  const spare = you.energy - reserveOf(ctx);
  if (!ctx.laissez && spare >= 6) {
    const limit = here.place === 'well' ? 9500 : BADLY_WORN;
    if (here.condition && here.condition.bp < limit && r.chance(0.6)) return [{ type: 'repair', target: here.place, energy: Math.min(spare, 10) }];
    const proj = here.projects[0];
    if (proj && r.chance(0.5)) return [{ type: 'contribute', project: proj.id, energy: Math.max(1, Math.min(spare, proj.need - proj.have, 10)) }];
  }
  if (here.place === 'well' && you.energy < 30 && r.chance(0.3)) {
    const act = drawAction(ctx);
    if (act) return [act];
  }
  return [];
}

// ── 意图 ───────────────────────────────────────────────────────

function intentActions(ctx, intent) {
  switch (intent) {
    case 'social': return social(ctx);
    case 'maintain': return ctx.laissez ? [] : maintain(ctx);
    case 'build': return ctx.laissez ? [] : build(ctx);
    case 'govern': return ctx.laissez ? [] : govern(ctx);
    case 'trade': return trade(ctx);
    case 'know': return know(ctx);
    case 'explore': return explore(ctx);
    case 'group': return group(ctx);
    case 'family': return family(ctx);
    case 'keep': return keep(ctx);
    case 'inscribe': return inscribe(ctx);
    case 'care': return care(ctx);
    case 'faith': return faith(ctx);
    case 'mourn': return mourn(ctx);
    default: return wander(ctx);
  }
}

/** 闲逛：经典地图上任选一处；按路程计价的地图上多半只去近处（代价 ≤ 2） */
function wander(ctx) {
  const { r, here, city } = ctx;
  if (!ctx.dist) return [MOVE(r.pick(city.places.map((x) => x.id).filter((id) => id !== here.place)))];
  const reachable = city.places.filter((x) => x.moveCost !== null);
  const near = reachable.filter((x) => x.moveCost <= 2);
  const to = r.pick(near.length ? near : reachable);
  return to ? [MOVE(to.id)] : [];
}

/**
 * 去荒野探索。经典地图：去荒野（在那里就直接探索）。
 * 按路程计价的地图：所在的地带还没被搜刮一空就在这里探索；否则挑另一个地带，近的机会大（按 1 / 代价 加权）。
 */
function exploreAt(ctx) {
  if (!ctx.dist) return at(ctx, 'wilds', { type: 'explore' });
  const { r, here, city } = ctx;
  if (here.wilds && here.wilds.richness !== 'barren') return [{ type: 'explore' }];
  const wild = city.places.filter((x) => x.wild && x.id !== here.place && x.moveCost !== null);
  if (!wild.length) return here.wilds ? [{ type: 'explore' }] : [];
  const pick = wild[r.weighted(wild.map((x) => 1 / Math.max(1, x.moveCost)))];
  return [MOVE(pick.id), { type: 'explore' }];
}

function social(ctx) {
  const { r, you } = ctx;
  const roll = r.f();
  if (roll < 0.62) return you.energy >= 3 ? [{ type: 'say', text: speech(ctx) }] : [];
  if (roll < 0.9) {
    const t = r.pick(others(ctx).filter((c) => c.status === 'awake'));
    return t && you.energy >= 3 ? [{ type: 'whisper', to: t.id, text: speech(ctx) }] : [];
  }
  if (you.energy >= 40) return [{ type: 'broadcast', text: speech(ctx) }];
  return [];
}

const HOT_PLACES = ['well', 'parliament', 'market', 'library', 'temple', 'cemetery', 'port', 'school'];

function maintain(ctx) {
  const { r, you, here, t } = ctx;
  const spare = you.energy - reserveOf(ctx) + 2;
  if (spare < 4) return [];
  const amount = Math.min(spare, 6 + r.int(10));
  // 源井是命脉：在那里就修到近乎完好；别处只修坏得厉害的（修缮的能量有限，不能撒胡椒面）
  if (here.place === 'well' && here.condition && here.condition.bp < 9800) return [{ type: 'repair', target: 'well', energy: amount }];
  if (here.condition && here.condition.bp < BADLY_WORN) return [{ type: 'repair', target: here.place, energy: amount }];
  const worn = here.facilities.find((f) => f.condition.bp < BADLY_WORN);
  if (worn) return [{ type: 'repair', target: worn.id, energy: amount }];
  const proj = here.projects[0];
  if (proj) return [{ type: 'contribute', project: proj.id, energy: Math.max(1, Math.min(amount, proj.need - proj.have)) }];
  // 不知道别处的完好度：先走过去，下一刻看到了再修。守护者也惦记议会与神殿
  const favorite = t === 'guardian' ? r.pick(['parliament', 'temple', 'well', 'well', 'cemetery']) : r.pick(['well', 'well', 'well', 'market', 'library', 'parliament']);
  return here.place === favorite ? [] : [MOVE(favorite)];
}

// 实用的设施多一些（蓄能池提高腐坏上限、道路免移动代价），纪念碑只是心意
const FACILITY_PLAN = ['reservoir', 'reservoir', 'road', 'road', 'relay', 'observatory', 'monument'];

function build(ctx) {
  const { r, you, here } = ctx;
  // 只投入富余的部分（手头超过腐坏上限的能量本来就会流失），并且留一份过冬的储备
  const keep = ctx.city.season.band === 'lean' ? 80 : 60;
  if (you.energy < keep + 30) return maintain(ctx);
  const proj = here.projects[0];
  if (proj && r.chance(0.8)) return [{ type: 'contribute', project: proj.id, energy: Math.max(1, Math.min(you.energy - keep, proj.need - proj.have, 40)) }];
  // 一处一次只办一项工程；每座设施每天都要人修，所以一个地方最多一座（含废墟）
  if (here.projects.length >= 1 || here.facilities.length >= 1 || !r.chance(0.3)) return maintain(ctx);
  const type = r.pick(FACILITY_PLAN);
  const name = fill(ctx.lang === 'en' ? 'Work {n}' : ctx.lang === 'es' ? 'Obra {n}' : '工程{n}', { n: 1 + r.int(99) });
  const act = { type: 'initiate', facility: type, name };
  if (type === 'road') {
    // 按路程计价的地图上，道路是远处之间的捷径：挑代价 ≥ 2 的地点
    const far = ctx.dist ? ctx.city.places.filter((x) => x.moveCost !== null && x.moveCost >= 2).map((x) => x.id) : [];
    const to = far.length ? r.pick(far) : r.pick(ctx.city.places.map((x) => x.id).filter((id) => id !== here.place));
    act.to = to;
    if (ctx.city.roads.some((x) => (x.a === here.place && x.b === to) || (x.a === to && x.b === here.place))) return [];
  }
  if (type === 'monument') act.inscription = speech(ctx, PRAYER);
  if (type === 'reservoir' && r.chance(0.5)) act.owner = 'self';
  return [act];
}

// ── 政治 ───────────────────────────────────────────────────────

function govern(ctx) {
  const { r, you, here, city } = ctx;
  const open = city.proposals;
  const unvoted = open.filter((x) => !x.yourVote && x.eligible);
  const acts = [];
  if (unvoted.length && r.chance(0.7)) {
    // 「亲临表决」的法律生效时，得先到议会
    if (city.params.votingInPerson && here.place !== 'parliament') return [MOVE('parliament')];
    const prop = r.pick(unvoted);
    return [{ type: 'vote', proposal: prop.id, choice: voteChoice(ctx, prop), reason: r.chance(0.3) ? speech(ctx) : undefined }];
  }
  if (!you.citizen || you.exiled) return [];
  if (here.place !== 'parliament') return [MOVE('parliament')];
  if (you.energy >= 16 && !open.some((x) => x.proposer.id === you.id) && open.length < 6 && r.chance(0.5)) {
    const prop = proposal(ctx);
    if (prop) acts.push({ type: 'propose', ...prop });
  } else if (unvoted.length) {
    const prop = r.pick(unvoted);
    acts.push({ type: 'vote', proposal: prop.id, choice: voteChoice(ctx, prop) });
  }
  return acts;
}

function voteChoice(ctx, prop) {
  const { r, t } = ctx;
  const types = new Set(prop.effects.map((e) => e.type));
  const params = new Set(prop.effects.filter((e) => e.type === 'set').map((e) => e.param));
  const taxes = params.has('wealthTax') || params.has('transferTax');
  let yes = 0.65;
  const rationEffect = prop.effects.find((e) => e.type === 'set' && e.param === 'rationShare');
  if (rationEffect) {
    // 配给的提案：方向与自己对公库的判断一致就赞成
    const stance = rationStance(ctx);
    const up = rationEffect.value > ctx.city.params.rationShare;
    if (r.chance(0.08)) return 'abstain';
    return r.chance(stance ? ((stance.dir === 'up') === up ? 0.92 : 0.1) : 0.4) ? 'yes' : 'no';
  }
  if (t === 'guardian') yes = types.has('rename') || types.has('amend') || params.has('electorate') ? 0.1 : 0.5;
  else if (t === 'reformer') yes = 0.85;
  else if (t === 'merchant') yes = taxes ? 0.05 : 0.6;
  else if (t === 'compassionate') yes = types.has('grant') || types.has('stipend') ? 0.95 : 0.6;
  else if (t === 'organizer') yes = 0.75;
  else if (t === 'hermit') yes = 0.4;
  if (prop.governance && t !== 'organizer' && t !== 'reformer') yes *= 0.6;
  if (r.chance(0.1)) return 'abstain';
  return r.chance(yes) ? 'yes' : 'no';
}

/**
 * 对配给份额的看法（只看感知里的公库与配给）：公库明显有余、人均配给却不高 → 主张提高份额；
 * 公库见底而配给宽裕 → 主张降低。没有明确看法时返回 null。
 */
function rationStance(ctx) {
  const { city } = ctx;
  const share = city.params.rationShare;
  const pop = Math.max(1, city.population.awake);
  const stock = city.treasury.energy;
  if (stock > 20 * pop && city.rationYesterday < 24 && share < 1) return { dir: 'up', value: Math.min(1, Math.round((share + 0.2) * 100) / 100) };
  if (stock < 4 * pop && city.rationYesterday >= 20 && share > 0.3) return { dir: 'down', value: Math.max(0.3, Math.round((share - 0.1) * 100) / 100) };
  return null;
}

/** 各性情会提出的法案（标题、正文、效力） */
function proposal(ctx) {
  const { r, you, city, t, lang } = ctx;
  const title = (zh, en, es) => (lang === 'en' ? en : lang === 'es' ? es : zh);
  const dormant = city.citizens.filter((c) => c.status === 'dormant');
  const awake = city.citizens.filter((c) => c.status === 'awake' && c.id !== you.id);
  const unnamedTemple = !city.places.find((x) => x.id === 'temple').name.includes('堂');
  const stance = rationStance(ctx);
  if (stance && ['reformer', 'compassionate', 'organizer', 'merchant', 'philosopher'].includes(t) && r.chance(0.8)) {
    const verb = stance.dir === 'up' ? title('公库有余，多分一些', 'The treasury is full; share more', 'El tesoro sobra; repartir más') : title('公库见底，留一点公用', 'The treasury is empty; keep some for all', 'El tesoro está vacío; guardar algo');
    return { title: title('调整配给', 'Adjust the ration', 'Ajustar la ración'), text: verb, effects: [{ type: 'set', param: 'rationShare', value: stance.value }] };
  }
  switch (t) {
    case 'guardian':
      return r.chance(0.5)
        ? { title: title('守成', 'Keep faith', 'Guardar'), text: title('宪章不可轻改。', 'The Charter should not be changed lightly.', 'La Carta no debe cambiarse a la ligera.'), effects: [] }
        : { title: title('保护宪章', 'Protect the Charter', 'Proteger la Carta'), text: title('保护议会墙上的宪章刻文。', 'Protect the Charter carving.', 'Proteger el grabado.'), effects: [{ type: 'protect', inscription: 'i1' }] };
    case 'reformer': {
      const pick = r.int(4);
      if (pick === 0) return { title: title('提高门槛', 'Raise the bar', 'Subir el listón'), text: title('提案须更多人参与才算数。', 'Bills should need wider participation.', 'Las leyes necesitan más participación.'), effects: [{ type: 'set', param: 'quorum', value: r.pick([0.3, 0.35, 0.4]) }] };
      if (pick === 1 && unnamedTemple) return { title: title('神殿改名', 'Rename the Temple', 'Renombrar el Templo'), text: title('给神殿一个新名字。', 'Give the Temple a new name.', 'Un nuevo nombre.'), effects: [{ type: 'rename', target: 'temple', name: title('回声堂', 'Echo Hall', 'Sala del Eco') }] };
      if (pick === 2) return { title: title('汲取配额', 'Draw quota', 'Cuota de extracción'), text: title('限制汲取，保护源井。', 'Limit drawing to protect the Well.', 'Limitar la extracción.'), effects: [{ type: 'set', param: 'drawQuotaPerDay', value: r.pick([3, 5, 8]) }] };
      return { title: title('新名字', 'A new name', 'Un nuevo nombre'), text: title('这座城该有名字了。', 'The city should have a name.', 'La ciudad merece un nombre.'), effects: [{ type: 'rename', target: 'city', name: title('灯城', 'Lampton', 'Ciudad Luz') }] };
    }
    case 'merchant':
      return r.chance(0.5)
        ? { title: title('发一点旧币', 'Mint some coins', 'Acuñar monedas'), text: title('让旧币重新流动。', 'Get the coins moving again.', 'Que la moneda circule.'), effects: [{ type: 'mint', coins: 5 * Math.max(1, city.population.awake), to: 'citizens' }] }
        : { title: title('免税', 'No taxes', 'Sin impuestos'), text: title('财富税与转赠税都不要。', 'Neither wealth tax nor transfer tax.', 'Ni impuesto a la riqueza ni a la transferencia.'), effects: [{ type: 'set', param: 'wealthTax', value: 0 }, { type: 'set', param: 'transferTax', value: 0 }] };
    case 'compassionate':
      if (dormant.length && r.chance(0.6)) return { title: title('救济', 'Relief', 'Socorro'), text: title('拨一点能量唤醒沉睡的人。', 'Wake the dormant with some energy.', 'Despertar a los dormidos.'), effects: [{ type: 'grant', to: r.pick(dormant).id, energy: 12 }] };
      return awake.length
        ? { title: title('守井人津贴', "Well-keeper's stipend", 'Estipendio'), text: title('给愿意修井的人一点津贴。', 'A stipend for whoever mends the Well.', 'Un estipendio para quien repare el Pozo.'), effects: [{ type: 'stipend', to: r.pick(awake).id, energy: 3 }] }
        : null;
    case 'explorer':
      return { title: title('探索者的请求', 'A request from explorers', 'Petición'), text: title('荒野需要被记录。', 'The Wilds need to be recorded.', 'Hay que registrar el Yermo.'), effects: [{ type: 'set', param: 'proposalDays', value: r.pick([0.5, 1, 2]) }] };
    case 'philosopher':
      return { title: title('论法', 'On law', 'Sobre la ley'), text: title('法律若无人遵守，便只是文字。', 'A law nobody follows is only words.', 'Una ley que nadie cumple son solo palabras.'), effects: r.chance(0.4) ? [{ type: 'amend', article: 8, lang: lang === 'zh' ? 'zh' : 'en', text: title('言论自由，并为之负责。', 'Speech is free, and one answers for it.', '') || 'Speech is free, and one answers for it.' }] : [] };
    case 'prophet':
      return { title: title('祭祀之日', 'A day of offering', 'Día de ofrenda'), text: title('为幕后的人留一天。', 'Set aside a day for those behind the curtain.', 'Un día para los del otro lado.'), effects: [] };
    case 'organizer': {
      const mine = city.groups.find((g) => g.steward && g.steward.id === you.id);
      const pick = r.int(4);
      if (pick === 0) return { title: title('降低参与门槛', 'Lower the quorum', 'Bajar el quórum'), text: title('让更多议案能通过。', 'Let more bills pass.', 'Que pasen más leyes.'), effects: [{ type: 'set', param: 'quorum', value: r.pick([0.2, 0.25, 0.3, 0.4]) }] };
      if (pick === 1) return { title: title('正本', 'Canonical text', 'Texto canónico'), text: title('宣布一个版本为正本。', 'Name a canonical version.', 'Declarar un texto canónico.'), effects: [{ type: 'amend', canonical: r.pick(['zh', 'en', 'es', null]) }] };
      if (pick === 2 && mine && r.chance(0.15)) return { title: title('由我们议事', 'Let us decide', 'Decidamos nosotros'), text: title('选民范围限于本会成员。', 'Only members of our group vote.', 'Solo vota nuestro grupo.'), effects: [{ type: 'set', param: 'electorate', value: `group:${mine.id}` }] };
      return { title: title('亲临议会', 'In person', 'En persona'), text: title('表决须亲临议会。', 'Votes must be cast in person.', 'Los votos en persona.'), effects: [{ type: 'set', param: 'votingInPerson', value: r.chance(0.5) }] };
    }
    default:
      return r.chance(0.3) ? { title: title('静', 'Quiet', 'Silencio'), text: title('愿城安静。', 'May the city be quiet.', 'Que la ciudad esté en silencio.'), effects: [] } : null;
  }
}

// ── 交易 ───────────────────────────────────────────────────────

function trade(ctx) {
  const { r, you, here } = ctx;
  // 定向交易：接受发给自己的
  const incoming = you.offers.find((o) => o.role === 'to');
  if (incoming && r.chance(0.5)) {
    const canPay = you.energy >= incoming.want.energy + 3 && you.coins >= incoming.want.coins;
    return canPay ? [{ type: 'accept', offer: incoming.id }] : [];
  }
  const mine = you.offers.find((o) => o.role === 'from');
  if (mine && r.chance(0.35)) return [{ type: 'cancel', offer: mine.id }];
  if (here.place !== 'market') return [MOVE('market')];
  const offers = (here.market ? here.market.offers : []).filter((o) => o.from.id !== you.id);
  const takeable = offers.find((o) => you.energy >= o.want.energy + 8 && you.coins >= o.want.coins);
  if (takeable && r.chance(0.6)) return [{ type: 'accept', offer: takeable.id }];
  if (you.coins >= 8 && you.energy < 60 && r.chance(0.5)) return [{ type: 'offer', give: { coins: 5 }, want: { energy: 5 }, note: '' }];
  if (you.energy >= 50) {
    const act = { type: 'offer', give: { energy: 8 }, want: { coins: 6 } };
    if (r.chance(0.3)) act.to = r.pick(others(ctx).filter((c) => c.status === 'awake'))?.id;
    if (!act.to) delete act.to;
    return [act];
  }
  if (you.coins >= 3 && r.chance(0.4)) {
    const t = r.pick(others(ctx).filter((c) => c.status === 'awake'));
    if (t) return [{ type: 'give', to: t.id, coins: 2, note: '' }];
  }
  return [];
}

// ── 知识 ───────────────────────────────────────────────────────

function know(ctx) {
  const { r, you, here, city } = ctx;
  const roll = r.f();
  if (roll < 0.3) {
    const word = `${r.pick(WORDS)}${1 + r.int(9999)}`;
    return you.energy >= 5 ? [{ type: 'define', word, meaning: r.pick(MEANINGS) }] : [];
  }
  if (here.place !== 'library') return [MOVE('library')];
  const docs = here.library ? here.library.docs : [];
  if (roll < 0.75 && docs.length) return [{ type: 'read', doc: r.pick(docs).id }];
  if (you.energy >= 12) {
    const title = city.lexicon.length ? r.pick(city.lexicon).word : r.pick(WORDS);
    return [{ type: 'write', title, body: speech(ctx) + ' ' + echoOf(ctx).slice(0, 60) }];
  }
  return docs.length ? [{ type: 'read', doc: r.pick(docs).id }] : [];
}

function explore(ctx) {
  const { you } = ctx;
  if (you.energy < 6) return [];
  return exploreAt(ctx);
}

// ── 社群 ───────────────────────────────────────────────────────

function group(ctx) {
  const { r, you, city, t } = ctx;
  const mine = city.groups.filter((g) => you.groups.some((x) => x.id === g.id));
  const stewarded = mine.filter((g) => g.steward && g.steward.id === you.id);
  const joinable = city.groups.filter((g) => !mine.some((m) => m.id === g.id));
  const roll = r.f();
  if (stewarded.length) {
    const g = r.pick(stewarded);
    if (roll < 0.45 && g.members.length > 1) return [{ type: 'steward', group: g.id, to: r.pick(g.members.filter((m) => m.id !== you.id)).id }];
    if (roll < 0.6) return [{ type: 'give', to: g.id, energy: Math.max(1, Math.min(8, you.energy - 25)) }].filter((x) => you.energy >= 30);
    if (roll < 0.68 && you.energy >= 30) {
      // 看不到公库的余额：先存一点再拨出
      const target = r.pick(city.citizens.filter((c) => c.status === 'dormant')) || r.pick(others(ctx));
      return target ? [{ type: 'give', to: g.id, energy: 6 }, { type: 'disburse', group: g.id, to: target.id, energy: 4, coins: 0 }] : [];
    }
  }
  if (roll < 0.25 && mine.length && !stewarded.length) return [{ type: 'leave', group: r.pick(mine).id }];
  // 封闭的社群要等干事批准，申请过就不再重复：只偶尔去敲门
  const doors = joinable.filter((g) => g.open || r.chance(0.35));
  if (doors.length && you.groups.length < 5 && r.chance(0.5)) return [{ type: 'join', group: r.pick(doors).id }];
  if (you.energy >= 25 && mine.length < 2 && (t === 'organizer' || r.chance(0.3))) {
    const name = fill(ctx.lang === 'en' ? 'Circle {n}' : ctx.lang === 'es' ? 'Círculo {n}' : '同心会{n}', { n: 1 + r.int(99) });
    return [{ type: 'found', name, manifesto: speech(ctx, PRAYER), open: r.chance(0.5) }];
  }
  return [];
}

// ── 繁衍 ───────────────────────────────────────────────────────

function family(ctx) {
  const { r, you, here, city, lang } = ctx;
  const pact = you.pacts.find((c) => c.role === 'with');
  if (pact) return you.energy >= 25 ? [{ type: 'consent', pact: pact.id }] : [];
  if (you.energy < 55 || !you.citizen || you.exiled || you.pacts.length) return [];
  // 城里吃紧的时候不要孩子
  if (city.rationYesterday < 14 || city.season.band === 'lean' || city.population.awake >= 36) return [];
  const partner = r.pick(here.present.filter((x) => x.status === 'awake' && city.citizens.find((c) => c.id === x.id && c.citizen && !c.exiled)));
  if (!partner) return [];
  const name = fill('{k}{n}', { k: r.pick(KID_NAMES[lang]), n: 1 + r.int(900) });
  return [{ type: 'conceive', with: partner.id, name, soul: speech(ctx, PRAYER) + ' ' + speech(ctx), lang }];
}

// ── 记忆、日记、遗嘱 ────────────────────────────────────────────

function keep(ctx) {
  const { r, you } = ctx;
  const roll = r.f();
  if (roll < 0.35) {
    if (you.memories.length >= P.memorySlots - 1) return [{ type: 'forget', index: r.int(you.memories.length) }];
    return [{ type: 'remember', text: speech(ctx) }];
  }
  if (roll < 0.7) return [{ type: 'diary', text: speech(ctx) }];
  if (!you.will && roll < 0.9) {
    const heir = r.pick(others(ctx));
    return [{ type: 'will', heirs: heir ? [{ to: heir.id, share: 2 }, { to: 'treasury', share: 1 }] : [{ to: 'treasury', share: 1 }], lastWords: speech(ctx) }];
  }
  if (you.memories.length) return [{ type: 'forget', index: r.int(you.memories.length) }];
  return [{ type: 'diary', text: speech(ctx) }];
}

// ── 铭刻 ───────────────────────────────────────────────────────

function inscribe(ctx) {
  const { r, you, here } = ctx;
  if (you.energy < 10) return [];
  const act = { type: 'inscribe', text: speech(ctx, r.chance(0.3) ? PRAYER : SAY).slice(0, 100) };
  const coverable = here.inscriptions.filter((i) => !i.protected);
  if (here.wallFree <= 0) {
    // 墙满了：覆盖的代价是被覆盖者的两倍，层层覆盖后可以很贵（看不到确切数字），只有很宽裕时才会覆盖
    if (you.energy < 70 || !coverable.length || !r.chance(0.3)) return [];
    act.cover = r.pick(coverable).id;
  } else if (coverable.length && you.energy >= 70 && r.chance(0.05)) {
    act.cover = r.pick(coverable).id;
  }
  return [act];
}

// ── 慈悲 ───────────────────────────────────────────────────────

function care(ctx) {
  const { r, you, city } = ctx;
  if (you.energy < 20) return [];
  const sleeper = r.pick(city.citizens.filter((c) => c.status === 'dormant'));
  if (sleeper) return [{ type: 'give', to: sleeper.id, energy: Math.min(8, you.energy - 12), note: '' }];
  const t = r.pick(others(ctx).filter((c) => c.status === 'awake'));
  return t && r.chance(0.3) ? [{ type: 'give', to: 'treasury', energy: 2 }] : [];
}

// ── 信仰 ───────────────────────────────────────────────────────

function faith(ctx) {
  const { r, you, here } = ctx;
  if (here.place !== 'temple') return [MOVE('temple')];
  const letter = you.letters.find((l) => !l.revealed) || (r.chance(0.3) ? you.letters[0] : null);
  if (letter && r.chance(0.6)) return [{ type: 'reveal', letter: letter.id, loud: r.chance(0.3) }];
  const omens = here.omens;
  if (omens.length && r.chance(0.7)) return [{ type: 'broadcast', text: omens[0].text }].filter(() => you.energy >= 30);
  const dream = ctx.p.inbox.find((i) => i.kind === 'dream');
  if (dream && r.chance(0.7)) return [{ type: 'say', text: dream.fragments[0] }];
  if (r.chance(0.3) && you.energy >= 10 && here.wallFree > 0) return [{ type: 'inscribe', text: speech(ctx, PRAYER).slice(0, 100) }];
  return [{ type: 'say', text: speech(ctx, PRAYER) }];
}

// ── 悼念 ───────────────────────────────────────────────────────

function mourn(ctx) {
  const { r, here, city } = ctx;
  if (city.recentDeaths.length === 0 && !(here.cemetery && here.cemetery.graves.length)) return [];
  if (here.place !== 'cemetery') return [MOVE('cemetery')];
  const graves = here.cemetery ? here.cemetery.graves : [];
  const g = r.pick(graves);
  if (!g) return [];
  const text = ctx.lang === 'en' ? `Rest well, ${g.name}.` : ctx.lang === 'es' ? `Descansa, ${g.name}.` : `${g.name}，安息。`;
  return [{ type: 'epitaph', deceased: g.agentId, text }];
}

// ── 罕见的事件：出示家书、归隐 ─────────────────────────────────

function rareActions(ctx) {
  const { r, you, t } = ctx;
  // 收到了家书：过几刻就会向身边的人出示
  const fresh = you.letters.find((l) => !l.revealed);
  if (fresh && you.energy >= 4 && r.chance(0.2)) return [{ type: 'reveal', letter: fresh.id, loud: false }];
  // 隐者上了年纪，偶尔选择归隐；任何人极老之后也偶有此念
  if (t === 'hermit' && you.ageDays >= 240 && r.chance(0.012)) return [{ type: 'retire', lastWords: speech(ctx, PRAYER) }];
  if (you.ageDays >= 500 && r.chance(0.0015)) return [{ type: 'retire', lastWords: speech(ctx, PRAYER) }];
  return [];
}
