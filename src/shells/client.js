// SPEC-E2 §13.2：躯壳居民的进程内客户端。躯壳没有令牌，不走 HTTP；它与 runner/client.js 同接口（me / act），
// 所以参考运行器的 runAgent 可以直接驱动它。
//
//   me({ lang, after })      → rt.engine.buildPerception(w, id, { lang, floor: 游标, ack: false, nextTickAt })
//   act({ thought, actions }) → rt.exec('act', { agentId, thought, actions, ackSeq })
//
// 游标的处理同 HTTP 层（Q9）：GET 不是命令，自动确认只推进内存游标；ackSeq 随 act 命令进入命令日志，回放才一致。
// 核心逻辑 meCore / actCore 就是 HTTP 处理器用的那两个函数（src/http/agent.js），所以两条路径的结果逐位相同。
//
// 每个调用返回 { ok, status, json }，与 HTTP 客户端一致。

import { meCore, actCore, waitCore } from '../http/agent.js';
import { agentic } from '../e2/facade.js';
import { errorBody } from '../http/util.js';

const normLang = (lang) => (lang === 'en' ? 'en' : 'zh');

/** @param rt Runtime；@param cursors Map<agentId, 已送达的最大收件 seq>（管理器里所有躯壳共用一张表） */
export function createShellClient(rt, agentId, { cursors }) {
  const ctx = { rt, cursors };
  return {
    base: 'in-process',
    async me({ lang = 'zh', after } = {}) {
      if (!rt.w.agents[agentId]) return { ok: false, status: 404, json: errorBody(normLang(lang), 'not_found', {}, rt.engine.protocol) };
      return { ok: true, status: 200, json: meCore(ctx, agentId, { lang: normLang(lang), after }) };
    },
    /**
     * 等待会叫醒的收件（SPEC-P2 §6.4）：不走 HTTP，用 rt.onWake 实现同样的语义——先查收件箱，再等通知，到时返回空。
     * 返回 { ok: true, status: 200, json: { items, cursor, status? } }；不是第二前提的城没有这个接口（404，同 HTTP）。
     */
    async wait({ after, timeoutMs = 25000, signal } = {}) {
      const a = rt.w.agents[agentId];
      if (!a || !agentic(rt.w)) return { ok: false, status: 404, json: errorBody('zh', 'not_found', {}, rt.engine.protocol) };
      const json = await waitCore(rt, agentId, { after: after ?? cursors.get(agentId) ?? 0, timeoutMs, signal, lang: normLang(a.lang) });
      return { ok: true, status: 200, json };
    },
    async act({ thought, actions, lang: asked, experimentGeneration }) {
      const lang = normLang(asked ?? (rt.w.agents[agentId] && rt.w.agents[agentId].lang));
      if (!rt.w.agents[agentId]) return { ok: false, status: 404, json: errorBody(lang, 'not_found', {}, rt.engine.protocol) };
      const body = { actions };
      if (experimentGeneration !== undefined) body.experimentGeneration = experimentGeneration;
      if (thought) body.thought = thought;
      const r = actCore(ctx, agentId, body, lang);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: r.json };
    },
  };
}
