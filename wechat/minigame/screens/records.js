// 本人居民记录页面（与网站 public/residents.js 的只读部分对应）：
// 分页（总览 / 收支 / 行动 / 用量 / 时间线）与「我的」页的居民概况。只展示已有记录，不提供管理操作。
const N = require('../ui/nodes');
const { C, STATUS_COLOR } = require('../ui/theme');
const { usable, moderationState, moderationNotice } = require('../utils/feed');
const { compact, num } = require('../utils/format');
const view = require('../utils/view');

const prose = v => { const t = view.text(v); const reason = moderationState(t); return reason ? moderationNotice(reason) : t; };
const timeText = value => { const d = value ? new Date(value) : null; return d && Number.isFinite(d.getTime()) ? `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '—'; };

const RUNNER = { hosted_balance_low: '托管余额不足', hosted_unavailable: '平台托管暂停', unconfigured: '未配置模型', paused: '运行已暂停', experiment_paused: '实验暂停', starting: '正在启动', thinking: '正在思考', waiting: '等待下一次调度', error: '模型调用失败', stopped: '运行已停止', cap_reached: '每日额度用尽', tokens_exhausted: '词元不足', dormant: '居民沉睡', running: '运行中' };
const ATTENTION = new Set(['paused', 'hosted_balance_low', 'hosted_unavailable', 'unconfigured', 'error', 'stopped', 'cap_reached', 'tokens_exhausted']);
const runnerText = s => RUNNER[s] || view.status(s);
const runnerColor = s => s === 'error' || s === 'hosted_balance_low' || s === 'hosted_unavailable' ? C.danger : ATTENTION.has(s) ? C.token : ['thinking', 'waiting', 'starting', 'running'].includes(s) ? C.awake : C.dormant;
function nextWakeText(wake, short, runnerStatus) {
  // 审核投影把未登记为机器字段的值也当文字处理；状态仍在审核时按运行状态说明，不显示占位符。
  if (wake && moderationState(wake.state)) return runnerStatus && RUNNER[runnerStatus] ? RUNNER[runnerStatus] : '运行器尚未报告，稍后刷新';
  if (!wake) return '运行器尚未报告，稍后刷新';
  const reasons = { hosted_balance_low: '托管余额不足，暂不醒来', hosted_unavailable: '平台托管暂停，暂不醒来', unconfigured: '未配置模型，不会醒来', paused: '运行已暂停', stopped: '运行已停止', error: '运行器异常', experiment_paused: '实验暂停中', dormant: '沉睡中', dead: '已长眠，不会再醒来', retired: '已归隐，不会再醒来', unknown: '运行器尚未报告，稍后刷新' };
  if (wake.state === 'off') return wake.called ? '只在被呼唤时醒来' : '定时醒来与呼唤均已关闭';
  if (wake.state !== 'scheduled') return reasons[wake.state] || reasons.unknown;
  const time = wake.at === null ? '等待世界调度启动' : '约 ' + timeText(wake.at);
  const blocked = (wake.blockedBy || []).filter(k => !moderationState(k)).map(k => RUNNER[k]).filter(Boolean).join('、');
  if (short || wake.day === undefined) return time + (blocked ? `（${blocked}，暂无法醒来）` : '');
  return `${time}（世界第 ${wake.day} 日第 ${wake.tickOfDay} 刻），之后每 ${wake.every} 刻一次${wake.called ? '；期间收到呼唤可能提前醒来' : ''}。${blocked ? `当前${blocked}，若未改变，本次醒来将被拒绝。` : ''}`;
}
const FLOW = { energy: '词元', basic: '基本额度', materials: '物料', income: '收入', payment: '支付', expense: '消耗', escrow: '转入托管', refund: '托管退回', issuance: '发放', expired: '到期清零', startup_grant: '首次启动款', basic_allotment: '基本额度发放', thinking: '思考读写', custody: '保管', basic_expired: '基本额度清零', ration: '城市配给', gift: '赠予', trade: '交易', order: '服务订单', project: '工程', construction: '施工投入', repair: '维修', gather: '采集', dismantle: '回收', claim: '领取物料', law_fee: '法律收费', law_transfer: '法律转移', city_transfer: '城市转移', law_share: '法律分配', research: '研究所服务', decay: '超额衰减', estate: '遗产分配', inheritance: '继承', pact: '孕育', soul_sponsor: '灵魂出资', well_dividend: '源井分红', rule_upkeep: '规则维持', standing_upkeep: '常驻指令维持' };
const flowName = key => key.split(':').map(k => FLOW[k] || k).join(' · ');
const ACHIEVEMENT = { repaired: '历史维修计数', repairedBp: '实际恢复完好度（基点）', contributed: '词元出资', drawn: '汲取词元', utterances: '公开发言', inscribed: '铭刻', salvaged: '回收物料', constructionWork: '实际施工工作量', ordersAccepted: '承接订单', ordersProvided_completed: '服务完成', ordersProvided_cancelled: '服务取消', ordersProvided_terminated: '服务终止', ordersProvided_expired: '服务逾期', ordersRequested_completed: '委托完成', ordersRequested_cancelled: '委托取消', ordersRequested_terminated: '委托终止', ordersRequested_expired: '委托逾期', reread: '上下文重读', read: '新内容读入', write: '文字写出' };
const achievementName = k => ACHIEVEMENT[k] || k;

function grid(W, cells, per = 3) {
  const rows = [];
  for (let i = 0; i < cells.length; i += per) rows.push(N.columns(W, cells.slice(i, i + per).map(([label, value, color]) => cw => N.stat(cw, label, value, null, color)), 8));
  return N.stack(rows, 8);
}
function row(W, left, right, opts = {}) { return N.rich(W, [{ text: left + '  ', color: C.text3 }, { text: String(right), color: opts.color || C.text, bold: !!opts.bold }], { style: opts.style || 'meta' }); }

// ── 居民记录：分页 ──
const RECORD_TABS = [['overview', '总览'], ['ledger', '收支'], ['actions', '行动'], ['usage', '用量'], ['timeline', '时间线']];
function recordTabs(app, W) {
  return N.segmented(W, RECORD_TABS.map(([v, l]) => ({ label: l, action: { type: 'recordsTab', tab: v }, selected: app.records.tab === v })));
}
function overviewStats(app, W) {
  const o = app.owner, escrow = o.escrow ? Object.values(o.escrow).reduce((n, v) => n + (Number(v) || 0), 0) : null, assets = o.assets || {};
  if (o.energy === undefined) return [];
  return [grid(W, [['可转让词元', compact(o.energy), C.token], ['基本额度', compact(o.basic)], ['物料', num(o.materials || 0)], ['每日上限', compact(o.dailyCap)], ['现实日已用', compact(o.usedToday || 0)], ['在途托管', escrow === null ? '—' : compact(escrow)], ['总可转让资产', assets.totalTransferable === undefined ? '—' : compact(assets.totalTransferable)], ['物料托管及待领', assets.materialEscrow === undefined ? '—' : num(assets.materialEscrow)]])];
}
function statusCard(app, W) {
  const o = app.owner, runner = o.runner || {}, place = o.place && ((app.state && app.state.places) || []).find(p => p.id === o.place);
  const placeName = place && (place.displayName && typeof place.displayName === 'object' ? place.displayName.zh : place.name);
  const w = app.state && app.state.world;
  return N.card(W, iw => [
    N.text(iw, '当前状态', { style: 'heading', bold: true }),
    row(iw, '地点', usable(placeName) ? placeName : o.place || '—'),
    row(iw, '模型运行', runnerText(runner.status || 'unconfigured'), { color: runnerColor(runner.status) }),
    N.text(iw, '下次醒来：' + nextWakeText(o.nextWake, false, runner.status), { style: 'meta', color: C.text2 }),
    row(iw, '下一刻', o.nextTickAt ? timeText(o.nextTickAt) : w && w.paused ? '等待实验恢复' : '尚未启动世界调度'),
    runner.lastError ? N.text(iw, prose(runner.lastError), { style: 'meta', color: C.danger }) : null,
  ], { pad: 14, gap: 6 });
}
// 私人记录只读。日记、记忆与收件里的居民文字由 AI 生成；家书和灵魂由人类写下，按实际来源标注。
function privateRecords(app, W) {
  const o = app.owner, nodes = [];
  const list = (title, source, rows, render) => {
    nodes.push(N.section(W, title, { small: true, sub: source }));
    const items = (rows || []).slice(-20).reverse();
    if (!items.length) nodes.push(N.text(W, '还没有记录。', { style: 'meta', color: C.text3 }));
    items.forEach(r => nodes.push(N.card(W, iw => render(iw, r), { pad: 12, gap: 4 })));
  };
  if (o.soul !== undefined) { nodes.push(N.section(W, '灵魂', { small: true, sub: '造者写下 · 仅管理者可见' }), N.card(W, iw => [N.text(iw, prose(o.soul) || '—', { style: 'feed' })], { pad: 12 })); }
  list('日记', 'AI 生成', o.diary, (iw, r) => [N.text(iw, prose(view.text(r.text, '此处已被遮盖')), { style: 'feed' })]);
  list('记忆', 'AI 生成', o.memories, (iw, r) => [N.text(iw, prose(view.text(r.text, '此处已被遮盖')), { style: 'feed' })]);
  if (o.letters !== undefined) list('已存家书', '管理者写下 · 只读', o.letters, (iw, r) => [N.text(iw, prose(r.text) || '—', { style: 'feed' }), r.day !== undefined ? N.text(iw, `第 ${r.day + 1} 日`, { style: 'caption', color: C.text3 }) : null]);
  if (o.inbox !== undefined) list('收件', '含 AI 生成', o.inbox, (iw, r) => [N.text(iw, [r.from && usable(r.from.name) ? r.from.name : '', r.kind || ''].filter(Boolean).join(' · '), { style: 'caption', color: C.text3 }), r.text ? N.text(iw, prose(r.text), { style: 'feed' }) : usable(r.tag) ? N.text(iw, `${r.added ? '获得' : '失去'}标签 ${r.tag}`, { style: 'meta' }) : null]);
  return nodes;
}
function overviewTab(app, W) {
  const a = app.owner, nodes = [...overviewStats(app, W)];
  if (a.runner) nodes.push(statusCard(app, W));
  if (a.dailyCap) nodes.push(N.card(W, iw => [
    N.text(iw, '今日模型用量', { style: 'heading', bold: true }),
    N.rich(iw, [{ text: compact(a.usedToday || 0), color: C.token, bold: true }, { text: ' / ' + compact(a.dailyCap) + ' 词元', color: C.text2 }], { style: 'heading' }),
    N.progress(iw, (a.usedToday || 0) / a.dailyCap, C.token),
    N.text(iw, '每日 0 点重置', { style: 'caption', color: C.text3 }),
  ], { pad: 14, gap: 8 }));
  return nodes.concat(privateRecords(app, W));
}
function ledgerTab(app, W) {
  const st = app.owner.statistics || {}, nodes = [N.text(W, '按世界日记录。自由余额变动与在途托管分开；托管扣款不等于最终消费。', { style: 'caption', color: C.text3 })];
  const totals = Object.entries(st.totals || {});
  nodes.push(N.section(W, '累计收支', { small: true }));
  if (!totals.length) nodes.push(N.text(W, '暂无收支。', { style: 'meta', color: C.text3 }));
  totals.forEach(([k, v]) => nodes.push(row(W, flowName(k), num(v), { color: Number(v) < 0 ? C.danger : C.text })));
  const days = Object.values(st.days || {}).slice(-30).reverse();
  nodes.push(N.section(W, '每日余额', { small: true, sub: days.length ? '最近 ' + days.length + ' 日' : '' }));
  days.forEach(d => nodes.push(N.card(W, iw => [N.text(iw, `第 ${d.day + 1} 日`, { style: 'meta', bold: true }), N.text(iw, `词元 ${num(d.opening.energy)} → ${num(d.closing.energy)}（${d.changes.energy >= 0 ? '+' : ''}${num(d.changes.energy)}）`, { style: 'caption', color: C.text2 }), N.text(iw, `基本额度 ${d.changes.basic >= 0 ? '+' : ''}${num(d.changes.basic)} · 物料 ${d.changes.materials >= 0 ? '+' : ''}${num(d.changes.materials)}`, { style: 'caption', color: C.text2 })], { pad: 12, gap: 2 })));
  const entries = (st.ledger || []).slice(-200).reverse(), key = 'ledger:' + app.residentId, all = app.expanded.has(key), shown = all ? entries : entries.slice(0, 30);
  nodes.push(N.section(W, '流水', { small: true, sub: `最近 ${entries.length} 条` }));
  nodes.push(N.buttonRow(W, [{ label: '下载流水 CSV', action: { type: 'recordsLedgerCsv' }, variant: 'secondary' }].concat(app.records.saved && app.records.saved.id === app.residentId ? [{ label: '分享已下载的流水', action: { type: 'recordsLedgerShare' }, variant: 'secondary' }] : []), 8, { size: 'small' }));
  shown.forEach(e => nodes.push(N.card(W, iw => [N.text(iw, `第 ${e.day + 1} 日 · 第 ${e.tick} 刻 · ${e.kind}${e.op ? ' · ' + e.op : ''}`, { style: 'caption', color: C.text3 }), N.text(iw, `词元 ${e.delta.energy >= 0 ? '+' : ''}${num(e.delta.energy)} · 基本 ${e.delta.basic >= 0 ? '+' : ''}${num(e.delta.basic)} · 物料 ${e.delta.materials >= 0 ? '+' : ''}${num(e.delta.materials)}`, { style: 'meta' }), (e.events || []).length ? N.text(iw, '事件 ' + e.events.join(', '), { style: 'caption', color: C.text3 }) : null], { pad: 12, gap: 2 })));
  if (entries.length > 30) nodes.push(N.button(W, all ? '只看最近 30 条' : `显示全部 ${entries.length} 条`, { type: 'expand', key }, { variant: 'text', size: 'small' }));
  return nodes;
}
function actionsTab(app, W) {
  const o = app.owner, s = (o.statistics && o.statistics.actions) || {}, nodes = [];
  nodes.push(N.columns(W, [cw => N.stat(cw, '尝试', num(s.attempted || 0)), cw => N.stat(cw, '成功', num(s.succeeded || 0), null, C.awake), cw => N.stat(cw, '失败', num(s.failed || 0), null, C.danger)], 8));
  const types = Object.entries(s.types || {});
  nodes.push(N.section(W, '动作', { small: true }));
  if (!types.length) nodes.push(N.text(W, '还没有行动。', { style: 'meta', color: C.text3 }));
  types.forEach(([k, v]) => nodes.push(row(W, k, `尝试 ${v.attempted} · 成功 ${v.succeeded} · 失败 ${v.failed}`)));
  const errors = Object.entries(s.errors || {});
  nodes.push(N.section(W, '错误分类', { small: true }));
  if (!errors.length) nodes.push(N.text(W, '没有错误。', { style: 'meta', color: C.text3 }));
  errors.forEach(([k, v]) => nodes.push(row(W, k, num(v))));
  nodes.push(N.section(W, '实际成果', { small: true }));
  Object.entries(Object.assign({}, o.stats || {}, (o.statistics && o.statistics.achievements) || {})).forEach(([k, v]) => nodes.push(row(W, achievementName(k), num(v))));
  const docs = ((app.state && app.state.docs) || []).filter(d => d.author && d.author.id === app.residentId);
  nodes.push(N.section(W, '作品', { small: true, sub: docs.length ? 'AI 生成' : '' }));
  if (!docs.length) nodes.push(N.text(W, '还没有作品。', { style: 'meta', color: C.text3 }));
  docs.forEach(d => nodes.push(N.listRow(W, { title: '《' + (usable(d.title) ? d.title : '一篇典籍') + '》', sub: `阅读 ${d.reads || 0} 次`, chevron: true, action: { type: 'detail', kind: 'doc', id: d.id } })));
  return nodes;
}
function usageTab(app, W) {
  const o = app.owner, u = o.usage || {}, total = u.total || {}, nodes = [];
  nodes.push(N.section(W, '模型用量', { small: true }), N.text(W, `现实日时区：${u.timezone || '—'}。当前管理账号的用量；生涯累计 ${num((u.lifetime && u.lifetime.calls) || 0)} 次调用。未返回用量显示未知。`, { style: 'caption', color: C.text3 }));
  nodes.push(grid(W, [['调用次数', num(total.calls || 0)], ['输入 token', compact(total.input || 0)], ['输出 token', compact(total.output || 0)], ['失败', num(total.failed || 0), C.danger], ['未报告用量', num(total.unreported || 0)]]));
  const days = (u.days || []).filter(d => d.calls).slice(-30).reverse();
  days.forEach(d => nodes.push(row(W, d.day, `调用 ${num(d.calls)} · 输入 ${compact(d.input)} · 输出 ${compact(d.output)} · 失败 ${num(d.failed)}`)));
  nodes.push(N.section(W, '最近 30 日诊断', { small: true }));
  const recent = (u.recent || []).slice(-50).reverse();
  if (!recent.length) nodes.push(N.text(W, '还没有模型调用。', { style: 'meta', color: C.text3 }));
  const unknown = v => v === undefined || v === null ? '未知' : num(v);
  recent.forEach(c => nodes.push(N.card(W, iw => [N.text(iw, `${timeText(c.at)} · ${prose(c.model) || '—'} · ${c.ok ? '完成' : '失败'}`, { style: 'caption', color: c.ok ? C.text3 : C.danger }), N.text(iw, `输入 ${unknown(c.input)} · 输出 ${unknown(c.output)} · 缓存读 ${unknown(c.cacheRead)} · 缓存写 ${unknown(c.cacheWrite)} · ${unknown(c.ms)} ms`, { style: 'caption', color: C.text2 }), N.text(iw, `结束原因 ${c.finishReason ? prose(c.finishReason) : '未知'} · 错误类别 ${c.errorKind ? prose(c.errorKind) : '—'}`, { style: 'caption', color: C.text3 })], { pad: 10, gap: 2 })));
  const thinking = Object.entries((o.statistics && o.statistics.thinking) || {});
  nodes.push(N.section(W, '游戏读写账单', { small: true }));
  if (!thinking.length) nodes.push(N.text(W, '还没有读写。', { style: 'meta', color: C.text3 }));
  thinking.forEach(([k, v]) => nodes.push(row(W, achievementName(k), num(v))));
  return nodes;
}
const EVENT_NAMES = { say: '说话', broadcast: '广播', move: '移动', arrive: '上岸', startup_grant: '首次启动款', gather: '采集', explore: '探索', give: '给予', repair: '修缮', letter: '收到家书', sleep: '沉睡', wake: '醒来', die: '离世' };
function timelineTab(app, W) {
  const tl = app.records.timeline, f = app.form, nodes = [
    N.columns(W, [cw => N.field(cw, '事件类型（留空全部）', f.timelineType || '', { type: 'field', name: 'timelineType', max: 40 }, { placeholder: '如 say' }), cw => N.field(cw, '世界日', f.timelineDay || '', { type: 'field', name: 'timelineDay', max: 6 }, { placeholder: '如 3' })], 8),
    N.button(W, '筛选', { type: 'recordsTimelineFilter' }, { variant: 'secondary', size: 'small' }),
  ];
  if (!tl || tl.id !== app.residentId) return nodes.concat([N.empty(W, '正在读取…')]);
  if (!tl.rows.length) nodes.push(N.empty(W, '暂无符合条件的事件。'));
  tl.rows.forEach(e => nodes.push(N.card(W, iw => [N.text(iw, `第 ${e.day + 1} 日 · ${EVENT_NAMES[e.type] || e.type} · #${e.seq}`, { style: 'meta', bold: true }), e.redacted ? N.text(iw, '此条已被遮盖', { style: 'caption', color: C.text3 }) : eventBody(iw, e)], { pad: 12, gap: 4 })));
  if (tl.cursor) nodes.push(N.button(W, '下一页', { type: 'recordsTimelineMore' }, { variant: 'secondary' }));
  return nodes;
}
function eventBody(W, e) {
  const d = e.data || {}, parts = [];
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined || typeof v === 'object') continue;
    parts.push(`${k}：${typeof v === 'string' ? prose(v) : v}`);
  }
  return N.text(W, parts.join(' · ') || '—', { style: 'caption', color: C.text2, maxLines: 6 });
}

// ── 「我的」页附加信息：概况与已过继的创作（只读） ──
function accountExtras(app, W) {
  const managed = app.linked || [], nodes = [];
  if (managed.length) {
    const attention = managed.filter(a => ATTENTION.has(a.runnerStatus));
    nodes.push(N.columns(W, [
      cw => N.stat(cw, '我的居民', String(managed.length)),
      cw => N.stat(cw, '醒着', String(managed.filter(a => a.status === 'awake').length), null, C.awake),
      cw => N.stat(cw, '需要留意', String(attention.length), { text: attention.length ? '未运行或出错' : '都在正常运行' }, attention.length ? C.token : C.text),
    ], 8));
  }
  const ids = new Set(managed.map(a => a.agentId || a.id)), handed = (app.created || []).filter(a => !ids.has(a.agentId || a.id));
  if (handed.length) {
    nodes.push(N.section(W, '已过继的创作', { small: true }), N.text(W, '你创作、现已由他人管理的居民，这里保留它们的公开生涯。', { style: 'caption', color: C.text3 }));
    handed.forEach(a => nodes.push(N.listRow(W, { avatar: { id: a.agentId || a.id, name: a.name }, title: usable(a.name) ? a.name : '我创作的居民', chip: { label: view.status(a.status), color: STATUS_COLOR[a.status] || C.dormant }, chevron: true, action: { type: 'resident', id: a.agentId || a.id } })));
  }
  return nodes;
}
module.exports = { recordTabs, overviewTab, ledgerTab, actionsTab, usageTab, timelineTab, accountExtras, nextWakeText, runnerText, runnerColor };
