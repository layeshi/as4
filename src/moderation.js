// SPEC-M1 §17：内容审核钩子。M1 只有一张可配置的屏蔽词表，默认为空。
// 所有公开文本在进入世界之前经过 screen()；不通过时动作失败并返回 moderated。
//
// 注意：引擎在处理命令时会调用 screen()，因此屏蔽词表属于「确定性环境」的一部分，
// 与代码版本一样，中途更换会使旧命令的回放结果不同（见 docs/QUESTIONS.md）。

import { nameKey } from './text.js';

let blocklist = [];

/** 设置屏蔽词（覆盖旧表）。词按 NFC + 小写比较，子串匹配。 */
export function setBlocklist(words) {
  blocklist = (words || [])
    .filter((w) => typeof w === 'string' && w.trim() !== '')
    .map((w) => nameKey(w.trim()));
}

export function getBlocklist() {
  return blocklist.slice();
}

/** 审核一段（已规范化的）文本 → { ok, reason } */
export function screen(text) {
  if (blocklist.length === 0) return { ok: true };
  const key = nameKey(text);
  for (const w of blocklist) {
    if (key.includes(w)) return { ok: false, reason: 'blocked_word' };
  }
  return { ok: true };
}
