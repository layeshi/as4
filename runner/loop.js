// SPEC-P2 §7：第二前提的工具循环（agent 模式）。
//
// 现在有：注意力上限的缺省值（第 2 步：感知里的 attention 要用它）、工具的定义与文本 JSON 的解析（第 7 步：提供者要用）；
// 一次醒来、被叫醒、摘要与预算在第 8 步加入。
// 缺省值只在这里定义一次：src/shells/config.js 与 src/http/server.js 引用它（SPEC-P2 §3）。

import { parseModelJson } from './parse.js';
import { D2, LOOK_WHATS } from './render-p2.js';

/** 每刻的上限（A）：运行时的配置，不属于世界；平台的运行器执行，服务器只通过感知的 attention 告诉所有客户端 */
export const DEFAULT_AGENT_LOOP = Object.freeze({ turns: 4, looks: 6, lookChars: 3000, wakes: 2, wakeTurns: 2, marginSec: 60, debounceSec: 20 });

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
