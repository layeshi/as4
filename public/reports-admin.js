import { h, clear } from './dom.js';
import { api, errorText } from './api.js';
import { card, form, field, metrics, btn, emptyState, request, tr } from './console-ui.js';
import { reportKind, reportRange, reportStatus } from './reports-ui.js';

export function reportsPanel() {
  const root = h('div', { class: 'page-body reports-admin' });
  async function load() {
    clear(root).append(h('p', { class: 'muted' }, tr('正在加载…', 'Loading…')));
    try {
      const [r, b] = await Promise.all([api('/api/admin/reports'), api('/api/history/branches')]);
      if (!r.ok) throw Error(errorText(r, '配置读取失败'));
      const data = r.json, config = data.config ?? {};
      const provider = h('select', { name: 'provider' }, [['openai', 'Chat Completions'], ['openai-responses', 'Responses'], ['anthropic', 'Anthropic']].map(([value, label]) => h('option', { value, selected: value === config.provider }, label)));
      clear(root).append(card(tr('AI 史官', 'AI chronicler'), tr('报告专用模型与独立额度，平台承担用量。保存配置后自动处理待生成报告。', 'A separate model and platform-funded budget. Pending reports resume after saving.'), metrics([[tr('今日已用 token', 'Tokens used today'), data.used], [tr('每日额度 token', 'Daily token limit'), data.limit], [tr('待处理', 'Pending'), data.pending]]),
        h('p', { class: 'muted' }, `${data.day} · ${data.timezone}`),
        form([h('label', { class: 'field' }, tr('接口类型', 'API type'), provider), field(tr('接口地址', 'Base URL'), 'baseURL', config.baseURL ?? 'https://api.openai.com/v1', 'url', { required: true }), field(tr('模型名称', 'Model'), 'model', config.model ?? '', 'text', { required: true }), field(tr('API Key（留空保留原密钥）', 'API key (blank keeps the existing key)'), 'apiKey', '', 'password', { autocomplete: 'new-password' }), field(tr('每日报告额度 token', 'Daily report token limit'), 'dailyLimit', data.limit, 'number', { min: 0, max: 10000000, required: true })], tr('保存史官配置', 'Save chronicler settings'), async values => { await request('/api/admin/reports/config', { ...values, dailyLimit: Number(values.dailyLimit) }); await load(); })));
      const branches = b.json?.branches ?? [];
      root.append(card(tr('补生成旧报告', 'Generate past reports'), tr('只处理已结束的完整周期，计入报告独立额度。', 'Completed periods only, charged to the separate report budget.'), form([
        h('label', { class: 'field' }, tr('世界与历史分支', 'World and history branch'), h('select', { name: 'branchId' }, branches.map(branch => h('option', { value: branch.id }, `${branch.worldId} · ${branch.id.slice(0, 8)}`)))),
        h('label', { class: 'field' }, tr('报告类型', 'Report type'), h('select', { name: 'kind' }, ['day', 'month', 'year'].map(value => h('option', { value }, reportKind(value))))),
        field(tr('周期起始世界日', 'First world day of the period'), 'fromDay', 1, 'number', { min: 1, required: true }),
      ], tr('提交补生成', 'Queue generation'), async values => { await request('/api/admin/reports/generate', { ...values, fromDay: Number(values.fromDay) - 1 }); await load(); })));
      root.append(card(tr('最近报告任务', 'Recent report jobs'), null, btn(tr('刷新任务', 'Refresh jobs'), load), ...data.reports.map(report => h('div', { class: 'list-item' }, h('strong', null, `${reportKind(report.kind)} · ${reportRange(report)}`), h('p', { class: 'muted' }, `${reportStatus(report)} · ${report.worldId} · ${report.branchId.slice(0, 8)}`), report.status === 'ready' ? h('a', { class: 'btn', href: `/reports.html?id=${report.id}` }, tr('查看报告', 'Read report')) : btn(tr('重试', 'Retry'), async () => { await request(`/api/admin/reports/${report.id}/retry`, {}); await load(); })))));
    } catch (error) { clear(root).append(emptyState(tr('报告配置读取失败', 'Report settings unavailable'), error.message, btn(tr('重试', 'Retry'), load))); }
  }
  load(); return root;
}
