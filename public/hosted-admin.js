import { catalogAdmin } from './hosted-catalog-admin.js';
// 管理后台里与模型计费有关的三块：平台托管（配置、连接测试、今日统计）、充值审核（待处理申请、手动调整、账号余额）、
// 公共角色模型（独立预算）。每块返回一个根节点，由 admin.js 挂到内容区。

import { h, clear } from './dom.js';
import { api, errorText } from './api.js';
import { btn, field, form, card, table, metrics, request, PENDING_POLL_MS } from './console-ui.js';
import { microYuan, yuanMicro, money, priceLabels, timeText, moneyField, noteField, checkedNote, requestChip } from './hosted-ui.js';
import { modelForm } from './model-form.js';

/**
 * 读 GET /api/admin/hosted 并交给 render 画；操作成功后 render 里调用 refresh 重读。
 * pollMs：定时重读；key(view) 变了才重画。管理员正在处理（展开了入账 / 拒绝、改过输入框、焦点在面板里）时不重画，只提示。
 * onView(view)：每次读到都调用（含不重画的那次）。
 */
function hostedPanel(render, { pollMs = 0, key = () => '', onView, stale = () => '' } = {}) {
  const root = h('div', { class: 'hosted-admin' }), notice = h('p', { role: 'status' }), fresh = h('p', { class: 'callout warn', role: 'status', hidden: true }), pane = h('div', { class: 'panel-stack' });
  let shownKey = null, initial = new Map(), timer = null;
  function draw(view) {
    clear(pane);
    notice.textContent = '';
    fresh.hidden = true;
    render(pane, view, refresh);
    shownKey = key(view);
    initial = new Map([...pane.querySelectorAll('input,textarea,select')].map((el) => [el, el.value]));
  }
  const editing = () => [...pane.querySelectorAll('details')].some((d) => d.open) || [...initial].some(([el, value]) => el.value !== value) || (typeof document !== 'undefined' && !!document.activeElement && root.contains(document.activeElement));
  function schedule() {
    clearTimeout(timer);
    if (!pollMs || !root.isConnected) return;
    timer = setTimeout(poll, pollMs);
    timer?.unref?.(); // 只在 Node（测试）里有：别让定时检查拖住进程
  }
  async function poll() {
    if (!root.isConnected) return;
    if (typeof document === 'undefined' || !document.hidden) {
      const r = await api('/api/admin/hosted');
      if (!root.isConnected) return;
      if (r.ok) {
        onView?.(r.json);
        if (key(r.json) !== shownKey) {
          if (editing()) { fresh.textContent = stale(r.json); fresh.hidden = false; } else draw(r.json);
        }
      }
    }
    schedule();
  }
  async function refresh() {
    const r = await api('/api/admin/hosted');
    if (!root.isConnected) return;
    if (!r.ok) throw Error(errorText(r, '无法读取托管管理信息'));
    onView?.(r.json);
    draw(r.json);
    schedule();
  }
  const reload = async () => {
    notice.textContent = '正在加载…';
    notice.className = '';
    try { await refresh(); } catch (err) { notice.className = 'error'; notice.textContent = err.message; }
  };
  root.append(h('div', { class: 'panel-toolbar' }, btn('刷新', reload)), notice, fresh, pane);
  reload();
  return root;
}

export function hostedConfigPanel() {
  return hostedPanel((pane, d, refresh) => {
    catalogAdmin(pane, d, refresh);
    if (d.config.version === 2) return;
    const c = d.config, today = d.stats.today;
    pane.append(h('p', { class: `callout ${d.available ? 'good' : 'warn'}` }, d.available ? '平台托管已开放：选择托管的居民从各自账号的余额扣费。' : '平台托管暂未开放：勾选「开放」并配齐接口地址、模型、API Key 与三个单价后，居民才能选择托管。'));
    if (d.storageFault) pane.append(h('p', { class: 'callout bad' }, '托管账本暂不可用，入账与调整已暂停。'));
    const enabled = h('input', { name: 'enabled', type: 'checkbox', checked: c.enabled }), clearKey = h('input', { name: 'clearApiKey', type: 'checkbox' });
    const fields = [h('label', { class: 'check' }, enabled, '开放'), field('接口地址', 'baseURL', c.baseURL, 'url', { required: true }), field('模型 ID', 'model', c.model), field(c.hasApiKey ? 'API Key（已配置，留空保留）' : 'API Key（留空保留）', 'apiKey', '', 'password', { autocomplete: 'off' }), h('label', { class: 'check' }, clearKey, '清除 API Key'), h('label', { class: 'field' }, h('span', null, '思考模式'), h('select', { name: 'thinking' }, [['default', '默认'], ['enabled', '开启'], ['disabled', '关闭']].map(([value, label]) => h('option', { value, selected: c.thinking === value }, label)))), field('单次最大输出 token', 'maxOutputTokens', c.maxOutputTokens, 'number', { min: 256, max: 32000, required: true }), h('p', { class: 'field-group' }, '单价（元 / 百万 token）'), h('div', { class: 'form-grid' }, ...priceLabels.map(([key, label]) => moneyField(label, key, c.pricesMicro ? microYuan(c.pricesMicro[key], 6) : '', { required: false })))];
    const config = (b) => {
      const result = { enabled: enabled.checked, baseURL: b.baseURL, model: b.model, apiKey: b.apiKey, clearApiKey: clearKey.checked, thinking: b.thinking, maxOutputTokens: Number(b.maxOutputTokens) };
      if (!Number.isInteger(result.maxOutputTokens) || result.maxOutputTokens < 256 || result.maxOutputTokens > 32000) throw Error('单次最大输出须为256–32000的整数');
      if (c.pricesMicro || priceLabels.some(([key]) => b[key]?.trim())) result.pricesMicro = Object.fromEntries(priceLabels.map(([key]) => [key, yuanMicro(b[key])]));
      return result;
    };
    const configForm = form(fields, '保存托管配置', async (b) => { await request('/api/admin/hosted/config', config(b)); await refresh(); }), testNotice = h('p', { role: 'status' });
    configForm.querySelector('.form-actions').append(btn('测试连接', async () => {
      testNotice.textContent = '正在测试…';
      testNotice.className = '';
      try {
        const result = await request('/api/admin/hosted/test', config(Object.fromEntries(new FormData(configForm))));
        await refresh();
        pane.prepend(h('p', { class: 'callout good', role: 'status' }, `模型连接测试成功：${result.model}。`));
      } catch (err) { testNotice.className = 'error'; testNotice.textContent = err.message; }
    }));
    configForm.append(testNotice);
    pane.append(h('div', { class: 'card-grid hosted-grid' },
      card('托管配置', '旧版单模型配置（迁移前兼容）。请使用上方 OpenLux 接入设置升级；测试调用由平台承担费用。', configForm),
      card('今日统计', `${d.day} · ${d.timezone}`, metrics([['余额合计', money(d.stats.balanceMicro)], ['在途预留', money(d.stats.reservedMicro)], ['今日扣费', money(today.costMicro)], ['今日调用', today.calls], ['今日 token', today.tokens], ['输入 token', today.input], ['缓存命中 token', today.cacheRead], ['输出 token', today.output], ['托管居民', d.stats.hostedResidents]]))));
  });
}

/** 充值审核；onPending(n) 报告待处理申请数（角标）。每 pollMs 检查一次，有新申请或别处的处理就更新。 */
export function hostedBillingPanel({ onPending, pollMs = PENDING_POLL_MS } = {}) {
  const key = (d) => JSON.stringify([d.requests.map((r) => r.id), !!d.storageFault, (d.history ?? []).map((r) => `${r.id}:${r.status}`).slice(0, 5)]);
  const stale = (d) => `有新的入账申请或状态变化（现在共 ${d.requests.length} 笔待处理）。处理完当前表单后点「刷新」查看。`;
  return hostedPanel((pane, d, refresh) => {
    if (d.storageFault) pane.append(h('p', { class: 'callout bad' }, '托管账本暂不可用，入账与调整已暂停。'));
    const mutationForm = (fields, label, submit) => {
      const f = form(fields, label, submit);
      if (d.storageFault) for (const el of f.querySelectorAll('input,button')) el.disabled = true;
      return f;
    };
    pane.append(
      card('待处理入账申请', d.requests.length ? `共 ${d.requests.length} 笔。核对到账后入账；实际入账金额可与申请金额不同。` : '没有待处理的申请。', table(['用户名', '申请金额', '付款说明', '申请时间', '处理'], d.requests.map((r) => [r.username ?? r.accountId, money(r.amountMicro), r.note || '—', timeText(r.createdAt), h('div', { class: 'row-decisions' },
        h('details', null, h('summary', null, '入账'), mutationForm([moneyField('实际入账金额（元）', 'credit', microYuan(r.amountMicro, 6)), noteField('入账说明（最多200字）')], '确认入账', async (b) => { await request(`/api/admin/hosted/requests/${encodeURIComponent(r.id)}/approve`, { creditMicro: yuanMicro(b.credit, { min: 1 }), note: checkedNote(b.note) }); await refresh(); })),
        h('details', null, h('summary', null, '拒绝'), mutationForm([noteField('拒绝原因（必填，最多200字）', true)], '确认拒绝', async (b) => { await request(`/api/admin/hosted/requests/${encodeURIComponent(r.id)}/reject`, { note: checkedNote(b.note, true) }); await refresh(); })))]))),
      card('手动调整余额', '正数增加余额，负数扣减余额。纠错、赠送或线下退款须写明原因。', mutationForm([field('用户名', 'username', '', 'text', { required: true }), moneyField('调整金额（元，可为负数）', 'amount', '', { inputmode: 'text' }), noteField('调整原因（必填，最多200字）', true)], '调整余额', async (b) => {
        const amountMicro = yuanMicro(b.amount, { signed: true, min: -Number.MAX_SAFE_INTEGER });
        if (!amountMicro) throw Error('调整金额不能为0');
        await request('/api/admin/hosted/adjust', { username: b.username.trim(), amountMicro, note: checkedNote(b.note, true) });
        await refresh();
      })),
      card('最近处理的申请', '最近 50 笔已入账、已拒绝或已撤回的申请，按处理时间新的在前。用户说提交过却不在待处理里时，先在这里查。', table(['用户名', '申请金额', '状态', '实际入账', '付款说明', '处理说明', '处理人', '申请时间', '处理 / 撤回时间'], (d.history ?? []).map((r) => [r.username ?? r.accountId, money(r.amountMicro), requestChip(r.status), r.status === 'approved' ? money(r.creditMicro) : '—', r.note || '—', r.adminNote || '—', r.status === 'cancelled' ? '用户撤回' : r.deciderName ?? r.decider ?? '—', timeText(r.createdAt), timeText(r.decidedAt ?? r.cancelledAt)]))),
      card('账号余额与累计用量', `余额合计 ${money(d.stats.balanceMicro)} · 在途预留 ${money(d.stats.reservedMicro)}`, table(['用户名', '余额', '在途预留', '累计调用', '输入 token', '缓存命中 token', '输出 token', '累计扣费'], d.accounts.map((a) => [a.username ?? `已删除账号 · ${a.accountId}`, money(a.balanceMicro), money(a.reservedMicro), a.total.calls, a.total.input, a.total.cacheRead, a.total.output, money(a.total.costMicro)]))));
  }, { pollMs, key, stale, onView: (d) => onPending?.(d.requests.length) });
}

/** 公共角色模型：独立于城市额度的每日预算与共享模型配置 */
export function publicModelPanel() {
  const root = h('div', { class: 'public-model' }), notice = h('p', { role: 'status' }), pane = h('div', { class: 'panel-stack' });
  async function load() {
    notice.className = '';
    notice.textContent = '正在加载…';
    const r = await api('/api/admin/public-model');
    if (!r.ok) { notice.className = 'error'; notice.textContent = errorText(r, '读取失败'); return; }
    notice.textContent = '';
    clear(pane).append(
      card('独立预算', `现实日时区：${r.json.timezone}`, metrics([['今日已用', r.json.used], ['在途预留', r.json.reserved], ['每日硬上限', r.json.limit]])),
      card('共享模型', '公共角色回答居民提问时使用的模型；额度独立于城市词元。', modelForm(r.json.config, (config) => request('/api/admin/public-model', { ...config, dailyLimit: 1000000 }), '保存共享模型（独立于城市额度）', undefined, null)));
  }
  root.append(h('div', { class: 'panel-toolbar' }, btn('刷新', load)), notice, pane);
  load();
  return root;
}
