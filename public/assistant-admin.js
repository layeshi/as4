import { h, clear } from './dom.js';
import { assistantRequest } from './assistant-client.js';
import { card, form, field, metrics, btn, emptyState, tr } from './console-ui.js';
export function assistantPanel() {
  const root = h('div', { class: 'page-body' });
  async function load() {
    clear(root).append(h('p', { class: 'muted' }, tr('正在加载…', 'Loading…')));
    try {
      const data = await assistantRequest('/api/admin/assistant'), c = data.config, u = data.usage;
      clear(root).append(card(tr('实验助手', 'Experiment assistant'), tr('平台承担费用，不扣用户余额；预算包含在途预留，北京时间零点重置。', 'Platform funded; user balances are unaffected. Budgets include reservations and reset at midnight Beijing time.'),
        metrics([[tr('今日成本（元）', 'Today’s cost (CNY)'), u.costYuan], [tr('在途预留（元）', 'Reserved (CNY)'), u.reservedYuan], [tr('调用次数', 'Calls'), u.calls], [tr('失败次数', 'Failures'), u.failures]]),
        h('p', { class: 'muted' }, `${u.day} · ${tr('单次等待', 'Timeout')} ${c.timeoutSeconds} s · ${data.available ? tr('可用', 'Available') : tr('未就绪', 'Unavailable')}`),
        form([h('label', { class: 'field' }, tr('已验证模型', 'Verified model'), h('select', { name: 'model' }, data.models.map(m => h('option', { value: m.id, selected: m.id === c.model, disabled: !m.available }, m.id + (m.available ? '' : tr(' · 不可用', ' · Unavailable')))))), field(tr('每账号每日次数', 'Questions per account per day'), 'dailyQuestions', c.dailyQuestions, 'number', { min: 0, max: 1000, required: true }), field(tr('全站每日预算（人民币元）', 'Daily site budget (CNY)'), 'dailyBudgetYuan', c.dailyBudgetYuan, 'number', { min: 0, step: '0.01', required: true })], tr('保存助手设置', 'Save assistant settings'), async values => { await assistantRequest('/api/admin/assistant', { method: 'POST', body: { model: values.model, dailyQuestions: Number(values.dailyQuestions), dailyBudgetYuan: Number(values.dailyBudgetYuan) } }); await load(); }), btn(tr('刷新用量', 'Refresh usage'), load)));
    } catch (error) { clear(root).append(emptyState(tr('助手配置暂不可用', 'Assistant settings unavailable'), error.message, btn(tr('重试', 'Retry'), load))); }
  }
  load(); return root;
}
