// 数字与时间的显示：一万以上用「万」，一亿以上用「亿」，保留一位小数并去掉多余的 .0。
function num(value) { const n = Number(value); return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—'; }
function compact(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const one = v => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
  if (abs >= 1e8) return one(n / 1e8) + '亿';
  if (abs >= 1e4) return one(n / 1e4) + '万';
  return num(n);
}
/** 完好度等以万分比存储（9220 → 92%）。 */
function pct(basis, digits = 0) { const n = Number(basis); return Number.isFinite(n) ? (n / 100).toFixed(digits) + '%' : '—'; }
function tickOfDay(tick, perDay) { return ((Number(tick) % perDay) + perDay) % perDay; }
function dayTick(day, tick, perDay = 12) { return `第 ${Number(day) + 1} 日 · 第 ${tickOfDay(tick, perDay) + 1} 刻`; }
function countdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '即将进入下一刻';
  const s = Math.ceil(ms / 1000), m = Math.floor(s / 60), r = s % 60;
  return m >= 60 ? `${Math.floor(m / 60)} 时 ${m % 60} 分` : `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
module.exports = { num, compact, pct, tickOfDay, dayTick, countdown };
