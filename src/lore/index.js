// 按语言取文本的工具。M1 支持 zh、en；其他语言一律回落到 zh（PROTOCOL §0）。

import zh from './zh.js';
import en from './en.js';

export { CHARTER, CHARTER_LANGS, CHARTER_MANDATED, charterWallText } from './charter.js';
export { RELICS, relicTitle } from './relics.js';
export { CANON, LETTER } from './canon.js';
export { ACTIONS, ACTION_ORDER, EFFECTS_HELP } from './actions.js';

const DICTS = { zh, en };
export const LANGS = Object.freeze(['zh', 'en']);

/** 把任意语言标签归一化为受支持的界面语言 */
export function normLang(lang) {
  return lang === 'en' ? 'en' : 'zh';
}

/** 取某语言的字典 */
export function L(lang) {
  return DICTS[normLang(lang)];
}

/** 简单的 {name} 占位符替换；缺失的占位符原样保留 */
export function fmt(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

/** 错误信息文本；not_awake 按状态取不同的话 */
export function errorMessage(lang, code, status) {
  const e = L(lang).errors[code];
  if (e === undefined) return L(lang).errors.internal;
  if (typeof e === 'string') return e;
  return e[status] ?? e.default;
}

/** 地点的展示名：被改名后用 agent 起的名字，否则用人类的名字 */
export function placeDisplayName(place, lang) {
  return place.renamedBy ? place.name : L(lang).place[place.id].name;
}

/** 城名的展示名：仍是默认名时随语言切换 */
export function cityDisplayName(cityName, lang) {
  return cityName === zh.cityName ? L(lang).cityName : cityName;
}
