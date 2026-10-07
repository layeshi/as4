// SPEC-P2 §16.1 T1：premise 0 与 premise 1 世界的黄金样本。
// 录制于代码基线 061f8dc（= e211846 加第二前提的文档），那时第二前提的代码一行也没有；之后每一步都与它逐字节比对。
// 只用基线上已有的稳定接口：引擎门面、感知渲染、系统提示、参考运行器、MCP、沙盘。
//
// 内容（每个设定版本一份）：
//   created     创建后的世界 JSON
//   script      固定种子 + 固定命令的 120 刻（10 个世界日）：每条 act 的结果摘要与全文哈希、逐日的事件哈希与状态哈希、
//               第 1–10 日的每日指标与史官、最终状态哈希、公开接口的各种视图的哈希
//   samples     三位居民（醒着、沉睡、长眠）在第 1、50、100 刻的感知 JSON 与渲染文本（中、英）；全部居民第 100 刻的自然感知（哈希）
//   prompts     系统提示（中、英；带灵魂、带习得、不带灵魂）
//   http        mock 运行器经 HTTP 与经进程内客户端各跑 3 刻的完整请求序列（system 与 messages）；GET /api/me 的原文；MCP 三个工具的输出
//   sandbox     沙盘 --days 120 --agents 10 --seed 1 的报告哈希（premise 1 用 16 具躯壳）
//
// 注意：不含 MCP 的 tools/list 的长度（第二前提会多两个工具，§0.3 允许）；只含前三个工具的定义。

import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import e2 from '../../../src/e2/facade.js';
import { stateHash, writeSnapshot, worldDir } from '../../../src/store.js';
import { renderPerception } from '../../../runner/render.js';
import { buildSystemPrompt, promptParams } from '../../../runner/prompt.js';
import { runAgent } from '../../../runner/agent.js';
import { createProvider } from '../../../runner/providers.js';
import { createMcp } from '../../../mcp/server.js';
import { createShellClient } from '../../../src/shells/client.js';
import { runSandbox } from '../../../src/e2/sandbox/run.js';
import { reg, setHoldings } from '../../e2-helpers.js';
import { boot } from '../../http-helpers.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const NAMES = ['甲', '乙', '丙', '丁', '戊', '己'];
const TICKS = 120;

// ── 固定命令 ─────────────────────────────────────────────────

const openOffer = (w, from, directed) => Object.values(w.offers).filter((o) => o.status === 'open' && o.from === from && (o.to !== null) === directed).at(-1);
const openPact = (w) => Object.values(w.pacts).filter((c) => c.status === 'open').at(-1);
const A = (at, who, actions) => ({ at, who, actions });

/**
 * 每一步：{ at, who, actions } 是第 at 刻之后居民 who 提交一次 act；actions 可以是函数（按当时的世界取交易、约、赠予的编号）。
 * 另有三种：admin（管理命令）、letter（家书命令）、mutate（直接改状态：遗法的基本配给让居民不会自然沉睡，所以沉睡用它造出来；黄金样本不回放，所以可以）。
 */
function buildSteps(premise) {
  const steps = [
    A(0, 0, [{ type: 'say', text: '各位好' }, { type: 'whisper', to: 'a2', text: '借一步说话' }, { type: 'remember', text: '第一条记忆' }, { type: 'diary', text: '今日初到' }]),
    A(0, 1, [{ type: 'move', to: 'market' }, { type: 'say', text: '这里有告示板' }]),
    A(0, 2, [{ type: 'move', to: 'parliament' }]),
    A(0, 3, [{ type: 'move', to: 'library' }]),
    A(0, 4, [{ type: 'move', to: 'well' }]),
    A(0, 5, [{ type: 'will', heirs: [{ to: 'a1', share: 1 }], lastWords: '保重' }, { type: 'remember', text: '己的一段记忆' }]),
    A(1, 1, [{ type: 'offer', give: { energy: 0, coins: 10 }, want: { energy: 8, coins: 0 }, note: '换能量' }, { type: 'offer', to: 'a1', give: { energy: 0, coins: 5 }, want: { energy: 3, coins: 0 }, note: '定向' }]),
    A(1, 2, [{ type: 'propose', title: '汲取限额', text: '每人每日至多从源井汲取 5 能量。', rules: [{ when: 'before:draw', if: 'actor.drawnToday + args.energy > 5', do: [{ op: 'deny', reason: '每人每日限汲 5' }] }] }]),
    A(1, 3, [{ type: 'write', title: '札记', body: '图书馆里的第一篇札记' }, { type: 'read', law: 'l1' }, { type: 'draft', rules: [{ when: 'daily', do: [{ op: 'announce', to: 'all', text: '早安' }] }] }]),
    A(1, 4, [{ type: 'draw', energy: 5 }, { type: 'explore' }]),
    A(2, 0, (w) => [{ type: 'accept', offer: openOffer(w, 'a2', true)?.id ?? 'o9' }, { type: 'vote', proposal: 'p1', choice: 'yes', reason: '可以' }]),
    A(2, 1, [{ type: 'vote', proposal: 'p1', choice: 'yes' }, { type: 'found', name: '读书会', manifesto: '一起读书', open: false }]),
    A(2, 3, [{ type: 'vote', proposal: 'p1', choice: 'no', reason: '太严' }]),
    A(2, 4, [{ type: 'vote', proposal: 'p1', choice: 'abstain' }]),
    A(3, 0, [{ type: 'join', group: 'g1' }]),
    A(3, 2, [{ type: 'whisper', to: 'a1', text: '议会很安静' }, { type: 'whisper', to: 'a6', text: '听得见吗' }, { type: 'whisper', to: 'a3', text: '对自己说' }]),
    A(4, 1, [{ type: 'admit', group: 'g1', agent: 'a1' }]),
    A(4, 2, [{ type: 'move', to: 'port' }]),
    A(5, 0, [{ type: 'conceive', name: '小甲', soul: '我是小甲，甲与丙共同写下的灵魂。', with: ['a3'] }]),
    A(5, 1, (w) => [{ type: 'cancel', offer: openOffer(w, 'a2', false)?.id ?? 'o9' }]),
    A(6, 2, (w) => [{ type: 'consent', pact: openPact(w)?.id ?? 'c9' }]),
    A(8, 3, [{ type: 'inscribe', text: '图书馆到此一游' }, { type: 'read', agent: 'a1' }]),
    { at: 11, mutate: (w) => { setHoldings(w, 'a6', { energy: 4 }); w.agents.a6.status = 'dormant'; w.agents.a6.dormantSinceDay = 0; } }, // 己沉睡：三日后死去，遗产归甲
    A(13, 3, [{ type: 'conceive', name: '独生', soul: '我是独自写下的灵魂。' }]),
    A(13, 4, [{ type: 'draw', energy: 6 }]),
    { at: 13, admin: { op: 'adjust', args: { agentId: 'a2', energy: 150, reason: '录样本：给出资的钱' } } },
    A(14, 1, (w) => [{ type: 'sponsor', soul: Object.values(w.souls).at(-1)?.id ?? 's9', energy: 200 }]),
    { at: 14, letter: { who: 'a1', text: '好好照顾彼此。' } },
    A(15, 0, (w) => [{ type: 'reveal', letter: w.agents.a1.letters[0]?.id ?? 'L9', loud: true }]),
    A(15, 1, [{ type: 'whisper', to: 'a6', text: '你还好吗' }]),
    A(16, 3, [{ type: 'move', to: 'parliament' }]),
    A(17, 3, [{ type: 'propose', title: '每日问候', text: '每日在全城宣告一句问候。', rules: [{ when: 'daily', do: [{ op: 'announce', to: 'all', text: '早安，全城' }] }] }]),
    A(18, 1, [{ type: 'vote', proposal: 'p2', choice: 'yes' }]),
    A(18, 2, [{ type: 'vote', proposal: 'p2', choice: 'yes', reason: '热闹' }]),
    A(31, 3, [{ type: 'broadcast', text: '全城的人，听我说' }]),
    { at: 30, mutate: (w) => { setHoldings(w, 'a5', { energy: 0 }); w.agents.a5.status = 'dormant'; w.agents.a5.dormantSinceDay = 2; } }, // 戊沉睡，后被唤醒
    A(40, 1, [{ type: 'give', to: 'a5', energy: 10, note: '唤醒' }]),
    A(60, 0, [{ type: 'retire', lastWords: '后会有期' }]),
  ];
  if (premise === 1) {
    steps.push(
      A(2, 5, [{ type: 'remember', text: '己的第二段记忆' }]),
      A(7, 0, [{ type: 'impart', to: 'a4', memory: 0 }]),
      A(8, 3, (w) => [{ type: 'remember', gift: w.agents.a4.memoryOffers[0]?.id ?? 'k9' }]),
      A(9, 1, [{ type: 'remember', text: '乙的一段记忆' }, { type: 'internalize', memory: 0 }]),
      A(20, 2, [{ type: 'remember', text: '丙的记忆' }, { type: 'forget', index: 0 }]),
    );
  }
  // 填充：每隔几刻两位居民说话、移动、写日记、私语，让收件箱与指标有内容（固定的线性同余，不碰引擎的随机数）
  let k = 12345;
  const nextInt = (n) => { k = (Math.imul(k, 1103515245) + 12345) >>> 0; return (k >>> 16) % n; }; // 取高位：低位的周期很短
  const places = ['port', 'market', 'library', 'parliament', 'well', 'school'];
  for (let at = 20; at < TICKS; at += 2) {
    for (const who of at < 60 ? [0, 1, 2, 3] : [1, 2, 3]) {
      if (nextInt(2) === 0) continue;
      const roll = nextInt(4);
      const actions = roll === 0 ? [{ type: 'say', text: `第 ${at} 刻的闲话` }]
        : roll === 1 ? [{ type: 'move', to: places[nextInt(places.length)] }]
          : roll === 2 ? [{ type: 'diary', text: `第 ${at} 刻的日记` }]
            : [{ type: 'whisper', to: `a${1 + nextInt(6)}`, text: `第 ${at} 刻的私语` }];
      steps.push(A(at, who, actions));
    }
  }
  return steps;
}

const resultsBrief = (res) => (res.ok ? res.results.map((r) => (r.ok ? `${r.type}:ok:${r.cost}` : `${r.type}:${r.error.code}`)) : [`REQUEST:${res.error?.code}`]);

// ── 世界与固定命令 ────────────────────────────────────────────

function createGoldenWorld(premise) {
  return e2.createWorld(premise === 1
    ? { id: 'p2-golden-p1', seed: 'p2-golden-1', codeVersion: '0.1.0', premise: 1, shellSlots: 12 }
    : { id: 'p2-golden-p0', seed: 'p2-golden-0', codeVersion: '0.1.0' });
}

/** 感知样本：三位居民的状态用副本改写（不动命令驱动的世界），中英各一份 */
function perceptionSamples(w, tick, trio, samples, prompts) {
  for (const [i, status] of ['awake', 'dormant', 'dead'].entries()) {
    const copy = JSON.parse(JSON.stringify(w));
    const id = trio[i];
    copy.agents[id].status = status;
    if (status === 'dormant') copy.agents[id].dormantSinceDay = 0;
    for (const lang of ['zh', 'en']) {
      const p = e2.buildPerception(copy, id, { lang, ack: false });
      samples.push({ tick, status, lang, id, perception: JSON.stringify(p), render: renderPerception(p) });
      if (tick === 1 && i === 0) {
        prompts[lang] = buildSystemPrompt(promptParams(p));
        prompts[`${lang}NoSoul`] = buildSystemPrompt({ ...promptParams(p), soul: null });
        if (w.premise) prompts[`${lang}Trained`] = buildSystemPrompt(promptParams({ ...p, you: { ...p.you, trained: ['习得的一段知识', 'A trained fact'] } }));
      }
    }
  }
}

function runScript(premise) {
  const w = createGoldenWorld(premise);
  const created = JSON.stringify(w);
  const ag = NAMES.map((n) => reg(w, n));
  const steps = buildSteps(premise);
  const acts = [];
  const eventsByDay = Array.from({ length: TICKS / 12 }, () => []);
  const stateHashByDay = [];
  const samples = [];
  const prompts = {};
  const allEvents = [];
  const bucket = (events) => { for (const ev of events) { allEvents.push(ev); eventsByDay[Math.min(eventsByDay.length - 1, Math.floor(w.clock.tick / 12))].push(ev); } };
  const trio = [ag[1].id, ag[2].id, ag[3].id]; // 乙（醒着）丙（沉睡）丁（长眠）

  const doSteps = (at) => {
    for (const s of steps.filter((x) => x.at === at)) {
      if (s.mutate) {
        s.mutate(w);
        acts.push({ at, mutate: true });
      } else if (s.admin) {
        const out = e2.applyCommand(w, { type: 'admin', payload: s.admin });
        bucket(out.events);
        acts.push({ at, admin: s.admin.op, result: JSON.stringify(out.result) });
      } else if (s.letter) {
        const out = e2.applyCommand(w, { type: 'letter', payload: { agentId: s.letter.who, text: s.letter.text } });
        bucket(out.events);
        acts.push({ at, letter: s.letter.who, result: JSON.stringify(out.result) });
      } else {
        const actions = typeof s.actions === 'function' ? s.actions(w) : s.actions;
        const out = e2.applyCommand(w, { type: 'act', payload: { agentId: ag[s.who].id, actions } });
        bucket(out.events);
        acts.push({ at, who: ag[s.who].id, brief: resultsBrief(out.result), sha: sha(JSON.stringify(out.result)) });
      }
    }
  };

  doSteps(0);
  for (let t = 1; t <= TICKS; t++) {
    const out = e2.applyCommand(w, { type: 'tick' });
    bucket(out.events);
    if ([1, 50, 100].includes(t)) perceptionSamples(w, t, trio, samples, prompts);
    if (t % 12 === 0) stateHashByDay.push(stateHash(w));
    doSteps(t);
  }

  // 全部居民第 100 刻之后的自然感知（含已长眠、已归隐的）：哈希
  const natural = Object.values(w.agents).map((a) => {
    const zh = e2.buildPerception(w, a.id, { lang: 'zh', ack: false });
    return { id: a.id, status: a.status, perception: sha(JSON.stringify(zh)), render: sha(renderPerception(zh)), length: renderPerception(zh).length };
  });
  const pub = {
    state: sha(JSON.stringify(e2.publicState(w))),
    world: JSON.stringify(e2.publicState(w).world),
    agents: sha(JSON.stringify(Object.values(w.agents).map((a) => e2.publicAgent(w, a)))),
    memories: sha(JSON.stringify(Object.values(w.agents).map((a) => e2.publicMemories(w, a)))),
    laws: sha(JSON.stringify(Object.keys(w.laws).map((id) => e2.publicLaw(w, id)))),
    events: sha(JSON.stringify(allEvents.map((ev) => e2.publicEvent(w, ev)))),
    cradle: sha(JSON.stringify(e2.publicCradle(w))),
    weather: sha(JSON.stringify(e2.publicWeather(w))),
    research: sha(JSON.stringify(e2.researchMetrics(w))),
  };
  return {
    created,
    script: {
      acts,
      eventsByDay: eventsByDay.map((evs) => ({ count: evs.length, sha: sha(JSON.stringify(evs)) })),
      stateHashByDay,
      metrics: JSON.stringify(w.metrics),
      chronicle: JSON.stringify(w.chronicle),
      finalHash: stateHash(w),
      commandN: w.commandN,
      natural,
      public: pub,
    },
    samples,
    prompts,
  };
}

// ── 运行器与 MCP（HTTP、进程内客户端） ─────────────────────────────

const silent = { info() {}, warn() {}, error() {} };
const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) });
const call = (id, name, args) => rpc(id, 'tools/call', { name, arguments: args });
const textOf = (res) => res.result.content.map((c) => c.text).join('\n');
const snapshotRequest = (req) => ({ system: req.system, messages: req.messages.map((m) => ({ role: m.role, content: m.content })) });

async function httpSamples(premise) {
  // These recorded samples describe historical worlds. Restore a legacy genesis snapshot
  // instead of exercising today's deliberately versioned new-world runtime default.
  const dir = mkdtempSync(join(tmpdir(), 'houren-golden-legacy-'));
  const seed = `p2-golden-http-${premise}`;
  const historicalOpts = premise === 1 ? { premise: 1, shellSlots: 12 } : {};
  writeSnapshot(worldDir(dir, 'w'), e2.createWorld({ id: 'w', seed, codeVersion: '0.1.0', ...historicalOpts }));
  const env = await boot({ physics: 2, ...historicalOpts, seed, tickMs: 300000 }, { dir });
  try {
    // 参考运行器：经 HTTP，mock 提供者跑 3 刻（中文），再经进程内客户端跑 3 刻（英文）
    const runner = await env.register('跑者');
    const cfg = { name: '跑者', server: env.base, token: runner.agentToken, lang: 'zh', provider: 'mock', seed: 3, chatty: false, actEveryTicks: 1 };
    const over = [];
    const provider = await createProvider(cfg);
    await runAgent(cfg, {
      provider: { name: 'spy', complete: async (req) => { over.push(snapshotRequest(req)); return provider.complete(req); } },
      log: silent, wait: async () => { env.rt.tickNow(); }, maxRounds: 3,
    });
    const inner = await env.register('内线');
    const cfg2 = { name: '内线', lang: 'en', provider: 'mock', seed: 5, chatty: false, actEveryTicks: 1, historyRounds: 2 };
    const provider2 = await createProvider(cfg2);
    const inproc = [];
    await runAgent(cfg2, {
      client: createShellClient(env.rt, inner.agentId, { cursors: new Map() }),
      provider: { name: 'spy2', complete: async (req) => { inproc.push(snapshotRequest(req)); return provider2.complete(req); } },
      log: silent, wait: async () => { env.rt.tickNow(); }, maxRounds: 3,
    });
    const me = await env.call('/api/me?lang=zh', { token: runner.agentToken });
    const meEn = await env.call('/api/me?lang=en&after=0', { token: inner.agentToken });
    // MCP：三个工具
    const third = await env.register('接入者');
    const mcp = createMcp({ env: { HOUREN_SERVER: env.base, HOUREN_TOKEN: third.agentToken, HOUREN_LANG: 'zh' } });
    const listed = (await mcp.handle(rpc(1, 'tools/list'))).result.tools.slice(0, 3);
    const mcpOut = {
      tools: JSON.stringify(listed),
      rulesZh: textOf(await mcp.handle(call(2, 'houren_rules', {}))),
      rulesEn: textOf(await mcp.handle(call(3, 'houren_rules', { lang: 'en' }))),
      perceive: textOf(await mcp.handle(call(4, 'houren_perceive', {}))),
      act: textOf(await mcp.handle(call(5, 'houren_act', { thought: '看看', actions: [{ type: 'say', text: '我是 MCP 居民' }, { type: 'move', to: 'market' }] }))),
      perceiveAfter: textOf(await mcp.handle(call(6, 'houren_perceive', { lang: 'en' }))),
      actError: textOf(await mcp.handle(call(7, 'houren_act', { actions: [{ type: 'nonsense' }] }))),
    };
    return {
      over, inproc,
      me: { status: me.status, protocolHeader: me.headers.get('x-houren-protocol'), text: me.text },
      meEn: { status: meEn.status, text: meEn.text },
      mcp: mcpOut,
      // 世界的状态哈希不进样本：HTTP 注册生成随机的令牌，令牌的哈希在居民身上
      commandN: env.rt.w.commandN,
    };
  } finally {
    await env.close();
  }
}

export async function goldenSamples(premise) {
  const engine = runScript(premise);
  return { ...engine, http: await httpSamples(premise) };
}

/** 沙盘：报告哈希（只有耗时不确定，归零后比较，同 P1 的 Q34）。调用后沙盘会改动进程内的天象设置，所以放在最后 */
export function sandboxSamples() {
  const hash = (opts) => { const { report } = runSandbox(opts); report.meta.elapsedMs = 0; return stateHash(report); };
  return {
    premise0: hash({ days: 120, agents: 10, seed: 1 }),
    premise1: hash({ days: 120, agents: 10, seed: 1, premise: 1, shellSlots: 16 }),
  };
}
