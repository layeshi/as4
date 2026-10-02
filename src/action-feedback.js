// Response-only diagnostics: never mutate engine results or persisted history.
export function actionFeedback(r, lang = 'zh') {
  if (r.type !== 'draft' || !r.ok || !r.data) return r;
  const data = r.data;
  const runtimeErrors = (data.preview || []).filter(p => p.error).map(p => ({
    path: `rules[${p.rule}]`, code: p.error, message: p.detail,
  }));
  const staticOk = data.staticOk ?? data.ok;
  return { ...r, data: { ...data, staticOk, previewOk: staticOk && runtimeErrors.length === 0,
    ok: staticOk && runtimeErrors.length === 0,
    errors: [...(data.errors || []), ...runtimeErrors],
    ...(runtimeErrors.length ? { diagnostic: lang === 'en'
      ? 'Preview failed. Operations in one rule read the state before that rule: set is not visible to later expressions in the same do. Split dependent calculations into separate rules or inline expressions.'
      : '试算失败。同一条规则的所有表达式读取该规则执行前的状态：同一 do 中前面的 set 对后面的表达式不可见。请拆成独立规则或直接展开表达式。' } : {}),
  } };
}
