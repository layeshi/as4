// 按语言取文本的工具（第二纪）。支持 zh、en；其他语言一律回落到 zh（PROTOCOL-2 §0）。

import zh from './zh.js';
import en from './en.js';
import { nameKey } from '../../text.js';

export { CHARTER, CHARTER_LANGS, CHARTER_MANDATED, charterWallText } from '../../lore/charter.js';
export { RELICS_FRONTIER, relicByN, relicTitle } from '../../lore/relics.js';
export { CANON, LETTER } from '../../lore/canon.js';
export { ACTIONS, ACTION_ORDER } from './actions.js';

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

/** 城名的展示名：仍是默认名时随语言切换 */
export function cityDisplayName(cityName, lang) {
  return cityName === zh.cityName ? L(lang).cityName : cityName;
}

/**
 * 地点的展示名（按语言）：
 *   人类的建筑、没有被改名：人类的名字（zh / en 各一个）；被改名或后人开辟的：居民起的名字（不翻译）；
 *   遗址：「X 的遗址」，X 是它成为遗址之前的展示名（系统文本，按语言显示，不占用名字，A.7）。
 */
export function placeDisplayName(place, lang) {
  const base = place.origin === 'human' && !place.renamedBy && place.humanName ? place.humanName[normLang(lang)] : place.name;
  return place.razed ? fmt(L(lang).razedName, { name: base }) : base;
}

/** 地点的描述（系统文本或居民写下的描述）：{ code, text } */
export function placeDescription(place, lang) {
  if (place.razed) return { code: 'razed', text: fmt(L(lang).razedDesc, { name: place.origin === 'human' && !place.renamedBy && place.humanName ? place.humanName[normLang(lang)] : place.name }) };
  if (place.origin === 'human') return { code: `place.${place.id}`, text: L(lang).place[place.id].desc };
  return { code: null, text: place.description || '' };
}

/** 一个地点用来比较「重名」的全部名字键：当前显示用的名字（含中英文的人类名字与遗址的名字） */
export function placeNameKeys(place) {
  const keys = new Set();
  for (const lang of LANGS) keys.add(nameKey(placeDisplayName(place, lang)));
  return [...keys];
}

/**
 * GET /api/public/lore?lang=：观测站需要的系统文本（物理定律、地点描述、档位词、天象名、模块名、遗址的说法）。
 * 这些文本本来就是公开的静态资源；由服务器提供，是为了让界面与引擎的文本不会各写一份而漂移。不含运行器提示词与错误信息。
 */
export function publicLore(lang) {
  const nl = normLang(lang);
  const d = L(nl);
  return {
    lang: nl,
    cityName: d.cityName, redacted: d.redacted, unreadableInscription: d.unreadableInscription,
    place: d.place, district: d.district, band: d.band, wellBand: d.wellBand, richnessWild: d.richnessWild, season: d.season,
    physicsP1: d.physicsP1, shellsP1: d.shellsP1,
    weather: d.weather, omen: d.omen, module: d.module, physics: d.physics, shells: d.shells,
    razedName: d.razedName, razedDesc: d.razedDesc, lotName: d.lotName,
  };
}
