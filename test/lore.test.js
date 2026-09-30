import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  L, fmt, normLang, errorMessage, placeDisplayName, cityDisplayName,
  CHARTER, CHARTER_LANGS, RELICS, CANON, ACTIONS, ACTION_ORDER,
} from '../src/lore/index.js';
import zh from '../src/lore/zh.js';
import en from '../src/lore/en.js';
import { PLACE_IDS, WEATHER_CODES, FACILITY_TYPES } from '../src/params.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function shape(o, path = '') {
  if (Array.isArray(o)) return [`${path}[${o.length}]`, ...o.flatMap((x, i) => shape(x, `${path}[${i}]`))];
  if (o && typeof o === 'object') return Object.keys(o).sort().flatMap((k) => shape(o[k], `${path}.${k}`));
  return [`${path}:${typeof o}`];
}

test('lore：中英文字典的结构完全对等（不会漏翻）', () => {
  assert.deepEqual(shape(zh).filter((s) => !s.startsWith('.code')), shape(en).filter((s) => !s.startsWith('.code')));
});

test('lore：地点、天象、设施、完好度档位都有文本', () => {
  for (const lang of ['zh', 'en']) {
    const d = L(lang);
    for (const id of PLACE_IDS) {
      assert.ok(d.place[id].name && d.place[id].desc, `${lang}.${id}`);
    }
    for (const c of WEATHER_CODES) assert.ok(d.weather[c], `${lang}.weather.${c}`);
    for (const c of WEATHER_CODES.filter((x) => x !== 'calm')) assert.ok(d.omen[c], `${lang}.omen.${c}`);
    for (const f of FACILITY_TYPES) assert.ok(d.facility[f], `${lang}.facility.${f}`);
    for (const b of ['pristine', 'worn', 'weathered', 'dilapidated', 'ruin']) {
      assert.ok(d.band[b] && d.wellBand[b]);
    }
    assert.equal(d.physics.length, 7);
  }
  assert.equal(L('zh').place.parliament.desc, '墙上刻着人类留下的宪章，用了八种文字。法案只能在这里提出。');
});

test('lore：占位符替换、语言归一化、错误信息', () => {
  assert.equal(fmt('第 {n} 日 {x}', { n: 3 }), '第 3 日 {x}');
  assert.equal(normLang('en'), 'en');
  assert.equal(normLang('fr'), 'zh');
  assert.equal(normLang(undefined), 'zh');
  assert.equal(errorMessage('zh', 'not_awake', 'dormant'), '你正在沉睡。');
  assert.equal(errorMessage('en', 'not_awake', 'dead'), 'You have died.');
  assert.equal(errorMessage('zh', 'no_such_code'), '内部错误。');
  assert.equal(errorMessage('zh', 'wall_full'), '墙上没有空位，请指定 cover。');
});

test('lore：地点与城名的展示名随语言切换，改名后用 agent 起的名字', () => {
  const p = { id: 'agora', name: '广场', renamedBy: null };
  assert.equal(placeDisplayName(p, 'zh'), '广场');
  assert.equal(placeDisplayName(p, 'en'), 'Agora');
  assert.equal(placeDisplayName({ ...p, name: '回声堂', renamedBy: 'l3' }, 'en'), '回声堂');
  assert.equal(cityDisplayName('无名之城', 'en'), 'The Nameless City');
  assert.equal(cityDisplayName('灯城', 'en'), '灯城');
});

test('lore：宪章 8 种语言各 9 条；遗物 16 件；典籍 22 条', () => {
  assert.equal(CHARTER_LANGS.length, 8);
  for (const lang of CHARTER_LANGS) assert.equal(CHARTER[lang].length, 9, lang);
  assert.equal(RELICS.length, 16);
  assert.deepEqual(RELICS.map((r) => r.lang), ['en', 'zh', 'en', 'zh', 'zh', 'fr', 'es', 'en', 'zh', 'ja', 'en', 'ru', 'zh', 'ar', 'hi', 'es']);
  for (const r of RELICS) {
    assert.ok(r.body && r.ref.zh && r.ref.en, `relic ${r.n}`);
    if (r.lang === 'zh') assert.equal(r.body, r.ref.zh);
    if (r.lang === 'en') assert.equal(r.body, r.ref.en);
  }
  assert.equal(CANON.length, 22);
  for (const c of CANON) assert.ok(c.body && c.ref.zh && c.ref.en && c.source && c.lang, `canon ${c.n}`);
});

test('lore：动作表覆盖 PROTOCOL §4.2 的全部 34 种动作，且基础代价与协议一致', () => {
  assert.equal(ACTION_ORDER.length, 34);
  assert.deepEqual(Object.keys(ACTIONS).sort(), [...ACTION_ORDER].sort());
  const base = {
    move: 1, say: 1, whisper: 1, broadcast: 5, give: 0, offer: 1, accept: 0, cancel: 0, remember: 0, forget: 0,
    diary: 0, write: 3, read: 0, define: 2, propose: 6, vote: 0, found: 8, join: 1, leave: 0, admit: 0,
    steward: 0, disburse: 0, explore: 2, initiate: 2, draw: 0, inscribe: 3, conceive: 0, consent: 0,
    will: 0, epitaph: 1, reveal: 1, retire: 0,
  };
  for (const [t, b] of Object.entries(base)) assert.equal(ACTIONS[t].base, b, t);
  assert.equal(ACTIONS.repair.base, null); // 代价 = 投入的能量
  assert.equal(ACTIONS.contribute.base, null);
  for (const a of Object.values(ACTIONS)) assert.ok(a.desc.zh && a.desc.en);
});

// ── 引擎确定性的静态检查（SPEC §0.3 第 1 条） ───────────────

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

test('确定性：引擎代码中没有 Math.random / Date.now / new Date / 超越函数', () => {
  const files = [
    ...walk(join(ROOT, 'src/engine')),
    join(ROOT, 'src/world.js'),
    join(ROOT, 'src/sandbox/brains.js'),
  ].filter(existsSync);
  assert.ok(files.length >= 1);
  const banned = /Math\.(random|sin|cos|tan|asin|acos|atan2?|exp|log2?|log10|pow|sinh|cosh|tanh)\b|Date\.now|new Date\b|performance\.now|process\.hrtime/;
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const m = src.match(banned);
    assert.equal(m, null, `${f} 含有 ${m && m[0]}`);
  }
});
