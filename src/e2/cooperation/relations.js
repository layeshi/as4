import { fail, emit } from '../engine/core.js';
import { P } from '../params.js';
import { COOP_LIMITS, requireCooperation, existingAgent, fields, text, cooperationEnabled } from './core.js';
import { departures } from './collaborations.js';

export const relationHandler = {
  validate({ w, a }, args) {
    const state = requireCooperation(w);
    fields(args, ['op', 'agent', 'text']);
    if (!['note', 'forget'].includes(args.op)) fail('invalid_args');
    const target = existingAgent(w, args.agent);
    if (target === a.id) fail('invalid_args');
    const notes = state.notes[a.id] ?? {};
    if (args.op === 'note' && (notes[target]?.forgotten !== false) && Object.values(notes).filter(n => !n.forgotten).length >= COOP_LIMITS.notes) fail('limit_reached');
    if (args.op === 'forget' && (!Object.hasOwn(notes, target) || notes[target].forgotten)) fail('not_found');
    return { op: args.op, target, text: args.op === 'note' ? text(args.text, COOP_LIMITS.note) : null, cost: 0, skipBefore: true };
  },
  apply({ w, a }, p) {
    w.cooperation.revision++;
    const notes = w.cooperation.notes[a.id] ??= {};
    const value = { actor: a.id, target: p.target, text: p.text, tick: w.clock.tick, op: p.op };
    const old = notes[p.target];
    const history = [...(old?.history ?? []), { ...value, releaseTick: w.clock.tick + P.privateDelayTicks }];
    // A forgotten note keeps only its delayed historical editions, not current text.
    notes[p.target] = { ...value, forgotten: p.op === 'forget', history };
    emit(w, 'relationship_note', { agent: a.id, vis: 'delayed', data: { target: p.target, op: p.op, text: p.text } });
    return { agent: p.target, op: p.op };
  },
};

function addFact(w, event, people, object = null, amounts = {}) {
  const state = w.cooperation;
  const participants = [...new Set(people)].filter(id => Object.hasOwn(w.agents, id));
  if (participants.length < 2) return;
  state.revision++;
  state.facts.push({ id: ++state.counters.fact, event: event.seq, tick: event.tick, command: w.commandN, kind: event.type, participants, object, ...amounts, releaseTick: event.vis === 'public' ? event.tick : event.releaseTick ?? event.tick + P.privateDelayTicks });
}
export function recordCooperation(w, cmd, out, replayed = false) {
  if (!cooperationEnabled(w) || replayed) return;
  if (cmd.type === 'act' && out.result?.ok) {
    for (const result of out.result.results ?? []) {
      if (!result.ok || !['repair','give','construct','contribute','write','say','broadcast','propose'].includes(result.type)) continue;
      const act=cmd.payload.actions[result.index], data=result.data??{};
      const id=`x${w.commandN}-${result.index}`;
      const effect=Object.fromEntries(['energy','materials','workAdded','from','to','doc','project','proposal'].filter(k=>typeof data[k]==='string'||Number.isSafeInteger(data[k])).map(k=>[k,data[k]]));
      w.cooperation.revision++;
      w.cooperation.activities[id]={id,actor:cmd.payload.agentId,type:result.type,tick:w.clock.tick,command:w.commandN,target:act.target??act.project??act.to??null,effect,kind:'verified_action'};
    }
  }
  departures(w);
  for (const e of out.events) {
    if (e.type === 'collaboration') {
      const c = w.cooperation.collaborations[e.data.id];
      const edition = c?.history[e.data.version - 1]?.value;
      if (edition) addFact(w, e, [e.agent, ...edition.members, ...(e.data.op === 'invite' ? edition.invited : [])], { kind: 'collaboration', id: c.id, version: e.data.version, op: e.data.op });
    } else if (['give', 'trade', 'order_accepted', 'order_settled'].includes(e.type)) {
      const data = e.data || {};
      const order = w.orders?.[data.id ?? data.orderId];
      const ref = x => typeof x === 'string' ? x : x?.id;
      addFact(w, e, [e.agent, ref(data.to), ref(data.from), ref(data.offerer), ref(data.acceptor), order?.requester, order?.provider], null,
        Object.fromEntries(['energy', 'materials'].filter(k => Number.isSafeInteger(data[k])).map(k => [k, data[k]])));
    }
  }
}
