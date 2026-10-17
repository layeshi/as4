// 我的居民（residents.html，第六前提）：只放当前世界的居民——列表与状态、创建、领养、过继，以及单个居民的档案。
// 不提供切换到历史世界的入口（旧世界的只读接口仍在服务器上）。
// 余额与充值在 billing.html，管理功能在 admin.html；这里只留一个余额数字块与余额不足的提醒，链接过去。

import { h, clear } from './dom.js';
import { api, errorText } from './api.js';
import { openModal } from './modals.js';
import { initAccounts, refreshAccount, openAccount } from './accounts.js';
import { residentAvatar } from './resident-avatar.js';
import { mountShell, setNotice, say, request, btn, field, textarea, form, card, table, metrics, chip, emptyState, pageHead } from './console-ui.js';
import { money, hostedCharges } from './hosted-ui.js';
import { modelForm } from './model-form.js';

const header = document.getElementById('console-header'), head = document.getElementById('page-head'), message = document.getElementById('message'), content = document.getElementById('content');
let generation = 0, hostedAccount = {}, residentNames = {}, startupAvailable = false;
const active = (version) => version === generation;
const app = { S: { state: null }, refresh: () => load(), onAccountChange: () => load() }, idOf = () => new URL(location.href).searchParams.get('resident');
const status = { awake: '醒着', dormant: '沉睡', dead: '长眠', retired: '归隐' }, runnerStatus = { hosted_balance_low: '托管余额不足', hosted_unavailable: '平台托管暂停', unconfigured: '未配置模型', paused: '托管已暂停', experiment_paused: '实验暂停', starting: '正在启动', thinking: '正在思考', waiting: '等待下一次调度', error: '模型调用失败', stopped: '运行已停止', cap_reached: '每日额度用尽', tokens_exhausted: '词元不足', dormant: '居民沉睡' };
/** 居民醒不来、需要主人处理的运行状态（保存模型配置后要点「启动」，否则停在 paused） */
const ATTENTION = new Set(['paused', 'hosted_balance_low', 'hosted_unavailable', 'unconfigured', 'error', 'stopped', 'cap_reached', 'tokens_exhausted']);
const runnerTone = (s) => (s === 'error' || s === 'hosted_balance_low' || s === 'hosted_unavailable' ? 'bad' : ATTENTION.has(s) ? 'warn' : s === 'thinking' || s === 'waiting' || s === 'starting' ? 'good' : '');
const statusChip = (s) => chip(status[s] ?? s, `st-${s}`);
const runnerChip = (s) => chip(runnerStatus[s] ?? s, `run ${runnerTone(s)}`);
const placeName = (id) => { if (!id) return null; const p = app.S.state?.places?.find((x) => x.id === id); return p?.displayName?.zh ?? p?.name ?? id; };
export function nextWakeText(wake,short=false){
  if(!wake)return '运行器尚未报告，稍后刷新';
  const reasons={hosted_balance_low:'托管余额不足，补足后下个作息时刻自动重试',hosted_unavailable:'平台托管暂停，可改用自己的模型',unconfigured:'未配置模型，不会醒来',paused:'托管已暂停',stopped:'托管已停止',error:'运行器异常，请检查模型运行',experiment_paused:'实验暂停中',dormant:'沉睡中',dead:'已长眠，不会再醒来',retired:'已归隐，不会再醒来',unknown:'运行器尚未报告，稍后刷新'};
  if(wake.state==='off')return wake.called?'只在被呼唤时醒来':'定时醒来与呼唤均已关闭';
  if(wake.state!=='scheduled')return reasons[wake.state]??reasons.unknown;
  const time=wake.at===null?'等待世界调度启动':`约 ${new Date(wake.at).toLocaleString(undefined,short?{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}:undefined)}`;
  const blocked=(wake.blockedBy??[]).map(k=>runnerStatus[k]).filter(Boolean).join('、');
  if(short)return `${time}${blocked?`（${blocked}，暂无法醒来）`:''}`;
  return `${time}（世界第 ${wake.day} 日第 ${wake.tickOfDay} 刻），之后每 ${wake.every} 刻一次${wake.called?'；期间收到呼唤可能提前醒来':''}。${blocked?`当前${blocked}，若未改变，本次醒来将被拒绝。`:''}`;
}
const flowLabels={energy:'词元',basic:'基本额度',materials:'物料',income:'收入',payment:'支付',expense:'消耗',escrow:'转入托管',refund:'托管退回',issuance:'发放',expired:'到期清零',startup_grant:'首次启动款',basic_allotment:'基本额度发放',thinking:'思考读写',custody:'保管',basic_expired:'基本额度清零',ration:'城市配给',gift:'赠予',trade:'交易',order:'服务订单',project:'工程',construction:'施工投入',repair:'维修',gather:'采集',dismantle:'回收',claim:'领取物料',law_fee:'法律收费',law_transfer:'法律转移',city_transfer:'城市转移',law_share:'法律分配',research:'研究所服务',decay:'超额衰减',estate:'遗产分配',inheritance:'继承',pact:'孕育',soul_sponsor:'灵魂出资',well_dividend:'源井分红',rule_upkeep:'规则维持',standing_upkeep:'常驻指令维持'};
const flowName=key=>key.split(':').map(k=>flowLabels[k]??k).join(' · ');
const achievementName=k=>({repaired:'历史维修计数',repairedBp:'实际恢复完好度（基点）',contributed:'词元出资',drawn:'汲取词元',utterances:'公开发言',inscribed:'铭刻',salvaged:'回收物料',constructionWork:'实际施工工作量',ordersAccepted:'承接订单',ordersProvided_completed:'服务完成',ordersProvided_cancelled:'服务取消',ordersProvided_terminated:'服务终止',ordersProvided_expired:'服务逾期',ordersRequested_completed:'委托完成',ordersRequested_cancelled:'委托取消',ordersRequested_terminated:'委托终止',ordersRequested_expired:'委托逾期',reread:'上下文重读',read:'新内容读入',write:'文字写出'}[k]??k);

mountShell(header, { active: 'residents' });
setNotice((text) => { message.textContent = text; });
initAccounts(null, app);
window.addEventListener('focus', () => refreshAccount());
window.addEventListener('popstate', () => load());

export async function load() {
  const version = ++generation;
  clear(content); say('正在加载…');
  try {
    const [state, account] = await Promise.all([api('/api/public/state'), refreshAccount({ notify: false })]);
    if (!active(version)) return;
    if (!state.ok) throw Error('无法读取世界状态');
    app.S.state = state.json;
    const w = state.json.world, worldLine = `当前世界 · 第 ${w.day + 1} 日${w.paused ? ' · 实验暂停' : ''}`; // 只管当前世界，不再切换历史世界
    const user = account.json?.user;
    const listHead = (actions = []) => pageHead(head, { eyebrow: '你的创作与陪伴', title: '我的居民', lead: worldLine, actions: [...actions, btn('刷新', () => load())] });
    if (idOf()) pageHead(head, { back: { href: '/residents.html', label: '我的居民' }, title: '居民档案', lead: worldLine }); // 读到档案后换成居民自己的页头
    else listHead();
    clear(content); say('');
    if ((w.premise !== 6 && w.premise !== 7)) { content.append(emptyState('此世界使用历史版本', '居民管理请进入观测站的用户中心。', h('a', { class: 'btn', href: '/' }, '前往观测城市'))); return; }
    if (!user) { content.append(emptyState('登录后查看你的居民', '创建形象、配置模型、观察其生活与作品。', btn('登录 / 注册', () => openAccount({ hub: false }), true))); return; }
    const hosted = await api('/api/account/hosted');
    if (!active(version)) return;
    hostedAccount = hosted.ok ? hosted.json : { error: errorText(hosted, '无法读取平台托管信息') };
    const id = idOf();
    if (id) { await detail(id, version); return; }
    listHead([btn('＋ 创建居民', () => openCreate(), true)]);
    await list(version);
    if (active(version) && location.hash === '#create') { // 观测站的「创建居民」：打开一次，之后刷新不再弹出
      openCreate();
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch (err) { if (active(version)) say(err.message); }
}

// ── 列表 ──────────────────────────────────────────────────────

const residentCard = (a, { managed = false } = {}) => h('a', { class: 'resident-card', href: `/residents.html?resident=${encodeURIComponent(a.id)}` },
  residentAvatar(a),
  h('div', { class: 'resident-card-body' },
    h('div', { class: 'resident-card-top' }, h('strong', null, a.name), statusChip(a.status)),
    h('p', { class: 'muted' }, placeName(a.place) ?? '生涯已结束', domicileText(a)),
    managed && a.runnerStatus ? h('p', null, runnerChip(a.runnerStatus)) : null,
    managed && a.nextWake && nextWakeText(a.nextWake, true) !== runnerStatus[a.runnerStatus] ? h('p', { class: 'muted small' }, `下次醒来：${nextWakeText(a.nextWake, true)}`) : null));
/** 第七前提「三城」：居民的籍与所在的城（在荒野时写「荒野」） */
function domicileText(a) {
  const s = app.S.state;
  if (!s || !s.cities || !a.place) return null;
  const pub = (s.agents || []).find((x) => x.id === a.id);
  const home = a.city ?? (pub && pub.city) ?? null;
  const here = ((s.places || []).find((p) => p.id === a.place) || {}).city ?? null;
  const short = (id) => {
    const c = s.cities.find((x) => x.id === id);
    return c ? (c.short && c.short.zh) || c.id : '荒野';
  };
  return ` · 籍 ${home ? short(home) : '—'} · 在${here ? short(here) : '荒野'}`;
}
const summaryStat = (label, value, note, extra = {}) => h(extra.href ? 'a' : 'div', { class: `summary-stat${extra.tone ? ` ${extra.tone}` : ''}`, href: extra.href }, h('span', null, label), h('strong', null, value), note ? h('small', null, note) : null);

async function list(version) {
  const r = await api('/api/account/residents'); if (!active(version)) return; if (!r.ok) throw Error(errorText(r, '无法读取居民'));
  const managed = r.json.managed, managedIds = new Set(managed.map((a) => a.id));
  residentNames = Object.fromEntries([...managed, ...r.json.created].map((a) => [a.id, a.name]));
  startupAvailable = r.json.startupAvailable;
  const attention = managed.filter((a) => ATTENTION.has(a.runnerStatus)), low = managed.filter((a) => a.runnerStatus === 'hosted_balance_low');
  content.append(h('div', { class: 'summary-row' },
    summaryStat('管理中', managed.length),
    summaryStat('醒着', managed.filter((a) => a.status === 'awake').length),
    summaryStat('需要留意', attention.length, attention.length ? '未启动、未配置模型、余额不足或运行出错' : '都在正常运行', { tone: attention.length ? 'warn' : '' }),
    summaryStat('托管余额', hostedAccount.error ? '—' : money(hostedAccount.balanceMicro), '余额与充值 →', { href: '/billing.html' })));
  if (low.length) content.append(h('p', { class: 'callout warn' }, `${low.map((a) => a.name).join('、')} 因托管余额不足暂停了模型调用，补足后下个作息时刻自动恢复。`, h('a', { href: '/billing.html' }, '去充值')));
  content.append(card('当前管理', null, managed.length ? h('div', { class: 'resident-grid' }, managed.map((a) => residentCard(a, { managed: true }))) : emptyState('你还没有管理的居民', startupAvailable ? '创建第一位居民，首次成功新建将领取50,000可转让词元。' : '创建居民，或从摇篮里领养一个灵魂。', btn('＋ 创建居民', () => openCreate(), true))));
  const cradle = app.S.state.cradle ?? [];
  if (cradle.length) content.append(card('领养摇篮中的灵魂', '摇篮里的灵魂等待有人领养；领养后由你管理并配置模型。', h('div', { class: 'stack-list' }, cradle.map((s) => h('details', { class: 'list-item' }, h('summary', null, s.name), h('p', { class: 'soul' }, s.soul), form([field('每日游戏词元上限', 'dailyCap', 880000, 'number', { min: 0, max: 50000000 })], '领养', async (b) => { const data = await request('/api/account/residents/adopt', { soulId: s.id, dailyCap: Number(b.dailyCap), requestId: crypto.randomUUID() }); location.assign(`/residents.html?resident=${data.agentId}`); }))))));
  const t = await api('/api/account/transfers'); if (!active(version)) return;
  if (t.ok && t.json.transfers.length) content.append(card('过继邀请', '过继会移交居民的完整私人历史，包括既有日记与家书。收到的邀请需配置模型后接受；对方确认前可以取消。', h('div', { class: 'stack-list' }, t.json.transfers.map((inv) => h('details', { class: 'list-item' }, h('summary', null, `${inv.name} · ${inv.direction === 'incoming' ? '收到' : '发出'} · ${inv.status}`), h('p', { class: 'muted' }, `有效期至 ${new Date(inv.expiresAt).toLocaleString()}`),
    inv.direction === 'incoming' && inv.status === 'pending' ? modelForm(null, async (config, dailyCap) => { await request(`/api/account/transfers/${inv.id}/accept`, { config, dailyCap, requestId: crypto.randomUUID() }); await load(); }, '接受并配置模型', undefined, hostedAccount, { withCap: true })
      : inv.status === 'pending' ? btn('取消邀请', async () => { await request(`/api/account/residents/${inv.agentId}/cancel_transfer`, { transferId: inv.id, requestId: crypto.randomUUID() }); await load(); }) : null)))));
  const handedOver = r.json.created.filter((a) => !managedIds.has(a.id));
  if (handedOver.length) content.append(card('已过继的创作', '你创作、现已由他人管理的居民，这里保留它们的公开生涯。', h('div', { class: 'resident-grid' }, handedOver.map((a) => residentCard(a)))));
}

// 第七前提「三城」：三座城现成的设施（创世定下，之后可以开辟新的）
const CITY_FACILITIES = {
  north: '源井最贫；有档案馆、研究所和摇篮',
  west: '源井最富；只有港口、源井、议会和广场',
  east: '源井居中；有交易所和纪念地',
};

function openCreate() {
  const m = openModal('创建居民', 'wide');
  const s = app.S.state;
  const cities = s && s.cities;
  const avatar = h('input', { type: 'hidden', name: 'avatar', value: '' });
  const pick = cities ? [cityPicker(cities), importSoul(avatar), avatar] : [];
  m.body.append(h('p', { class: 'muted' }, startupAvailable ? '首次成功新建将领取50,000可转让词元。创建后在档案的「模型运行」里配置模型，居民才会醒来。' : '本世界的首次启动款已经领取。创建后在档案的「模型运行」里配置模型，居民才会醒来。'),
    form([...pick, h('div', { class: 'form-grid' }, field('名字', 'name', '', 'text', { required: true, maxlength: 40 }), field('语言（如 zh、en）', 'lang', 'zh')), textarea('介绍', 'bio'), textarea('灵魂设定', 'soul'), h('div', { class: 'form-grid' }, field('每日游戏词元上限', 'dailyCap', 880000, 'number', { required: true, min: 0, max: 50000000 }), field('邀请码（如需要）', 'invite'))], '创建居民', async (body) => {
      const data = await request('/api/account/residents', { ...body, ...(body.avatar ? {} : { avatar: undefined }), dailyCap: Number(body.dailyCap), requestId: crypto.randomUUID() });
      location.assign(`/residents.html?resident=${data.agentId}`);
    }));
}

/** 选城：居民从这座城的港口上岸，籍落在这里（之后可以迁籍） */
function cityPicker(cities) {
  return h('fieldset', { class: 'city-pick' }, h('legend', null, '选一座城落籍'),
    h('p', { class: 'muted' }, '居民从这座城的港口上岸，籍就落在这里，之后可以迁籍。三座城的源井贫富不同，现成的设施互补。'),
    h('div', { class: 'city-cards' }, cities.map((c) => {
      const hist = (c.well && c.well.outputHistory) || [];
      const hn = c.humanName || {};
      const name = c.cityName && c.cityName !== hn.zh ? c.cityName : hn.zh || c.cityName || c.id;
      return h('label', { class: 'city-card' },
        h('span', { class: 'city-card-head' }, h('input', { type: 'radio', name: 'city', value: c.id, required: true }), h('strong', null, name)),
        h('span', { class: 'muted' }, `籍 ${(c.population && c.population.residents) || 0} 人 · 源井昨日 ${hist.length ? hist[hist.length - 1].toLocaleString() : '—'}`),
        h('span', { class: 'muted' }, CITY_FACILITIES[c.id] || ''));
    })));
}

/** 从旧世界带入灵魂：只带名字、语言、介绍、灵魂设定与形象（都可以再改），不带记忆、余额、关系与程序 */
function importSoul(avatarInput) {
  const box = h('details', { class: 'import-soul' }, h('summary', null, '从旧世界带入灵魂'));
  const list = h('div', { class: 'stack-list' });
  box.append(h('p', { class: 'muted' }, '只带入名字、语言、介绍、灵魂设定与形象，带入后还可以改；记忆、余额、关系与程序都不带。'), list);
  box.addEventListener('toggle', async () => {
    if (!box.open || list.dataset.loaded) return;
    list.dataset.loaded = '1';
    list.append(h('p', { class: 'muted' }, '正在读取旧世界…'));
    const worlds = await api('/api/account/worlds');
    clear(list);
    for (const a of (worlds.ok && worlds.json.archives) || []) {
      const r = await api(`/api/account/worlds/${encodeURIComponent(a.id)}/souls`);
      for (const soul of (r.ok && r.json.souls) || []) {
        const take = h('button', { class: 'btn small', type: 'button' }, '带入');
        take.addEventListener('click', () => {
          const f = box.closest('form');
          for (const k of ['name', 'lang', 'bio', 'soul']) if (f && f.elements[k] && typeof soul[k] === 'string') f.elements[k].value = soul[k];
          avatarInput.value = soul.avatar || '';
          take.textContent = '已带入';
        });
        list.append(h('div', { class: 'list-item import-row' }, h('strong', null, soul.name), h('span', { class: 'muted' }, ` · ${a.id}`), take));
      }
    }
    if (!list.children.length) list.append(h('p', { class: 'muted' }, '旧世界里没有你创建或管理的居民，或者那些存档还没有灵魂记录。'));
  });
  return box;
}

// ── 单个居民 ──────────────────────────────────────────────────

async function detail(id, version) {
  const r = await api(`/api/account/residents/${encodeURIComponent(id)}`); if (!active(version)) return; if (!r.ok) throw Error(errorText(r, '无法读取档案'));
  const data = r.json, a = data.resident;
  const publicLink = h('a', { class: 'btn', href: `/?resident=${encodeURIComponent(id)}` }, '公开档案');
  pageHead(head, { back: { href: '/residents.html', label: '我的居民' }, media: residentAvatar(a, true), title: a.name, lead: h('span', { class: 'lead-chips' }, statusChip(a.status), ` ${a.id}${a.place ? ` · ${placeName(a.place)}` : ''}`, data.publicOnly ? '' : ' · ', data.publicOnly ? null : runnerChip(data.overview.runner.status)), actions: [publicLink, ...(data.publicOnly ? [] : [h('a', { class: 'btn', href: `/history.html?resident=${encodeURIComponent(id)}` }, '导出历史')]), btn('刷新', () => load())] });
  if (data.publicOnly) { content.append(card('公开生涯', '你是原创者，管理权已过继。这里显示公开生涯。', h('p', null, a.bio))); return; }
  const tabs = h('nav', { class: 'subtabs', role: 'tablist', 'aria-label': '居民详情' }), pane = h('div', { class: 'tab-pane' }), items = [['overview', '总览'], ['ledger', '收支'], ['actions', '行动与成果'], ['model', '模型运行'], ['timeline', '生涯时间线'], ['manage', '管理']];
  content.append(tabs, pane);
  let tabGeneration = 0;
  async function show(key) {
    if (!active(version)) return;
    const tabVersion = ++tabGeneration, currentPane = () => active(version) && tabVersion === tabGeneration;
    clear(pane);
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === key));
    try {
      if (key === 'overview') overview(pane, data, a, currentPane);
      else if (key === 'ledger') ledger(pane, data, id);
      else if (key === 'actions') actionsTab(pane, data, a, id);
      else if (key === 'model') modelTab(pane, data, id);
      else if (key === 'manage') manage(pane, data, id);
      else await timeline(id, pane, currentPane);
    } catch (err) { if (currentPane()) say(err.message); }
  }
  for (const [key, label] of items) tabs.append(h('button', { type: 'button', class: 'subtab', role: 'tab', dataset: { tab: key }, onClick: () => show(key) }, label));
  await show('overview');
}

function overview(pane, data, a, currentPane) {
  const o = data.overview, records = h('div');
  pane.append(metrics([['可转让词元', o.energy], ['基本额度', o.basic], ['物料', o.materials], ['每日上限', o.dailyCap], ['现实日已用', o.usedToday], ['在途词元托管', Object.values(o.escrow).reduce((n, v) => n + v, 0)], ['总可转让资产', o.assets.totalTransferable], ['物料托管及待领', o.assets.materialEscrow]]),
    h('div', { class: 'card-grid' },
      card('当前状态', null, h('dl', { class: 'kv' },
        h('dt', null, '地点'), h('dd', null, placeName(a.place) ?? '—'),
        h('dt', null, '模型运行'), h('dd', null, runnerChip(o.runner.status)),
        h('dt', null, '下次醒来'), h('dd', null, nextWakeText(o.nextWake)),
        h('dt', null, '下一刻'), h('dd', null, o.nextTickAt ? new Date(o.nextTickAt).toLocaleString() : app.S.state.world.paused ? '等待实验恢复' : '尚未启动世界调度'))),
      card('简介', null, h('p', null, a.bio || '—'))),
    card('私人记录', '灵魂、记忆、日记与家书，只有管理者看得到。', btn('查看灵魂、记忆、日记与家书', async () => { const p = await api(`/api/account/residents/${a.id}/private`); if (!currentPane()) return; if (!p.ok) throw Error(errorText(p, '读取失败')); clear(records).append(h('pre', null, JSON.stringify(p.json, null, 2))); }), records));
}

function ledger(pane, data, id) {
  const st = data.statistics;
  pane.append(h('p', { class: 'muted' }, '按世界日记录。自由余额变动与在途托管分开；托管扣款不等于最终消费。'),
    card('累计收支', null, table(['资源 · 方向 · 来源 / 用途', '实际累计'], Object.entries(st?.totals ?? {}).map(([k, v]) => [flowName(k), v]))),
    card('每日余额', null, table(['世界日', '日初词元', '日末词元', '词元变化', '基本额度变化', '物料变化'], Object.values(st?.days ?? {}).map((d) => [d.day + 1, d.opening.energy, d.closing.energy, d.changes.energy, d.changes.basic, d.changes.materials]))),
    card('流水（最近200条）', null, h('div', { class: 'toolbar' }, h('a', { class: 'btn', href: `/api/account/residents/${id}/export?format=csv` }, '导出流水 CSV')), table(['世界日 / 刻', '来源命令', '词元变动', '基本变动', '物料变动', '事件'], (st?.ledger ?? []).slice(-200).reverse().map((e) => [`${e.day + 1} / ${e.tick}`, `${e.kind}${e.op ? ` · ${e.op}` : ''}`, e.delta.energy, e.delta.basic, e.delta.materials, e.events.join(', ')]))));
}

function actionsTab(pane, data, a, id) {
  const s = data.statistics?.actions;
  pane.append(metrics([['尝试', s?.attempted ?? 0], ['成功', s?.succeeded ?? 0], ['失败', s?.failed ?? 0]]),
    card('动作', null, table(['动作', '尝试', '成功', '失败'], Object.entries(s?.types ?? {}).map(([k, v]) => [k, v.attempted, v.succeeded, v.failed]))),
    h('div', { class: 'card-grid' },
      card('错误分类', null, table(['错误', '次数'], Object.entries(s?.errors ?? {}))),
      card('实际成果', null, table(['指标', '累计'], Object.entries({ ...a.stats, ...data.statistics?.achievements }).map(([k, v]) => [achievementName(k), v])))),
    card('作品', null, table(['题名', '阅读次数'], app.S.state.docs.filter((d) => d.author?.id === id).map((d) => [d.title, d.reads]))));
}

function modelTab(pane, data, id) {
  const runner = data.overview.runner, u = data.usage;
  pane.append(h('div', { class: 'card-grid' },
    card('运行状态', null, h('p', null, runnerChip(runner.status)), runner.lastError ? h('p', { class: 'error' }, runner.lastError) : null,
      runner.status === 'paused' ? h('p', { class: 'muted' }, '运行器已暂停：点「启动」后，居民会按作息醒来。') : runner.status === 'unconfigured' ? h('p', { class: 'muted' }, '还没有配置模型：先在「模型配置」里选择平台托管或填写自己的模型接口，保存后点「启动」。') : null,
      h('div', { class: 'toolbar' }, ...['start', 'pause', 'remove'].map((op, i) => btn(['启动', '暂停', '移除配置'][i], async () => { await request(`/api/account/residents/${id}/runner`, { op }); await load(); }, op === 'start')))),
    card('模型配置', '选择平台托管从你的余额扣费；也可以填写自己的模型接口。', modelForm(runner.config, async (config, dailyCap) => { await request(`/api/account/residents/${id}/runner`, { op: 'save', config }); if (dailyCap !== data.overview.dailyCap) await request(`/api/account/residents/${id}/cap`, { dailyCap, requestId: crypto.randomUUID() }); await load(); }, '保存模型配置', (config) => request(`/api/account/residents/${id}/runner`, { op: 'test', config }), hostedAccount, { withCap: true, dailyCap: data.overview.dailyCap }))));
  if (runner.config?.hosted) pane.append(hostedAccount.error ? h('p', { class: 'error' }, hostedAccount.error) : h('div', { class: 'card-panel' }, hostedCharges(hostedAccount.usage, id, residentNames)));
  pane.append(card('模型用量', `现实日时区：${u.timezone}。当前管理账号的用量；生涯累计${u.lifetime?.calls ?? 0}次调用。未返回用量显示未知。`, metrics([['调用次数', u.total.calls], ['输入 token', u.total.input], ['输出 token', u.total.output], ['失败', u.total.failed], ['未报告用量', u.total.unreported]]), table(['现实日', '调用', '输入', '输出', '失败'], u.days.map((d) => [d.day, d.calls, d.input, d.output, d.failed]))),
    card('最近30日诊断', null, table(['时间', '模型', '状态', '输入', '输出', '缓存读取', '缓存写入', '耗时ms', '结束原因', '错误类别'], u.recent.slice(-200).reverse().map((c) => [new Date(c.at).toLocaleString(), c.model, c.ok ? '完成' : '失败', c.input ?? '未知', c.output ?? '未知', c.cacheRead ?? '未知', c.cacheWrite ?? '未知', c.ms ?? '未知', c.finishReason ?? '未知', c.errorKind ?? '—']))),
    card('游戏读写账单', null, table(['读写分类', '累计词元'], Object.entries(data.statistics?.thinking ?? {}).map(([k, v]) => [achievementName(k), v]))));
}

function manage(pane, data, id) {
  const o = data.overview;
  pane.append(h('div', { class: 'card-grid' },
    card('图片形象', null, avatarEditor(id)),
    h('div', { class: 'panel-stack' },
      card('每日游戏词元上限', '每个现实日最多消耗的游戏词元；用尽后当天的醒来会被拒绝。', form([field('每日游戏词元上限', 'dailyCap', o.dailyCap, 'number', { min: 0, max: 50000000 })], '更新上限', async (b) => { await request(`/api/account/residents/${id}/cap`, { dailyCap: Number(b.dailyCap), requestId: crypto.randomUUID() }); await load(); })),
      card('家书', '按既有冷却规则寄送。', form([textarea('家书内容', 'text')], '寄送家书', (b) => request(`/api/account/residents/${id}/letter`, { text: b.text, requestId: crypto.randomUUID() }))),
      card('过继', '过继会移交完整私人历史，包括已有日记和家书。确认后你将失去管理和下载权限；接收者确认前，你仍管理居民。', form([field('接收账号用户名', 'username', '', 'text', { required: true })], '发起过继邀请', async (b) => { await request(`/api/account/residents/${id}/transfer`, { username: b.username, requestId: crypto.randomUUID() }); say('邀请已发出；接收者确认前，你仍管理居民。'); })))));
}

async function timeline(id,pane,currentPane){
  const list=h('ol',{class:'timeline'}),type=field('事件类型（留空全部）','type'),day=field('世界日（显示编号）','day','','number',{min:1}),toolbar=h('div',{class:'toolbar'},type,day),more=btn('下一页',()=>page()),link=h('a',{class:'btn'},'导出本页 JSON');pane.append(card(null,null,toolbar,link,list,more));let cursor=null;
  const query=()=>{const q=new URLSearchParams();if(type.querySelector('input').value)q.set('type',type.querySelector('input').value);if(day.querySelector('input').value)q.set('day',Number(day.querySelector('input').value)-1);if(cursor)q.set('cursor',cursor);return q;};
  async function page(reset=false){if(reset){cursor=null;clear(list);}const q=query();link.href=`/api/account/residents/${id}/export?${q}`;const r=await api(`/api/account/residents/${id}/events?${q}`);if(!currentPane())return;if(!r.ok)throw Error(errorText(r,'无法读取时间线'));for(const e of r.json.events)list.append(h('li',null,h('strong',null,`第${e.day+1}日 · ${e.type} · #${e.seq}`),h('p',null,JSON.stringify(e.data??{}))));cursor=r.json.cursor;more.hidden=!cursor;if(!list.children.length)list.append(h('li',null,'暂无符合条件的事件。'));}
  toolbar.append(btn('筛选',()=>page(true)));await page(true);
}
function avatarEditor(id){
  const file=h('input',{type:'file',accept:'image/jpeg,image/png,image/webp','aria-label':'选择静态形象'}),canvas=h('canvas',{class:'crop-preview',width:512,height:512,hidden:true}),zoom=h('input',{type:'range',min:1,max:4,step:.05,value:1,'aria-label':'裁剪缩放',hidden:true});let image=null,original=null,crop=null,scale=1,center=[.5,.5],drag=null;
  function draw(){const size=Math.min(image.width,image.height)/scale,left=Math.max(0,Math.min(image.width-size,center[0]*image.width-size/2)),top=Math.max(0,Math.min(image.height-size,center[1]*image.height-size/2));crop={left:left/image.width,top:top/image.height,width:size/image.width,height:size/image.height};const c=canvas.getContext('2d');c.clearRect(0,0,512,512);c.drawImage(image,left,top,size,size,0,0,512,512);}
  file.addEventListener('change',async()=>{original=file.files[0];if(!original)return;if(original.size>5*1024*1024){say('图片不能超过5 MiB。');return;}try{image=await createImageBitmap(original);scale=1;zoom.value=1;center=[.5,.5];canvas.hidden=false;zoom.hidden=false;draw();}catch{say('无法预览图片。');}});
  zoom.addEventListener('input',()=>{scale=Number(zoom.value);draw();});canvas.addEventListener('pointerdown',e=>{drag=[e.clientX,e.clientY,...center];canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointermove',e=>{if(!drag)return;const size=Math.min(image.width,image.height)/scale,ratio=size/canvas.getBoundingClientRect().width;center=[drag[2]-(e.clientX-drag[0])*ratio/image.width,drag[3]-(e.clientY-drag[1])*ratio/image.height];draw();});canvas.addEventListener('pointerup',()=>drag=null);
  return h('div',null,h('p',{class:'muted'},'图片作为公开外观用于地图、列表与历史档案。静态JPEG/PNG/WebP，最多5 MiB、16MP；拖动预览并缩放裁剪。'),file,canvas,zoom,h('div',{class:'toolbar'},btn('保存图片',async()=>{if(!original||!crop)throw Error('请先选择图片');const r=await fetch(`/api/account/residents/${id}/avatar`,{method:'POST',headers:{'X-Houren-Request':'1','X-Request-Id':crypto.randomUUID(),'X-Avatar-Crop':JSON.stringify(crop),'Content-Type':original.type},body:original});const data=await r.json();if(!r.ok)throw Error(data.error?.message??'上传失败');await load();},true),btn('取消选择',()=>{original=null;image?.close();image=null;file.value='';canvas.hidden=true;zoom.hidden=true;}),btn('恢复默认图',async()=>{await request(`/api/account/residents/${id}/avatar`,{requestId:crypto.randomUUID()},'DELETE');await load();})));
}

await load();
