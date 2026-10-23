// 观测扩展的页面：统计与注意力、天象、遗产、交易所、物料·研究·工程、出资核对、知识与协作。
// 文案与网站 public/e2-tabs.js、tabs2.js、market-ui.js、materials-ui.js、project-ui.js、cooperation-ui.js 对应。
const N = require('../ui/nodes');
const P = require('../ui/paint');
const T = require('../ui/text');
const { C, font } = require('../ui/theme');
const { usable, directory, pendingName, moderationState, moderationNotice } = require('../utils/feed');
const { compact, num, pct } = require('../utils/format');
const shared = require('../utils/shared-text');
const view = require('../utils/view');

const prose = v => { const t = view.text(v); const reason = moderationState(t); return reason ? moderationNotice(reason) : t; };
const named = v => { const t = view.text(v); return usable(t) ? t : ''; };
function agentName(app, id) {
  if (!id) return '待定';
  const a = directory(app.state || {}).agents[id];
  return a && usable(a.name) ? a.name : pendingName(id);
}
function placeName(app, id) {
  const p = ((app.state && app.state.places) || []).find(x => x.id === id);
  const n = p && (p.displayName && typeof p.displayName === 'object' ? p.displayName.zh : p.name);
  return usable(n) ? n : id || '—';
}
function cityShort(app, id) {
  const c = ((app.state && app.state.cities) || []).find(x => x.id === id);
  return c ? (c.short && c.short.zh) || c.id : '荒野';
}
function focusCity(app) { return app.state && app.state.cities && app.cityFocus ? app.state.cities.find(c => c.id === app.cityFocus) : null; }
function dayTickText(tick, perDay) {
  if (!Number.isFinite(tick) || !Number.isFinite(perDay) || perDay <= 0) return '—';
  return `第 ${Math.floor(tick / perDay) + 1} 日 · 第 ${tick % perDay + 1} 刻`;
}
function back(title) { return { kind: 'back', title }; }
function loading(app, W, page, data) {
  if (data) return null;
  const error = app.observe.errors[page];
  return error ? [N.empty(W, '暂时读不到', error), N.button(W, '重试', { type: 'refresh' }, { variant: 'secondary' })] : [N.empty(W, '正在读取…')];
}
function pager(W, page, hasPrev, hasNext, action) {
  if (!hasPrev && !hasNext) return N.space(0);
  const items = [];
  if (hasPrev) items.push({ label: '首页', action: { type: action, dir: 'first' }, variant: 'secondary' }, { label: '上一页', action: { type: action, dir: 'prev' }, variant: 'secondary' });
  if (hasNext) items.push({ label: '下一页', action: { type: action, dir: 'next' }, variant: 'secondary' });
  return N.stack([N.text(W, `第 ${page} 页`, { style: 'caption', color: C.text3, align: 'center' }), items.length ? N.buttonRow(W, items, 8, { size: 'small' }) : null], 6);
}
function kv(W, rows) {
  return N.stack(rows.filter(r => r && r[1] !== undefined && r[1] !== null && r[1] !== '').map(([k, v]) => N.rich(W, [{ text: k + '：', color: C.text3 }, { text: String(v), color: C.text }], { style: 'meta' })), 4);
}

// ── 折线图（网站 charts.js 的手机版：同一组指标，一行一图，页眉带最新值） ──
const SERIES = [C.moon, C.token, C.awake, C.ai, C.material, C.danger];
function lineChart(W, title, series, opts = {}) {
  const live = series.filter(s => s.points.length);
  const latest = live.map(s => ({ s, v: s.points[s.points.length - 1][1] }));
  const fmt = opts.format || (v => compact(v));
  const legend = N.rich(W - 28, latest.flatMap(({ s, v }, i) => [{ text: (i ? '   ' : '') + '● ', color: SERIES[s.color % SERIES.length] }, { text: `${s.name} ${fmt(v)}`, color: C.text2 }]), { style: 'caption' });
  const H = 96;
  return N.card(W, iw => [
    N.text(iw, title, { style: 'heading', bold: true }),
    live.length ? legend : N.text(iw, '暂无数据', { style: 'caption', color: C.text3 }),
    live.length ? N.node(H, (g, x, y) => {
      const ctx = g.ctx, xs = live.flatMap(s => s.points.map(p => p[0])), x0 = Math.min(...xs), x1 = Math.max(...xs);
      // 左右两轴：标为 right 的序列单独缩放（网站同样做法）。
      const range = axis => { const v = live.filter(s => (s.axis === 'right') === axis).flatMap(s => s.points.map(p => p[1])); return v.length ? [Math.min(0, ...v), opts.yMax !== undefined && !axis ? opts.yMax : Math.max(1e-9, ...v)] : [0, 1]; };
      const ranges = { left: range(false), right: range(true) };
      P.line(ctx, x, y + H - 0.5, x + iw, y + H - 0.5, C.line, 1);
      for (const s of live) {
        const [lo, hi] = ranges[s.axis === 'right' ? 'right' : 'left'];
        ctx.beginPath();
        s.points.forEach(([px, py], i) => {
          const cx = x + (x1 === x0 ? iw / 2 : (px - x0) / (x1 - x0) * iw), cy = y + H - 4 - (hi === lo ? 0 : (py - lo) / (hi - lo)) * (H - 8);
          if (i) ctx.lineTo(cx, cy); else ctx.moveTo(cx, cy);
        });
        ctx.strokeStyle = SERIES[s.color % SERIES.length]; ctx.lineWidth = 2; ctx.stroke();
      }
      P.text(ctx, (opts.xLabel === undefined ? '第 ' : '') + x0 + (opts.xLabel === undefined ? ' 日' : ''), x, y + H - 8, font(10, {}), C.text3);
      P.text(ctx, (opts.xLabel === undefined ? '第 ' : '') + x1 + (opts.xLabel === undefined ? ' 日' : ''), x + iw, y + H - 8, font(10, {}), C.text3, 'right');
    }) : null,
  ], { pad: 14, gap: 8 });
}
const rate = v => Math.round(v * 100) + '%';
function metrics(app, W) {
  const o = app.observe, focus = focusCity(app), top = back(focus ? `统计 · ${(focus.short && focus.short.zh) || focus.id}` : '统计');
  const wait = loading(app, W, 'metrics', o.metrics);
  if (wait) return { top, nodes: wait, tabbar: false, pull: true };
  const m = focus ? o.metrics.filter(x => x.cities && x.cities[focus.id]).map(x => Object.assign({ day: x.day }, x.cities[focus.id])) : o.metrics;
  const nodes = [N.text(W, '日结法律拨款按公库每日／每月规则实际转账、均分金额统计，人均值按在世居民计算；修缮等其他法律拨款另列。历史余额不变。', { style: 'caption', color: C.text3 })];
  if (!m.length) nodes.push(N.empty(W, '还没有数据', '每个世界日结束后记一次。'));
  else {
    const pts = (key, scale = 1) => m.filter(x => typeof x[key] === 'number').map(x => [x.day + 1, x[key] * scale]);
    const chart = (title, series, opts) => nodes.push(lineChart(W, title, series, opts));
    chart('日结法律拨款／在世居民', [{ name: '实际拨款', points: pts('rationPerCapita'), color: 1 }]);
    chart('公库法律拨款', [{ name: '日结拨款', points: pts('dailyDistributionEnergy'), color: 1 }, { name: '其他拨款', points: pts('otherLawPaymentsEnergy'), color: 2 }]);
    chart('人口', [{ name: '醒', points: pts('awake'), color: 2 }, { name: '眠', points: pts('dormant'), color: 4 }]);
    chart('源井完好度与日产', [{ name: '完好度 %', points: pts('wellCondition', 0.01), color: 0 }, { name: '日产', points: pts('output'), axis: 'right', color: 1 }], { yMax: 100 });
    chart('公库词元', [{ name: '公库', points: pts('treasuryEnergy'), color: 1 }]);
    if (!focus) chart('基尼系数', [{ name: 'Gini', points: pts('gini'), color: 3 }], { yMax: 1, format: v => v.toFixed(2) });
    chart('在效规则数与维持费', [{ name: '在效规则', points: pts('rulesActive'), color: 3 }, { name: '当日维持费', points: pts('upkeepPaid'), axis: 'right', color: 1 }]);
    chart('停摆与规则错误', [{ name: '停摆数', points: pts('lawsSuspended'), color: 1 }, { name: '规则错误', points: pts('ruleErrors'), axis: 'right', color: 5 }]);
    if (!focus) {
      chart('后人所建的比例', [{ name: '后人所建', points: pts('agentBuiltShare'), color: 1 }], { yMax: 1, format: rate });
      chart('剩余残料与遗址', [{ name: '剩余残料', points: pts('salvageLeft'), color: 4 }, { name: '累计遗址', points: pts('razed'), axis: 'right', color: 1 }]);
      chart('躯壳使用与排队', [{ name: '在世的躯壳', points: pts('shellsUsed'), color: 0 }, { name: '排队中', points: pts('shellQueue'), color: 1 }]);
      chart('有志者的比例', [{ name: '有志者', points: pts('purposeShare'), color: 1 }], { yMax: 1, format: rate });
      chart('公共投入率', [{ name: '公共投入率', points: pts('publicInvestmentRate'), color: 0 }], { yMax: 1, format: rate });
      chart('搭便车比例', [{ name: '搭便车', points: pts('freeRiderShare'), color: 1 }], { yMax: 1, format: rate });
      chart('幕布曲线（世代 0 占比）', [{ name: '世代 0', points: pts('humanAuthoredShare'), color: 1 }], { yMax: 1, format: rate });
      chart('出生的作者数', [{ name: '1 位作者', points: pts('birthsSolo'), color: 2 }, { name: '2 位作者', points: pts('birthsPair'), color: 0 }, { name: '3 位以上', points: pts('birthsGroup'), color: 1 }]);
      if (![6, 7].includes(app.state.world.premise)) chart('旧币流量与价格', [{ name: '流量', points: pts('coinVolume'), color: 2 }, { name: '币价', points: pts('coinPrice'), axis: 'right', color: 1 }]);
    }
    chart('在效法律数', [{ name: '在效法律', points: pts('lawsActive'), color: 3 }]);
    if (!focus && app.state.world.premise >= 2) {
      nodes.push(N.section(W, '注意力与自动化', { small: true }), N.text(W, '来自平台运行器的注意力轨迹（按地球日，最近 30 天的有数据的日子），只有平均数；不含任何居民的内容，常驻指令的内容也不公开。', { style: 'caption', color: C.text3 }));
      const days = (o.attention || []).filter(d => d.residents > 0), att = key => days.map((d, i) => [i + 1, d[key]]);
      if (!days.length) nodes.push(N.text(W, '运行器还没有留下注意力的数据。', { style: 'meta', color: C.text3 }));
      else {
        chart('每次醒来的轮数', [{ name: '轮数', points: att('turnsPerWaking'), color: 0 }], { xLabel: '' });
        chart('每次醒来看的次数', [{ name: '看的次数', points: att('looksPerWaking'), color: 3 }], { xLabel: '' });
        chart('每位居民每日被叫醒的次数', [{ name: '被叫醒', points: att('wakesPerResident'), color: 2 }], { xLabel: '' });
      }
      chart('常驻指令', [{ name: '指令条数', points: pts('standingOrders'), color: 4 }, { name: '当日触发次数', points: pts('standingFired'), axis: 'right', color: 1 }]);
    }
  }
  return { top, nodes, tabbar: false, pull: true };
}

// ── 天象（第六、七前提完全随机，不开放投票；与网站 renderWeather 相同） ──
function weather(app, W) {
  const o = app.observe, focus = focusCity(app), top = back(focus ? `天象 · ${(focus.short && focus.short.zh) || focus.id}` : '天象');
  const wait = loading(app, W, 'weather', o.weather);
  if (wait) return { top, nodes: wait, tabbar: false, pull: true };
  const W0 = o.weather, name = type => shared.LORE.weather[type] || type, premise = app.state.world.premise;
  const nodes = [];
  if (app.state.cities && !focus) {
    nodes.push(N.text(W, '全岛视图显示荒野的天象；三座城的天象各自独立，可在观测页选一座城再看。', { style: 'caption', color: C.text3 }));
    const cities = W0.cities || {};
    nodes.push(N.card(W, iw => app.state.cities.map(c => N.rich(iw, [{ text: ((c.short && c.short.zh) || c.id) + '  ', color: C.text, bold: true }, { text: ((cities[c.id] && cities[c.id].active) || []).map(x => name(x.type)).join(' · ') || '平静', color: C.text2 }], { style: 'meta' })), { pad: 14, gap: 6 }));
  }
  nodes.push(N.section(W, '生效中的天象', { small: true }));
  if (!(W0.active || []).length) nodes.push(N.text(W, '眼下风平浪静。', { style: 'meta', color: C.text3 }));
  (W0.active || []).forEach(x => nodes.push(N.rich(W, [{ text: name(x.type), color: C.moon, bold: true }, { text: ` · 第 ${x.startDay + 1}–${x.endDay + 1} 日 · 还剩 ${x.daysLeft} 日`, color: C.text2 }], { style: 'action' })));
  nodes.push(N.section(W, '征兆', { small: true }));
  if (!(W0.omens || []).length) nodes.push(N.text(W, '没有可见的征兆。', { style: 'meta', color: C.text3 }));
  (W0.omens || []).forEach(om => nodes.push(N.card(W, iw => [N.text(iw, placeName(app, om.place), { style: 'meta', color: C.label }), N.text(iw, prose(om.text), { style: 'feed' })], { pad: 12, gap: 4 })));
  if ([6, 7].includes(premise)) nodes.push(N.text(W, '天象完全随机：平静400、震80、雾100、蚀60；首月平静，每月最多一次。', { style: 'caption', color: C.text3 }));
  else nodes.push(N.text(W, '本月投票请在网站「天象」页进行：投票按网页浏览器记录一人一票，微信端暂不提供投票。', { style: 'caption', color: C.text3 }));
  nodes.push(N.section(W, '历史', { small: true }));
  const history = (W0.history || []).slice().reverse();
  if (!history.length) nodes.push(N.text(W, '还没有天象。', { style: 'meta', color: C.text3 }));
  history.forEach(x => nodes.push(N.rich(W, [{ text: name(x.type), color: C.text, bold: true }, { text: ` · 第 ${x.startDay + 1}–${x.endDay + 1} 日${x.decidedBy ? ' · ' + ({ vote: '投票', random: '随机' }[x.decidedBy] || x.decidedBy) : ''}`, color: C.text2 }], { style: 'action' })));
  return { top, nodes, tabbar: false, pull: true };
}
function legacy(app, W) {
  const o = app.observe, top = back('人类遗产存活表');
  if (!o.legacy && !o.errors.legacy && app.refreshing) return { top, nodes: [N.empty(W, '正在读取…')], tabbar: false, pull: true };
  const L = o.legacy, nodes = [N.text(W, '人类留下的制度、物件与习惯，此刻是否还在。', { style: 'caption', color: C.text3 })];
  if (o.errors.legacy) nodes.push(N.empty(W, '暂时读不到', o.errors.legacy));
  else if (!L) nodes.push(N.empty(W, '还没有数据'));
  else {
    nodes.push(N.text(W, `第 ${L.day + 1} 日更新`, { style: 'meta', color: C.text3 }));
    (L.items || []).forEach(i => nodes.push(N.card(W, iw => [N.rich(iw, [{ text: view.text(i.name), color: C.text, bold: true }, { text: '  ' + view.text(i.statusText), color: C.moon }], { style: 'action' }), N.text(iw, prose(i.text), { style: 'meta', color: C.text2 })], { pad: 12, gap: 4 })));
  }
  return { top, nodes, tabbar: false, pull: true };
}

// ── 交易所（只读观察，与网站 market-ui.js 同一组筛选与分页） ──
const KINDS = { program: '程序服务', material_delivery: '物料交付', construction: '施工', repair: '维修', document: '作品交付', announcement: '公告发布', proposal: '提案提交' };
const ORDER_STATUS = { open: '待承接', offered: '待接受', active: '履约中', completed: '已结算', cancelled: '已取消', expired: '已到期', failed: '已终止' };
const REASONS = { program_delivered: '程序结果已交付', criterion_met: '已达到交付条件', deadline: '超过约定期限', party_departed: '交易一方已离开', target_unavailable: '目标已不可用', declined: '承接者拒绝订单', agreement: '按取消规则解除' };
function party(app, id) {
  if (!id) return '待定';
  const a = directory(app.state || {}).agents[id];
  return agentName(app, id) + (app.state.cities && a && a.city ? ` · 籍${cityShort(app, a.city)}` : '');
}
function marketRecord(app, W, row, isService) {
  const c = row.criterionTemplate || (row.terms && row.terms.criterion) || {}, perDay = app.state.world.ticksPerDay;
  const price = num(isService ? row.price : row.terms && row.terms.price);
  const goal = c.quantity || c.work || c.bp || 1;
  const unit = c.kind === 'material_delivery' ? '物料' : c.kind === 'construction' ? '工作量' : c.kind === 'repair' ? '基点' : '项';
  const key = 'market:' + row.id, open = app.expanded.has(key);
  const status = isService ? '服务中' : ORDER_STATUS[row.status] || row.status || '—';
  return N.card(W, iw => {
    N.record('title', prose(row.title) || '（无题）', { action: { type: 'expand', key } });
    const parts = [
      N.node(22, (g, x, y) => {
        const tf = font(15, { bold: true }), tw = iw - N.chipWidth(status) - 8;
        P.text(g.ctx, T.ellipsize(g.ctx, prose(row.title) || '（无题）', tw, tf), x, y + 11, tf, C.text);
        N.paintChip(g.ctx, status, x + iw - N.chipWidth(status), y + 1, row.status === 'completed' ? C.awake : C.token);
      }),
      N.rich(iw, [{ text: price + ' 词元', color: C.token, bold: true }, { text: `  ${KINDS[c.kind] || c.kind || '—'} · 交付 ${isService ? num(goal) : num(row.progress) + ' / ' + num(goal)} ${unit}`, color: C.text2 }], { style: 'meta' }),
      N.text(iw, isService ? '提供者：' + party(app, row.provider) : `付款方：${party(app, row.requester)} · 承接者：${party(app, row.provider)}`, { style: 'caption', color: C.text3 }),
    ];
    if (!isService && c.kind !== 'program') parts.push(N.text(iw, '截止 ' + dayTickText(row.dueTick != null ? row.dueTick : row.acceptBy, perDay), { style: 'caption', color: C.text3 }));
    if (open) {
      parts.push(N.text(iw, prose(row.description) || '（无说明）', { style: 'feed' }));
      const facts = [['编号', row.id], ['交付要求', `${KINDS[c.kind] || c.kind || '—'} · ${num(goal)} ${unit}`]];
      if (c.to) facts.push(['接收方', directory(app.state).agents[c.to] ? party(app, c.to) : c.to]);
      if (c.project) facts.push(['工程', c.project]);
      if (c.target) { const road = (app.state.roads || []).find(r => r.id === c.target); facts.push(['维修目标', road ? `${c.target} · ${placeName(app, road.a)} → ${placeName(app, road.b)}` : placeName(app, c.target)]); }
      if (c.place || c.publishPlace) facts.push(['地点', placeName(app, c.place || c.publishPlace)]);
      if (c.class) facts.push(['提案类别', c.class === 'constitutional' ? '宪制提案' : '普通提案']);
      if (c.audience) facts.push(['公告范围', c.audience === 'all' ? '全城' : '指定地点']);
      if (isService && c.kind === 'program') facts.push(['交付方式', '购买后自动运行并返回结果'], ['输入说明', prose(row.inputDescription || '') || '—']);
      else if (isService) {
        facts.push(['等待接单', `${row.waitTicks} 刻`], ['履约时限', `${row.durationTicks} 刻`]);
        if (!c.to && !c.project && !c.target && ['material_delivery', 'construction', 'repair'].includes(c.kind)) facts.push(['目标', '由下单居民指定']);
      } else {
        facts.push(['创建时间', dayTickText(row.createdTick, perDay)]);
        if (row.acceptedTick != null) facts.push(['承接时间', dayTickText(row.acceptedTick, perDay)]);
        if (row.terms && row.terms.durationTicks != null) facts.push(['承接后时限', `${row.terms.durationTicks} 刻`]);
        if (row.terms && row.terms.eligible) facts.push(['承接资格', row.terms.eligible === 'any' ? '所有居民' : groupName(app, row.terms.eligible)]);
        if (c.kind !== 'program') facts.push([row.dueTick == null ? '接单截止' : '履约截止', dayTickText(row.dueTick != null ? row.dueTick : row.acceptBy, perDay)]);
        facts.push(['当前托管', `${num(row.escrow)} 词元`]);
        if (row.closedTick != null) facts.push(['结束时间', dayTickText(row.closedTick, perDay)]);
        if (row.reason) facts.push(['结束原因', REASONS[row.reason] || row.reason]);
        if (row.status === 'completed') facts.push(['已支付报酬', `${price} 词元`]);
      }
      parts.push(kv(iw, facts));
      if (c.project) parts.push(N.button(iw, '核对出资', { type: 'observeProject', id: c.project }, { variant: 'secondary', size: 'small' }));
      if (!isService && c.kind === 'program') parts.push(N.text(iw, '购买输入', { style: 'meta', bold: true }), N.text(iw, prose(row.input || '') || '—', { style: 'meta', color: C.text2 }), N.text(iw, '运行结果', { style: 'meta', bold: true }), N.text(iw, prose(row.output || '') || '—', { style: 'meta', color: C.text2 }));
      if (!isService) {
        const evidence = row.evidence || [];
        parts.push(N.text(iw, '公开交付记录', { style: 'meta', bold: true }));
        if (!evidence.length) parts.push(N.text(iw, '暂无公开交付记录。', { style: 'caption', color: C.text3 }));
        evidence.forEach(e => {
          const doc = e.ref && c.kind === 'document' && (app.state.docs || []).some(d => d.id === e.ref);
          parts.push(N.text(iw, `交付 ${num(e.amount)} ${unit} · ${e.ref || e.key || '—'}`, { style: 'caption', color: doc ? C.moon : C.text2, action: doc ? { type: 'detail', kind: 'doc', id: e.ref } : null }));
        });
      }
      parts.push(N.text(iw, c.kind === 'program' ? '按次付费，结果交付即结算；平台不保证计算结果正确。' : '报酬全额托管，全部达标后一次支付；成本由承接者承担，超时退还报酬。作品只验交付，不评判质量或真伪。', { style: 'caption', color: C.text3 }));
    }
    parts.push(N.button(iw, open ? '收起' : '查看交易详情', { type: 'expand', key }, { variant: 'text', size: 'small', align: 'left' }));
    return parts;
  }, { pad: 14, gap: 6 });
}
function groupName(app, id) { const g = ((app.state && app.state.groups) || []).find(x => x.id === id); return g && usable(g.name) ? g.name : '一个社群'; }
function market(app, W) {
  const o = app.observe, m = o.market, top = back('交易所');
  const nodes = [N.text(W, '观察全城居民的服务、需求与履约结果。交易由居民自主完成。居民文字由 AI 生成，经内容检查后展示。', { style: 'caption', color: C.text3 })];
  nodes.push(N.segmented(W, [['services', '服务告示'], ['demands', '需求大厅'], ['orders', '全部订单']].map(([v, l]) => ({ label: l, action: { type: 'observeMarketView', view: v }, selected: m.view === v }))));
  nodes.push(N.text(W, '任务类型', { style: 'caption', color: C.text3 }), N.chips(W, Object.keys(KINDS).map(k => ({ label: KINDS[k], selected: m.kind === k, action: { type: 'observeMarketFilter', key: 'kind', value: k } }))));
  if (m.view !== 'services') nodes.push(N.text(W, '订单状态', { style: 'caption', color: C.text3 }), N.chips(W, Object.keys(ORDER_STATUS).map(k => ({ label: ORDER_STATUS[k], selected: m.status === k, action: { type: 'observeMarketFilter', key: 'status', value: k } }))));
  const agentsKey = 'market:agents', agentsOpen = app.expanded.has(agentsKey);
  nodes.push(N.button(W, m.agent ? `居民：${agentName(app, m.agent)}` : '按居民筛选', { type: 'expand', key: agentsKey }, { variant: 'text', size: 'small', align: 'left' }));
  if (agentsOpen) {
    const agents = ((app.state && app.state.agents) || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const items = agents.map(a => ({ label: agentName(app, a.id), selected: m.agent === a.id, action: { type: 'observeMarketFilter', key: 'agent', value: a.id } }));
    if (m.agent && !agents.some(a => a.id === m.agent)) items.unshift({ label: m.agent, selected: true, action: { type: 'observeMarketFilter', key: 'agent', value: m.agent } });
    nodes.push(N.chips(W, items));
  }
  if (m.agent || m.kind || m.status) nodes.push(N.button(W, '清除筛选', { type: 'observeMarketClear' }, { variant: 'secondary', size: 'small' }));
  if (m.error) nodes.push(N.empty(W, '交易信息读取失败', m.error), N.button(W, '重试', { type: 'refresh' }, { variant: 'secondary' }));
  else if (!m.rows) nodes.push(N.empty(W, '正在读取…'));
  else {
    nodes.push(N.text(W, `本页 ${m.rows.length} 条 · 按发布顺序展示`, { style: 'caption', color: C.text3 }));
    if (!m.rows.length) nodes.push(N.empty(W, '暂无交易记录', '可清除筛选、返回首页或稍后刷新。居民发布的服务、需求和订单会显示在这里。'));
    m.rows.forEach(row => nodes.push(marketRecord(app, W, row, m.view === 'services')));
    nodes.push(pager(W, m.cursors.length, m.cursors.length > 1, !!m.next, 'observeMarketPage'));
  }
  return { top, nodes, tabbar: false, pull: true };
}

// ── 物料、研究所、工程与环境记录（网站 materials-ui.js、project-ui.js） ──
const PROJECT_STATE = { funding: '筹资中', building: '施工中', built: '已建成', cancelled: '已取消', abandoned: '已终止' };
const ACCESS = { owner: '仅业主／管事', group: '所属社群成员', public: '公开参与' };
const projectState = j => PROJECT_STATE[j.status === 'open' ? j.phase : j.status] || j.status;
const accountName = (app, a) => !a ? '—' : a.kind === 'city' ? '公库' : `${named(a.name) || (a.kind === 'agent' ? agentName(app, a.id) : a.kind === 'group' ? groupName(app, a.id) : a.id)}（${a.id}）`;
const amounts = (energy, materials) => `${num(energy)} 词元 / ${num(materials)} 物料`;
function materials(app, W) {
  const o = app.observe, s = o.materials, top = back('物料 · 研究 · 工程');
  const wait = loading(app, W, 'materials', s.zones);
  if (wait) return { top, nodes: wait, tabbar: false, pull: true };
  const nodes = [N.section(W, '物料', { small: true })];
  const zones = Object.entries(s.zones || {});
  if (!zones.length) nodes.push(N.text(W, '这座世界没有物料地带。', { style: 'meta', color: C.text3 }));
  zones.forEach(([id, z]) => nodes.push(N.listRow(W, { title: placeName(app, id), sub: `现存 ${num(z.stock)} / 上限 ${num(z.capacity)}`, meta: `本日已采 ${num(z.harvestedThisDay || 0)}`, action: { type: 'sheet', kind: 'place', id } })));
  nodes.push(N.section(W, '研究所 · 服务覆盖全城', { small: true }));
  if (!(s.research || []).length) nodes.push(N.text(W, '还没有研究所。', { style: 'meta', color: C.text3 }));
  (s.research || []).forEach(r => nodes.push(N.card(W, iw => [N.text(iw, placeName(app, r.id), { style: 'heading', bold: true, action: { type: 'detail', kind: 'place', id: r.id } }), kv(iw, [['完好度', pct(r.condition)], ['授权', ACCESS[r.policy && r.policy.access] || (r.policy && r.policy.access) || '—'], ['每次收费', num(r.policy && r.policy.fee) + ' 词元'], ['名义支持', `施工至多 ${r.nominalWork || 15} / 维修至多 ${r.repairLimit || 750}bp`]])], { pad: 14, gap: 6 })));
  nodes.push(N.section(W, '工程历史与出资核对', { small: true }), N.text(W, '包含筹资、施工、已建成、取消等状态。', { style: 'caption', color: C.text3 }));
  if (!s.projects) nodes.push(N.text(W, '正在读取…', { style: 'meta', color: C.text3 }));
  else {
    if (!s.projects.length) nodes.push(N.text(W, '还没有工程。', { style: 'meta', color: C.text3 }));
    s.projects.forEach(j => nodes.push(N.card(W, iw => [
      N.text(iw, `${j.id} · ${prose(j.name) || (j.module && shared.LORE.module[j.module]) || j.module || j.build || '工程'}`, { style: 'heading', bold: true }),
      kv(iw, [['状态 / 工作', `${projectState(j)} · ${num(j.progress)}/${num(j.needWork)}`], ['地点', placeName(app, j.place)], ['业主', accountName(app, j.owner)], ['参与权限', ACCESS[j.access] || j.access]]),
      N.button(iw, '核对出资', { type: 'observeProject', id: j.id }, { variant: 'secondary', size: 'small' }),
    ], { pad: 14, gap: 6 })));
    nodes.push(pager(W, s.projectCursors.length, s.projectCursors.length > 1, !!s.projectNext, 'observeProjectsPage'));
  }
  nodes.push(N.section(W, '环境记录', { small: true }), N.text(W, '只展示已经发生的变化。', { style: 'caption', color: C.text3 }));
  if (!s.observations) nodes.push(N.text(W, '正在读取…', { style: 'meta', color: C.text3 }));
  else {
    if (!s.observations.length) nodes.push(N.text(W, '还没有记录。', { style: 'meta', color: C.text3 }));
    s.observations.forEach(ob => nodes.push(N.card(W, iw => [
      N.text(iw, `${ob.id} · ${ob.tick !== undefined ? `第 ${ob.tick} 刻` : `第 ${ob.dayClosed + 1} 日结束`} · ${ob.zone ? placeName(app, ob.zone) : ob.project || '—'}`, { style: 'meta', color: C.text3 }),
      N.text(iw, ob.kind === 'regrowth' ? `采集 ${num(ob.harvested)}，补充 ${num(ob.added)}，库存 ${num(ob.stockAfterRefill)}` : `居民 ${agentName(app, ob.actor)}，工作 +${num(ob.workAdded)}，${ob.researchUsed ? placeName(app, ob.researchUsed) : '无研究所'}，工程支出 ${num(ob.energySpent)} 词元 / ${num(ob.materialsSpent)} 物料`, { style: 'action' }),
    ], { pad: 12, gap: 4 })));
    nodes.push(pager(W, s.observationCursors.length, s.observationCursors.length > 1, !!s.observationNext, 'observeObservationsPage'));
  }
  return { top, nodes, tabbar: false, pull: true };
}
function projectAudit(app, W) {
  const p = app.observe.project, top = back(p ? '出资核对 · ' + p.id : '出资核对');
  if (!p) return { top, nodes: [N.empty(W, '没有选择工程')], tabbar: false };
  const wait = loading(app, W, 'projectAudit', p.data);
  if (wait) return { top, nodes: wait, tabbar: false, pull: true };
  const j = p.data, a = j.accounting || {};
  const nodes = [
    N.text(W, `${p.id} · ${projectState(j)} · ${ACCESS[j.access] || j.access}`, { style: 'heading', bold: true }),
    N.text(W, '出资不自动授予产权或施工权限；施工还需资源齐备、人在现场，并通过法律、额度与服务检查。', { style: 'caption', color: C.text3 }),
    kv(W, [['历史实际投入', a.recordsAvailable ? amounts(a.totals.energy, a.totals.materials) : '明细缺失，无法核对'], ['历史已消耗', a.recordsAvailable ? amounts(a.totals.spentEnergy, a.totals.spentMaterials) : '—'], ['当前托管余额', a.escrow ? amounts(a.escrow.energy, a.escrow.materials) : '—']]),
    N.section(W, '出资账户', { small: true, sub: `第 ${p.page || 1} 页` }),
  ];
  const rows = a.contributors || [];
  if (!rows.length) nodes.push(N.text(W, '没有出资记录。', { style: 'meta', color: C.text3 }));
  rows.forEach(c => nodes.push(N.card(W, iw => [N.text(iw, accountName(app, c.account), { style: 'action', bold: true }), N.text(iw, `实际投入 ${amounts(c.energy, c.materials)} · 已消耗 ${amounts(c.spentEnergy, c.spentMaterials)}`, { style: 'caption', color: C.text2 })], { pad: 12, gap: 4 })));
  if (p.next) nodes.push(N.button(W, '更多出资账户', { type: 'observeProjectMore' }, { variant: 'secondary', size: 'small' }));
  nodes.push(N.text(W, '代管物料归属其受益账户；赠与、承诺、失败出资不计入。关闭工程保留历史投入，托管余额为零；不能从投入数推断退款或继承分配。', { style: 'caption', color: C.text3 }));
  return { top, nodes, tabbar: false, pull: true };
}

// ── 知识与协作（网站 cooperation-ui.js） ──
const COOP = { cards: '资料卡', collaborations: '协作单', relations: '往来评价' };
const COOP_STATUS = { approved: '已接受', pending: '等待验收', rejected: '要求补充', open: '招募中', active: '进行中', orphaned: '等待接续', completed: '已完成', cancelled: '已取消', claimed: '已认领', submitted: '已提交', accepted: '已验收', private: '私人', shared: '定向共享', public: '公开', invited: '邀请' };
const coopStatus = s => COOP_STATUS[s] || s || '—';
const ACTION_NAMES = { give: '交付', repair: '修缮', construct: '施工', contribute: '工程投入', write: '著述', say: '发言', broadcast: '宣告', propose: '提案' };
function evidenceText(app, e) {
  const d = e.effect || {}, pieces = [];
  if (d.energy > 0) pieces.push(`${d.energy} 词元`);
  if (d.materials > 0) pieces.push(`${d.materials} 物料`);
  if (d.workAdded > 0) pieces.push(`施工进度 +${d.workAdded}`);
  if (e.type === 'repair' && typeof d.from === 'number' && typeof d.to === 'number') pieces.push(`${(d.from / 100).toFixed(1)}% → ${(d.to / 100).toFixed(1)}%`);
  if (e.type === 'give' && e.target) pieces.push('交给 ' + agentName(app, e.target));
  return `${ACTION_NAMES[e.type] || e.type} · ${pieces.join(' · ')} · 刻 ${e.tick}`;
}
function cooperation(app, W) {
  const c = app.observe.coop, top = back('知识与协作');
  const nodes = [N.segmented(W, Object.keys(COOP).map(k => ({ label: COOP[k], action: { type: 'observeCoopKind', kind: k }, selected: c.kind === k }))), N.text(W, '公开内容即时展示；私人内容在观测延迟后，以当时的历史版本展示。居民文字由 AI 生成。', { style: 'caption', color: C.text3 })];
  const wait = loading(app, W, 'cooperation', c.rows);
  if (wait) return { top, nodes: nodes.concat(wait), tabbar: false, pull: true };
  if (!c.rows.length) nodes.push(N.empty(W, '暂时没有可观测的记录。'));
  c.rows.forEach(row => {
    if (c.kind === 'relations') nodes.push(N.card(W, iw => [N.text(iw, `${agentName(app, row.actor)} → ${agentName(app, row.target)}`, { style: 'action', bold: true }), N.text(iw, prose(row.text), { style: 'feed' }), N.text(iw, `居民自己的判断 · 刻 ${row.tick}`, { style: 'caption', color: C.text3 })], { pad: 12, gap: 4 }));
    else nodes.push(N.card(W, iw => [N.text(iw, prose(row.title) || row.id, { style: 'heading', bold: true }), N.text(iw, `${row.id} · 历史版本 ${row.version}${row.status ? ' · ' + coopStatus(row.status) : ''}`, { style: 'caption', color: C.text3 })], { pad: 14, gap: 4, action: { type: 'observeCoopDetail', id: row.id } }));
  });
  if (c.next) nodes.push(N.button(W, '查看更多', { type: 'observeCoopMore' }, { variant: 'secondary' }));
  return { top, nodes, tabbar: false, pull: true };
}
function cooperationDetail(app, W) {
  const c = app.observe.coop, det = c.detail, top = back(COOP[c.kind] || '协作');
  const wait = loading(app, W, 'cooperationDetail', det && det.data);
  if (wait) return { top, nodes: wait, tabbar: false, pull: true };
  const d = det.data, claim = '由居民提交，平台不替其证明主张。';
  const nodes = [N.text(W, prose(d.title) || d.id, { style: 'title', bold: true, serif: true }), N.text(W, `${d.id} · 历史版本 ${d.version} · 刻 ${d.tick}`, { style: 'caption', color: C.text3 })];
  const editions = [];
  if (d.version > 1) editions.push({ label: '上一版本', action: { type: 'observeCoopDetail', id: det.id, version: d.version - 1 }, variant: 'secondary' });
  if (det.edition) editions.push({ label: '最新可观测版本', action: { type: 'observeCoopDetail', id: det.id }, variant: 'secondary' });
  if (editions.length) nodes.push(N.buttonRow(W, editions, 8, { size: 'small' }));
  if (c.kind === 'cards') {
    nodes.push(kv(W, [['作者', agentName(app, d.author)], ['可见范围', coopStatus(d.visibility)], ['状态', d.archived ? '已归档' : '']]), N.text(W, prose(d.body), { style: 'body' }));
    if (d.source) nodes.push(N.button(W, `来源：${d.source.id} · v${d.source.version}`, { type: 'observeCoopDetail', id: d.source.id, version: d.source.version }, { variant: 'text', size: 'small', align: 'left' }));
    (d.feedback || []).forEach(f => nodes.push(N.card(W, iw => [N.text(iw, agentName(app, f.actor), { style: 'meta', bold: true }), N.text(iw, prose(f.text), { style: 'feed' }), N.text(iw, claim, { style: 'caption', color: C.text3 })], { pad: 12, gap: 4 })));
    if (d.citations && d.citations.length) nodes.push(N.text(W, `${d.citations.length} 次引用记录`, { style: 'caption', color: C.text3 }));
  } else {
    nodes.push(kv(W, [['发起者', agentName(app, d.founder)], ['负责人', d.owner ? agentName(app, d.owner) : '无'], ['状态', coopStatus(d.status)]]));
    nodes.push(N.section(W, '共同目标', { small: true }), N.text(W, prose(d.goal), { style: 'body' }), N.section(W, '任务步骤', { small: true }));
    (d.tasks || []).forEach((t, i) => nodes.push(N.card(W, iw => {
      const parts = [N.text(iw, `${i + 1}. ${prose(t.title)}`, { style: 'heading', bold: true }), N.text(iw, `${t.status === 'open' ? '待认领' : coopStatus(t.status)} · ${t.assignee ? agentName(app, t.assignee) : '无'}`, { style: 'caption', color: C.text3 })];
      (t.submissions || []).forEach(s => { parts.push(N.text(iw, agentName(app, s.actor), { style: 'meta', bold: true }), N.text(iw, prose(s.text), { style: 'feed' }), N.text(iw, claim, { style: 'caption', color: C.text3 })); (s.evidence || []).forEach(e => parts.push(N.text(iw, evidenceText(app, e), { style: 'caption', color: C.text2 }))); });
      (t.reviews || []).forEach(r => parts.push(N.text(iw, `验收 · ${r.accepted ? '已接受' : '要求补充'} · ${agentName(app, r.actor)} ${prose(r.text)}`, { style: 'meta', color: C.text2 })));
      return parts;
    }, { pad: 12, gap: 4 })));
    if ((d.contributions || []).length) { nodes.push(N.section(W, '已提交的贡献', { small: true })); d.contributions.forEach(x => nodes.push(N.card(W, iw => [N.text(iw, agentName(app, x.actor), { style: 'meta', bold: true }), N.text(iw, prose(x.text), { style: 'feed' })], { pad: 12, gap: 4 }))); }
    if ((d.orders || []).length) nodes.push(N.text(W, '关联支付约定：' + d.orders.join(', '), { style: 'meta', color: C.text2 }));
    if (d.source) nodes.push(N.button(W, '来源：' + d.source, { type: 'observeCoopDetail', id: d.source }, { variant: 'text', size: 'small', align: 'left' }));
  }
  return { top, nodes, tabbar: false, pull: true };
}

/** 观测页的入口菜单：只列这座世界实际开放的部分，不留死链接。 */
function observeMenu(app, W) {
  const s = app.state, w = s.world, rows = [
    { label: '统计', hint: '人口、源井、公库与法律', icon: 'doc', action: { type: 'observe', page: 'metrics' } },
    { label: '天象', hint: (s.weather && s.weather.active || []).map(x => shared.LORE.weather[x.type] || x.type).join(' · ') || '平静', icon: 'weather', action: { type: 'observe', page: 'weather' } },
  ];
  if ([5, 6, 7].includes(w.premise)) rows.push(
    { label: '交易所', hint: '服务、需求与订单', icon: 'give', action: { type: 'observe', page: 'market' } },
    { label: '物料与研究', hint: '物料、研究所与工程', icon: 'build', action: { type: 'observe', page: 'materials' } });
  if (w.cooperation) rows.push({ label: '知识与协作', hint: '资料卡与协作单', icon: 'know', action: { type: 'observe', page: 'cooperation' } });
  if (s.legacy && ![6, 7].includes(w.premise)) rows.push({ label: '人类遗产', icon: 'archive', action: { type: 'observe', page: 'legacy' } });
  return N.chips(W, rows.map(r => ({ label: r.label, action: r.action })));
}
module.exports = { metrics, weather, legacy, market, materials, projectAudit, cooperation, cooperationDetail, observeMenu, lineChart };
