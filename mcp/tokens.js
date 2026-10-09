// MCP transport for P4. Keep the old tools' request/output path untouched.
import { buildSystemPrompt, tokenPromptValues } from '../runner/prompt.js';
import { renderActResult, D2 } from '../runner/render-p2.js';
import { cityDisplayName } from '../src/e2/lore/index.js';
import { P } from '../src/e2/params.js';
import { errorMessage } from '../runner/client.js';
const total = bill => (bill?.reread || 0) + (bill?.read || 0) + (bill?.write || 0);
const text = (value, isError = false) => ({ content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) });

export function tokenTools(client) {
  let wakeId, bill = null, you = null, seen = 0;
  const remember = status => { if (status?.you) you = status.you; };
  const footer = (lang, cost) => !you ? '' : lang === 'en'
    ? `tokens ${you.energy} (basic ${you.basic}) · body today ${you.usedToday} / ${you.cap} · this step ${cost}`
    : `词元 ${you.energy}（基本额度 ${you.basic}）· 身体今天 ${you.usedToday} / ${you.cap} · 这一笔 ${cost}`;
  const finish = (value, lang, cost = 0, error = false) => text([value, footer(lang, cost)].filter(Boolean).join('\n'), error);
  async function refresh(lang) { const r = await client.me({ lang }); if (r.ok) remember(r.json); return r; }
  async function rejected(r, lang) {
    await refresh(lang);
    if (['tokens_exhausted','cap_reached','no_waking'].includes(r.json?.error?.code)) wakeId = undefined;
    return finish(errorMessage(r), lang, 0, true);
  }
  async function rules(lang, known) {
    const st = known ? { ok: true, json: known } : await refresh(lang);
    if (!st.ok) return finish(errorMessage(st), lang, 0, true);
    remember(st.json);
    const state = await client.state();
    if (!state.ok) return finish(errorMessage(state), lang, 0, true);
    const w = state.json.world, values = tokenPromptValues({ capacity: w.tokens.capacity, basicAllotment: w.tokens.basic });
    return finish(buildSystemPrompt({ protocol: 2, premise: 4, lang, cityName: cityDisplayName(w.cityName, lang),
      maxActions: st.json.you.maxActionsPerTick, ticksPerDay: st.json.now.ticksPerDay, daysPerMonth: st.json.now.daysPerMonth,
      memorySlots: P.memorySlots, floor: values.floor, tokenValues: { ...values, basicAllotment: w.tokens.basic }, soul: null, toolMode: 'mcp' }), lang);
  }
  async function call(name, args, lang) {
    if (name === 'houren_rules') return rules(lang);
    if (name === 'houren_perceive') {
      const r = await client.wake({ kind: 'main', lang, toolMode: 'mcp' });
      if (!r.ok) return rejected(r, lang);
      wakeId = r.json.wakeId; bill = r.json.bill; remember(r.json);
      return finish(r.json.text, lang, total(bill));
    }
    if (name === 'houren_look' || name === 'houren_act') {
      const before = total(bill);
      const r = name === 'houren_look'
        ? await client.look({ wakeId, what: args.what, id: args.id, lang })
        : await client.act({ wakeId, actions: args.actions, thought: args.thought, lang });
      if (!r.ok) return rejected(r, lang);
      remember(r.json); bill = r.json.bill;
      const cost = Math.max(0, total(bill) - before);
      const body = name === 'houren_look' ? r.json.text : renderActResult({ protocol: 2, premise: 4, lang, you: r.json.you }, { results: r.json.results || [], lang }) + (r.json.arrived ? `\n${r.json.arrived}` : '');
      if (r.json.arrivedWithheld !== undefined) wakeId = undefined;
      return finish(body, lang, cost);
    }
    if (name === 'houren_wait') {
      if (args.timeoutMs !== undefined && !Number.isInteger(args.timeoutMs)) return finish('timeoutMs must be an integer', lang, 0, true);
      const r = await client.wait({ after: seen, timeoutMs: args.timeoutMs, lang });
      if (!r.ok) return rejected(r, lang);
      const items = (r.json.items || []).map(({ seq, kind }) => ({ seq, kind }));
      seen = Math.max(seen, r.json.cursor || 0);
      await refresh(lang);
      return finish(items.length ? JSON.stringify(items) : D2[lang].res.mcpEmpty, lang);
    }
    return null;
  }
  return { call, rules, remember, rejected };
}
