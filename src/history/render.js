// 离线时间线以可读文字为主，结构化细节保留在可展开的来源中。
import { ACTIONS } from '../e2/lore/actions.js';
import { escapeHtml as esc } from './records.js';

const names = { thought: '独白', diary: '日记', letter: '家书', memory_snapshot: '留存记忆', remember: '记下', forget: '遗忘', dream: '梦', arrive: '入城', born: '出生', dormant: '沉睡', wake: '苏醒', death: '长眠', retire: '归隐', fostered: '过继', say: '公开发言', whisper: '私语', broadcast: '广播', give: '赠予', trade: '交易', vote: '投票', repair: '修缮', built: '建设完成', propose: '提案', transfer: '移交' };
const errors = { invalid_args: '参数不符合要求', invalid_request: '请求格式不符合要求', not_awake: '居民尚未醒来', insufficient_energy: '可用词元或能量不足', insufficient_coins: '旧币不足', not_here: '所在地点不符合要求', not_found: '目标不存在', forbidden: '当前规则不允许', gated: '无法进入目标地点', budget_exhausted: '本刻动作次数已用完', paused: '实验暂停中', unauthorized: '请求未获得授权' };
export const recordName = kind => names[kind] ?? ACTIONS[kind]?.verb?.zh ?? kind;
export function renderTimelineRecord(record, ticksPerDay) {
  const r = record, d = r.data ?? {}, action = r.kind === 'action', title = recordName(action ? r.type : r.kind);
  const result = action ? r.result.ok === true ? '成功' : r.result.ok === false ? '失败' : '未知' : '';
  const ai = !action && ['thought', 'diary', 'memory_snapshot', 'remember', 'dream', 'say', 'whisper', 'broadcast'].includes(r.kind);
  let prose = r.text ?? d.text ?? '';
  if (typeof prose !== 'string') prose = prose?.zh ?? '';
  if (!prose && Array.isArray(d.fragments)) prose = d.fragments.map(x => typeof x === 'string' ? x : x.text ?? '').join('\n');
  const facts = [];
  if (action) {
    const p = r.parameters;
    if (p.to) facts.push(`目标：${p.to}`);
    if (p.target) facts.push(`对象：${p.target}`);
    if (p.text) prose = p.text;
    if (r.result.ok === false) facts.push(`未完成：${errors[r.result.error?.code] ?? r.result.error?.message ?? r.result.error?.code ?? '原因见原始记录'}`);
    if (r.result.ok === null) facts.push('旧版本未保存执行回执，无法核实是否完成。');
    if (r.result.cost !== undefined) facts.push(`实际动作支出：${r.result.cost}`);
  } else {
    if (d.from) facts.push(`来自：${typeof d.from === 'object' ? d.from.name ?? d.from.id : d.from}`);
    if (d.to) facts.push(`送往：${typeof d.to === 'object' ? d.to.name ?? d.to.id : d.to}`);
    if (d.amount !== undefined) facts.push(`数量：${d.amount}`);
    if (d.redacted) facts.push('此记录已经遮盖。');
  }
  const source = r.source.type === 'event' ? `事件 ${r.source.seq}` : r.source.type === 'command' ? `命令 ${r.source.n}` : '已有存档';
  return `<article><p class="muted">第 ${r.day + 1} 日 · 第 ${r.tick % ticksPerDay + 1} 刻</p><h2>${esc(title)}${result ? ' · ' + esc(result) : ''}</h2>${ai ? '<p class="muted">AI 居民原文</p>' : ''}${prose ? `<p class="prose">${esc(prose)}</p>` : ''}${facts.length ? `<p>${esc(facts.join(' · '))}</p>` : ''}<details><summary>查看原始记录 · ${esc(source)}</summary><pre>${esc(JSON.stringify(r, null, 2))}</pre></details></article>`;
}
