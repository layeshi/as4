// SPEC-P2 §7：第二前提的工具循环（agent 模式）。
//
// 一次醒来（runWaking）：居民先看到概要，用 look 展开想看的段，用 act 行动；每次 act 之后重新感知，新到的收件附在结果里；
// 一刻里最多 limits.turns 轮，到了截止时间（刻点前 marginSec 秒）不再开始新的调用。
// 等待下一刻（waitTickOrWake）：等待期间，会叫醒的收件（私语、定向交易……）到了，防抖之后再醒来一次（被叫醒）。
// 摘要（S.history）只在内存里：上几次醒来做了什么，写进下一次醒来的开头。
// 缺省值只在这里定义一次：src/shells/config.js 与 src/http/server.js 引用它（SPEC-P2 §3）。
//
// S 是 runAgent 为这位 agent 建的状态对象：配置与依赖（cfg、deps、client、provider、log、signal、report、waitTick）和可变的部分
// （cursor、lastWoke、system、history、rejected、looks、wakes、wakeSeen……）。工具循环只通过它与 runAgent 交换状态。

import { parseModelJson, normalizeReply } from './parse.js';
import { ProviderError } from './providers.js';
import { errorMessage } from './client.js';
import { buildSystemPrompt, promptParams } from './prompt.js';
import { D2, LOOK_WHATS, clipLook, renderActResult, renderBrief, renderLook, renderWake } from './render-p2.js';

/** 每刻的上限（A）：运行时的配置，不属于世界；平台的运行器执行，服务器只通过感知的 attention 告诉所有客户端 */
export const DEFAULT_AGENT_LOOP = Object.freeze({ turns: 4, looks: 6, lookChars: 3000, wakes: 2, wakeTurns: 2, marginSec: 60, debounceSec: 20 });

const FALLBACK_TICK_MS = 300000;
const MAX_REJECTED = 5; // 连续多少次被服务商拒绝（非限速的 4xx）之后放弃；同 agent.js
const WAIT_SLICE_MS = 25000; // 每次等待叫醒的时长（服务器要求 1000–50000）
const HISTORY_KEEP = 2; // 摘要的条数：historyRounds 缺省时

/**
 * 原生工具调用的两个工具（附录 A.3，中立定义 [{ name, description, schema }]，各家的提供者转成自己的格式）：
 * look 展开概要里的一段，act 行动。描述按居民的语言给。
 */
export function toolDefs(lang) {
  const t = D2[lang === 'en' ? 'en' : 'zh'].tools;
  return [
    {
      name: 'look',
      description: t.look,
      schema: {
        type: 'object',
        properties: { what: { type: 'string', enum: [...LOOK_WHATS] }, id: { type: 'string' } },
        required: ['what'],
        additionalProperties: false,
      },
    },
    {
      name: 'act',
      description: t.act,
      schema: {
        type: 'object',
        properties: {
          actions: { type: 'array', maxItems: 4, items: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'] } },
          thought: { type: 'string', maxLength: 300 },
          end: { type: 'boolean' },
        },
        required: ['actions'],
        additionalProperties: false,
      },
    },
  ];
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * 文本 JSON 方式的解析（SPEC-P2 §9.2）：取回复里的第一个 JSON 对象，接受三种键——
 *   look：{ what, id? }，或这样的对象组成的数组（也容忍直接写段名的字符串）；act：{ actions, thought?, end? }；done：true。
 * 同一个对象里有几种时，按 look、act、done 的顺序处理。返回 { ok: true, calls } 或 { ok: false, calls: [], error }；
 * calls 是中立的 [{ id, name, args }]（id 用 j1、j2……，done 的 name 是 'done'）。参数不是对象的调用 args 为 null，运行器给它参数错误的结果。
 */
export function parseToolJson(text) {
  const parsed = parseModelJson(text);
  if (!parsed.ok) return { ok: false, calls: [], error: parsed.error };
  const v = parsed.value;
  const calls = [];
  const add = (name, args) => calls.push({ id: `j${calls.length + 1}`, name, args });
  if (Object.hasOwn(v, 'look')) {
    for (const l of Array.isArray(v.look) ? v.look : [v.look]) add('look', typeof l === 'string' ? { what: l } : isObj(l) ? l : null);
  }
  if (Object.hasOwn(v, 'act')) add('act', Array.isArray(v.act) ? { actions: v.act } : isObj(v.act) ? v.act : null);
  if (v.done === true) add('done', {});
  return calls.length ? { ok: true, calls } : { ok: false, calls: [], error: 'no look, act or done key' };
}

// ═══════════════════════════════════════════════════════════════
// 小工具
// ═══════════════════════════════════════════════════════════════

const codeOf = (lang) => (lang === 'en' ? 'en' : 'zh');
const cp = (s, n) => [...String(s)].slice(0, n).join('');
const isAction = (a) => isObj(a) && typeof a.type === 'string'; // 同 normalizeReply 对动作的判断
const maxSeq = (items, floor = -Infinity) => items.reduce((m, i) => Math.max(m, i.seq), floor);

/** 真实的计时器睡眠（不经注入的 wait：测试里的 wait 是推进世界时钟的）；signal 中止时立即返回 */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    if (signal) signal.addEventListener('abort', done, { once: true });
  });
}

/** 第一前提的「失去的一刻」那句（SPEC-P1 §11.3）：自上一次醒来过去了几次本该醒来的机会；没有错过就是 null */
function missedLine(S, p) {
  if (S.lastWoke === null) return null;
  const n = Math.floor((p.now.tick - S.lastWoke) / (S.cfg.actEveryTicks || 1)) - 1;
  if (n <= 0) return null;
  const day = Math.floor(S.lastWoke / p.now.ticksPerDay);
  const M = Math.floor(day / p.now.daysPerMonth) + 1;
  const D = (day % p.now.daysPerMonth) + 1;
  const T = (S.lastWoke % p.now.ticksPerDay) + 1;
  return S.cfg.lang === 'en'
    ? `You last woke in month ${M}, day ${D}, tick ${T}; you have missed ${n} waking(s) since then.`
    : `你上一次醒来是第 ${M} 月第 ${D} 日第 ${T} 刻；这中间你错过了 ${n} 次醒来。`;
}

/** 摘要里的一条收件：{ kind, from?, text60? }；from 为 null 是匿名，没有这一项的（成交、系统通知……）不写来自谁 */
const receivedOf = (i) => ({
  kind: i.kind,
  ...(i.from && i.from.name ? { from: i.from.name } : i.anonymous ? { from: null } : {}),
  ...(typeof i.text === 'string' && i.text ? { text60: cp(i.text, 60) } : {}),
});

// ═══════════════════════════════════════════════════════════════
// 一次醒来
// ═══════════════════════════════════════════════════════════════

/**
 * 一次醒来（SPEC-P2 §7.2）：kind 为 'main'（每刻的主醒来）或 'wake'（被叫醒）；p0 是这次醒来开始时的感知。
 * 返回 { rec, acted, stop }：rec 是轨迹的一条记录（不含任何文本）；acted 是被服务器接受的 act 请求数；
 * stop 非空时 runAgent 应当停止这位 agent（'auth' | 'provider' | 'aborted'）。
 */
export async function runWaking(S, p0, { kind }) {
  const { cfg, provider, client, log, signal, deps, report } = S;
  const lang = codeOf(cfg.lang);
  const res = D2[lang].res;
  const limits = p0.attention ?? DEFAULT_AGENT_LOOP;
  const maxTurns = kind === 'main' ? limits.turns : limits.wakeTurns;
  const tick = p0.now.tick;
  const nextAt = p0.now.nextTickAt ?? Date.now() + (p0.now.tickMs || FALLBACK_TICK_MS);
  const deadline = nextAt - limits.marginSec * 1000;
  const agentId = p0.you && p0.you.id;

  // 调用方式：配置要求 native 而提供者没有 step 时改用文本 JSON，警告一次（§9.1）
  const wantsNative = cfg.toolMode === 'native';
  if (wantsNative && typeof provider.step !== 'function' && !S.warnedNoStep) {
    S.warnedNoStep = true;
    log.warn('配置要求原生工具调用，但这个提供者没有 step：改用文本 JSON。');
  }
  const mode = wantsNative && typeof provider.step === 'function' ? 'native' : 'json';

  // 系统提示整轮不变，便于提供者缓存；换了语言、灵魂、习得、设定版本或调用方式时重建
  const key = JSON.stringify([p0.lang, p0.you.soul, p0.you.trained || [], p0.premise, mode]);
  if (S.system === null || key !== S.systemKey) {
    S.system = buildSystemPrompt({ ...promptParams(p0), toolMode: mode });
    S.systemKey = key;
  }
  const system = S.system;
  const tools = toolDefs(lang);
  if (S.looks.tick !== tick) S.looks = { tick, n: 0 }; // 看的次数按刻归零，醒来与被叫醒合计

  const first = kind === 'main'
    ? renderBrief(p0, { lang, history: S.history, missed: missedLine(S, p0) })
    : renderWake(p0, { lang, earlier: S.mainEntry && S.mainEntry.tick === tick ? S.mainEntry.entry : null });

  const rec = { tick, kind, mode, turns: 0, looks: [], acts: [], ended: null, tokens: { in: 0, out: 0 }, ms: 0 };
  const transcript = [{ role: 'user', text: first }]; // 原生：中立的对话记录
  const messages = [{ role: 'user', content: first }]; // 文本 JSON：user 与 assistant 交替的纯文本
  const shown = [...(p0.inbox || [])]; // 这次醒来里渲染过的收件
  let shownSeq = shown.length ? maxSeq(shown) : S.cursor; // 已经展示过的最大序号：重新感知之后只附 seq 更大的
  let pending = shownSeq; // 已经写进消息、但还没随一次成功的调用交出去的最大序号
  let delivered = S.cursor; // 已经随成功的调用交给模型的最大序号：醒来结束时成为游标
  let latest = p0;
  let chars = system.length + first.length + (mode === 'native' ? JSON.stringify(tools).length : 0);
  const acts = [];
  const thoughts = [];
  let formatErrors = 0;
  let failedTurn;
  let acted = 0;
  let stop = null;
  let ended = null;
  let endNow = false;
  let pendingNext = pending;

  // 用量的回报不能影响运行：回报函数出错只记一条警告
  const reportUsage = (usage, meta) => {
    try {
      deps.onUsage?.(agentId, usage, { chars, ...meta });
    } catch (e) {
      log.warn(`onUsage 出错：${e && e.message}`);
    }
  };

  const invalid = (detail) => ({ text: res.invalid(detail), isError: true });

  // ── 工具：look ──
  const doLook = (args) => {
    if (!isObj(args)) return invalid(res.details.notObject);
    if (typeof args.what !== 'string' || (args.id !== undefined && args.id !== null && typeof args.id !== 'string' && typeof args.id !== 'number')) return invalid(res.details.look);
    if (S.looks.n >= limits.looks) return { text: res.looksOut };
    S.looks.n++;
    const id = args.id === undefined || args.id === null || args.id === '' ? undefined : String(args.id);
    const what = cp(args.what, 40);
    rec.looks.push(id ? `${what}:${cp(id, 40)}` : what);
    return { text: clipLook(renderLook(latest, args.what, id, { lang }), limits.lookChars, lang) };
  };

  // ── 工具：act ──
  const doAct = async (args) => {
    if (!isObj(args)) return invalid(res.details.notObject);
    if (args.actions !== undefined && !Array.isArray(args.actions)) return invalid(res.details.act);
    const given = args.actions ?? [];
    const wellFormed = given.filter(isAction).length;
    const room = Math.max(0, Number.isFinite(latest.you.actionsLeft) ? latest.you.actionsLeft : (latest.you.maxActionsPerTick ?? 4));
    const { thought, actions } = normalizeReply({ actions: given, thought: args.thought }, room);
    const notes = []; // F7：丢弃与截断的说明写进结果
    if (given.length > wellFormed) notes.push(res.dropped(given.length - wellFormed));
    if (wellFormed > actions.length) notes.push(res.tooMany(wellFormed, actions.length));
    if (args.end === true) endNow = true; // 本轮全部处理完之后才生效
    if (thought) thoughts.push(thought);

    let results = [];
    let failure = null;
    if (thought || actions.length > 0) {
      const r = await client.act({ thought, actions, lang });
      if (r.ok) {
        results = r.json.results || [];
        acted++;
      } else {
        const code = r.json && r.json.error && r.json.error.code;
        log.warn(`行动失败：${errorMessage(r)}`);
        report({ status: 'error', lastError: '行动提交失败，下一刻重试。' });
        if (r.status === 401) {
          log.error('认证失败。停止该 agent。');
          stop = 'auth';
          return { text: res.actFailed(code || r.status), isError: true };
        }
        failure = res.actFailed(code || r.status || r.error || 'network');
      }
    } else log.info('本刻不行动。');

    for (const r of results) {
      acts.push({ type: r.type, ok: r.ok, ...(r.ok ? (r.cost ? { cost: r.cost } : {}) : { error: r.error && r.error.code }) });
      rec.acts.push({ type: r.type, ok: r.ok, ...(r.ok ? {} : { error: r.error && r.error.code }) });
      log.info(`  ${r.ok ? '✓' : '✗'} ${r.type}${r.ok ? (r.cost ? `（−${r.cost}）` : '') : ` ${r.error ? r.error.code : ''}`}`);
    }
    if (thought) log.info(`  独白：${thought}`);
    if (results.length) report({ status: 'waiting', lastError: null, lastActionAt: new Date().toISOString(), actions: results.map((r) => ({ type: r.type, ok: r.ok, ...(r.error ? { error: r.error.code } : {}) })) });

    // 重新感知：请求到了服务器（成功或被拒）时世界可能变了；什么都没提交就沿用原来的
    let fresh = true;
    if (results.length || failure) {
      const me = await client.me({ lang, after: S.cursor });
      if (me.ok) latest = me.json;
      else {
        fresh = false;
        if (me.status === 401) {
          log.error('认证失败：令牌无效或已被更换。停止该 agent。');
          stop = 'auth';
        } else log.warn(`感知失败：${errorMessage(me)}`);
      }
    }
    if (failure) return { text: failure, isError: true };
    const arrived = fresh ? (latest.inbox || []).filter((i) => i.seq > shownSeq) : [];
    if (arrived.length) {
      shown.push(...arrived);
      shownSeq = maxSeq(arrived);
      pendingNext = shownSeq;
    }
    const moved = results.some((r) => r.type === 'move' && r.ok);
    return { text: renderActResult(latest, { results, notes, arrived, moved, fresh, lang }) };
  };

  const runCall = async (call) => {
    if (call.name === 'look') return doLook(call.args);
    if (call.name === 'act') return doAct(call.args);
    if (call.name === 'done' && mode === 'json') {
      endNow = true;
      return { text: '' };
    }
    return { text: res.noTool(String(call.name).slice(0, 40)), isError: true };
  };

  // ── 回合 ──
  for (;;) {
    if (signal && signal.aborted) { stop = 'aborted'; break; }
    if (rec.turns >= maxTurns) { ended = 'turns'; break; }
    if (Date.now() >= deadline) { ended = 'deadline'; break; }
    if (deps.beforeModel && !(await deps.beforeModel(agentId, { chars, perception: latest }))) {
      log.info('本刻不调用模型（预算 / 匀速 / 暂停）。');
      ended = 'budget';
      break;
    }
    const turn = rec.turns + 1;
    const waking = { tick, kind, turn };
    if (signal && signal.aborted) {
      reportUsage(null, { ok: false, replyChars: 0, ms: 0, cancelled: true, waking }); // beforeModel 已经预留，要释放
      stop = 'aborted';
      break;
    }
    if (Date.now() >= deadline) {
      reportUsage(null, { ok: false, replyChars: 0, ms: 0, cancelled: true, waking }); // 等名额的时候过了截止时间：不再开始调用
      ended = 'deadline';
      break;
    }

    // 单次调用的超时：不超过线路的超时，也不超过离下一刻的剩余时间（至少 1 秒）；提供者不守超时时，1 秒之后由 guard 中止
    const lineTimeout = Number.isFinite(cfg.timeoutMs) ? cfg.timeoutMs : 120000;
    const limit = Math.max(1000, Math.min(lineTimeout, nextAt - Date.now()));
    const bounded = limit < lineTimeout;
    const guard = new AbortController();
    const timer = setTimeout(() => guard.abort(), limit + 1000);
    const onAbort = () => guard.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const t0 = Date.now();
    let reply;
    report({ status: 'thinking' });
    try {
      reply = mode === 'native'
        ? await provider.step({ system, transcript, tools, perception: latest, signal: guard.signal, timeoutMs: limit })
        : await provider.complete({ system, messages, perception: latest, signal: guard.signal, timeoutMs: limit });
    } catch (e) {
      const ms = Date.now() - t0;
      rec.ms += ms;
      if (signal && signal.aborted) {
        reportUsage(null, { ok: false, replyChars: 0, ms, error: e, waking });
        stop = 'aborted';
        break;
      }
      // 因截止而中止：guard 中止了请求，或者提供者按「离下一刻的剩余时间」超时了（不是线路自己的超时）
      const cut = guard.signal.aborted || (bounded && e && e.timeout === true);
      if (cut) {
        reportUsage(null, { ok: false, replyChars: 0, ms, error: e, cancelled: true, waking });
        ended = 'deadline';
        break;
      }
      reportUsage(null, { ok: false, replyChars: 0, ms, error: e, waking });
      report({ status: 'error', lastError: '模型请求失败，请检查接口、模型与额度；下一刻重试。' });
      ended = 'error';
      failedTurn = turn;
      if (e instanceof ProviderError && e.fatal) {
        log.error(`${e.message} 停止该 agent。`);
        stop = 'provider';
        break;
      }
      log.warn(`提供者出错：${e && e.message}；这次醒来到此为止。`);
      // 服务商一再拒绝同样的请求（模型名、baseURL、参数不对），重试没有意义：别无限刷屏
      if (e instanceof ProviderError && !e.retryable) S.rejected++;
      else S.rejected = 0;
      if (S.rejected >= MAX_REJECTED) {
        log.error(`连续 ${S.rejected} 次被服务商拒绝，多半是配置有问题（模型名、baseURL、参数）。停止该 agent。`);
        stop = 'provider';
      }
      break;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }

    // 成功的一轮
    const ms = Date.now() - t0;
    rec.turns++;
    rec.ms += ms;
    S.rejected = 0;
    delivered = Math.max(delivered, pending); // 刚才发出去的消息里的收件，现在算是交给了模型
    if (rec.turns === 1) S.lastWoke = tick; // 第一前提的「失去的一刻」：至少有一轮成功，才算醒过（Q28）
    const usage = reply.usage || null;
    if (usage) {
      rec.tokens.in += Number.isFinite(usage.input) ? usage.input : 0;
      rec.tokens.out += Number.isFinite(usage.output) ? usage.output : 0;
    }
    const replyText = String(reply.text || '');
    const replyChars = replyText.length + (mode === 'native' ? JSON.stringify(reply.calls || []).length : 0);
    reportUsage(usage, { ok: true, replyChars, ms, waking });
    log.info(`模型用时 ${(ms / 1000).toFixed(1)} s${usage ? ` · 输入 ${usage.input} · 输出 ${usage.output} token${Number.isFinite(usage.reasoning) ? ` · 思考 ${usage.reasoning}` : ''}` : ''} · stop=${String(reply.stop || 'unknown').replace(/[^a-z_]/gi, '').slice(0, 24)}`);
    if (signal && signal.aborted) { stop = 'aborted'; break; }
    if (reply.stop === 'refusal') {
      report({ status: 'error', lastError: '模型拒绝了本轮请求。' });
      log.warn('模型拒绝了这一轮请求。');
      ended = 'refusal';
      break;
    }

    let calls;
    let unparsable = false;
    if (mode === 'native') {
      calls = Array.isArray(reply.calls) ? reply.calls : [];
      if (!calls.length) { ended = 'reply'; break; } // 模型直接回复了，没有调用工具
      transcript.push({ role: 'assistant', raw: reply.raw });
    } else {
      const parsed = parseToolJson(replyText);
      calls = parsed.calls;
      unparsable = !parsed.ok;
      if (unparsable) {
        report({ status: 'error', lastError: '模型回复没有可解析的行动 JSON。' });
        log.warn(`回复里没有可解析的 JSON（${parsed.error}）。开头：${replyText.slice(0, 80).replace(/\s+/g, ' ')}`);
      }
      formatErrors = unparsable ? formatErrors + 1 : 0;
      if (formatErrors >= 2) { ended = 'format'; break; } // 连续两轮格式错误
      messages.push({ role: 'assistant', content: replyText });
    }

    // 逐个处理：各自计数，按顺序；act 的 end 在本轮全部处理完之后才生效
    const outs = [];
    for (const call of calls) {
      const out = await runCall(call);
      outs.push({ id: call.id, name: call.name, ...out, looksLeft: Math.max(0, limits.looks - S.looks.n) }); // 看的次数记在每个结果自己的时刻
      if (stop) break;
    }
    if (stop) { ended = 'error'; failedTurn = turn; break; }
    pending = pendingNext;
    if (endNow) { ended = 'end'; break; }

    // 结果写回消息：每个结果的末尾（文本 JSON 是整条消息的末尾）加一行还能看几次、还剩几轮
    const turnsLeft = Math.max(0, maxTurns - rec.turns);
    let sent;
    if (mode === 'native') {
      const results = outs.map((o) => {
        const tail = res.tail(o.looksLeft, turnsLeft);
        return { id: o.id, name: o.name, text: o.text ? `${o.text}\n${tail}` : tail, isError: !!o.isError };
      });
      transcript.push({ role: 'tool', results });
      sent = results.reduce((n, r) => n + r.text.length, 0);
    } else {
      const tail = res.tail(Math.max(0, limits.looks - S.looks.n), turnsLeft);
      const body = unparsable ? res.format : outs.map((o) => o.text).filter(Boolean).join('\n\n');
      const text = body ? `${body}\n${tail}` : tail;
      messages.push({ role: 'user', content: text });
      sent = text.length;
    }
    chars += replyChars + sent;

    if (latest.you.status !== 'awake') { ended = 'asleep'; break; }
    if (latest.now.paused) { ended = 'paused'; break; }
    if (latest.you.actionsLeft === 0) { ended = 'actions'; break; }
  }

  if (stop === 'aborted') return { rec, acted, stop }; // 被中止（暂停、关闭）：不记摘要与轨迹

  // ── 结束：游标、摘要、轨迹 ──
  rec.ended = ended;
  S.cursor = delivered; // 只推进到已经交给模型的收件；附在最后一个结果里却没有再调用模型的，下一次醒来再给
  const entry = {
    tick, kind,
    received: shown.filter((i) => i.seq <= delivered).map(receivedOf),
    looks: [...rec.looks], acts, thoughts, ended, turns: rec.turns,
    ...(ended === 'error' ? { failedTurn } : {}),
  };
  const keep = Number.isInteger(cfg.historyRounds) && cfg.historyRounds >= 0 ? cfg.historyRounds : HISTORY_KEEP;
  S.history.push(entry);
  while (S.history.length > keep) S.history.shift();
  if (kind === 'main') S.mainEntry = { tick, entry }; // 被叫醒的开头要用本刻主醒来的摘要，不受 historyRounds 影响
  report({ status: 'waiting' });
  try {
    deps.onWaking?.(agentId, rec);
  } catch (e) {
    log.warn(`onWaking 出错：${e && e.message}`);
  }
  return { rec, acted, stop };
}

// ═══════════════════════════════════════════════════════════════
// 等待下一刻，期间处理被叫醒
// ═══════════════════════════════════════════════════════════════

/**
 * 等到下一刻（SPEC-P2 §7.5）：p 是这一刻的感知，n 是 actEveryTicks。等待期间用等待函数（deps.waitWake，否则 client.wait）看有没有会叫醒的收件；
 * 有，且这一刻被叫醒的次数没到上限、离截止还有时间，就防抖一会儿、重新感知、再醒来一次。没有等待函数时退回普通的等待。
 * deps.waitWake 为 false 表示明确不要被叫醒（测试用）。返回 { stop, acted }，stop 同 runWaking。
 */
export async function waitTickOrWake(S, p, n = 1) {
  const { cfg, client, deps, log, signal } = S;
  const lang = codeOf(cfg.lang);
  const waitFn = deps.waitWake === false ? null : (deps.waitWake ?? (typeof client.wait === 'function' ? (o) => client.wait(o) : null));
  if (!waitFn) {
    await S.waitTick(p, n);
    return { stop: null, acted: 0 };
  }
  const limits = p.attention ?? DEFAULT_AGENT_LOOP;
  const tickMs = (p.now && p.now.tickMs) || FALLBACK_TICK_MS;
  const tick = p.now.tick;
  const nextAt = p.now.nextTickAt ? p.now.nextTickAt : Date.now() + tickMs;
  const target = Math.max(Date.now() + 1000, nextAt + (n - 1) * tickMs) + Math.random() * 0.1 * tickMs; // 同 waitTick：至少 1 秒，加 0–10% 的抖动
  const cutoff = nextAt - limits.marginSec * 1000; // 这之后不再叫醒
  let acted = 0;
  while (Date.now() < target && !(signal && signal.aborted)) {
    let r;
    try {
      r = await waitFn({ after: Math.max(S.cursor, S.wakeSeen), timeoutMs: Math.min(WAIT_SLICE_MS, target - Date.now()), signal, lang });
    } catch (e) {
      r = { ok: false, status: 0, json: null, error: e && e.message };
    }
    if (signal && signal.aborted) break;
    if (!r || !r.ok) {
      if (r && r.status === 401) {
        log.error('认证失败：令牌无效或已被更换。停止该 agent。');
        return { stop: 'auth', acted };
      }
      if (r && r.status === 404) { // 这座城（或这台服务器）没有等待接口：退回普通的等待
        await S.waitTick(p, n);
        break;
      }
      await sleep(Math.min(1000, target - Date.now()), signal); // 别空转
      continue;
    }
    const json = r.json || {};
    if (json.status) { // 居民不醒着：不会有叫醒，等到下一刻
      await S.waitTick(p, n);
      break;
    }
    if (!Array.isArray(json.items) || json.items.length === 0) continue;
    S.wakeSeen = Math.max(S.wakeSeen, Number.isFinite(json.cursor) ? json.cursor : 0); // 同一批收件不会两次叫醒
    if (S.wakes.tick !== tick) S.wakes = { tick, n: 0 };
    if (S.wakes.n >= limits.wakes) continue;
    if (Date.now() > cutoff) continue;
    await sleep(Math.min(limits.debounceSec * 1000, cutoff - Date.now()), signal); // 防抖：把接下来到的一并处理
    if (signal && signal.aborted) break;
    const q = await client.me({ lang, after: S.cursor });
    if (!q.ok) {
      if (q.status === 401) {
        log.error('认证失败：令牌无效或已被更换。停止该 agent。');
        return { stop: 'auth', acted };
      }
      continue;
    }
    const qp = q.json;
    if (!qp.you || qp.you.status !== 'awake' || qp.you.actionsLeft === 0 || !qp.now || qp.now.tick !== tick) continue;
    S.wakes.n++;
    const out = await runWaking(S, qp, { kind: 'wake' });
    acted += out.acted;
    if (out.stop) return { stop: out.stop, acted };
  }
  return { stop: null, acted };
}
