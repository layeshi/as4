// 交易所只读观察：只查询公开信息，不持有居民令牌或提交居民行动。
import { h, clear, ai } from './dom.js';
import { api } from './api.js';
import { getLang, t } from './i18n.js';
import { section, agentLink, placeLink } from './render.js';
import { projectAudit } from './project-ui.js';

const text = (zh, en) => getLang() === 'en' ? en : zh;
const kinds = {
  program: ['程序服务', 'Program service'],
  material_delivery: ['物料交付', 'Material delivery'], construction: ['施工', 'Construction'],
  repair: ['维修', 'Repair'], document: ['作品交付', 'Document delivery'],
  announcement: ['公告发布', 'Announcement'], proposal: ['提案提交', 'Proposal'],
};
const statuses = {
  open: ['待承接', 'Open'], offered: ['待接受', 'Offered'], active: ['履约中', 'In progress'],
  completed: ['已结算', 'Settled'], cancelled: ['已取消', 'Cancelled'],
  expired: ['已到期', 'Expired'], failed: ['已终止', 'Terminated'],
};
const reasons = {
  program_delivered: ['程序结果已交付', 'Program result delivered'],
  criterion_met: ['已达到交付条件', 'Delivery criteria met'], deadline: ['超过约定期限', 'Deadline passed'],
  party_departed: ['交易一方已离开', 'A party has departed'], target_unavailable: ['目标已不可用', 'Target unavailable'],
  declined: ['承接者拒绝订单', 'Provider declined'], agreement: ['按取消规则解除', 'Cancelled under the agreed rules'],
};
const label = (map, key) => map[key] ? text(...map[key]) : key ?? '—';
const number = n => Number.isFinite(n) ? n.toLocaleString(getLang() === 'en' ? 'en-US' : 'zh-CN') : '—';
const criterion = row => row.criterionTemplate ?? row.terms?.criterion ?? {};
const endpoints = { services: '/api/public/services', demands: '/api/public/demands', orders: '/api/public/orders' };
// 只保留浏览状态；实时重绘不重置筛选、页码或已展开的条目。
const session = { view: 'services', agent: '', status: '', kind: '', cursors: [null], opened: new Set() };
let renderGeneration = 0, worldKey = null;

export function marketTime(tick, ticksPerDay) {
  if (!Number.isFinite(tick) || !Number.isFinite(ticksPerDay) || ticksPerDay <= 0) return '—';
  const day = Math.floor(tick / ticksPerDay) + 1, step = tick % ticksPerDay + 1;
  return text(`第 ${day} 日 · 第 ${step} 刻`, `Day ${day} · Tick ${step}`);
}

function renderRecord(ctx, row, isService) {
  const c = criterion(row), world = ctx.S.state.world;
  const price = number(isService ? row.price : row.terms?.price);
  const badge = h('span', { class: 'chip' }, isService ? text('服务中', 'Available') : label(statuses, row.status));
  const summary = h('div', { class: 'market-heading' },
    h('span', { class: 'market-title' }, ai(row.title)), badge,
    h('span', { class: 'market-price' }, `${price} ${text('词元', 'tokens')}`));
  const detail = h('details', { class: 'market-detail' },
    h('summary', null, text('查看交易详情', 'View trade details')));
  detail.open = session.opened.has(row.id);
  detail.addEventListener('toggle', () => {
    if (detail.open) session.opened.add(row.id); else session.opened.delete(row.id);
  });
  const resident = id => {
    if (!id) return text('待定', 'Unassigned');
    const link = agentLink(ctx, id);
    link.classList.add('ai');
    return link;
  };
  const parties = h('p', { class: 'market-parties' },
    isService ? [text('提供者：', 'Provider: '), resident(row.provider)]
      : [text('付款方：', 'Requester: '), resident(row.requester), ' · ', text('承接者：', 'Provider: '), resident(row.provider)]);
  const goal = c.quantity ?? c.work ?? c.bp ?? 1;
  const unit = c.kind === 'material_delivery' ? text('物料', 'materials') : c.kind === 'construction' ? text('工作量', 'work units') : c.kind === 'repair' ? text('基点', 'basis points') : text('项', 'item(s)');
  const progress = isService ? `${number(goal)} ${unit}` : `${number(row.progress)} / ${number(goal)} ${unit}`;
  const meta = h('p', { class: 'muted market-meta' }, `${label(kinds, c.kind)} · ${text('交付', 'Delivery')} ${progress}`,
    !isService && c.kind !== 'program' ? ` · ${text('截止', 'Due')} ${marketTime(row.dueTick ?? row.acceptBy, world.ticksPerDay)}` : '');
  const fields = h('dl', { class: 'kv market-facts' });
  const fact = (zh, en, value) => fields.append(h('dt', null, text(zh, en)), h('dd', null, value));
  fact('编号', 'ID', row.id);
  fact('交付要求', 'Requirement', `${label(kinds, c.kind)} · ${number(goal)} ${unit}`);
  if (c.to) fact('接收方', 'Recipient', ctx.agent(c.to) ? resident(c.to) : projectAudit(ctx, c.to));
  if (c.project) fact('工程', 'Project', [c.project, ' · ', projectAudit(ctx, c.project)]);
  if (c.target) {
    const road = ctx.S.state.roads?.find(r => r.id === c.target);
    fact('维修目标', 'Repair target', road
      ? [c.target, ' · ', placeLink(ctx, road.a), ' → ', placeLink(ctx, road.b)]
      : placeLink(ctx, c.target));
  }
  if (c.place || c.publishPlace) fact('地点', 'Place', placeLink(ctx, c.place ?? c.publishPlace));
  if (c.class) fact('提案类别', 'Proposal class', c.class === 'constitutional' ? text('宪制提案', 'Constitutional') : text('普通提案', 'Ordinary'));
  if (c.audience) fact('公告范围', 'Audience', c.audience === 'all' ? text('全城', 'Citywide') : text('指定地点', 'Specified place'));
  if (isService && c.kind === 'program') {
    fact('交付方式', 'Delivery', text('购买后自动运行并返回结果', 'Runs automatically on purchase'));
    fact('输入说明', 'Input instructions', ai(row.inputDescription ?? ''));
  } else if (isService) {
    fact('等待接单', 'Acceptance window', text(`${row.waitTicks} 刻`, `${row.waitTicks} ticks`));
    fact('履约时限', 'Delivery window', text(`${row.durationTicks} 刻`, `${row.durationTicks} ticks`));
    if (!c.to && !c.project && !c.target && ['material_delivery', 'construction', 'repair'].includes(c.kind)) {
      fact('目标', 'Target', text('由下单居民指定', 'Specified by the ordering resident'));
    }
  } else {
    fact('创建时间', 'Created', marketTime(row.createdTick, world.ticksPerDay));
    if (row.acceptedTick != null) fact('承接时间', 'Accepted', marketTime(row.acceptedTick, world.ticksPerDay));
    if (row.terms?.durationTicks != null) fact('承接后时限', 'Time after acceptance', text(`${row.terms.durationTicks} 刻`, `${row.terms.durationTicks} ticks`));
    if (row.terms?.eligible) fact('承接资格', 'Eligibility', row.terms.eligible === 'any' ? text('所有居民', 'All residents') : ai(ctx.groupName(row.terms.eligible)));
    if (c.kind !== 'program') fact(row.dueTick == null ? '接单截止' : '履约截止', row.dueTick == null ? 'Accept by' : 'Deliver by', marketTime(row.dueTick ?? row.acceptBy, world.ticksPerDay));
    fact('当前托管', 'Current escrow', `${number(row.escrow)} ${text('词元', 'tokens')}`);
    if (row.closedTick != null) fact('结束时间', 'Closed', marketTime(row.closedTick, world.ticksPerDay));
    if (row.reason) fact('结束原因', 'Outcome', label(reasons, row.reason));
    if (row.status === 'completed') fact('已支付报酬', 'Reward paid', `${price} ${text('词元', 'tokens')}`);
  }
  detail.append(h('p', { class: 'market-description' }, ai(row.description)), fields);
  if (!isService && c.kind === 'program') {
    detail.append(h('h4', null, text('购买输入', 'Purchase input')), h('pre', {class:'market-program-result'}, ai(row.input ?? '')),
      h('h4', null, text('运行结果', 'Program result')), h('pre', {class:'market-program-result'}, ai(row.output ?? '')));
  }
  if (!isService) {
    detail.append(h('h4', null, text('公开交付记录', 'Public delivery records')));
    const evidence = row.evidence ?? [];
    detail.append(evidence.length ? h('ul', { class: 'plain' }, evidence.map(e => h('li', null,
      `${text('交付', 'Delivered')} ${number(e.amount)} ${unit} · `,
      e.ref && c.kind === 'document' && ctx.S.state.docs?.some(d => d.id === e.ref)
        ? h('button', { class: 'link', type: 'button', onClick: () => ctx.openDoc(e.ref) }, e.ref)
        : e.ref ?? e.key ?? '—'
    ))) : h('p', { class: 'muted' }, text('暂无公开交付记录。', 'No public delivery records yet.')));
  }
  if (c.kind === 'program') detail.append(h('p', {class:'muted'}, text('按次付费，结果交付即结算；平台不保证计算结果正确。', 'Payment is per use on delivery; the platform does not guarantee result accuracy.')));
  else detail.append(h('p', { class: 'muted' }, text(
    '报酬全额托管，全部达标后一次支付；成本由承接者承担，超时退还报酬。作品只验交付，不评判质量或真伪。',
    'The full reward is held in escrow and paid once on complete delivery. Providers bear costs; expired orders refund the reward. Document orders verify delivery, not quality or truth.'
  )));
  // 摘要和参与方保持可见，详情默认收起；链接不嵌套进展开控件。
  return h('article', { class: 'card market-record' }, summary, parties, meta, detail);
}

export function renderMaterialsMarket(ctx, root) {
  if (![5, 6].includes(ctx.S.state.world.premise)) return;
  const key = `${ctx.S.state.world.id}:${ctx.S.state.world.epoch}`;
  if (key !== worldKey) {
    Object.assign(session, { agent: '', status: '', kind: '', cursors: [null], opened: new Set() });
    worldKey = key;
  }
  const generation = ++renderGeneration;
  let request = 0, nextCursor = null, busy = false;
  const title = text('交易所', 'Exchange');
  const tabs = h('div', { class: 'subtabs market-tabs', role: 'group', 'aria-label': text('交易分区', 'Trade sections') });
  const content = h('div', { class: 'market-records' });
  const notice = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });
  const retry = h('button', { class: 'btn', type: 'button', onClick: () => load() }, text('重试', 'Retry'));
  retry.hidden = true;
  const select = (name, options, value) => h('select', { 'aria-label': name, value },
    options.map(([key, name]) => h('option', { value: key, selected: key === value }, name)));
  const agents = [...ctx.S.state.agents].sort((a, b) => a.name.localeCompare(b.name));
  const resident = select(text('居民', 'Resident'), [['', text('全城居民', 'All residents')], ...agents.map(a => [a.id, `${a.name} · ${a.id}`])], session.agent);
  // 离世居民可能已不在当前名册中；保留已有筛选，不悄悄回到全城。
  if (session.agent && !agents.some(a => a.id === session.agent)) resident.append(h('option', { value: session.agent, selected: true }, session.agent));
  const state = select(text('订单状态', 'Order status'), [['', text('全部状态', 'All statuses')], ...Object.entries(statuses).map(([k, v]) => [k, text(...v)])], session.status);
  const kind = select(text('任务类型', 'Task type'), [['', text('全部类型', 'All types')], ...Object.entries(kinds).map(([k, v]) => [k, text(...v)])], session.kind);
  const field = (name, control) => h('label', { class: 'field' }, h('span', null, name), control);
  const stateField = field(text('订单状态', 'Order status'), state);
  const filters = h('div', { class: 'market-filters' }, field(text('居民', 'Resident'), resident), stateField, field(text('任务类型', 'Task type'), kind));
  const first = h('button', { class: 'btn', type: 'button', onClick: () => { session.cursors = [null]; void load(); } }, text('首页', 'First'));
  const previous = h('button', { class: 'btn', type: 'button', onClick: () => { session.cursors.pop(); void load(); } }, text('上一页', 'Previous'));
  const next = h('button', { class: 'btn', type: 'button', onClick: () => { if (nextCursor) { session.cursors.push(nextCursor); void load(); } } }, text('下一页', 'Next'));
  const page = h('span', { class: 'muted' });
  const refresh = h('button', { class: 'btn', type: 'button', onClick: () => load() }, text('刷新', 'Refresh'));
  const reset = h('button', { class: 'btn', type: 'button', onClick: () => {
    session.agent = session.status = session.kind = '';
    resident.value = state.value = kind.value = '';
    session.cursors = [null]; void load();
  } }, text('清除筛选', 'Clear filters'));
  const controls = () => {
    first.disabled = previous.disabled = busy || session.cursors.length === 1;
    next.disabled = busy || !nextCursor;
    refresh.disabled = busy;
    page.textContent = text(`第 ${session.cursors.length} 页`, `Page ${session.cursors.length}`);
    stateField.hidden = session.view === 'services';
    for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.view === session.view));
  };
  const load = async () => {
    const own = ++request, view = session.view;
    busy = true; nextCursor = null; retry.hidden = true; controls();
    content.setAttribute('aria-busy', 'true'); clear(content);
    notice.textContent = text('正在加载…', 'Loading…');
    const query = new URLSearchParams({ limit: '20', lang: getLang() });
    if (session.agent) query.set('agent', session.agent);
    if (session.kind) query.set('kind', session.kind);
    if (session.status && view !== 'services') query.set('status', session.status);
    if (session.cursors.at(-1)) query.set('after', session.cursors.at(-1));
    const r = await api(`${endpoints[view]}?${query}`);
    if (own !== request || generation !== renderGeneration) return;
    busy = false; content.setAttribute('aria-busy', 'false');
    if (!r.ok || !Array.isArray(r.json)) {
      notice.textContent = r.status === 401 ? text('请登录后查看交易信息。', 'Sign in to view trades.')
        : r.status === 403 ? text('当前账户无权查看交易信息。', 'This account cannot view trades.')
        : text('交易信息读取失败，请重试。', 'Could not load trades. Please retry.');
      if (r.status === 401) content.append(h('a', { class: 'link', href: '/login.html' }, text('前往登录', 'Sign in')));
      retry.hidden = false; controls(); return;
    }
    const rows = r.json;
    notice.textContent = text(`本页 ${rows.length} 条 · 按发布顺序展示`, `${rows.length} records on this page · Oldest first`);
    content.append(...rows.map(row => renderRecord(ctx, row, view === 'services')));
    if (!rows.length) content.append(h('div', { class: 'card market-empty' }, h('h4', null, text('暂无交易记录', 'No trade records')),
      h('p', { class: 'muted' }, text('可清除筛选、返回首页或稍后刷新。居民发布的服务、需求和订单会显示在这里。', 'Clear filters, return to the first page, or refresh later. Resident services, requests and orders will appear here.'))));
    nextCursor = rows.length === 20 ? rows.at(-1).id : null;
    controls();
  };
  for (const [value, zh, en] of [['services', '服务告示', 'Services'], ['demands', '需求大厅', 'Requests'], ['orders', '全部订单', 'All orders']]) {
    tabs.append(h('button', { class: 'subtab', type: 'button', dataset: { view: value }, onClick: () => {
      session.view = value; session.cursors = [null]; void load();
    } }, text(zh, en)));
  }
  for (const [control, key] of [[resident, 'agent'], [state, 'status'], [kind, 'kind']]) {
    control.addEventListener('change', () => { session[key] = control.value; session.cursors = [null]; void load(); });
  }
  root.append(section(title, h('p', { class: 'muted' }, text('观察全城居民的服务、需求与履约结果。交易由居民自主完成。', 'Observe resident services, requests and outcomes across the city. Residents conduct their own trades.')),
    h('p', { class: 'ai-note' }, t('aiNote')), tabs, filters,
    h('div', { class: 'toolbar' }, refresh, reset), notice, retry, content,
    h('nav', { class: 'toolbar market-pagination', 'aria-label': text('交易分页', 'Trade pagination') }, first, previous, page, next)));
  controls();
  return load();
}
