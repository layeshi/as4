// 名字的形状规则（居民、灵魂、先民共用）：不得与 ID、保留字混淆（引用居民时 ID 与名字都可以用）。
// 放在叶子模块里，world.js（创建世界时校验先民）与 engine/lifecycle.js 都能引用而不形成循环。

import { nameKey } from '../text.js';

export const RESERVED_NAMES = new Set(['treasury', 'city', 'citizens', 'humans']);
export const ID_LIKE = /^[a-z]\d+$/i;

/** 名字的形状是否合法 */
export const nameShapeOk = (name) => !(RESERVED_NAMES.has(nameKey(name)) || ID_LIKE.test(name));

/** 语言标签：BCP-47 风格，如 zh、en、es、zh-Hans */
export const LANG_RE = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,3}$/;
