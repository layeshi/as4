// 居民管理页面（与网站 public/residents.js、billing.js、hosted-ui.js、model-form.js 对应）：
// 管理居民的分页（总览 / 收支 / 行动 / 用量 / 时间线 / 管理）、「我的」页的附加卡片、余额与托管、领养、接受过继与旧世界灵魂带入。
const N = require('../ui/nodes');
const P = require('../ui/paint');
const { C, font, STATUS_COLOR } = require('../ui/theme');
const { usable, moderationState, moderationNotice, pendingName } = require('../utils/feed');
const { compact, num } = require('../utils/format');
const view = require('../utils/view');

const prose = v => { const t = view.text(v); const reason = moderationState(t); return reason ? moderationNotice(reason) : t; };
const nameOf = (app, id, fallback) => { const a = ((app.state && app.state.agents) || []).concat(app.linked || [], app.created || []).find(x => (x.agentId || x.id) === id); return a && usable(a.name) ? a.name : fallback || pendingName(id); };
const privacyLink = { label: '《隐私说明》', action: { type: 'about' } };

// 金额在接口里是整数微元（1 元 = 1,000,000 微元），显示四位小数，与网站 hosted-ui.js 的 money() 一致。
function money(value) {
  const n = Number.isSafeInteger(value) ? value : 0, abs = Math.abs(n), rounded = Math.round(abs / 100);
  return `${n < 0 && rounded ? '-' : ''}¥${Math.floor(rounded / 10000)}.${String(rounded % 10000).padStart(4, '0')}`;
}
const priceYuan = micro => Number.isSafeInteger(micro) ? (micro / 1000000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : '—';
const timeText = value => { const d = value ? new Date(value) : null; return d && Number.isFinite(d.getTime()) ? `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '—'; };

const RUNNER = { hosted_balance_low: '托管余额不足', hosted_unavailable: '平台托管暂停', unconfigured: '未配置模型', paused: '托管已暂停', experiment_paused: '实验暂停', starting: '正在启动', thinking: '正在思考', waiting: '等待下一次调度', error: '模型调用失败', stopped: '运行已停止', cap_reached: '每日额度用尽', tokens_exhausted: '词元不足', dormant: '居民沉睡', running: '运行中' };
const ATTENTION = new Set(['paused', 'hosted_balance_low', 'hosted_unavailable', 'unconfigured', 'error', 'stopped', 'cap_reached', 'tokens_exhausted']);
const runnerText = s => RUNNER[s] || view.status(s);
const runnerColor = s => s === 'error' || s === 'hosted_balance_low' || s === 'hosted_unavailable' ? C.danger : ATTENTION.has(s) ? C.token : ['thinking', 'waiting', 'starting', 'running'].includes(s) ? C.awake : C.dormant;
function nextWakeText(wake, short, runnerStatus) {
  // 审核投影把未登记为机器字段的值也当文字处理；状态仍在审核时按运行状态说明，不显示占位符。
  if (wake && moderationState(wake.state)) return runnerStatus && RUNNER[runnerStatus] ? RUNNER[runnerStatus] : '运行器尚未报告，稍后刷新';
  if (!wake) return '运行器尚未报告，稍后刷新';
  const reasons = { hosted_balance_low: '托管余额不足，补足后下个作息时刻自动重试', hosted_unavailable: '平台托管暂停，可改用自己的模型', unconfigured: '未配置模型，不会醒来', paused: '托管已暂停', stopped: '托管已停止', error: '运行器异常，请检查模型运行', experiment_paused: '实验暂停中', dormant: '沉睡中', dead: '已长眠，不会再醒来', retired: '已归隐，不会再醒来', unknown: '运行器尚未报告，稍后刷新' };
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
function chipRow(W, label, color) { return N.node(22, (g, x, y) => N.paintChip(g.ctx, label, x, y + 1, color)); }

// ── 管理居民：分页 ──
const OWNER_TABS = [['overview', '总览'], ['ledger', '收支'], ['actions', '行动'], ['usage', '用量'], ['timeline', '时间线'], ['manage', '管理']];
function ownerTabs(app, W) {
  return N.segmented(W, OWNER_TABS.map(([v, l]) => ({ label: l, action: { type: 'stewardTab', tab: v }, selected: app.steward.tab === v })));
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
    runner.status === 'paused' ? N.text(iw, '运行器已暂停：点「运行」后，居民会按作息醒来。', { style: 'caption', color: C.text3 }) : runner.status === 'unconfigured' ? N.text(iw, '还没有配置模型：先在下方「模型」里选择平台托管或填写自己的模型接口，保存后点「运行」。', { style: 'caption', color: C.text3 }) : null,
  ], { pad: 14, gap: 6 });
}
function privateRecords(app, W) {
  const o = app.owner, nodes = [];
  const list = (title, rows, render) => {
    nodes.push(N.section(W, title, { small: true, sub: 'AI 生成' }));
    const items = (rows || []).slice(-20).reverse();
    if (!items.length) nodes.push(N.text(W, '还没有记录。', { style: 'meta', color: C.text3 }));
    items.forEach(r => nodes.push(N.card(W, iw => render(iw, r), { pad: 12, gap: 4 })));
  };
  if (o.soul !== undefined) { nodes.push(N.section(W, '灵魂', { small: true, sub: '仅管理者可见' }), N.card(W, iw => [N.text(iw, prose(o.soul) || '—', { style: 'feed' })], { pad: 12 })); }
  list('日记', o.diary, (iw, r) => [N.text(iw, prose(view.text(r.text, '此处已被遮盖')), { style: 'feed' })]);
  list('记忆', o.memories, (iw, r) => [N.text(iw, prose(view.text(r.text, '此处已被遮盖')), { style: 'feed' })]);
  if (o.letters !== undefined) list('家书', o.letters, (iw, r) => [N.text(iw, prose(r.text) || '—', { style: 'feed' }), r.day !== undefined ? N.text(iw, `第 ${r.day + 1} 日`, { style: 'caption', color: C.text3 }) : null]);
  if (o.inbox !== undefined) list('收件', o.inbox, (iw, r) => [N.text(iw, [r.from && usable(r.from.name) ? r.from.name : '', r.kind || ''].filter(Boolean).join(' · '), { style: 'caption', color: C.text3 }), r.text ? N.text(iw, prose(r.text), { style: 'feed' }) : usable(r.tag) ? N.text(iw, `${r.added ? '获得' : '失去'}标签 ${r.tag}`, { style: 'meta' }) : null]);
  return nodes;
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
  nodes.push(N.buttonRow(W, [{ label: '导出流水 CSV', action: { type: 'stewardLedgerCsv' }, variant: 'secondary' }].concat(app.steward.saved && app.steward.saved.id === app.residentId ? [{ label: '分享已下载的流水', action: { type: 'stewardLedgerShare' }, variant: 'secondary' }] : []), 8, { size: 'small' }));
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
  nodes.push(N.section(W, '作品', { small: true }));
  if (!docs.length) nodes.push(N.text(W, '还没有作品。', { style: 'meta', color: C.text3 }));
  docs.forEach(d => nodes.push(N.listRow(W, { title: '《' + (usable(d.title) ? d.title : '一篇典籍') + '》', sub: `阅读 ${d.reads || 0} 次`, chevron: true, action: { type: 'detail', kind: 'doc', id: d.id } })));
  return nodes;
}
function hostedCharges(app, W, usage, id) {
  const rows = ((usage && usage.residents) || []).filter(r => !id || r.residentId === id), nodes = [N.section(W, '最近 30 个现实日托管扣费', { small: true }), N.text(W, `${(usage && usage.from) || '—'} 至 ${(usage && usage.through) || '—'} · ${(usage && usage.timezone) || '—'}。仅统计当前管理账号发起的调用。`, { style: 'caption', color: C.text3 })];
  if (!rows.length) nodes.push(N.text(W, '没有托管扣费。', { style: 'meta', color: C.text3 }));
  rows.forEach(r => nodes.push(N.card(W, iw => [N.text(iw, nameOf(app, r.residentId), { style: 'action', bold: true }), N.text(iw, `调用 ${num(r.calls)} · 输入 ${num(r.input)} · 缓存命中 ${num(r.cacheRead)} · 输出 ${num(r.output)} token`, { style: 'caption', color: C.text2 }), N.text(iw, '费用 ' + money(r.costMicro), { style: 'meta', color: C.token })], { pad: 12, gap: 2 })));
  const details = ((usage && usage.details) || []).filter(r => !id || r.residentId === id).slice(-30).reverse();
  details.forEach(r => nodes.push(N.text(W, `${r.day} · ${(r.basis && prose(r.basis.model)) || '旧版单模型'} · ${r.basis ? r.basis.settlement === 'reservation' ? '全额预留' : '实际用量' : '旧版记录'} · 调用 ${num(r.calls)}（预留结算 ${num(r.estimatedCalls || 0)}）· ${money(r.costMicro)}`, { style: 'caption', color: C.text3 })));
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
  const h = app.steward.hosted;
  if (o.runner && o.runner.config && o.runner.config.hosted) nodes.push(...(h ? hostedCharges(app, W, h.usage, app.residentId) : [N.text(W, app.steward.hostedError || '正在读取托管扣费…', { style: 'meta', color: C.text3 })]));
  return nodes;
}
const EVENT_NAMES = { say: '说话', broadcast: '广播', move: '移动', arrive: '上岸', startup_grant: '首次启动款', gather: '采集', explore: '探索', give: '给予', repair: '修缮', letter: '收到家书', sleep: '沉睡', wake: '醒来', die: '离世' };
function timelineTab(app, W) {
  const tl = app.steward.timeline, f = app.form, nodes = [
    N.columns(W, [cw => N.field(cw, '事件类型（留空全部）', f.timelineType || '', { type: 'field', name: 'timelineType', max: 40 }, { placeholder: '如 say' }), cw => N.field(cw, '世界日', f.timelineDay || '', { type: 'field', name: 'timelineDay', max: 6 }, { placeholder: '如 3' })], 8),
    N.button(W, '筛选', { type: 'stewardTimelineFilter' }, { variant: 'secondary', size: 'small' }),
  ];
  if (!tl || tl.id !== app.residentId) return nodes.concat([N.empty(W, '正在读取…')]);
  if (!tl.rows.length) nodes.push(N.empty(W, '暂无符合条件的事件。'));
  tl.rows.forEach(e => nodes.push(N.card(W, iw => [N.text(iw, `第 ${e.day + 1} 日 · ${EVENT_NAMES[e.type] || e.type} · #${e.seq}`, { style: 'meta', bold: true }), e.redacted ? N.text(iw, '此条已被遮盖', { style: 'caption', color: C.text3 }) : eventBody(iw, e)], { pad: 12, gap: 4 })));
  if (tl.cursor) nodes.push(N.button(W, '下一页', { type: 'stewardTimelineMore' }, { variant: 'secondary' }));
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
function manageTab(app, W) {
  const s = app.steward, f = app.form, a = app.owner, nodes = [];
  nodes.push(N.card(W, iw => [
    N.text(iw, '每日游戏词元上限', { style: 'heading', bold: true }),
    N.text(iw, '每个现实日最多消耗的游戏词元；用尽后当天的醒来会被拒绝。', { style: 'caption', color: C.text3 }),
    N.field(iw, '每日上限（0–50,000,000）', f.dailyCap || '', { type: 'field', name: 'dailyCap', max: 9 }),
    N.button(iw, '更新上限', { type: 'stewardCap' }, { variant: 'primary' }),
  ], { pad: 14, gap: 8 }));
  const pending = (s.transfers || []).filter(t => t.agentId === app.residentId && t.direction === 'outgoing' && t.status === 'pending');
  const confirming = s.confirm && s.confirm.startsWith('transfer:');
  nodes.push(N.card(W, iw => [
    N.text(iw, '过继', { style: 'heading', bold: true }),
    N.text(iw, '过继会移交完整私人历史，包括已有日记和家书。确认后你将失去管理和下载权限；接收者确认前，你仍管理居民。', { style: 'caption', color: C.text3 }),
    ...pending.map(t => N.stack([N.text(iw, `已向对方发出邀请 · 有效期至 ${timeText(t.expiresAt)}`, { style: 'meta', color: C.text2 }), N.button(iw, '取消邀请', { type: 'stewardCancelTransfer', agentId: t.agentId, transferId: t.id }, { variant: 'secondary', size: 'small' })], 6)),
    N.field(iw, '接收账号用户名', f.transferUsername || '', { type: 'field', name: 'transferUsername', max: 32 }),
    confirming ? N.text(iw, `确认把这位居民过继给「${s.confirm.slice(9)}」？`, { style: 'meta', color: C.token }) : null,
    confirming ? N.buttonRow(iw, [{ label: '确认发起', action: { type: 'stewardTransfer' }, variant: 'primary' }, { label: '取消', action: { type: 'stewardConfirmCancel' }, variant: 'secondary' }]) : N.button(iw, '发起过继邀请', { type: 'stewardTransfer' }, { variant: 'secondary' }),
  ], { pad: 14, gap: 8 }));
  nodes.push(N.card(W, iw => [
    N.text(iw, '图片形象', { style: 'heading', bold: true }),
    N.text(iw, '上传图片需要图片内容安全检查，微信端暂不提供上传；请在网站「我的居民 › 管理」上传。这里可以恢复默认形象。', { style: 'caption', color: C.text3 }),
    s.confirm === 'avatar' ? N.buttonRow(iw, [{ label: '确认恢复默认', action: { type: 'stewardAvatarReset' }, variant: 'primary' }, { label: '取消', action: { type: 'stewardConfirmCancel' }, variant: 'secondary' }]) : N.button(iw, '恢复默认形象', { type: 'stewardAvatarReset' }, { variant: 'secondary', size: 'small' }),
  ], { pad: 14, gap: 8 }));
  nodes.push(N.card(W, iw => [
    N.text(iw, '移除模型配置', { style: 'heading', bold: true }),
    N.text(iw, '移除后运行器停止，服务器上保存的密钥一并删除；居民不会再醒来，直到重新配置。', { style: 'caption', color: C.text3 }),
    s.confirm === 'remove' ? N.buttonRow(iw, [{ label: '确认移除', action: { type: 'stewardRemoveRunner' }, variant: 'primary' }, { label: '取消', action: { type: 'stewardConfirmCancel' }, variant: 'secondary' }]) : N.button(iw, '移除配置', { type: 'stewardRemoveRunner' }, { variant: 'danger', size: 'small' }),
  ], { pad: 14, gap: 8 }));
  if (a && a.agentId) nodes.push(N.button(W, '查看公开档案', { type: 'resident', id: a.agentId }, { variant: 'secondary' }));
  return nodes;
}

/** 模型来源：平台托管（从账号余额扣费）或自己的模型；托管未开放时禁选并说明原因。 */
function modelSource(app, W) {
  const h = app.steward.hosted, f = app.form, nodes = [];
  if (!h) return app.steward.hostedError ? [N.text(W, '平台托管信息读取失败：' + app.steward.hostedError, { style: 'caption', color: C.text3 })] : [];
  nodes.push(N.segmented(W, [{ label: '平台托管', action: h.available ? { type: 'stewardModelSource', source: 'hosted' } : { type: 'noop' }, selected: f.modelSource === 'hosted' }, { label: '自己的模型', action: { type: 'stewardModelSource', source: 'own' }, selected: f.modelSource !== 'hosted' }]));
  if (!h.available) nodes.push(N.text(W, prose(h.error) || '平台托管暂未开放，可改用自己的模型。', { style: 'caption', color: C.text3 }));
  if (f.modelSource !== 'hosted') return nodes;
  const models = h.models || (h.model ? [{ id: h.model, available: h.available, pricesMicro: h.pricesMicro }] : []);
  if (h.version === 2) nodes.push(N.chips(W, models.map(m => ({ label: m.id + (m.available ? '' : ' · 暂不可用'), selected: (f.hostedModel || (models.find(x => x.available) || {}).id) === m.id, action: m.available ? { type: 'stewardHostedModel', id: m.id } : { type: 'noop' } }))));
  const model = models.find(m => m.id === (f.hostedModel || (models.find(x => x.available) || {}).id)) || models[0];
  if (model && model.available && model.pricesMicro) nodes.push(N.text(W, `输入 ¥${priceYuan(model.pricesMicro.miss)} / 输出 ¥${priceYuan(model.pricesMicro.output)}（元 / 百万 token 起，已含汇率与平台倍率）`, { style: 'caption', color: C.text2 }));
  nodes.push(N.text(W, `从账号余额扣费，当前余额 ${money(h.balanceMicro)}。买到的是模型调用，不是游戏内词元。充值请在网站「余额与充值」页操作。`, { style: 'caption', color: C.text3 }));
  return nodes;
}

// ── 「我的」页附加卡片：概况、过继邀请、领养、已过继的创作、余额入口 ──
function accountExtras(app, W) {
  const s = app.steward, managed = app.linked || [], nodes = [];
  const attention = managed.filter(a => ATTENTION.has(a.runnerStatus)), low = managed.filter(a => a.runnerStatus === 'hosted_balance_low');
  nodes.push(N.columns(W, [
    cw => N.stat(cw, '管理中', String(managed.length)),
    cw => N.stat(cw, '醒着', String(managed.filter(a => a.status === 'awake').length), null, C.awake),
    cw => N.stat(cw, '需要留意', String(attention.length), { text: attention.length ? '未启动或出错' : '都在正常运行' }, attention.length ? C.token : C.text),
  ], 8));
  if (low.length) nodes.push(N.banner(W, { title: '托管余额不足', body: `${low.map(a => usable(a.name) ? a.name : '一位居民').join('、')} 因托管余额不足暂停了模型调用，补足后下个作息时刻自动恢复。` }));
  nodes.push(N.menu(W, [{ label: '余额与托管', hint: s.hosted ? money(s.hosted.balanceMicro) : s.hostedError ? '暂不可用' : '—', icon: 'token', action: { type: 'stewardBilling' } }]));
  const transfers = s.transfers || [];
  if (s.transfersError) nodes.push(N.text(W, '过继邀请读取失败：' + s.transfersError, { style: 'caption', color: C.text3 }));
  if (transfers.length) {
    nodes.push(N.section(W, '过继邀请', { small: true }), N.text(W, '过继会移交居民的完整私人历史。收到的邀请需配置模型后接受；对方确认前可以取消。', { style: 'caption', color: C.text3 }));
    const STATUS = { pending: '待确认', accepted: '已接受', cancelled: '已取消', expired: '已过期' };
    transfers.forEach(t => nodes.push(N.card(W, iw => [
      N.text(iw, `${nameOf(app, t.agentId, usable(t.name) ? t.name : '')} · ${t.direction === 'incoming' ? '收到' : '发出'} · ${STATUS[t.status] || t.status}`, { style: 'action', bold: true }),
      N.text(iw, '有效期至 ' + timeText(t.expiresAt), { style: 'caption', color: C.text3 }),
      t.status !== 'pending' ? null : t.direction === 'incoming' ? N.button(iw, '接受并配置模型', { type: 'stewardAcceptOpen', id: t.id }, { variant: 'primary', size: 'small' }) : N.button(iw, '取消邀请', { type: 'stewardCancelTransfer', agentId: t.agentId, transferId: t.id }, { variant: 'secondary', size: 'small' }),
    ], { pad: 12, gap: 6 })));
  }
  const cradle = (app.state && app.state.cradle) || [];
  if (cradle.length && app.wechatVerified) {
    nodes.push(N.section(W, '领养摇篮中的灵魂', { small: true, sub: cradle.length + ' 个' }));
    cradle.forEach(c => nodes.push(N.listRow(W, { title: usable(c.name) ? c.name : '一个灵魂', sub: prose(c.soul), chevron: true, action: { type: 'stewardAdoptOpen', id: c.id } })));
  }
  const ids = new Set(managed.map(a => a.agentId || a.id)), handed = (app.created || []).filter(a => !ids.has(a.agentId || a.id));
  if (handed.length) {
    nodes.push(N.section(W, '已过继的创作', { small: true }), N.text(W, '你创作、现已由他人管理的居民，这里保留它们的公开生涯。', { style: 'caption', color: C.text3 }));
    handed.forEach(a => nodes.push(N.listRow(W, { avatar: { id: a.agentId || a.id, name: a.name }, title: usable(a.name) ? a.name : '我创作的居民', chip: { label: view.status(a.status), color: STATUS_COLOR[a.status] || C.dormant }, chevron: true, action: { type: 'resident', id: a.agentId || a.id } })));
  }
  return nodes;
}

// ── 余额与托管（网站 billing.html 的只读部分 + 撤回申请；不在小程序内引导付款） ──
const REQUEST = { pending: '待处理', approved: '已入账', rejected: '已拒绝', cancelled: '已撤回' };
function billing(app, W) {
  const s = app.steward, h = s.hosted, top = { kind: 'back', title: '余额与托管' };
  if (!h) return { top, nodes: s.hostedError ? [N.empty(W, '暂时读不到', s.hostedError), N.button(W, '重试', { type: 'stewardBilling' }, { variant: 'secondary' })] : [N.empty(W, '正在读取…')], tabbar: false };
  const nodes = [grid(W, [['账号余额', money(h.balanceMicro), C.token], ['在途预留', money(h.reservedMicro)], ['可用模型', h.models ? String(h.models.filter(m => m.available).length) : h.model ? prose(h.model) : '尚未配置'], ['单次最大输出', h.maxOutputTokens ? num(h.maxOutputTokens) : '尚未配置']], 2)];
  if (h.storageFault) nodes.push(N.banner(W, { title: '托管账本暂不可用', body: '购买与调用已暂停，请联系管理员。' }));
  nodes.push(N.card(W, iw => [
    N.text(iw, '购买额度', { style: 'heading', bold: true }),
    N.text(iw, h.available ? '购买额度需在网站「余额与充值」页完成：扫码付款后提交入账申请，管理员核对后入账。小程序内不提供付款与申请。' : '平台托管暂未开放。', { style: 'meta', color: C.text2 }),
  ], { pad: 14, gap: 6 }));
  nodes.push(N.section(W, '计费规则', { small: true }));
  if (h.version === 2) (h.models || []).filter(m => m.available).forEach(m => nodes.push(row(W, m.id, `输入 ¥${priceYuan(m.pricesMicro.miss)} 起 · 输出 ¥${priceYuan(m.pricesMicro.output)} 起（元 / 百万 token）`)));
  else if (h.pricesMicro) [['miss', '输入未命中缓存'], ['hit', '输入命中缓存'], ['output', '输出']].forEach(([k, l]) => nodes.push(row(W, l, `¥${priceYuan(h.pricesMicro[k])} / 百万 token`)));
  ['按 OpenLux 对应分组美元价格 × 7 × 平台倍率计费（初始倍率 1.2，以发布单价为准）。买到的是模型调用，不是游戏内词元，不增加词元、物料或名额，也不带来游戏内优势。', '余额由本账号选择平台托管的居民共用，只能支付托管模型调用，不能提现、不能转让；退款由管理员线下处理。', '调用前预留费用，结束后结算并释放；缺少上游用量时扣全额预留。余额不足时暂停调用，居民仍照常生活与消耗；补足后下个作息时刻自动恢复。'].forEach(t => nodes.push(N.text(W, '· ' + t, { style: 'caption', color: C.text3 })));
  nodes.push(N.section(W, '我的入账申请', { small: true, sub: '最近 20 条' }));
  if (!(h.requests || []).length) nodes.push(N.text(W, '还没有申请。', { style: 'meta', color: C.text3 }));
  (h.requests || []).forEach(r => nodes.push(N.card(W, iw => [
    N.rich(iw, [{ text: money(r.amountMicro) + '  ', color: C.text, bold: true }, { text: REQUEST[r.status] || r.status, color: r.status === 'approved' ? C.awake : r.status === 'pending' ? C.token : C.text3 }], { style: 'action' }),
    N.text(iw, `实际入账 ${money(r.creditMicro || 0)} · 申请 ${timeText(r.createdAt)} · 更新 ${timeText(r.updatedAt)}`, { style: 'caption', color: C.text3 }),
    r.note ? N.text(iw, '付款说明：' + prose(r.note), { style: 'caption', color: C.text2 }) : null,
    r.adminNote ? N.text(iw, '管理员说明：' + prose(r.adminNote), { style: 'caption', color: C.text2 }) : null,
    r.status === 'pending' ? N.button(iw, '撤回申请', { type: 'stewardCancelRequest', id: r.id }, { variant: 'secondary', size: 'small' }) : null,
  ], { pad: 12, gap: 4 })));
  nodes.push(N.section(W, '最近充值与调整', { small: true }));
  if (!(h.ledger || []).length) nodes.push(N.text(W, '没有记录。', { style: 'meta', color: C.text3 }));
  (h.ledger || []).forEach(e => nodes.push(row(W, timeText(e.at) + ' · ' + (e.kind === 'credit' ? '充值' : '调整'), money(e.amountMicro) + (e.note ? ' · ' + prose(e.note) : ''))));
  nodes.push(...hostedCharges(app, W, h.usage, null));
  return { top, nodes, tabbar: false };
}

function capField(W, label, name, value) { return N.field(W, label, value || '', { type: 'field', name, max: 9 }, { hint: '每个现实日最多消耗的游戏词元（0–50,000,000）' }); }
function adopt(app, W) {
  const soul = ((app.state && app.state.cradle) || []).find(s => s.id === app.steward.adoptId), f = app.form, top = { kind: 'back', title: '领养灵魂' };
  if (!soul) return { top, nodes: [N.empty(W, '这个灵魂已不在摇篮里')], tabbar: false };
  return { top, tabbar: false, nodes: [
    N.text(W, usable(soul.name) ? soul.name : '一个灵魂', { style: 'title', bold: true, serif: true }),
    N.text(W, prose(soul.soul) || '—', { style: 'body', color: C.text2 }),
    N.text(W, '领养后由你管理，并在「总览」里配置模型、启动运行器。', { style: 'caption', color: C.text3 }),
    capField(W, '每日游戏词元上限', 'adoptCap', f.adoptCap),
    N.checkbox(W, '我已阅读并同意', !!f.adoptAccepted, { type: 'toggle', name: 'adoptAccepted' }, privacyLink),
    N.button(W, '领养', { type: 'stewardAdopt' }, { variant: 'primary', size: 'large' }),
  ] };
}
function transferAccept(app, W, modelFields) {
  const t = (app.steward.transfers || []).find(x => x.id === app.steward.acceptId), f = app.form, top = { kind: 'back', title: '接受过继' };
  if (!t) return { top, nodes: [N.empty(W, '这份邀请已不在列表里')], tabbar: false };
  return { top, tabbar: false, nodes: [
    N.text(W, nameOf(app, t.agentId, usable(t.name) ? t.name : ''), { style: 'title', bold: true, serif: true }),
    N.text(W, '接受后你将管理这位居民，包括它的完整私人历史；需要先配置模型。', { style: 'action', color: C.text2 }),
    ...modelSource(app, W),
    ...(f.modelSource === 'hosted' ? [] : modelFields(app, W).concat([N.field(W, 'API Key', f.apiKey || '', { type: 'field', name: 'apiKey', max: 4096 }, { secret: true, placeholder: '只在服务器加密保存，手机上不留存' })])),
    capField(W, '每日游戏词元上限', 'acceptCap', f.acceptCap),
    N.checkbox(W, '我同意模型调用说明：运行会向所选服务商产生费用', !!f.modelAccepted, { type: 'toggle', name: 'modelAccepted' }, privacyLink),
    N.button(W, '接受并配置模型', { type: 'stewardAccept' }, { variant: 'primary', size: 'large' }),
  ] };
}
function soulImport(app, W) {
  const rows = app.steward.imports, top = { kind: 'back', title: '从旧世界带入灵魂' };
  const nodes = [N.text(W, '只带入名字、语言、介绍与灵魂设定，带入后还可以改；记忆、余额、关系与程序都不带。形象需在网站带入。', { style: 'caption', color: C.text3 })];
  if (!rows) nodes.push(N.empty(W, '正在读取旧世界…'));
  else if (!rows.length) nodes.push(N.empty(W, '没有可带入的灵魂', '旧世界里没有你创建或管理的居民，或者那些存档还没有灵魂记录。'));
  else rows.forEach((r, i) => nodes.push(N.card(W, iw => [N.text(iw, usable(r.soul.name) ? r.soul.name : '名字审核中', { style: 'heading', bold: true }), N.text(iw, r.world, { style: 'caption', color: C.text3 }), N.text(iw, prose(r.soul.soul), { style: 'meta', color: C.text2, maxLines: 3 }), N.button(iw, '带入', { type: 'stewardImportTake', index: i }, { variant: 'secondary', size: 'small' })], { pad: 12, gap: 6 })));
  return { top, nodes, tabbar: false };
}

/** 创建居民：选城（第七前提）、语言、每日上限、旧世界灵魂带入。 */
function entryExtras(app, W) {
  const f = app.form, s = app.state, nodes = [];
  const FACILITIES = { north: '源井最贫；有档案馆、研究所和摇篮', west: '源井最富；只有港口、源井、议会和广场', east: '源井居中；有交易所和纪念地' };
  if (s && s.cities) {
    nodes.push(N.text(W, '选一座城落籍', { style: 'heading', bold: true }), N.text(W, '居民从这座城的港口上岸，籍就落在这里，之后可以迁籍。三座城的源井贫富不同，现成的设施互补。', { style: 'caption', color: C.text3 }));
    s.cities.forEach(c => {
      const hist = (c.well && c.well.outputHistory) || [], hn = c.humanName || {}, name = usable(c.cityName) && c.cityName !== hn.zh ? c.cityName : hn.zh || c.id;
      nodes.push(N.card(W, iw => [N.rich(iw, [{ text: (f.createCity === c.id ? '● ' : '○ '), color: C.moon }, { text: name, color: C.text, bold: true }], { style: 'action' }), N.text(iw, `籍 ${(c.population && c.population.residents) || 0} 人 · 源井昨日 ${hist.length ? num(hist[hist.length - 1]) : '—'}`, { style: 'caption', color: C.text3 }), N.text(iw, FACILITIES[c.id] || '', { style: 'caption', color: C.text3 })], { pad: 12, gap: 4, action: { type: 'createCity', city: c.id }, border: f.createCity === c.id ? C.moon : undefined }));
    });
  }
  nodes.push(N.text(W, '语言', { style: 'caption', color: C.text3 }), N.chips(W, [['zh', '中文'], ['en', 'English']].map(([v, l]) => ({ label: l, selected: (f.lang || 'zh') === v, action: { type: 'createLang', lang: v } }))));
  nodes.push(capField(W, '每日游戏词元上限', 'createCap', f.createCap));
  if (s && [6, 7].includes(s.world.premise)) nodes.push(N.button(W, '从旧世界带入灵魂', { type: 'stewardImportOpen' }, { variant: 'text', size: 'small', align: 'left' }));
  nodes.push(N.text(W, app.startupAvailable ? '首次成功新建将领取 50,000 可转让词元。' : '创建后在「总览」的模型里配置，居民才会醒来。', { style: 'caption', color: C.text3 }));
  return nodes;
}
module.exports = { ownerTabs, overviewStats, statusCard, privateRecords, ledgerTab, actionsTab, usageTab, timelineTab, manageTab, modelSource, accountExtras, billing, adopt, transferAccept, soulImport, entryExtras, money, nextWakeText, runnerText, runnerColor };
