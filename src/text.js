// SPEC-M1 §2：所有外部输入的文本——Unicode NFC 规范化；去除控制字符（保留 \n）；
// 首尾空白去掉；长度按码点计。另有文字系统识别（§1.2：只做到「文字系统」一级）与词典匹配（§7.11）。

const CTRL_EXCEPT_LF = /(?!\n)\p{Cc}/gu;

/** 规范化一段外部文本。非字符串返回 null。 */
export function normalizeText(input) {
  if (typeof input !== 'string') return null;
  let s = input.normalize('NFC');
  if (typeof s.toWellFormed === 'function') s = s.toWellFormed(); // 孤立代理项 → U+FFFD
  s = s.replace(CTRL_EXCEPT_LF, '');
  return s.trim();
}

/** 按码点计的长度 */
export function cpLength(s) {
  let n = 0;
  for (const _ of s) n++; // eslint-disable-line no-unused-vars
  return n;
}

/** 按码点截断 */
export function truncateCp(s, n) {
  if (s.length <= n) return s; // 码点数 ≤ UTF-16 长度，短串必然不超
  let out = '';
  let i = 0;
  for (const ch of s) {
    if (i++ >= n) break;
    out += ch;
  }
  return out;
}

/**
 * 校验并规范化一个文本字段。
 * 返回 { ok: true, text } 或 { ok: false, code }，code 为 PROTOCOL §2.2 的动作级错误码：
 * 类型不对 / 为空 → invalid_args；超长 → text_too_long。
 */
export function checkText(value, { max, min = 1 } = {}) {
  const text = normalizeText(value);
  if (text === null) return { ok: false, code: 'invalid_args' };
  const len = cpLength(text);
  if (len < min) return { ok: false, code: 'invalid_args' };
  if (max !== undefined && len > max) return { ok: false, code: 'text_too_long' };
  return { ok: true, text };
}

/** 名字、词等的比较键：NFC + 小写（SPEC §5.9） */
export function nameKey(s) {
  return s.normalize('NFC').toLowerCase();
}

// ── 文字系统识别 ──────────────────────────────────────────────

const SCRIPT_TESTS = [
  ['han', /\p{Script=Han}/gu],
  ['hiragana', /\p{Script=Hiragana}/gu],
  ['katakana', /\p{Script=Katakana}/gu],
  ['hangul', /\p{Script=Hangul}/gu],
  ['latin', /\p{Script=Latin}/gu],
  ['cyrillic', /\p{Script=Cyrillic}/gu],
  ['arabic', /\p{Script=Arabic}/gu],
  ['devanagari', /\p{Script=Devanagari}/gu],
  ['greek', /\p{Script=Greek}/gu],
  ['hebrew', /\p{Script=Hebrew}/gu],
  ['thai', /\p{Script=Thai}/gu],
];

function countMatches(s, re) {
  const m = s.match(re);
  return m ? m.length : 0;
}

/**
 * 识别一段文字的主要文字系统。
 * 返回 han | kana | hangul | latin | cyrillic | arabic | devanagari | greek | hebrew | thai | other，
 * 没有任何字母（纯数字、符号、表情）返回 null。
 * 日文同时含汉字与假名：假名不少于汉字的三分之一即判为 kana。
 */
export function detectScript(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const counts = {};
  let total = 0;
  for (const [name, re] of SCRIPT_TESTS) {
    const n = countMatches(text, re);
    if (n > 0) {
      counts[name] = n;
      total += n;
    }
  }
  if (total === 0) {
    return /\p{L}/u.test(text) ? 'other' : null;
  }
  const kana = (counts.hiragana || 0) + (counts.katakana || 0);
  const han = counts.han || 0;
  if (kana > 0 && kana * 3 >= han) return 'kana';
  if ((counts.hangul || 0) > 0 && counts.hangul >= han) return 'hangul';
  let best = null;
  let bestN = -1;
  for (const [name] of SCRIPT_TESTS) {
    if (name === 'hiragana' || name === 'katakana') continue;
    const n = counts[name] || 0;
    if (n > bestN) {
      best = name;
      bestN = n;
    }
  }
  return bestN > 0 ? best : 'kana';
}

// ── 词典匹配（§7.11） ───────────────────────────────────────

const CJK_WORD = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const matcherCache = new Map();

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matcherFor(wordKey) {
  let m = matcherCache.get(wordKey);
  if (m) return m;
  if (CJK_WORD.test(wordKey)) {
    m = { cjk: true, word: wordKey };
  } else {
    m = { cjk: false, re: new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(wordKey)}(?![\\p{L}\\p{N}_])`, 'gu') };
  }
  if (matcherCache.size > 5000) matcherCache.clear();
  matcherCache.set(wordKey, m);
  return m;
}

/**
 * 统计词 wordKey（已 nameKey 过）在文本中出现的次数。
 * 含汉字、假名、谚文的词做子串匹配；其他词按词边界匹配（不区分大小写）。
 */
export function countWord(text, wordKey) {
  if (!wordKey) return 0;
  const hay = text.toLowerCase();
  const m = matcherFor(wordKey);
  if (m.cjk) {
    let n = 0;
    let from = 0;
    for (;;) {
      const at = hay.indexOf(m.word, from);
      if (at < 0) return n;
      n++;
      from = at + m.word.length;
    }
  }
  m.re.lastIndex = 0;
  const found = hay.match(m.re);
  return found ? found.length : 0;
}
