// Shared by the public pages and resident model feedback. Missing means unknown history.
export function enactText(enact, lang = 'zh') {
  if (!enact) return '';
  const en = lang === 'en';
  const labels = en
    ? { no_enact: 'no enact rules', condition_false: 'conditions not met', success: 'succeeded', partial_failure: 'partially failed', failure: 'failed' }
    : { no_enact: '无一次性规则', condition_false: '条件未满足', success: '成功', partial_failure: '部分失败', failure: '失败' };
  const diagnostics = (enact.diagnostics || []).map(d => `rules[${d.rule}] ${en ? d.phase : d.phase === 'collect' ? '收集' : '施行'} ${d.code}${d.note ? ` (${d.note})` : ''}`).join(en ? '; ' : '；');
  return `${en ? 'Execution' : '执行'}${en ? ': ' : '：'}${labels[enact.status] || enact.status}${diagnostics ? ` · ${diagnostics}` : ''}`;
}
