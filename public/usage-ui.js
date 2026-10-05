// 幕后的 token 用量：每位居民一块面板，外加跨居民的总览。
// 数据来自 GET /api/owner（agents[0].usage）与 GET /api/owner/usage，两者同形，都用造者密钥鉴权。
// 只有服务器托管运行的居民才有统计（tracked: true）；自托管运行器与 MCP 的模型调用服务器看不到。

import { h, clear } from './dom.js';
import { t, getLang } from './i18n.js';
import { api, errorText } from './api.js';
import { el, niceMax } from './charts.js';

const POLL_MS = 15000;
export const locale = () => (getLang() === 'en' ? 'en' : 'zh-CN');
export const num = (n) => (Number.isFinite(n) ? n.toLocaleString(locale()) : '–');
/** 纵轴刻度用的紧凑写法 */
const compact = (n) => (n >= 1e6 ? `${parseFloat((n / 1e6).toFixed(2))}M` : n >= 1e3 ? `${parseFloat((n / 1e3).toFixed(1))}K` : String(parseFloat(n.toFixed(1))));
export const stamp = (iso) => (iso ? new Date(iso).toLocaleString(locale()) : '–');
const inOut = (b) => `${t('usageInput')} ${num(b.input)} · ${t('usageOutput')} ${num(b.output)}`;
/** 同样的内容，但「标签 数字」不会在行尾被拆开 */
export const inOutNodes = (b) => [h('span', { class: 'nw' }, `${t('usageInput')} ${num(b.input)}`), ' · ', h('span', { class: 'nw' }, `${t('usageOutput')} ${num(b.output)}`)];
/** 失败与「接口没有报告用量」的次数：这两种调用不进 token 数，必须让人看得见，否则 0 token 会被误读成免费 */
export const oddNotes = (total) => [total.failed ? t('usageFailed', { n: total.failed }) : '', total.unreported ? t('usageUnreported', { n: total.unreported }) : ''].filter(Boolean);
/** 服务器给出的完整视图才画图：任何字段缺失（旧服务器、意外的响应）都当作没有数据 */
export const complete = (u) => !!(u && u.tracked === true && u.total && u.today && Array.isArray(u.days) && Array.isArray(u.recent));

export function tile(label, big, sub) {
  return h('div', { class: 'usage-tile' }, h('span', { class: 'usage-label' }, label), h('strong', { class: 'usage-big' }, big), sub ? h('span', { class: 'usage-sub' }, sub) : null);
}

/** 近 N 日每天的 token：输入在下、输出在上；每一天（含没有调用的日子）悬停都有读数 */
export function dayChart(days) {
  // 图按容器宽度等比缩放：手机上用更窄的画布，坐标轴的字才不会缩到看不清（下一次轮询时按当时的窗口宽度重画）
  const narrow = typeof innerWidth === 'number' && innerWidth <= 560;
  const W = narrow ? 300 : 560, H = narrow ? 132 : 124, M = { l: 46, r: 6, t: 8, b: 20 };
  const innerW = W - M.l - M.r, innerH = H - M.t - M.b;
  const max = niceMax(Math.max(0, ...days.map((d) => d.tokens)));
  const slot = innerW / days.length, bar = slot * 0.62;
  const svg = el('svg', { class: 'usage-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('usageChartLabel', { n: days.length }) });
  for (const f of [0, 0.5, 1]) {
    const y = M.t + innerH - innerH * f;
    svg.append(el('line', { class: 'grid', x1: M.l, y1: y, x2: W - M.r, y2: y }), el('text', { class: 'axis', x: M.l - 6, y: y + 3.5, 'text-anchor': 'end' }, compact(max * f)));
  }
  days.forEach((d, i) => {
    const x = M.l + slot * i + (slot - bar) / 2;
    const hIn = d.input > 0 ? Math.max(1, (d.input / max) * innerH) : 0;
    const hOut = d.output > 0 ? Math.max(1, (d.output / max) * innerH) : 0;
    const g = el('g', { class: 'usage-bar' });
    g.append(el('title', {}, `${d.day} · ${inOut(d)} · ${t('usageCalls')} ${num(d.calls)}`));
    g.append(el('rect', { class: 'hit', x: M.l + slot * i, y: M.t, width: slot, height: innerH }));
    if (hIn) g.append(el('rect', { class: 'in', x, y: M.t + innerH - hIn, width: bar, height: hIn }));
    if (hOut) g.append(el('rect', { class: 'out', x, y: M.t + innerH - hIn - hOut, width: bar, height: hOut }));
    svg.append(g);
  });
  for (const [i, anchor] of [[0, 'start'], [Math.floor((days.length - 1) / 2), 'middle'], [days.length - 1, 'end']]) {
    svg.append(el('text', { class: 'axis', x: anchor === 'start' ? M.l : anchor === 'end' ? W - M.r : M.l + slot * (i + 0.5), y: H - 6, 'text-anchor': anchor }, days[i].day.slice(5)));
  }
  return svg;
}

/** 一次调用的一行：时间、用量（或失败原因）、用时、模型；第二前提的调用还有第几轮、是不是被叫醒的 */
function callLine(c) {
  const what = !c.ok ? (c.status ? t('usageCallFailedHttp', { status: c.status }) : t('usageCallFailed')) : c.reported ? inOut(c) : t('usageCallUnreported');
  const w = c.waking;
  return h('li', null, h('span', { class: 'muted' }, `${new Date(c.at).toLocaleTimeString(locale())} · `), what,
    Number.isFinite(c.ms) ? h('span', { class: 'muted' }, ` · ${(c.ms / 1000).toFixed(1)} s`) : null, c.model ? h('span', { class: 'muted' }, ` · ${c.model}`) : null,
    w ? h('span', { class: 'muted' }, ` · ${t('usageTurn', { n: w.turn })}${w.kind === 'wake' ? ` · ${t('usageWoken')}` : ''}`) : null);
}

/**
 * 最近的调用，新的在前。第二前提的调用带 waking.tick：同一刻的几次调用归在一起（一次醒来是好几轮调用），
 * 其他世界的调用没有，仍是平的列表。
 */
export function recentList(recent) {
  const items = recent.slice().reverse();
  if (!items.some((c) => c.waking)) return h('ul', { class: 'plain usage-recent' }, items.map(callLine));
  const groups = [];
  for (const c of items) {
    const tick = c.waking ? c.waking.tick : null;
    const last = groups[groups.length - 1];
    if (last && last.tick === tick) last.calls.push(c);
    else groups.push({ tick, calls: [c] });
  }
  return h('ul', { class: 'plain usage-recent' }, groups.map((g) => (g.tick === null
    ? g.calls.map(callLine)
    : h('li', { class: 'usage-tick' }, h('span', { class: 'muted' }, t('usageTick', { n: g.tick })), h('ul', { class: 'plain' }, g.calls.map(callLine))))));
}

function usageBody(u) {
  const { total, today } = u;
  const ok = total.calls - total.failed - total.unreported; // 接口报告了用量的调用次数
  const root = h('div', { class: 'usage-content' }, h('div', { class: 'usage-tiles' },
    tile(t('usageToday'), num(today.tokens), inOutNodes(today)),
    tile(t('usageTotal'), num(total.tokens), inOutNodes(total)),
    tile(t('usageCalls'), num(total.calls), oddNotes(total).join(' · ')),
    tile(t('usageAvg'), ok > 0 ? num(Math.round(total.tokens / ok)) : '–', t('usageTodayCalls', { n: today.calls }))));
  if (total.calls === 0) return [root, h('p', { class: 'empty' }, t('usageNoCalls'))];
  // 接口没有报告用量时（例如演示模型）一个 token 也没有，画一张全空的图没有意义
  if (u.days.some((d) => d.tokens > 0)) {
    root.append(h('h5', { class: 'usage-chart-title' }, t('usageChartTitle', { n: u.days.length })), dayChart(u.days),
      h('p', { class: 'usage-legend muted' }, h('span', { class: 'swatch in' }), t('usageInput'), ' ', h('span', { class: 'swatch out' }), t('usageOutput')));
  }
  if (u.recent.length) root.append(h('details', null, h('summary', null, `${t('usageRecent')} (${u.recent.length})`), recentList(u.recent)));
  root.append(h('p', { class: 'muted usage-note' }, t('usageSince', { date: new Date(u.since).toLocaleDateString(locale()), tz: u.timezone }), ' ', t('usageNote')));
  return [root];
}

/**
 * 一位居民的用量面板。initial：GET /api/owner 里的 agents[0].usage（没有就先显示「没有数据」，等刷新）。
 * 面板每 POLL_MS 毫秒向 /api/owner/usage 拉一次，面板离开页面之后自行停止。
 */
export function usagePanel(key, initial) {
  const refresh = h('button', { class: 'btn small ghost', type: 'button' }, t('refresh'));
  const body = h('div', { class: 'usage-body' });
  const root = h('section', { class: 'usage-panel' }, h('div', { class: 'usage-head' }, h('h4', null, t('usageTitle')), refresh), body);
  let busy = false;
  const show = (u, failure = '') => {
    clear(body);
    if (failure) body.append(h('p', { class: 'error', role: 'alert' }, failure));
    if (complete(u)) body.append(...usageBody(u));
    else if (u && u.tracked === false) body.append(h('p', { class: 'entry-note' }, t('usageNotTracked')));
    else if (!failure) body.append(h('p', { class: 'empty' }, t('loadFailed')));
  };
  let last = initial;
  const load = async () => {
    if (busy) return;
    busy = true; refresh.disabled = true;
    const r = await api('/api/owner/usage', { key });
    busy = false; refresh.disabled = false;
    if (r.ok) { last = r.json; show(last); }
    else show(last, r.status === 401 || r.status === 403 ? t('invalidKey') : r.status === 0 ? t('networkError') : errorText(r, t('loadFailed')));
  };
  refresh.addEventListener('click', load);
  show(initial);
  const timer = setInterval(() => {
    if (!root.isConnected) { clearInterval(timer); return; }
    if (!document.hidden) load();
  }, POLL_MS);
  if (typeof timer === 'object' && timer.unref) timer.unref(); // 浏览器里是数字；在 Node 的测试里不让它拖住进程
  return root;
}

/**
 * 跨居民的总览：entries 是本浏览器保存的造者密钥（{ key, agentId?, name? }）。每把密钥各查一次，逐行填入。
 * onOpen(key)：点「查看」时回到这位居民的幕后页。
 */
export function usageOverview(entries, { onOpen }) {
  const total = { today: 0, tokens: 0, calls: 0, rows: 0 };
  const sum = h('tr', { class: 'usage-sum', hidden: true });
  const rows = entries.map((entry) => h('tr', null, h('td', { colspan: 6, class: 'muted' }, `${entry.name ? `${entry.name} · ` : ''}${entry.agentId || ''} …`)));
  const root = h('section', { class: 'usage-overview' }, h('h3', null, t('usageOverview')), h('p', { class: 'muted' }, t('usageOverviewHelp')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'tbl usage-table' },
      h('thead', null, h('tr', null, [t('usageColAgent'), t('usageColToday'), t('usageColTotal'), t('usageColCalls'), t('usageColLast'), ''].map((c, i) => h('th', { class: i >= 1 && i <= 3 ? 'num' : i === 4 ? 'last' : null }, c)))),
      h('tbody', null, rows, sum))));
  const open = (entry, who) => {
    const b = h('button', { class: 'btn small', type: 'button', 'aria-label': `${t('usageOpen')} ${who}`.trim() }, t('usageOpen'));
    b.addEventListener('click', () => onOpen(entry.key));
    return b;
  };
  const fill = (i, entry, r) => {
    const u = r.json;
    const who = `${(u && u.name) || entry.name || entry.agentId || ''}${(u && u.agentId) || entry.agentId ? ` · ${(u && u.agentId) || entry.agentId}` : ''}`;
    const row = rows[i];
    clear(row);
    if (r.ok && complete(u)) {
      const last = u.recent.length ? stamp(u.recent[u.recent.length - 1].at) : t('usageNever');
      row.append(h('td', null, who), h('td', { class: 'num' }, num(u.today.tokens)), h('td', { class: 'num' }, num(u.total.tokens)), h('td', { class: 'num' }, num(u.total.calls), oddNotes(u.total).map((note) => h('div', { class: 'usage-sub' }, note))), h('td', { class: 'last' }, last), h('td', null, open(entry, who)));
      total.today += u.today.tokens; total.tokens += u.total.tokens; total.calls += u.total.calls; total.rows++;
    } else {
      const why = r.ok && u && u.tracked === false ? t('usageNotManaged') : r.status === 401 || r.status === 403 ? t('usageKeyInvalid') : r.status === 0 ? t('networkError') : t('loadFailed');
      row.append(h('td', null, who), h('td', { colspan: 4, class: 'muted' }, why), h('td', null, r.ok || r.status !== 401 ? open(entry, who) : null));
    }
    if (total.rows > 1) {
      clear(sum); sum.hidden = false;
      sum.append(h('td', null, t('usageSum')), h('td', { class: 'num' }, num(total.today)), h('td', { class: 'num' }, num(total.tokens)), h('td', { class: 'num' }, num(total.calls)), h('td', { class: 'last' }), h('td', null));
    }
  };
  entries.forEach(async (entry, i) => fill(i, entry, await api('/api/owner/usage', { key: entry.key })));
  return root;
}
