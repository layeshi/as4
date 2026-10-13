// 从网站与服务端的同一份文案生成小游戏的句式模块，避免两边各写一份而漂移。
// 输出 CommonJS 源码文本；release.mjs 在 prepare 时写入、在 check 时比对。
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SHARED_TARGET = join('utils', 'shared-text.js');

// 网站 i18n 里给事件模板取值用的小工具：按名字从源码里取出原样的声明。
function declaration(source, name) {
  const line = source.split('\n').find(l => l.startsWith(`const ${name} = `));
  if (!line) throw new Error(`public/i18n.js 缺少 ${name}，请更新 wechat/scripts/shared.mjs`);
  return line;
}
function functionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/i18n.js 缺少函数 ${name}`);
  let depth = 0, i = source.indexOf('{', start);
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) break;
  }
  return source.slice(start, i + 1);
}
const ALLOWED_CALLS = new Set(['A', 'PL', 'GR', 'TX', 'AMT', 'WHO', 'TARGET', 'ruleOpDetail', 't', 'currentLang', 'String', 'Math', 'Number', 'Boolean']);

export async function buildSharedModule() {
  const i18nPath = join(repo, 'public', 'i18n.js');
  const source = await readFile(i18nPath, 'utf8');
  const i18n = await import(pathToFileURL(i18nPath).href);
  const strings = await import(pathToFileURL(join(repo, 'public', 'e2-strings.js')).href);
  const outcome = await import(pathToFileURL(join(repo, 'public', 'law-outcome.js')).href);
  const presets = await import(pathToFileURL(join(repo, 'public', 'model-presets.js')).href);
  const lore = (await import(pathToFileURL(join(repo, 'src', 'e2', 'lore', 'index.js')).href)).publicLore('zh');
  const vars = Object.entries(i18n.VARS).map(([type, fn]) => {
    const body = fn.toString();
    for (const m of body.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (!ALLOWED_CALLS.has(m[2])) throw new Error(`事件 ${type} 的取值函数调用了未移植的 ${m[2]}，请更新 wechat/scripts/shared.mjs`);
    }
    return `  ${JSON.stringify(type)}: ${body},`;
  });
  const names = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === 'object' && v ? v.name : v]));
  const data = {
    MODEL_PRESETS: presets.MODEL_PRESETS,
    TPL: i18n.TPL.zh,
    CAT: i18n.CAT,
    CATEGORIES: i18n.CATEGORIES,
    CATEGORY_LABELS: Object.fromEntries(i18n.CATEGORIES.map(c => [c, i18n.STR.zh['cat_' + c]])),
    P4: Object.fromEntries(['tokenRoutineEvent', 'tokenSupplyUp', 'tokenSupplyDown', 'tokenBasicUp', 'tokenBasicDown'].map(k => [k, strings.P4_STR.zh[k]])),
    LORE: { district: lore.district, band: lore.band, wellBand: lore.wellBand, richness: lore.richnessWild, weather: lore.weather, module: names(lore.module), razedName: lore.razedName, redacted: lore.redacted },
  };
  return `// 由 wechat/scripts/shared.mjs 从 public/i18n.js、public/e2-strings.js、public/law-outcome.js 与服务端文案生成，不要手改。
const DATA = ${JSON.stringify(data)};
const TPL = DATA.TPL;
${['A', 'PL', 'GR', 'TX', 'AMT', 'WHO', 'TARGET'].map(n => declaration(source, n)).join('\n')}
const t = () => '';
const currentLang = () => 'zh';
${functionBlock(source, 'ruleOpDetail')}
const tokenized = ${strings.tokenized.toString()};
const tokenTerms = ${strings.tokenTerms.toString()};
const enactText = ${outcome.enactText.toString()};
const templateKey = ${i18n.templateKey.toString()};
const VARS = {
${vars.join('\n')}
};
/** 与网站 describeEvent 相同的规则（中文）：返回 { key, template, vars }。 */
function describe(e, premise) {
  if (e.redacted) return { key: 'redacted', template: '{text}', vars: { text: TX(e.data && e.data.text ? e.data.text.zh || e.data.text : DATA.LORE.redacted) } };
  const key = templateKey(e);
  let template = TPL[key] !== undefined ? TPL[key] : TPL[e.type];
  if (premise === 6 && e.type === 'fostered') template = '{a} 的管理权已完成过继。';
  let vars = {};
  try { vars = VARS[e.type] ? VARS[e.type](e) : {}; } catch (_) { vars = {}; }
  if (e.type === 'inscribe' && e.data && e.data.cover) vars.cover = e.data.cover;
  if (tokenized({ premise })) {
    if (e.type === 'routine') { template = DATA.P4.tokenRoutineEvent; vars.a = A(e.agent); }
    if (e.type === 'backstage' && e.data && ['supply', 'basic'].includes(e.data.kind)) template = DATA.P4['token' + (e.data.kind === 'supply' ? 'Supply' : 'Basic') + (e.data.direction === 'up' ? 'Up' : 'Down')];
    if (template !== undefined) template = tokenTerms(template);
  }
  if (template === undefined) return { key, template: '{type}', vars: { type: e.type } };
  return e.data && e.data.enact ? { key, template: template + ' {enact}', vars: Object.assign({}, vars, { enact: enactText(e.data.enact, 'zh') }) } : { key, template, vars };
}
module.exports = { describe, CAT: DATA.CAT, CATEGORIES: DATA.CATEGORIES, CATEGORY_LABELS: DATA.CATEGORY_LABELS, LORE: DATA.LORE, MODEL_PRESETS: DATA.MODEL_PRESETS, tokenized, tokenTerms };
`;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { writeFile } = await import('node:fs/promises');
  const target = join(repo, 'wechat', 'minigame', SHARED_TARGET);
  await writeFile(target, await buildSharedModule());
  console.log('已生成 ' + target);
}
