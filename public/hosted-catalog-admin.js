import { h } from './dom.js';
import { btn, field, form, card, table, request } from './console-ui.js';
import { catalogPriceLabels, microYuan } from './hosted-ui.js';

export function catalogAdmin(pane, data, refresh) {
  const c = data.config, modern = c.version === 2;
  const enabled = h('input', { name: 'enabled', type: 'checkbox', checked: modern && c.enabled });
  const clearKey = h('input', { name: 'clearApiKey', type: 'checkbox' });
  pane.append(card('OpenLux 接入设置', 'Key 决定线路分组。保存倍率不会立即调价：同步、测试后确认发布才生效。更换 Key 或接口会使旧目录失效，需要重新核验；在途调用继续按原版本结算。',
    form([
      h('label', { class: 'check' }, enabled, '开放平台托管'),
      field('OpenLux 推理接口地址（按官方接入文档填写）', 'baseURL', modern ? c.baseURL : '', 'url', { required: true }),
      field(modern && c.hasApiKey ? '平台 API Key（留空保留）' : '平台 API Key', 'apiKey', '', 'password', { autocomplete: 'off' }),
      h('label', { class: 'check' }, clearKey, '清除 Key'),
      field('计费倍率（美元价格 × 7 × 此倍率）', 'multiplier', c.multiplier ?? '1.2', 'text', { inputmode: 'decimal', required: true }),
      field('单次最大输出 token', 'maxOutputTokens', c.maxOutputTokens ?? 4096, 'number', { min: 256, max: 32000, required: true }),
    ], '保存 OpenLux 设置', async b => { await request('/api/admin/hosted/config', { version: 2, enabled: enabled.checked, baseURL: b.baseURL, apiKey: b.apiKey, clearApiKey: clearKey.checked, multiplier: b.multiplier, maxOutputTokens: Number(b.maxOutputTokens) }); await refresh(); })));
  if (!modern) { pane.append(h('p', { class: 'callout warn' }, '当前仍为旧版单模型配置。保存 OpenLux 设置后开始同步与核验；旧模型不在限定名单中时暂停，等待用户选择。')); return; }
  pane.append(card('已发布模型', `价格版本：${c.priceVersion ?? '尚未发布'}；倍率：${c.publishedMultiplier}；固定汇率：7。`, table(['模型', ...catalogPriceLabels.map(([,label]) => `${label}（元/百万起）`)], c.models.map(m => [m.id, ...catalogPriceLabels.map(([k]) => m.pricesMicro[k] == null ? '不适用' : microYuan(m.pricesMicro[k],6))]))));
  pane.append(btn('同步 OpenLux 价格（生成待发布草稿）', async () => { await request('/api/admin/hosted/catalog/sync', {}); await refresh(); }));
  const draft = c.draft;
  if (!draft) return;
  const selected = new Map();
  const items = draft.entries.map(m => {
    const tested = draft.tested[m.id];
    const include = h('input', { type: 'checkbox', checked: !!tested, disabled: !tested }); selected.set(m.id, include);
    const group = h('select', { name: `group-${m.id}` }, h('option', { value: '' }, '自动识别 Key 实际分组（推荐）'), m.groups.map(g => h('option', { value: g.group }, `${g.group}（×${g.ratio}）`)));
    group.value = tested?.group ?? c.models.find(x => x.id === m.id)?.group ?? '';
    const confirmed = h('input', { type: 'checkbox' });
    const notice = h('p', { role: 'status' });
    group.addEventListener('change', () => { include.checked = false; include.disabled = true; confirmed.checked = false; notice.textContent = '分组已变化，请重新核对并验证后发布。'; });
    const test = btn('验证此模型（平台承担调用费用）', async () => {
      notice.textContent = '正在验证…';
      try { await request('/api/admin/hosted/catalog/test', { draftId: draft.id, model: m.id, group: group.value, autoGroup: !group.value, groupConfirmed: confirmed.checked }); await refresh(); }
      catch (e) { notice.textContent = e.message; }
    });
    const tiers = tested ? table(['输入长度上限', ...catalogPriceLabels.map(([,label])=>label)], tested.tiers.map(t=>[t.upTo??'不限',...catalogPriceLabels.map(([k])=>t.pricesMicro[k]==null?'不适用':microYuan(t.pricesMicro[k],6))])) : null;
    return card(m.id, m.error ?? (tested ? '工具调用与用量返回已通过测试，可纳入本次发布。' : '未验证；不向用户开放。'), h('label', { class: 'check' }, include, '纳入本次发布'), h('label', { class: 'field' }, h('span', null, 'Key 对应分组（当前中间档须按实际配置核对）'), group), h('label', { class: 'check' }, confirmed, '手动指定时：已核对平台 Key 在此模型上的实际分组'), m.error ? null : test, tiers, notice);
  });
  pane.append(card('待发布价格', `${draft.fetchedAt} · 来源 OpenLux 官方目录 · 倍率 ${draft.multiplier}。发布会用勾选模型替换当前目录；未勾选模型将停止接受新调用。`, ...items,
    btn('确认发布勾选模型及价格', async () => { await request('/api/admin/hosted/catalog/publish', { draftId: draft.id, models: [...selected].filter(([,input])=>input.checked).map(([id])=>id) }); await refresh(); }, true)));
}
