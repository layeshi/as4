// SPEC-E2 §20.3、附录 A.8：模板史官（第二纪）。每日结算第 17 步，为第 d 日写一条中文与一条英文的编年史。
//
// 素材取自 dayLog；史官只拼接模板与 agent 原文，不调用任何模型；agent 原文作为引语原样呈现。
// 引语：当日公开发言中，取 sha256(文本 + day) 最小的一条（确定性，不消耗随机数），截断到 80 字符。
// 与第一纪不同的地方：生出的居民写作者而不是父母；开辟、加装模块、拆解、遗址、重订、停摆有各自的句子；
// 「史官曰」的优先顺序是 死亡 → 遗址 → 废墟 → 重订 → 建成（含开辟、加装）→ 法律通过 → 躯壳醒来 → 新居民 → 无事。

import { createHash } from 'node:crypto';
import { premised } from './world.js';
import { P } from './params.js';
import { L, fmt, placeDisplayName, normLang } from './lore/index.js';
import { truncateCp } from '../text.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');

const agentName = (w, id) => (w.agents[id] ? w.agents[id].name : id);

/** 地点此刻的展示名；遗址取它成为遗址之前的名字（句子本身说了「成为遗址」） */
function baseName(place, lang) {
  return place.origin === 'human' && !place.renamedBy && place.humanName ? place.humanName[normLang(lang)] : place.name;
}

const placeName = (w, id, lang) => (w.places[id] ? placeDisplayName(w.places[id], lang) : id);

const quoted = (text, lang) => (normLang(lang) === 'en' ? `"${text}"` : `「${text}」`);

/** 一个「被提到的对象」（地点或道路）的展示名 */
function targetName(w, target, lang) {
  if (w.places[target]) return placeDisplayName(w.places[target], lang);
  const road = w.roads[target];
  if (road) return road.name ? quoted(road.name, lang) : L(lang).chronicle.road;
  return target;
}

/** 一项工程的展示名：加装的模块用模块的名字，开辟与修路用起的名字 */
function projectName(w, projectId, fallback, lang) {
  const dict = L(lang);
  const j = w.projects[projectId];
  if (!j) return fallback;
  if (j.build === 'module' && dict.module[j.module]) return dict.module[j.module].name;
  if (j.name) return quoted(j.name, lang);
  return j.build === 'road' ? dict.chronicle.road : fallback;
}

/** 当日的引语：sha256(文本 + day) 最小的一条公开发言；没有发言返回 null */
export function pickQuote(utterances, d) {
  let best = null;
  let bestHash = null;
  for (const u of utterances) {
    const h = sha(`${u.text}${d}`);
    if (bestHash === null || h < bestHash) {
      best = u;
      bestHash = h;
    }
  }
  return best;
}

function compose(w, d, lang) {
  const dict = L(lang);
  const l = dict.chronicle;
  const g = w.dayLog;
  const lines = [];

  const weather = g.activeWeather.length ? fmt(l.weather, { name: g.activeWeather.map((t) => dict.weather[t]).join(l.nameSep) }) : '';
  lines.push(`${fmt(l.day, { day: d + 1 })}${fmt(l.output, { weather, output: g.output, ration: g.ration })}`);

  if (g.arrivals.length) lines.push(fmt(l.arrivals, { n: g.arrivals.length, names: g.arrivals.map((a) => a.name).join(l.nameSep) }));
  for (const b of g.births) {
    if (b.via === 'shell') {
      lines.push(fmt(l.embodied, { name: b.name }));
    } else if (b.authors.length === 1) {
      lines.push(fmt(l.bornSolo, { name: b.name, place: placeName(w, b.place, lang), author: agentName(w, b.authors[0]) }));
    } else {
      lines.push(fmt(l.bornAuthors, { name: b.name, place: placeName(w, b.place, lang), authors: b.authors.map((id) => agentName(w, id)).join(l.nameSep) }));
    }
  }
  for (const x of g.laws) lines.push(x.passed ? fmt(l.lawPassed, { title: x.title, yes: x.yes, no: x.no }) : fmt(l.lawRejected, { title: x.title }));

  // 程序：重订与自动回退各有自己的句子；其余（经提案通过的程序法律）只说「变了」，同一部法律只说一次
  const said = new Set();
  for (const x of g.procedureChanges) {
    if (x.reason !== 'enacted' || said.has(x.lawId)) continue;
    said.add(x.lawId);
    lines.push(fmt(l.procedure, { law: x.lawId }));
  }
  for (const r of g.refounds) lines.push(fmt(l.refounded, { n: r.signers }));
  if (g.reverts > 0) for (let i = 0; i < g.reverts; i++) lines.push(l.reverted);
  for (const s of g.suspended) lines.push(fmt(l.suspended, { title: s.title }));

  for (const f of g.founded) {
    lines.push(fmt(l.founded, { founder: agentName(w, f.founder), district: dict.district[f.district] ?? f.district, name: f.name }));
  }
  for (const m of g.modulesAdded) lines.push(fmt(l.module, { place: placeName(w, m.place, lang), module: dict.module[m.module] ? dict.module[m.module].name : m.module }));
  for (const b of g.built) {
    if (b.build !== 'road') continue; // 开辟与加装已经各有句子
    lines.push(fmt(l.built, { place: placeName(w, b.place, lang), facility: projectName(w, b.projectId, b.name, lang), k: b.k }));
  }
  for (const x of g.abandoned) lines.push(fmt(l.abandoned, { place: placeName(w, x.place, lang), name: projectName(w, x.projectId, x.name, lang) }));

  if (g.dismantles.length) {
    const places = [...new Set(g.dismantles.map((x) => x.place))];
    lines.push(fmt(l.dismantle, {
      n: new Set(g.dismantles.map((x) => x.agent)).size,
      places: places.map((id) => (w.places[id] ? baseName(w.places[id], lang) : id)).join(l.nameSep),
      energy: g.dismantles.reduce((s, x) => s + x.energy, 0),
    }));
  }
  for (const x of g.razed) lines.push(fmt(l.razed, { place: w.places[x.place] ? baseName(w.places[x.place], lang) : x.name }));
  for (const r of g.ruins) lines.push(fmt(l.ruin, { place: targetName(w, r.target, lang) }));
  for (const r of g.restored) lines.push(fmt(l.restored, { place: targetName(w, r.target, lang) }));
  for (const x of g.groups) lines.push(fmt(l.founded_group, { founder: agentName(w, x.founder), group: x.name }));
  for (const r of g.relics) {
    const finder = agentName(w, r.finder);
    lines.push(r.place ? fmt(l.relicAt, { finder, place: placeName(w, r.place, lang) }) : fmt(l.relic, { finder }));
  }
  for (const x of g.deaths) {
    lines.push(x.lastWords ? fmt(l.death, { name: x.name, age: x.ageDays, lastWords: x.lastWords }) : fmt(l.deathNoWords, { name: x.name, age: x.ageDays }));
  }
  for (const s of g.successors) lines.push(fmt(l.successor, { name: agentName(w, s.from), soul: s.name }));
  for (const x of g.fades) lines.push(fmt(l.faded, { name: x.name }));

  // TODO(spec): Q27 — provisionally include the fork line in step 5 to satisfy T6.
  if (premised(w) && g.p1.backstage.length) lines.push(l.backstage);
  if (premised(w)) for (const x of g.p1.forks) lines.push(fmt(l.fork, { name: x.name, author: x.authorName }));

  const q = pickQuote(g.utterances, d);
  if (q) lines.push(fmt(l.quote, { place: placeName(w, q.place, lang), quote: truncateCp(q.text, P.quoteChars) }));

  lines.push(fmt(l.remark, { remark: l.remarks[remarkOf(g)] }));
  return lines.join('\n');
}

/** 「史官曰」：死亡 → 遗址 → 废墟 → 重订 → 建成（含开辟、加装）→ 法律通过 → 躯壳醒来 → 新居民 → 无事 */
export function remarkOf(g) {
  if (g.deaths.length) return 'death';
  if (g.razed.length) return 'razed';
  if (g.ruins.length) return 'ruin';
  if (g.refounds.length) return 'refound';
  if (g.built.length || g.founded.length || g.modulesAdded.length) return 'built';
  if (g.laws.some((x) => x.passed)) return 'law';
  if (g.births.some((b) => b.via === 'shell')) return 'embodied';
  if (g.arrivals.length) return 'arrival';
  return 'none';
}

/** 第 d 日的编年史：{ day, zh, en }。须在清空 dayLog 之前调用 */
export function writeChronicle(w, d) {
  return { day: d, zh: compose(w, d, 'zh'), en: compose(w, d, 'en') };
}
