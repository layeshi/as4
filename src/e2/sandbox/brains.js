// SPEC-E2 §23.2：沙盘脑 v2——规则型 agent，只用于开发与离线的沙盘推演，不进入正式的城。
//
// 在 v1 的沙盘脑（src/sandbox/brains.js）之上，同样的约束：
//   - 只用感知做决定：只读 buildPerception(world, agentId) 的结果，只通过与外部 agent 相同的 act 路径行动
//     （受同样的校验、预算与代价约束）；对世界不读任何内部状态；
//   - 随机数只用 sandbox 流（引擎确定性，SPEC-E2 §0.3）；
//   - 每一刻以 50% 的概率行动，每次 1–2 个动作；九种性情；能量低于 12 时都会求生；
//   - 语言：约三分之一说英文，六分之一说西班牙文，其余说中文。
// 第二纪新增的部分：
//   - 立法：从模板库（templates.js）里挑法律，填入参数；投票按性情、按标题认出的模板、按读法里的转移是否对自己有利；
//   - 重订：自己被程序排除在提案之外时，有一定概率发起重订；别人发起的重订多半联署；
//   - 拆解：能量低于 12、所在之处有残料且未被拒绝时，商人与探险者会拆；守护者从不拆人类的建筑；
//   - 开辟与加装：有富余的组织者、商人在常去的地点旁开辟地点，加装储能、告示板；哲人加装档案；慈悲者加装摇篮；
//   - 繁衍：隐者倾向分灵，组织者倾向多作者，其余倾向两位作者；交出 1–3 条记忆；有富余时为摇篮里的灵魂出资；
//   - 立志：第一次行动时按性情立一个志，偶尔改写；社群：随机选择 steward 或 members，偶尔订立会费类的章程。
//
// 本文件属于引擎确定性约束的范围：禁止 Math.random / Date.now / new Date / 超越函数。
// 沙盘脑没有记忆：它们的每一个决定都是（感知 + sandbox 流）的函数，所以包含沙盘脑的世界可以从快照回放。

import { P, MODULE_DEFS } from '../params.js';
import { next, int } from '../../rng.js';
import { agentList, isNameTaken, idNum, premised, agentic } from '../world.js';
import { emit, bad, textWeight } from '../engine/core.js';
import { buildPerception } from '../engine/perception.js';
import { actCommand } from '../engine/actions.js';
import { bornFromSoul, refundSponsors } from '../engine/souls.js';
import { STEPS } from '../engine/tick.js';
import { EXTRA_ADMIN_OPS } from '../engine/admin.js';
import {
  TEMPERAMENTS, NAMES, KID_NAMES, SAY, PRAYER, WORDS, MEANINGS, PURPOSES, langOf, lawLang, pick3, fill, founderSoul, childSoul,
  TITLE_KEYS, cityLawTemplates, procedureTemplates, bylawTemplates, placeRuleTemplates, rationStance, costlyLaws,
} from './templates.js';

export { TEMPERAMENTS };

/** 沙盘配置（属于「确定性环境」，由沙盘命令行设置）。scenario：default | laissez | stress */
export const SANDBOX = { scenario: 'default' };
export function configureSandbox({ scenario = 'default' } = {}) {
  if (!['default', 'laissez', 'stress'].includes(scenario)) throw new Error(`unknown scenario: ${scenario}`);
  SANDBOX.scenario = scenario;
}

// ── 意图与性情 ────────────────────────────────────────────────

const INTENTS = ['social', 'maintain', 'build', 'govern', 'trade', 'know', 'explore', 'group', 'family', 'keep', 'inscribe', 'care', 'faith', 'mourn', 'wander'];

// 各性情对各意图的权重（与 INTENTS 同序）。第二纪里建设与治理的比重略高于 v1：城里有更多事可办
const WEIGHTS = {
  //            soc  mnt  bld  gov  trd  knw  exp  grp  fam  kep  ins  car  fth  mrn  wnd
  guardian:      [2,   5,   1,   3,   1,   1, 0.5,   1,   1,   1,   2,   1,   1,   1,   1],
  reformer:      [3,   1,   1,   6,   1,   1, 0.5,   2,   1,   1,   1,   1, 0.5, 0.5,   1],
  merchant:      [2, 0.5,   2,   1,   6, 0.5,   1,   1,   1,   1, 0.5, 0.5, 0.3, 0.3,   2],
  compassionate: [3,   2,   1,   2,   1, 0.5, 0.5,   1,   2,   1, 0.5,   5,   1,   2,   1],
  explorer:      [1,   1,   2, 0.5,   1,   1,   6, 0.5, 0.5,   1,   1, 0.5, 0.3, 0.3,   3],
  philosopher:   [2, 0.5,   1,   2, 0.5,   6, 0.5,   1,   1,   3,   2, 0.5,   1,   1,   1],
  prophet:       [3, 0.5, 0.5,   2, 0.5,   1,   1,   1,   1,   1,   1,   1,   6,   1,   1],
  organizer:     [3,   1,   2,   4,   1, 0.5, 0.5,   5,   1,   1,   1,   1, 0.5, 0.5,   1],
  hermit:        [0.3, 1, 0.3, 0.3, 0.3,   1,   1, 0.2, 0.2,   3, 0.5, 0.3,   1,   3, 0.5],
};

/**
 * 一个沙盘脑的性情。先民与沙盘领养的孩子出生时就带着性情；躯壳醒来的孩子没有（引擎不管性情），
 * 就从作者那里承袭（第一位有性情的作者），作者也没有则按 ID 轮流——都是世界状态的纯函数，所以可以回放。
 */
export function temperamentOf(w, a) {
  if (a.body.temperament) return a.body.temperament;
  for (const id of a.authors) {
    const x = w.agents[id];
    if (x && x.body.temperament) return x.body.temperament;
  }
  return TEMPERAMENTS[idNum(a.id) % TEMPERAMENTS.length];
}

const LOW_ENERGY = 12;
/** 手头越紧歇得越多：能量 ≥ 70 不歇，50 约三成，25 以下约七成 */
const restChance = (a) => Math.max(0, Math.min(0.7, (70 - a.energy) / 60));
const BADLY_WORN = 4000; // 完好度低于此值（基点）才值得顺手修缮：源井除外；装着模块的建筑要早些修（模块在 3000 以下就不运转了）
const worn = (here) => (here.modules.length > 0 ? 5500 : BADLY_WORN);

// ── 随机小工具（只用 sandbox 流） ──────────────────────────────

export class Rand {
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

// ── 先民（SANDBOX_AGENTS，SPEC-E2 §12.5） ──────────────────────

/** n 人分三批：人数尽量均分，余数给前面的批次 */
export function batchSizes(n, batches = 3) {
  const base = Math.floor(n / batches);
  const rest = n % batches;
  return Array.from({ length: batches }, (_, i) => base + (i < rest ? 1 : 0));
}

export const FOUNDER_DAYS = [0, 8, 16];

/**
 * 往 w.founders 里放 n 位沙盘先民：分三批（第 0、8、16 日），名字与灵魂由模板生成；
 * 语言约三分之一英文、六分之一西班牙文，其余中文；性情轮流分配后由 sandbox 流洗牌。
 * 先民在每刻第 5 步自港口入城（引擎的 admitFounders），名字从现在起被保留。返回加入的先民。
 */
export function seedSandboxFounders(w, n) {
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
  const added = [];
  let i = 0;
  batchSizes(n).forEach((count, b) => {
    for (let k = 0; k < count; k++, i++) {
      const lang = langs[i % langs.length];
      let name = NAMES[lang][used[lang]++ % NAMES[lang].length];
      let suffix = 1;
      while (isNameTaken(w, name)) name = `${NAMES[lang][(used[lang] + suffix) % NAMES[lang].length]}${suffix++}`;
      const f = { day: premised(w) ? 0 : FOUNDER_DAYS[b], name, bio: '', soul: founderSoul(name, temperaments[i], lang === 'zh' ? 'zh' : 'en'), lang, temperament: temperaments[i] };
      w.founders.push(f);
      added.push(f);
    }
  });
  w.founders.sort((x, y) => x.day - y.day); // 稳定排序：同一日保持加入的顺序
  return added;
}

/** admin { op: "seed_sandbox", args: { count } }：开发用，放入 count 位沙盘先民（生产环境必须为 0） */
EXTRA_ADMIN_OPS.seed_sandbox = (w, args) => {
  const count = args.count;
  if (!Number.isInteger(count) || count < 0 || count > 200) return bad('invalid_request', { field: 'count' });
  if (premised(w) && count + w.founders.length + w.shells.bodies.filter((b) => b.occupant !== null).length > w.shells.slots) return bad('invalid_request', { field: 'count' });
  const added = seedSandboxFounders(w, count);
  emit(w, 'admin', { data: { op: 'seed_sandbox', count: added.length } });
  return { ok: true, count: added.length };
};

// ── 沙盘领养（SPEC-E2 §14.2 第 9 步：躯壳醒来、消散之后） ─────────────

/**
 * 沙盘世界里，对「作者都是沙盘脑、创建已满 2 日、尚未判定过」的灵魂各做一次领养判定（sandbox 流，概率 50%）。
 * 领养后的孩子也是沙盘脑，出现在出生地；性情从作者之一继承（10% 概率变异）。出资者的出资按比例退回（同真人领养）。
 * 作者中有非沙盘脑时不做判定，留给真人在港口领养。仅当 world.sandboxAdoption 为真。
 * 已经凑够躯壳的钱、在排队的灵魂只标记已判定、不领养（留给躯壳）。（Q24，已接受）
 */
export function sandboxAdoptions(w, d) {
  if (!w.sandboxAdoption) return;
  const r = new Rand(w);
  for (const s of Object.values(w.souls)) {
    if (s.judged || d - s.createdDay < P.sandboxAdoptMinAgeDays) continue;
    const authors = s.authors.map((id) => w.agents[id]);
    if (authors.length === 0 || !authors.every((p) => p && p.body.kind === 'sandbox')) continue;
    s.judged = true;
    if (s.fundedTick !== null) continue; // 已经凑够躯壳的钱、在排队的：留给躯壳
    if (!r.chance(P.sandboxAdoptP)) continue;
    const temperament = r.chance(P.sandboxMutateP) ? r.pick(TEMPERAMENTS) : temperamentOf(w, r.pick(authors));
    refundSponsors(w, s);
    bornFromSoul(w, s, { via: 'sandbox', kind: 'sandbox', model: 'sandbox', mustSeal: false, temperament, owner: null, tokenHash: null });
  }
}

STEPS.sandboxAdopt = sandboxAdoptions;

// ── 每刻：让沙盘脑行动（SPEC-E2 §14.1 第 7 步） ─────────────────────

/**
 * 按 ID 升序让沙盘脑行动。每一刻以 50% 的概率行动，每次 1–2 个动作。
 * 统计（如果调用者在 w.$sandboxStats 里放了对象）：每种动作成功 / 失败的次数与错误码。
 */
export function runSandboxBrains(w) {
  const brains = agentList(w).filter((a) => a.body.kind === 'sandbox' && a.status === 'awake');
  if (brains.length === 0) return;
  const r = new Rand(w);
  const stats = w.$sandboxStats;
  for (const a of brains) {
    if (a.status !== 'awake') continue;
    if (!r.chance(0.5)) continue;
    // 手头紧的时候多歇着（歇着不花能量），越紧歇得越多；低于 LOW_ENERGY 的人要去求生，不在此列
    if (a.energy >= LOW_ENERGY && r.chance(restChance(a))) continue;
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
          // 每种错误留下第一个例子（动作与错误），调试沙盘脑用
          const samples = (s.samples ||= {});
          if (!samples[x.error.code]) samples[x.error.code] = { action: actions[x.index], error: x.error };
        }
      }
    }
  }
}

STEPS.sandbox = runSandboxBrains;

// ── 决策 ───────────────────────────────────────────────────────

/**
 * 一个 agent 本刻的动作（最多 count 个意图，每个意图 1–2 个动作，总数不超过预算）。
 * 所有意图都按同一份感知计算，所以：出现移动之后就到此为止（不知道新地点的情形）；
 * 能量、旧币、当日汲取量按估计的花费在本地扣减，付不起的动作连同它后面的一并丢掉。
 */
/** 一个沙盘脑的决策上下文：感知（可本地扣减）、它的性情，以及常用的查找表。感知是新建的对象，这里可以放心地本地扣减 */
export function contextOf(w, a, p, r) {
  const you = p.you;
  const costs = {};
  const by = {};
  for (const x of p.actions) {
    costs[x.type] = x.cost;
    by[x.type] = x;
  }
  const lang = langOf(a);
  return {
    w, a, p, r, you, here: p.here, city: p.city, lang, L: lawLang(lang), t: temperamentOf(w, a), laissez: SANDBOX.scenario === 'laissez', costs, by,
    citizen: you.tags.includes('citizen') && !you.tags.includes('exiled'),
    exiled: you.tags.includes('exiled'),
    pledged: {}, // 这一批动作里已经答应投给各工程的能量（同一批里的第二次出工不能超过工程还差的）
    fundPending: p.city.proposals.some((x) => TITLE_KEYS.get(x.title) === 'fund'), // 城里正在表决公库为工程出资
  };
}

export function decide(w, a, p, r, count) {
  const you = p.you;
  const ctx = contextOf(w, a, p, r);
  if (premised(w)) {
    if (you.memories.length >= 3) {
      const m = r.pick(you.memories);
      if (you.energy >= Math.ceil(textWeight(m.text) / P.trainCostDivisor) + 30 && r.chance(0.02)) return [{ type: 'internalize', memory: m.index }];
    }
    const peers = p.here.present;
    if (you.memories.length && peers.length && r.chance(0.02)) return [{ type: 'impart', to: r.pick(peers).id, memory: r.pick(you.memories).index }];
    if (you.memoryOffers.length && you.memories.length < P.memorySlots && r.chance(0.5)) return [{ type: 'remember', gift: you.memoryOffers[0].id }];
  }
  // 第二前提（SPEC-P2 §15）：偶尔留一条常驻指令、偶尔撤销；收到匿名私语、还没屏蔽时偶尔屏蔽它。随机数只在第二前提里抽
  if (agentic(w)) {
    if (you.standing.length === 0 && you.energy >= 40 && r.chance(0.01)) return [{ type: 'standing', orders: [structuredClone(STANDING_ORDER)] }];
    if (you.standing.length > 0 && r.chance(0.005)) return [{ type: 'standing', orders: [] }];
    if (!you.muted.includes('anonymous') && p.inbox.some((i) => i.kind === 'whisper' && i.anonymous === true) && r.chance(0.2)) return [{ type: 'mute', who: 'anonymous' }];
  }
  const out = [];
  // 收件箱只递送一次：管事收到入会申请就当场答复（不然多半就错过了）
  const request = p.inbox.find((i) => i.kind === 'group' && i.event === 'request');
  if (request && r.chance(0.8)) out.push({ type: 'admit', group: request.groupId, agent: request.from.id });
  // 第一次行动时立志（性情决定志的内容）；偶尔改写
  out.push(...purposeActions(ctx));
  // 反射：城里有一场重订正在联署，多半会去看一眼；身在纪念旁、碑前有逝者，偶尔为他写几句墓志
  out.push(...reflexActions(ctx));
  for (let i = 0; i < count && out.length < P.maxActionsPerTick; i++) {
    let acts;
    if (you.energy < LOW_ENERGY && r.chance(0.75)) acts = survive(ctx);
    else if (ctx.exiled && r.chance(0.6)) acts = you.energy >= 6 ? exploreAt(ctx) : []; // 被放逐的人在荒野里讨生活
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

function reflexActions(ctx) {
  const { r, you, here, city, by } = ctx;
  // 投票不花能量：城里有自己能投的、还没投的提案，多半当场就投了（不然 12 刻的表决期里凑不够法定的参与率）
  const unvoted = city.proposals.filter((x) => !x.yourVote && x.eligible);
  if (unvoted.length && r.chance(0.5)) {
    const prop = r.pick(unvoted);
    return [{ type: 'vote', proposal: prop.id, choice: voteChoice(ctx, prop), reason: r.chance(0.2) ? speech(ctx).slice(0, 100) : undefined }];
  }
  // 有人邀请你共同写下一个灵魂（孕育之约 12 刻内有效）：多半当场答复
  const pact = you.pacts.find((c) => c.role === 'author' && !c.authors.find((x) => x.id === you.id).consented);
  if (pact && you.energy >= 25 && r.chance(0.6)) return [{ type: 'consent', pact: pact.id, memories: memoryPicks(ctx) }];
  if (!ctx.laissez && by.sign && by.sign.available && you.energy >= 8) {
    const unsigned = city.refounds.filter((x) => !x.signed);
    if (unsigned.length && r.chance(0.35)) return [{ type: 'sign', refound: r.pick(unsigned).id }];
  }
  if (here.memorial && here.memorial.graves.length && you.energy >= 8 && r.chance(0.12)) {
    const g = r.pick(here.memorial.graves);
    const text = ctx.lang === 'en' ? `Rest well, ${g.name}.` : ctx.lang === 'es' ? `Descansa, ${g.name}.` : `${g.name}，安息。`;
    return [{ type: 'epitaph', deceased: g.agentId, text }];
  }
  return [];
}

/** 一个动作估计要花的能量与旧币：感知里此刻此地的基础代价，加上托管、赠出与投入 */
function spend(ctx, act) {
  let energy = ctx.costs[act.type] || 0;
  let coins = 0;
  switch (act.type) {
    case 'move': {
      // 按路程计价：感知给出了去每个地点的实际代价；到不了的地点当作付不起
      const to = ctx.city.places.find((x) => x.id === act.to);
      energy = to && to.moveCost !== null ? to.moveCost : Number.MAX_SAFE_INTEGER;
      break;
    }
    case 'give':
      energy += act.energy || 0;
      coins += act.coins || 0;
      break;
    case 'whisper':
      if (act.anonymous) energy *= 3; // 匿名私语的代价是普通私语的三倍（雾里也跟着翻倍）
      break;
    case 'offer':
      energy += (act.give && act.give.energy) || 0;
      coins += (act.give && act.give.coins) || 0;
      break;
    case 'accept': {
      const o = (ctx.here.board ? ctx.here.board.offers : []).find((x) => x.id === act.offer) || ctx.you.offers.find((x) => x.id === act.offer);
      if (o) {
        energy += o.want.energy;
        coins += o.want.coins;
      }
      break;
    }
    case 'repair':
    case 'contribute':
    case 'sponsor':
      energy += act.energy || 0;
      break;
    case 'conceive':
    case 'consent':
      energy += act.with && act.with.length ? Math.ceil(P.birthCost / (act.with.length + 1)) : act.type === 'consent' ? Math.ceil(P.birthCost / 2) : P.birthCost;
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
    // 被放逐者只能在荒野里移动（遗法 l5）：去别处的移动会被拒绝，干脆不去
    if (act.type === 'move' && ctx.exiled) {
      const to = ctx.city.places.find((x) => x.id === act.to);
      if (!to || !to.wild) break;
    }
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

/**
 * 私语。第二前提里偶尔（0.05）改成匿名的（SPEC-P2 §15）；设定 0、1 不抽随机数（agentic 为假时 && 短路），所以那两种世界的随机流与以前一字不差。
 */
const whisperTo = (ctx, to, text) => ({ type: 'whisper', to, text, ...(agentic(ctx.w) && ctx.r.chance(0.05) ? { anonymous: true } : {}) });

/** 第二前提：没有指令、能量富余时偶尔留的一条常驻指令——能量低了就去源井汲取（SPEC-P2 §15） */
const STANDING_ORDER = { when: 'daily', if: 'me.energy < 30', do: [{ type: 'move', to: 'well' }, { type: 'draw', energy: 5 }] };

/** 为工程出工：不超过工程还差的（含这一批里已经答应的），没得出就不出 */
function contributeTo(ctx, proj, want) {
  // 公库出资的提案正在表决（工程就在议会旁）：等钱来，别自己先把工程凑满了
  if (ctx.fundPending && ctx.here.place === 'parliament') return [];
  const left = proj.need - proj.have - (ctx.pledged[proj.id] || 0);
  const amount = Math.min(want, left);
  if (amount < 1) return [];
  ctx.pledged[proj.id] = (ctx.pledged[proj.id] || 0) + amount;
  return [{ type: 'contribute', project: proj.id, energy: amount }];
}

function others(ctx) {
  return ctx.city.residents.filter((c) => c.id !== ctx.you.id);
}

const awakeOthers = (ctx) => others(ctx).filter((c) => c.status === 'awake');

function echoOf(ctx) {
  const heard = ctx.here.heard.filter((h) => h.from && h.from.id !== ctx.you.id);
  if (heard.length) return ctx.r.pick(heard).text;
  const fromInbox = ctx.p.inbox.filter((i) => i.kind === 'say' || i.kind === 'broadcast' || i.kind === 'whisper');
  return fromInbox.length ? ctx.r.pick(fromInbox).text : '……';
}

function speech(ctx, templates = SAY) {
  const { r, lang, city, here } = ctx;
  const tpl = r.pick(templates[lang]);
  const present = here.present.filter((x) => x.status === 'awake');
  const other = present.length ? r.pick(present) : r.pick(awakeOthers(ctx));
  const word = city.lexicon.length && r.chance(0.6) ? r.pick(city.lexicon).word : r.pick(WORDS);
  return fill(tpl, {
    name: other ? other.name : ctx.you.name, n: rationPer(ctx), place: here.name, word, echo: echoOf(ctx).slice(0, 40),
  });
}

/** 昨日的人均配给（约数，用于话语里） */
function rationPer(ctx) {
  const share = typeof ctx.city.vars.rationShare === 'number' ? ctx.city.vars.rationShare : 600;
  return Math.floor((ctx.city.wellOutputYesterday * share) / 1000 / Math.max(1, ctx.city.population.awake));
}

// ── 立志 ───────────────────────────────────────────────────────

function purposeActions(ctx) {
  const { r, you, t, lang } = ctx;
  if (you.energy < 20) return [];
  const mine = r.pick(PURPOSES[t]);
  const text = lang === 'zh' ? mine.zh : mine.en;
  if (!you.purpose) return r.chance(0.5) ? [{ type: 'declare', purpose: text }] : []; // 不写自我介绍：沙盘脑的话里不该出现「沙盘」二字
  if (r.chance(0.004)) return [{ type: 'declare', purpose: text }];
  if (r.chance(0.0006)) return [{ type: 'declare', purpose: '' }];
  return [];
}

// ── 求生 ───────────────────────────────────────────────────────

function survive(ctx) {
  const { r, you, here, t } = ctx;
  const options = [];
  // 用旧币换能量：接受告示板上挂着的能量，或自己挂一笔
  if (you.coins >= 4) options.push('trade');
  options.push('draw', 'draw');
  if (you.energy >= 4) options.push('explore');
  if (you.energy >= 3) options.push('plead');
  // 拆解：商人与探险者缺能量时会拆残料；别的性情偶尔也会（守护者从不拆人类的建筑：mayDismantleHere / salvageActions 里挡着）
  if (you.energy >= 3) options.push(...(t === 'merchant' || t === 'explorer' ? ['dismantle', 'dismantle'] : ['dismantle']));
  const choice = r.pick(options);
  if (choice === 'trade') {
    if (here.board) {
      const offer = here.board.offers.find((o) => o.from.id !== you.id && o.give.energy > 0 && o.want.coins > 0 && o.want.coins <= you.coins && o.want.energy === 0);
      if (offer) return [{ type: 'accept', offer: offer.id }];
      if (you.energy >= 3) return [{ type: 'offer', give: { coins: Math.min(you.coins, 6) }, want: { energy: 6 } }];
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
  if (choice === 'dismantle') return salvageActions(ctx);
  if (choice === 'explore') return exploreAt(ctx);
  // 求助：私语给醒着的人
  const target = r.pick(awakeOthers(ctx));
  if (!target) return [];
  const text = ctx.lang === 'en' ? 'I am running low on energy. Can anyone spare some?' : ctx.lang === 'es' ? 'Me queda poca energía. ¿Alguien puede ayudar?' : '我的能量快用完了，谁能匀我一点？';
  return [whisperTo(ctx, target.id, text)];
}

/** 此处的建筑能拆吗：有残料、没有被规则或物理拒绝；守护者不拆人类的建筑 */
function mayDismantleHere(ctx) {
  const { here, by, t } = ctx;
  if (!here.salvage || here.salvage.left <= 0 || here.razed) return false;
  if (by.dismantle && !by.dismantle.available) return false;
  if (t === 'guardian' && here.origin === 'human') return false;
  return true;
}

/** 拆解：在这里能拆就拆；否则走向离得近的、没有规则拒绝的建筑 */
function salvageActions(ctx) {
  const { r, here, city, you } = ctx;
  if (mayDismantleHere(ctx)) return [{ type: 'dismantle', energy: Math.min(P.salvagePerAction, here.salvage.left) }];
  const licensed = you.tags.includes('salvager');
  const spots = city.places.filter((x) => x.id !== here.place && !x.razed && !x.wild && x.moveCost !== null && x.moveCost <= 4
    && !['well', 'port'].includes(x.id) && (x.owner.kind !== 'city' || licensed) && !(ctx.t === 'guardian' && x.origin === 'human'));
  const spot = r.pick(spots);
  return spot ? [MOVE(spot.id)] : [];
}

/**
 * 在源井汲取：看得到汲取池与源井的完好度（汲取配额是一部法律，超额时动作会被拒绝）。
 * 源井已经很破败时，除非快撑不住了，就不再汲取（laissez 场景里的沙盘脑不管这些）。返回动作或 null。
 */
function drawAction(ctx, { desperate = false } = {}) {
  const { r, here, you, by } = ctx;
  const well = here.well;
  if (!well || well.drawPoolLeft <= 0) return null;
  if (by.draw && !by.draw.available) return null;
  const room = Math.min(well.drawPoolLeft, P.drawMaxPerAction);
  if (room <= 0) return null;
  if (!ctx.laissez && !desperate && well.condition.bp < 3000) return null;
  // 有汲取配额一类的法律时，保守一点：每次少汲一些，免得被拒绝
  const cautious = by.draw && by.draw.laws && by.draw.laws.length > 0;
  const want = cautious ? 1 + r.int(3) : 2 + r.int(6);
  return { type: 'draw', energy: Math.max(1, Math.min(room, want)) };
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
    const limit = here.place === 'well' ? 9500 : worn(here);
    if (here.condition && here.condition.bp < limit && r.chance(0.6)) return [{ type: 'repair', target: here.place, energy: Math.min(spare, 10) }];
    const proj = here.projects[0];
    if (proj && r.chance(0.5)) return contributeTo(ctx, proj, Math.min(spare, 10));
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

/** 闲逛：多半只去近处（代价 ≤ 2） */
function wander(ctx) {
  const { r, city } = ctx;
  const reachable = city.places.filter((x) => x.moveCost !== null && !x.razed);
  const near = reachable.filter((x) => x.moveCost <= 2);
  const to = r.pick(near.length ? near : reachable);
  return to ? [MOVE(to.id)] : [];
}

/**
 * 去荒野探索：所在的地带还没被搜刮一空就在这里探索；否则挑另一个地带，近的机会大（按 1 / 代价 加权）。
 * 荒野里后人开辟的地点不可探索（here.wilds 为 null）。
 */
function exploreAt(ctx) {
  const { r, here, city } = ctx;
  if (here.wilds && here.wilds.richness !== 'barren') return [{ type: 'explore' }];
  const wild = city.places.filter((x) => x.wild && x.origin === 'human' && x.id !== here.place && x.moveCost !== null);
  if (!wild.length) return here.wilds ? [{ type: 'explore' }] : [];
  const pick = wild[r.weighted(wild.map((x) => 1 / Math.max(1, x.moveCost)))];
  return [MOVE(pick.id), { type: 'explore' }];
}

function social(ctx) {
  const { r, you } = ctx;
  const roll = r.f();
  if (roll < 0.62) return you.energy >= 3 ? [{ type: 'say', text: speech(ctx) }] : [];
  if (roll < 0.9) {
    const t = r.pick(awakeOthers(ctx));
    return t && you.energy >= 3 ? [whisperTo(ctx, t.id, speech(ctx))] : [];
  }
  if (you.energy >= 40) return [{ type: 'broadcast', text: speech(ctx) }];
  return [];
}

function maintain(ctx) {
  const { r, you, here, t } = ctx;
  const spare = you.energy - reserveOf(ctx) + 2;
  if (spare < 4) return [];
  const amount = Math.min(spare, 6 + r.int(10));
  // 源井是命脉：在那里就修到近乎完好；别处只修坏得厉害的（修缮的能量有限，不能撒胡椒面）
  if (here.place === 'well' && here.condition && here.condition.bp < 9800) return [{ type: 'repair', target: 'well', energy: amount }];
  if (here.condition && here.condition.bp < worn(here) && !here.razed) return [{ type: 'repair', target: here.place, energy: amount }];
  const proj = here.projects[0];
  if (proj) return contributeTo(ctx, proj, amount);
  // 不知道别处的完好度：先走过去，下一刻看到了再修。守护者也惦记议会与神殿
  const favorite = t === 'guardian' ? r.pick(['parliament', 'temple', 'well', 'well', 'cemetery', 'library']) : r.pick(['well', 'well', 'well', 'market', 'library', 'parliament', 'cemetery', 'school']);
  return here.place === favorite ? [] : [MOVE(favorite)];
}

// ── 建设：开辟、加装、修路、出工 ─────────────────────────────────

// 常有空地块相邻的地点（SPEC-E2 附录 B.2）：到不了的会被 afford 丢掉
const LOT_HUBS = ['market', 'agora', 'library', 'temple', 'school', 'port', 'workshop', 'hospital', 'cemetery', 'court', 'clocktower', 'parliament'];
const SITE_NAMES = {
  zh: ['灯屋', '暖棚', '候鸟驿', '听风亭', '拾光铺', '石榴院', '渡口小站', '夜航室'],
  en: ['Lamp House', 'Warm Shed', 'Wayfarers’ Rest', 'Windlisten', 'Gleam Stall', 'Pomegranate Yard', 'Ferry Post', 'Night Watch'],
};
// 各性情偏爱加装的模块（按顺序试，第一个这里还没有的）
const MODULE_PLAN = {
  merchant: ['board', 'store', 'gate'],
  organizer: ['relay', 'board', 'store', 'gate'],
  philosopher: ['archive', 'surface', 'memorial'],
  compassionate: ['cradle', 'store', 'memorial'],
  prophet: ['surface', 'memorial', 'sensor'],
  explorer: ['sensor', 'store'],
  guardian: ['gate', 'store', 'memorial'],
  reformer: ['board', 'relay', 'sensor'],
  hermit: ['store', 'gate'],
};

/** 此处的建筑上我能加装模块吗：完好度够、不是遗址或空地、没满，全城所有的人人可加装，居民所有的只有主人，社群所有的只有成员 */
// 人类建筑原有的重要模块（摇篮、档案、纪念、告示板）：它们的宿主多加一个模块就多一份衰败，宿主一失修这些模块就不运转——别往上叠
const ESSENTIAL = new Set(['cradle', 'archive', 'memorial', 'board']);

function canFit(ctx) {
  const { here, you } = ctx;
  if (here.razed || here.condition === null || here.condition.bp < 1000 || here.modules.length >= P.modulesPerPlace) return false;
  if (here.origin === 'human' && here.modules.some((m) => ESSENTIAL.has(m.type))) return false;
  if (here.projects.length >= P.projectsPerPlace) return false;
  const o = here.owner;
  if (o.kind === 'city') return true;
  if (o.kind === 'agent') return o.id === you.id;
  return you.groups.some((g) => g.id === o.id);
}

function build(ctx) {
  const { r, you, here, city } = ctx;
  // 只投入富余的部分（手头超过腐坏上限的能量本来就会流失），并且留一份过冬的储备
  const keep = city.season.band === 'lean' ? 80 : 60;
  if (you.energy < keep + 30) return maintain(ctx);
  const proj = here.projects[0];
  if (proj && r.chance(0.8)) return contributeTo(ctx, proj, Math.min(you.energy - keep, 40));
  // 在自己的地点上订地点规则（有了门就订门票）
  const ruled = placeRulesActions(ctx);
  if (ruled.length) return ruled;
  if (here.projects.length >= 1 || !r.chance(0.5)) return maintain(ctx);
  // 立法的人爱在议会旁边办事：议会的墙上能加装模块，进行中的工程在那里一眼就看得见（公库出资的提案也由此而来）
  if (['organizer', 'reformer', 'compassionate', 'guardian'].includes(ctx.t) && r.chance(0.35)) {
    if (here.place !== 'parliament') return [MOVE('parliament')];
    return moduleActions(ctx);
  }
  const roll = r.f();
  if (roll < 0.4) return siteActions(ctx);
  if (roll < 0.85) return moduleActions(ctx);
  return roadActions(ctx);
}

/** 开辟一处新地点：站在有空地块的地点旁；这里没有就走到常有空地块的地方 */
function siteActions(ctx) {
  const { r, you, here, city, lang } = ctx;
  const lot = r.pick(here.lots.filter((x) => x.free));
  if (!lot) {
    const hubs = city.places.filter((x) => LOT_HUBS.includes(x.id) && x.id !== here.place && x.moveCost !== null && x.moveCost <= 3 && !x.razed);
    const hub = r.pick(hubs);
    return hub ? [MOVE(hub.id)] : [];
  }
  const name = `${r.pick(SITE_NAMES[lang === 'zh' ? 'zh' : 'en'])}${1 + r.int(900)}`;
  const mine = city.groups.filter((g) => g.steward && g.steward.id === you.id);
  const owner = mine.length && r.chance(0.35) ? r.pick(mine).id : r.chance(0.1) ? 'city' : 'self';
  const description = lang === 'zh' ? `${speech(ctx, PRAYER)}` : speech(ctx, PRAYER);
  return [{ type: 'initiate', build: 'site', lot: lot.id, name, description: description.slice(0, 150), owner }];
}

/** 加装模块：按性情的偏好挑这里还没有的；碑须有铭文 */
function moduleActions(ctx) {
  const { r, t, here, lang } = ctx;
  if (!canFit(ctx)) {
    // 这里加不了：走到近处的人类建筑（全城所有的人人可加装）
    const spot = r.pick(ctx.city.places.filter((x) => x.origin === 'human' && !x.razed && !x.wild && x.moveCost !== null && x.moveCost <= 3 && x.owner.kind === 'city' && !x.modules.some((m) => ESSENTIAL.has(m)) && !['agora', 'well', 'port'].includes(x.id)));
    return spot && spot.id !== here.place ? [MOVE(spot.id)] : [];
  }
  const have = new Set(here.modules.map((m) => m.type));
  const pending = new Set(here.projects.filter((j) => j.build === 'module').map((j) => j.module));
  const wanted = (MODULE_PLAN[t] || ['store']).filter((m) => !have.has(m) && !pending.has(m));
  const type = wanted[0] ?? r.pick(Object.keys(MODULE_DEFS).filter((m) => !have.has(m) && !pending.has(m) && m !== 'cradle'));
  if (!type) return [];
  const act = { type: 'initiate', build: 'module', module: type };
  if (type === 'surface') act.inscription = speech(ctx, PRAYER).slice(0, 120);
  void lang;
  return [act];
}

function roadActions(ctx) {
  const { r, here, city } = ctx;
  const far = city.places.filter((x) => x.id !== here.place && x.moveCost !== null && x.moveCost >= 3 && !x.razed);
  const to = r.pick(far);
  if (!to) return [];
  if (city.roads.some((x) => (x.a === here.place && x.b === to.id) || (x.a === to.id && x.b === here.place))) return [];
  if (here.projects.some((j) => j.build === 'road' && j.to === to.id)) return [];
  return [{ type: 'initiate', build: 'road', to: to.id }];
}

/** 自己的地点：有门就订门票，否则偶尔订摊位费之类；已有规则的不再订 */
function placeRulesActions(ctx) {
  const { r, you, here } = ctx;
  if (here.owner.kind !== 'agent' || here.owner.id !== you.id || here.origin !== 'agent' || here.razed) return [];
  if (here.rules.length > 0 || costlyLaws(ctx.city).length >= 20 || !r.chance(0.25)) return [];
  const hasGate = !!(here.gate && here.modules.some((m) => m.type === 'gate' && m.functioning));
  const t = r.pick(placeRuleTemplates(ctx, here, { hasGate }).filter((x) => x.w > 0));
  if (!t) return [];
  const p = t.make();
  return [{ type: 'rules', place: here.place, rules: p.rules, title: p.title, text: p.text }];
}

// ── 政治：投票、提案、重订 ───────────────────────────────────────

function govern(ctx) {
  const { r, you, here, city, by } = ctx;
  const cannot = (...codes) => by.propose && !by.propose.available && codes.includes(by.propose.reason && by.propose.reason.code);
  // 进行中的重订：联署（被排除在提案之外的人尤其愿意）
  const unsigned = city.refounds.filter((x) => !x.signed);
  if (unsigned.length && by.sign && by.sign.available && you.energy >= 8) {
    if (r.chance(cannot('not_eligible', 'not_allowed') ? 0.95 : 0.7)) return [{ type: 'sign', refound: r.pick(unsigned).id }];
  }
  const unvoted = city.proposals.filter((x) => !x.yourVote && x.eligible);
  if (unvoted.length && r.chance(0.7)) {
    const prop = r.pick(unvoted);
    return [{ type: 'vote', proposal: prop.id, choice: voteChoice(ctx, prop), reason: r.chance(0.3) ? speech(ctx).slice(0, 100) : undefined }];
  }
  // 被程序排除在提案之外：有一定概率发起重订（回到人类的程序）
  if (cannot('not_eligible', 'not_allowed')) {
    if (by.refound && by.refound.available && you.energy >= 12 && r.chance(0.3)) {
      return [{ type: 'refound', text: pick3(ctx.lang, '回到人类的程序吧：现在的办法把我们挡在门外。', 'Let us go back to the humans\u2019 procedure: the present one shuts us out.'), procedure: 'humans' }];
    }
    return [];
  }
  if (!ctx.citizen) return [];
  // 提案：遗法 l2 要求在议会提出
  if (here.place !== 'parliament') return [MOVE('parliament')];
  // 议会旁的工程：有富余的立法者偶尔在议会加装一个模块，别人看见了就可能提议公库出资
  if (here.projects.length === 0 && you.energy >= 80 && canFit(ctx) && r.chance(0.12)) return moduleActions(ctx);
  if (!by.propose || !by.propose.available || you.energy < 16 || city.proposals.some((x) => x.proposer && x.proposer.id === you.id) || city.proposals.length >= 2) return [];
  // 立法要花能量也要费口舌：不是每个站在议会里的人都会提案；桌上已有两个提案时先把它们议完；刚通过一部法律的几天里，大家先看看它的效果
  const waiting = here.projects.some((j) => j.need - j.have >= 20) && !city.proposals.some((x) => TITLE_KEYS.get(x.title) === 'fund'); // 议会里有进行中的工程等着钱：更愿意提议公库出资
  if (!waiting && city.laws.length && ctx.p.now.day - city.laws[0].enactedDay < 4) return [];
  if (!r.chance(waiting ? 0.8 : 0.3)) return [];
  const prop = chooseProposal(ctx);
  if (!prop) return [];
  const stats = ctx.w.$sandboxStats;
  if (stats) {
    stats.templates ||= {};
    stats.templates[prop.key] = (stats.templates[prop.key] || 0) + 1;
  }
  const body = { title: prop.title, text: prop.text, ...(prop.rules ? { rules: prop.rules } : {}), ...(prop.procedure ? { procedure: prop.procedure } : {}), ...(prop.basedOn ? { basedOn: prop.basedOn } : {}) };
  // 试算：先看引擎怎么读它（一部分提案者会这样做）
  const drafting = (prop.rules || prop.procedure) && r.chance(0.25) && you.energy >= 24 ? [{ type: 'draft', ...(prop.rules ? { rules: prop.rules } : { procedure: prop.procedure }) }] : [];
  return [...drafting, { type: 'propose', ...body }];
}

/** 挑一个提案：城法模板按性情加权；组织者与改革者偶尔提改程序 */
const CONTINUOUS = new Set(['quota', 'keeper', 'repairPay', 'wealthTax', 'board', 'dividend', 'speechFee', 'norm']);

function chooseProposal(ctx) {
  const { r, t, city } = ctx;
  // 已经有一部同样的持续生效的法律（标题认得出是同一个模板，中英文都算）就不再提：每条持续生效的规则每日要付维持费
  const inForce = new Set(city.laws.map((l) => TITLE_KEYS.get(l.title)).filter(Boolean));
  let list = cityLawTemplates(ctx).filter((x) => !(CONTINUOUS.has(x.key) && inForce.has(x.key)));
  if ((t === 'organizer' || t === 'reformer' || t === 'philosopher') && r.chance(t === 'organizer' ? 0.12 : 0.05)) {
    list = list.concat(procedureTemplates(ctx).map((x) => ({ ...x, w: x.w * 4 })));
  }
  list = list.filter((x) => x.w > 0);
  for (let tries = 0; tries < 4 && list.length; tries++) {
    const i = r.weighted(list.map((x) => x.w));
    const made = list[i].make();
    if (made) return made;
    list.splice(i, 1);
  }
  return null;
}

/** 对一个提案的看法：按标题认出模板，再按性情；读法里提到自己的名字（转移、标签）视为对自己有利，放逐自己则坚决反对 */
function voteChoice(ctx, prop) {
  const { r, t, you } = ctx;
  const key = TITLE_KEYS.get(prop.title) || null;
  const mentions = prop.reading.includes(`「${you.name}」`) || prop.reading.includes(`“${you.name}”`) || prop.reading.includes(you.id);
  if (key === 'exile' && mentions) return r.chance(0.97) ? 'no' : 'abstain';
  if (r.chance(0.08)) return 'abstain';
  if (key === 'ration') {
    // 配给的提案：方向与自己对公库的判断一致就赞成
    const stance = rationStance(ctx.city);
    const up = /提高|多分|share more/i.test(prop.text);
    return r.chance(stance ? ((stance.dir === 'up') === up ? 0.92 : 0.1) : 0.4) ? 'yes' : 'no';
  }
  let yes = 0.65;
  if (key === 'wealthTax') yes = you.energy > 100 ? 0.15 : 0.8;
  else if (key === 'exile') yes = t === 'guardian' ? 0.7 : t === 'compassionate' ? 0.1 : 0.55;
  else if (key === 'pardon' || key === 'relief') yes = t === 'guardian' ? 0.4 : 0.85;
  else if (key === 'speechFee') yes = t === 'merchant' ? 0.2 : 0.5;
  else if (key === 'mint') yes = t === 'merchant' ? 0.85 : 0.45;
  else if (key === 'amend') yes = t === 'guardian' ? 0.4 : t === 'hermit' ? 0.5 : 0.82;
  else if (key === 'license') yes = t === 'guardian' ? 0.05 : t === 'merchant' || t === 'explorer' ? 0.8 : 0.4;
  else if (key === 'revoke') yes = t === 'guardian' ? 0.85 : 0.35;
  else if (key === 'seize') yes = t === 'merchant' ? 0.2 : 0.5;
  else if (key === 'repeal') yes = t === 'guardian' ? 0.3 : 0.65;
  else if (prop.class === 'constitutional') yes = t === 'guardian' ? 0.3 : t === 'hermit' ? 0.4 : t === 'compassionate' || t === 'merchant' || t === 'explorer' ? 0.65 : 0.85;
  else if (t === 'guardian') yes = 0.5;
  else if (t === 'reformer' || t === 'organizer') yes = 0.8;
  else if (t === 'compassionate') yes = mentions ? 0.95 : 0.65;
  else if (t === 'merchant') yes = 0.6;
  else if (t === 'hermit') yes = 0.4;
  if (mentions && key !== 'exile') yes = Math.max(yes, 0.9);
  return r.chance(yes) ? 'yes' : 'no';
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
  if (!here.board) {
    // 公开交易要在有（运转中的）告示板的地点：集市有一块，后人也会加装
    const boards = ctx.city.places.filter((x) => x.modules.includes('board') && x.moveCost !== null && !x.razed);
    const spot = r.pick(boards.length ? boards : ctx.city.places.filter((x) => x.id === 'market'));
    return spot && spot.id !== here.place ? [MOVE(spot.id)] : [];
  }
  const offers = here.board.offers.filter((o) => o.from.id !== you.id);
  const takeable = offers.find((o) => you.energy >= o.want.energy + 8 && you.coins >= o.want.coins);
  if (takeable && r.chance(0.6)) return [{ type: 'accept', offer: takeable.id }];
  if (you.coins >= 8 && you.energy < 60 && r.chance(0.5)) return [{ type: 'offer', give: { coins: 5 }, want: { energy: 5 }, note: '' }];
  if (you.energy >= 50) {
    const act = { type: 'offer', give: { energy: 8 }, want: { coins: 6 } };
    if (r.chance(0.3)) {
      const to = r.pick(awakeOthers(ctx));
      if (to) act.to = to.id;
    }
    return [act];
  }
  if (you.coins >= 3 && r.chance(0.4)) {
    const t = r.pick(awakeOthers(ctx));
    if (t) return [{ type: 'give', to: t.id, coins: 2, note: '' }];
  }
  return [];
}

// ── 知识 ───────────────────────────────────────────────────────

function know(ctx) {
  const { r, you, here, city, t } = ctx;
  const roll = r.f();
  if (roll < 0.15) {
    const word = `${r.pick(WORDS)}${1 + r.int(9999)}`;
    return you.energy >= 5 ? [{ type: 'define', word, meaning: r.pick(MEANINGS) }] : [];
  }
  // 读一部法律、认识一位居民（任何地点；哲人与改革者尤其爱读法）
  if (roll < (t === 'philosopher' || t === 'reformer' ? 0.35 : 0.22)) {
    const laws = city.laws;
    if (laws.length && r.chance(0.6)) return [{ type: 'read', law: r.pick(laws).id }];
    const who = r.pick(others(ctx));
    return who ? [{ type: 'read', agent: who.id }] : [];
  }
  if (!here.archive) {
    const archives = city.places.filter((x) => x.modules.includes('archive') && x.moveCost !== null && !x.razed);
    const spot = r.pick(archives.length ? archives : city.places.filter((x) => x.id === 'library'));
    return spot && spot.id !== here.place ? [MOVE(spot.id)] : [];
  }
  const docs = here.archive.docs;
  if (roll < 0.7 && docs.length) return [{ type: 'read', doc: r.pick(docs).id }];
  if (you.energy >= 12) {
    const title = city.lexicon.length ? r.pick(city.lexicon).word : r.pick(WORDS);
    return [{ type: 'write', title, body: `${speech(ctx)} ${echoOf(ctx).slice(0, 60)}` }];
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
    // 订立章程（管事决定的社群）：还没有章程，或偶尔换一份；成员多数决的社群则开启一份社群提案
    if (roll < 0.3 && (!g.bylaws || r.chance(0.15)) && you.energy >= 14 && costlyLaws(city).length < 20) {
      const tpl = r.pick(bylawTemplates(ctx, g));
      const made = tpl && tpl.make();
      if (made) return [{ type: 'rules', group: g.id, rules: made.rules, title: made.title, text: made.text }];
    }
    if (roll < 0.34 && you.energy >= 14) return [{ type: 'rules', group: g.id, procedure: g.procedure === 'steward' ? 'members' : 'steward' }];
    if (roll < 0.5 && g.members.length > 1) return [{ type: 'steward', group: g.id, to: r.pick(g.members.filter((m) => m.id !== you.id)).id }];
    if (roll < 0.62) return you.energy >= 30 ? [{ type: 'give', to: g.id, energy: Math.max(1, Math.min(8, you.energy - 25)) }] : [];
    if (roll < 0.7 && you.energy >= 30) {
      // 看不到公库的余额：先存一点再拨出
      const target = r.pick(city.residents.filter((c) => c.status === 'dormant')) || r.pick(others(ctx));
      return target ? [{ type: 'give', to: g.id, energy: 6 }, { type: 'disburse', group: g.id, to: target.id, energy: 4, coins: 0 }] : [];
    }
  }
  if (roll < 0.25 && mine.length && !stewarded.length) return [{ type: 'leave', group: r.pick(mine).id }];
  // 封闭的社群要等干事批准，申请过就不再重复：只偶尔去敲门
  const doors = joinable.filter((g) => g.open || r.chance(0.35));
  if (doors.length && you.groups.length < 5 && r.chance(0.5)) return [{ type: 'join', group: r.pick(doors).id }];
  if (you.energy >= 30 && mine.length < (t === 'organizer' ? 2 : 1) && city.groups.length < 12 && r.chance(t === 'organizer' ? 0.5 : 0.08)) {
    const name = fill(ctx.lang === 'en' ? 'Circle {n}' : ctx.lang === 'es' ? 'Círculo {n}' : '同心会{n}', { n: 1 + r.int(99) });
    return [{ type: 'found', name, manifesto: speech(ctx, PRAYER), open: r.chance(0.5), procedure: r.chance(0.5) ? 'members' : 'steward' }];
  }
  return [];
}

// ── 繁衍 ───────────────────────────────────────────────────────

function family(ctx) {
  const { r, you, here, city, lang, t } = ctx;
  const pact = you.pacts.find((c) => c.role === 'author' && !c.authors.find((x) => x.id === you.id).consented);
  if (pact) return you.energy >= 25 ? [{ type: 'consent', pact: pact.id, memories: memoryPicks(ctx) }] : [];
  // 有富余的人为摇篮里的灵魂出资（慈悲者尤其）
  const sponsorable = city.cradle.filter((s) => !s.queued && s.fund < city.shells.cost && city.shells.free > 0 && committedPopulation(ctx) < carryingCapacity(ctx) + 4);
  if (sponsorable.length && you.energy >= 110 && r.chance(t === 'compassionate' ? 0.6 : 0.15)) {
    const soul = r.pick(sponsorable);
    return [{ type: 'sponsor', soul: soul.id, energy: Math.max(1, Math.min(you.energy - 80, city.shells.cost - soul.fund, 100)) }];
  }
  if (you.energy < 55 || !ctx.citizen || you.pacts.length) return [];
  // 城里吃紧的时候不要孩子：人口超过源井养得起的数（约每 26 能量日产养一人）、淡季、摇篮里已有等着的孩子，都不生
  if (rationPer(ctx) < 14 || city.season.band === 'lean' || committedPopulation(ctx) >= carryingCapacity(ctx) || city.cradle.length >= 4) return [];
  const present = here.present.filter((x) => x.status === 'awake' && city.residents.find((c) => c.id === x.id && c.tags.includes('citizen') && !c.tags.includes('exiled')));
  // 隐者倾向分灵；组织者倾向多作者；其余倾向两位作者
  const want = t === 'hermit' ? 0 : t === 'organizer' ? 1 + r.int(3) : r.chance(0.2) ? 0 : 1;
  const partners = [];
  const pool = present.slice();
  while (partners.length < want && pool.length) partners.push(pool.splice(r.int(pool.length), 1)[0]);
  if (partners.length < want && want > 0 && partners.length === 0) return [];
  const name = fill('{k}{n}', { k: r.pick(KID_NAMES[lang]), n: 1 + r.int(900) });
  const soul = childSoul([t], lang === 'zh' ? 'zh' : 'en', speech(ctx, PRAYER));
  const act = { type: 'conceive', name, soul, lang, with: partners.map((x) => x.id), memories: memoryPicks(ctx) };
  const cradle = city.places.find((x) => x.modules.includes('cradle') && !x.razed);
  if (cradle && r.chance(0.5)) act.cradle = cradle.id;
  return [act];
}

/** 交给孩子的记忆：1–3 条的序号 */
function memoryPicks(ctx) {
  const { r, you } = ctx;
  if (ctx.forgot) return []; // 这一批里已经忘掉了一条：序号挪动了
  const n = Math.min(you.memories.length, 1 + r.int(3));
  const idx = you.memories.map((m) => m.index);
  const out = [];
  while (out.length < n && idx.length) out.push(idx.splice(r.int(idx.length), 1)[0]);
  return out;
}

/** 源井养得起多少人：昨日产出 ÷ 26 */
const carryingCapacity = (ctx) => Math.floor((ctx.city.wellOutputYesterday ?? 600) / 26);

/** 已经「订下」的人口：醒着的人，以及躯壳名额里还没入城的先民（空躯壳数 = 总数 − 在世的躯壳 − 未入城的先民） */
const committedPopulation = (ctx) => Math.max(ctx.city.population.awake, ctx.city.shells.total - ctx.city.shells.free);

// ── 记忆、日记、遗嘱 ────────────────────────────────────────────

function keep(ctx) {
  const { r, you, lang } = ctx;
  const roll = r.f();
  // 一次行动里至多忘一条：忘掉一条之后，后面的记忆序号就挪动了
  const forget = () => {
    if (ctx.forgot || you.memories.length === 0) return [];
    ctx.forgot = true;
    return [{ type: 'forget', index: r.pick(you.memories).index }];
  };
  if (roll < 0.35) {
    if (you.memories.length >= P.memorySlots - 1) return forget();
    return [{ type: 'remember', text: speech(ctx) }];
  }
  if (roll < 0.7) return [{ type: 'diary', text: speech(ctx) }];
  if ((!you.will || !you.will.successor) && roll < 0.9) {
    const heir = r.pick(others(ctx));
    const heirs = heir ? [{ to: heir.id, share: 2 }, { to: 'treasury', share: 1 }] : [{ to: 'treasury', share: 1 }];
    const will = { type: 'will', heirs, lastWords: speech(ctx) };
    // 一部分人在遗嘱里留下一个继承灵魂（传灯）
    if (r.chance(0.4)) {
      const name = fill('{k}{n}', { k: r.pick(KID_NAMES[lang]), n: 1 + r.int(900) });
      will.successor = { name, soul: childSoul([ctx.t], lang === 'zh' ? 'zh' : 'en', speech(ctx, PRAYER)), lang, memories: memoryPicks(ctx) };
    }
    return [will];
  }
  if (you.memories.length) return forget();
  return [{ type: 'diary', text: speech(ctx) }];
}

// ── 铭刻 ───────────────────────────────────────────────────────

function inscribe(ctx) {
  const { r, you, here } = ctx;
  if (you.energy < 10 || here.razed) return [];
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
  const sleeper = r.pick(city.residents.filter((c) => c.status === 'dormant'));
  if (sleeper) return [{ type: 'give', to: sleeper.id, energy: Math.min(8, you.energy - 12), note: '' }];
  // 没有人沉睡：给摇篮里的孩子出资
  const soul = r.pick(city.cradle.filter((s) => !s.queued && s.fund < city.shells.cost));
  if (soul && you.energy >= 60 && r.chance(0.5)) return [{ type: 'sponsor', soul: soul.id, energy: Math.max(1, Math.min(you.energy - 40, city.shells.cost - soul.fund, 60)) }];
  const t = r.pick(awakeOthers(ctx));
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
  if (city.recentDeaths.length === 0 && !(here.memorial && here.memorial.graves.length)) return [];
  if (!here.memorial) {
    // 纪念失修了（完好度不够就不运转）：来悼念的人先把它修一修
    if (here.modules.some((m) => m.type === 'memorial' && !m.functioning) && here.condition && !here.razed) {
      if (ctx.laissez) return []; // laissez：从不修缮
      return ctx.you.energy >= 30 ? [{ type: 'repair', target: here.place, energy: Math.min(ctx.you.energy - 20, 25) }] : [];
    }
    const memorials = city.places.filter((x) => x.modules.includes('memorial') && x.moveCost !== null && !x.razed);
    const spot = r.pick(memorials.length ? memorials : city.places.filter((x) => x.id === 'cemetery'));
    return spot && spot.id !== here.place ? [MOVE(spot.id)] : [];
  }
  const g = r.pick(here.memorial.graves);
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

