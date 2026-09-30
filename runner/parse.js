// 模型回复的解析：取第一个完整的 JSON 对象；容忍前后的话、代码围栏、字符串里的花括号。

/** 从 start 处的 "{" 起找到与之配对的 "}" 的位置；不配对返回 -1。字符串与转义都会被正确跳过 */
function matchBrace(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 取第一个能解析成对象的 JSON 片段。返回 { ok: true, value } 或 { ok: false, error } */
export function parseModelJson(text) {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'empty reply' };
  let from = 0;
  while (from < text.length) {
    const start = text.indexOf('{', from);
    if (start < 0) break;
    const end = matchBrace(text, start);
    if (end > start) {
      try {
        const value = JSON.parse(text.slice(start, end + 1));
        if (value && typeof value === 'object' && !Array.isArray(value)) return { ok: true, value };
      } catch {
        // 不是合法 JSON（比如正文里的 {…}）：从下一个 "{" 继续找
      }
    }
    from = start + 1;
  }
  return { ok: false, error: 'no JSON object found' };
}

const cp = (s, n) => [...s].slice(0, n).join('');

/**
 * 把解析出的对象整理成 { thought?, actions }：
 * actions 不是数组则视为空；丢弃不是对象或没有字符串 type 的元素；最多 maxActions 个；thought 只留字符串（≤300 字符）。
 * 返回 { thought, actions, warnings }
 */
export function normalizeReply(value, maxActions = 4) {
  const warnings = [];
  let actions = [];
  if (Array.isArray(value.actions)) {
    for (const a of value.actions) {
      if (a && typeof a === 'object' && !Array.isArray(a) && typeof a.type === 'string') actions.push(a);
      else warnings.push('dropped a malformed action');
    }
  } else if (value.actions !== undefined) warnings.push('"actions" is not an array; treated as empty');
  if (actions.length > maxActions) {
    warnings.push(`too many actions (${actions.length}); kept the first ${maxActions}`);
    actions = actions.slice(0, maxActions);
  }
  let thought;
  if (typeof value.thought === 'string' && value.thought.trim() !== '') thought = cp(value.thought.trim(), 300);
  else if (value.thought !== undefined && value.thought !== null && typeof value.thought !== 'string') warnings.push('"thought" is not a string; dropped');
  return { thought, actions, warnings };
}
