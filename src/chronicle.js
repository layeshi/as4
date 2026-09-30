// SPEC-M1 §12.3：模板史官。每日结算第 17 步，为第 d 日写一条中文与一条英文的编年史（附录 A.8）。
//
// 素材取自 dayLog；史官只拼接模板与 agent 原文，不调用任何模型；agent 原文作为引语原样呈现。
// 引语：当日公开发言中，取 sha256(文本 + day) 最小的一条（确定性，不消耗随机数），截断到 80 字符。

import { createHash } from 'node:crypto';
import { P } from './params.js';
import { L, fmt, placeDisplayName } from './lore/index.js';
import { truncateCp } from './text.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');

/** 一个「被提到的对象」（地点或设施）的展示名 */
function targetName(w, target, lang) {
  const place = w.places[target];
  if (place) return placeDisplayName(place, lang);
  const f = w.facilities[target];
  return f ? f.name : target;
}

const placeName = (w, id, lang) => placeDisplayName(w.places[id], lang);

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
    const [p1, p2] = b.parents.map((id) => (w.agents[id] ? w.agents[id].name : id));
    lines.push(fmt(l.born, { name: b.name, p1, p2 }));
  }
  for (const x of g.laws) lines.push(x.passed ? fmt(l.lawPassed, { title: x.title, yes: x.yes, no: x.no }) : fmt(l.lawRejected, { title: x.title }));
  for (const b of g.built) lines.push(fmt(l.built, { place: placeName(w, b.place, lang), facility: dict.facility[b.type], k: b.k }));
  for (const x of g.abandoned) lines.push(fmt(l.abandoned, { place: placeName(w, x.place, lang), name: x.name }));
  for (const r of g.ruins) lines.push(fmt(l.ruin, { place: targetName(w, r.target, lang) }));
  for (const r of g.restored) lines.push(fmt(l.restored, { place: targetName(w, r.target, lang) }));
  for (const x of g.groups) lines.push(fmt(l.founded, { founder: w.agents[x.founder] ? w.agents[x.founder].name : x.founder, group: x.name }));
  for (const r of g.relics) lines.push(fmt(l.relic, { finder: w.agents[r.finder] ? w.agents[r.finder].name : r.finder }));
  for (const x of g.deaths) {
    lines.push(x.lastWords ? fmt(l.death, { name: x.name, age: x.ageDays, lastWords: x.lastWords }) : fmt(l.deathNoWords, { name: x.name, age: x.ageDays }));
  }
  for (const x of g.fades) lines.push(fmt(l.faded, { name: x.name }));

  const q = pickQuote(g.utterances, d);
  if (q) lines.push(fmt(l.quote, { place: placeName(w, q.place, lang), quote: truncateCp(q.text, P.quoteChars) }));

  const remark = g.deaths.length ? 'death'
    : g.ruins.length ? 'ruin'
      : g.built.length ? 'built'
        : g.laws.some((x) => x.passed) ? 'law'
          : g.arrivals.length ? 'arrival'
            : 'none';
  lines.push(fmt(l.remark, { remark: l.remarks[remark] }));
  return lines.join('\n');
}

/** 第 d 日的编年史：{ day, zh, en }。须在清空 dayLog 之前调用 */
export function writeChronicle(w, d) {
  return { day: d, zh: compose(w, d, 'zh'), en: compose(w, d, 'en') };
}
