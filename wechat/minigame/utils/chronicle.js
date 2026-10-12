// 编年史：服务端每日一段文字，按固定句式拆成一节（出能与配给、事件、「是日」引文、史官曰）。
const { compact } = require('./format');
const PENDING = '内容审核中';
function parseChronicle(entry) {
  const day = Number(entry && entry.day) || 0;
  const raw = entry && (typeof entry.text === 'string' ? entry.text : entry.zh);
  const base = { day, title: `第 ${day + 1} 日`, stats: null, items: [], quotes: [], coda: null, locked: false };
  if (typeof raw !== 'string' || !raw.trim()) return base;
  if (raw === PENDING) return Object.assign(base, { locked: true });
  const items = [];
  for (let line of raw.split('\n').map(s => s.trim()).filter(Boolean)) {
    const head = /^【(第 \d+ 日)】(.*)$/.exec(line);
    if (head) { base.title = head[1]; line = head[2].trim(); if (!line) continue; }
    if (/^源井出能/.test(line)) { base.stats = line.replace(/\d{5,}/g, n => compact(n)); continue; }
    const quote = /^是日，有人在(.+?)说：「([\s\S]*?)」?$/.exec(line);
    if (quote) { base.quotes.push({ place: quote[1], text: quote[2] }); continue; }
    const coda = /^史官曰：(.*)$/.exec(line);
    if (coda) { base.coda = coda[1]; continue; }
    const last = items[items.length - 1];
    if (last && last.text === line) last.count++; else items.push({ text: line, count: 1 });
  }
  base.items = items;
  return base;
}
module.exports = { parseChronicle };
