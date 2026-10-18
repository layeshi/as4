const N = require('../ui/nodes');
const { C } = require('../ui/theme');
const { usable, moderationState, moderationNotice } = require('../utils/feed');
const label = value => usable(value) ? value : '文字暂未展示';
const reason = meta => ['loginRequired', 'rejected', 'unavailable', 'pending', 'withheld'].find(key => meta?.[key]);
const statuses = { generating: '正在生成…', pending: '内容正在审核，通过后显示全文', complete: '已完成', failed: '生成失败，可手动重试', cancelled: '已停止，未生成完整答案', withheld: '内容暂未展示：未通过审核、审核不可用或访问权限已变化' };
function assistant(app, W) {
  const a = app.assistant; a.sync(); const s = a.status || {}, nodes = [];
  const page = { top: { kind: 'back', title: '实验助手' }, nodes, tabbar: false, pull: true };
  if (!app.user || s.signedIn === false) {
    nodes.push(N.empty(W, '登录后向实验提问', '查询规则、居民与三城变化，重要事实附来源。助手只读，不代为操作实验。'), N.button(W, '前往登录', { type: 'tab', tab: 'account' }, { variant: 'primary' })); return page;
  }
  if (a.loading) nodes.push(N.text(W, '正在读取…', { style: 'meta', color: C.text3 }));
  if (a.error) nodes.push(N.banner(W, { title: '暂时无法完成', body: a.error, actions: [{ label: '刷新 / 重新验证', action: { type: 'assistantRefresh' } }] }));
  if (app.needsWechatLogin) nodes.push(N.button(W, '前往微信登录以阅读内容', { type: 'tab', tab: 'account' }, { variant: 'secondary' }));
  const w = s.world || {}, q = s.quota;
  nodes.push(N.text(W, 'AI 分析仅供观测 · 回答通过审核后展示', { style: 'meta', color: C.ai }));
  if (q) nodes.push(N.text(W, `今日剩余 ${q.remaining} / ${q.limit} · ${s.model || ''}\n恢复时间 ${new Date(q.resetAt).toLocaleString()}`, { style: 'caption', color: C.text3 }));
  if (w.id) nodes.push(N.text(W, `${w.id} · 纪元 ${w.epoch ?? '—'} · 分支 ${w.branchId?.slice(0, 8) || '—'}\n第 ${(w.day || 0) + 1} 日 · ${w.ended ? '已结束' : w.paused ? '已暂停' : '运行中'}\n数据截至 ${w.observedAt || '本次服务端查询时点'}`, { style: 'caption', color: C.text3 }));
  nodes.push(N.section(W, '对话'), N.button(W, '＋ 新对话', { type: 'assistantNew' }, { variant: 'secondary' }));
  for (const c of s.conversations || []) nodes.push(N.button(W, label(c.title) || '未命名对话', { type: 'assistantSession', id: c.id }, { variant: 'secondary' }));
  nodes.push(N.section(W, '本次问题范围'));
  const chips = (key, choices) => N.chips(W, choices.map(([value, text]) => ({ label: text, selected: a.scope[key] === value, action: { type: 'assistantScope', key, value } })));
  nodes.push(chips('mode', [['public', '公开记录'], ['resident', '我的居民私人记录'], ['research', '管理员研究']]));
  nodes.push(chips('branchId', [['', '当前世界'], ...(s.branches || []).map(b => [b.id, `${b.worldId} · 纪元${b.epoch} · ${b.id.slice(0, 8)}`])]), chips('city', [['', '全部城市'], ...(w.cities || []).map(c => typeof c === 'string' ? [c, c] : [c.id, label(typeof c.name === 'string' ? c.name : c.name?.zh || c.id)])]));
  nodes.push(N.text(W, '居民对象' + (a.scope.agentId ? ' · ' + a.scope.agentId : ' · 未指定'), { style: 'caption', color: C.text3 }));
  nodes.push(chips('agentId', [['', '未指定'], ...(s.branches?.find(b => b.id === a.scope.branchId)?.residents || s.residents || []).map(r => [r.id, label(r.name) + (r.managed ? ' · 我管理' : ' · 公开')])]));
  nodes.push(N.field(W, '历史居民 ID（填写后优先使用）', app.form.assistantResidentId || '', { type: 'field', name: 'assistantResidentId', max: 128 }, { placeholder: '按所选历史分支中的 ID 填写' }));
  if (a.scope.lawId) nodes.push(N.text(W, '带入法律：' + a.scope.lawId, { style: 'meta', color: C.moon }), N.button(W, '清除法律对象', { type: 'assistantScope', key: 'lawId', value: '' }, { variant: 'secondary' }));
  for (const [name, text] of [['assistantFrom', '起始世界日（可空）'], ['assistantTo', '结束世界日（可空）']]) nodes.push(N.field(W, text, app.form[name] || '', { type: 'field', name, max: 9 }, { placeholder: '从 1 开始' }));
  if (a.scope.mode === 'research') nodes.push(N.field(W, '管理密钥 · 仅本次内存中使用', app.form.assistantAdminKey || '', { type: 'field', name: 'assistantAdminKey', max: 256, secret: true }, { secret: true }));
  if (a.scope.mode === 'resident') nodes.push(N.text(W, 'P6/P7 按账号管理权验证；旧世界按其原有密钥验证。', { style: 'caption', color: C.text3 }), N.field(W, '旧世界造者密钥（按需填写）', app.form.assistantOwnerKey || '', { type: 'field', name: 'assistantOwnerKey', max: 256, secret: true }, { secret: true }));
  for (const m of a.conversation?.messages || []) {
    // Fail closed even if an unexpected server accidentally includes a draft in pending/failed responses.
    const readable = m.status === 'complete' && !reason(m.moderation);
    const children = [N.text(W, m.role === 'user' ? '你' : '实验助手 · AI 生成', { style: 'meta', color: C.ai }), N.text(W, readable ? label(m.text) : reason(m.moderation) ? moderationNotice(reason(m.moderation)) : statuses[m.status] || '内容暂未展示', { style: 'body' })];
    const o = m.observation;
    if (readable && o) children.push(N.text(W, `${o.worldId} · 纪元 ${o.epoch} · 分支 ${o.branchId?.slice(0, 8)} · 第 ${o.day + 1} 日
${o.ended ? '已结束' : o.paused ? '已暂停' : '运行中'} · 数据截至 ${o.observedAt}`, { style: 'caption', color: C.text3 }));
    if (readable) for (const source of m.sources || []) children.push(N.button(W, '来源 ' + (source.label ? '[' + source.label + '] ' : '· ') + label(source.title || source.id), { type: 'assistantSource', id: source.id }, { variant: 'secondary' }));
    if (m.role === 'assistant' && ['failed', 'cancelled', 'withheld'].includes(m.status)) children.push(N.button(W, '重试（计新次数）', { type: 'assistantRetry', id: m.id }, { variant: 'secondary' }));
    nodes.push(N.card(W, () => children, { pad: 0 }));
  }
  if (a.source) nodes.push(N.section(W, '回答来源'), N.text(W, reason(a.sourceModeration) ? '回答依据' : label(a.source.title), { style: 'heading' }), N.text(W, `${a.source.worldId || ''} · 纪元 ${a.source.epoch ?? '—'} · ${a.source.branchId?.slice(0, 8) || ''}${a.source.day != null ? ' · 第 ' + (a.source.day + 1) + ' 日' : ''}`, { style: 'caption', color: C.text3 }), N.text(W, reason(a.sourceModeration) || moderationState(a.source.text) ? moderationNotice(reason(a.sourceModeration) || moderationState(a.source.text)) : label(a.source.text), { style: 'body' }), N.button(W, '关闭来源', { type: 'assistantCloseSource' }, { variant: 'secondary' }));
  if (a.active) { if (a.conversation.messages.some(m => m.status === 'generating')) nodes.push(N.button(W, '停止生成', { type: 'assistantCancel' }, { variant: 'secondary' })); }
  else if (s.available) nodes.push(N.field(W, '你的问题', app.form.assistantText || '', { type: 'field', name: 'assistantText', max: 4000, multiple: true }, { placeholder: '例如：三城有哪些变化？', multiline: true }), N.button(W, '提问', { type: 'assistantAsk' }, { variant: 'primary' }));
  else nodes.push(N.text(W, '助手暂不可用，可查看已有对话。', { style: 'meta', color: C.text3 }));
  if (a.conversation) nodes.push(N.button(W, '刷新 / 重新验证', { type: 'assistantRefresh' }, { variant: 'secondary' }), N.button(W, '删除此对话（立即生效）', { type: 'assistantDelete' }, { variant: 'secondary' }));
  nodes.push(N.text(W, '每条消息保存 30 天。一次回答最长等待 60 秒；失败、停止、审核失败及重试也计次。切到后台会清除本页内容与密钥，可从会话列表重新验证后读取。', { style: 'caption', color: C.text3 }));
  return page;
}
module.exports = { assistant };
