import { cpLength, truncateCp } from '../../text.js';
import { fail } from '../engine/core.js';
import { COOP_LIMITS, cooperationEnabled, requireCooperation, bound, activeCollaboration } from './core.js';
import { canReadCard, cardFor } from './cards.js';
import { canReadCollaboration, collaborationFor } from './collaborations.js';

function sourceVisible(w, source, actor) {
  if (!source) return null;
  const c = w.cooperation.cards[source.id];
  if (!c) return null;
  if (actor !== null) return canReadCard(c, actor) && c.history[source.version-1] && canReadCard(c.history[source.version-1].value,actor) ? source : null;
  const v = c.history[source.version - 1];
  return v && v.releaseTick <= w.clock.tick ? source : null;
}
function cardValue(w, entry, actor, body = true) {
  const c = entry.value, record = w.cooperation.cards[c.id];
  return { id: c.id, author: c.author, title: c.title, ...(body ? { body: c.body, feedback: record.feedback.slice(0,c.feedbackCount ?? c.feedback?.length ?? 0), citations: record.citations.slice(0,c.citationCount ?? c.citations?.length ?? 0) } : {}), visibility: c.visibility, archived: c.archived, source: sourceVisible(w, c.source, actor), version: entry.version, tick: entry.tick };
}
function collaborationValue(w, entry, actor, details = true) {
  const c = structuredClone(entry.value);
  const record = w.cooperation.collaborations[c.id];
  if (!details) return { id: c.id, title: c.title, owner: c.owner, founder: c.founder, status: c.status, version: entry.version, tick: entry.tick };
  c.contributions = structuredClone(record.contributions.slice(0,c.contributionCount ?? c.contributions?.length ?? 0));
  c.tasks = c.tasks.map((t,i) => ({...t,submissions:structuredClone(record.tasks[i].submissions.slice(0,t.submissionCount ?? t.submissions?.length ?? 0)),reviews:structuredClone(record.tasks[i].reviews.slice(0,t.reviewCount ?? t.reviews?.length ?? 0))}));
  delete c.contributionCount;
  for(const task of c.tasks){delete task.submissionCount;delete task.reviewCount;}
  const permitted = id => {
    const card = w.cooperation.cards[id];
    return card && (actor === null ? card.history.some(h => h.releaseTick <= w.clock.tick) : canReadCard(card, actor));
  };
  for (const submission of new Set([...c.contributions, ...c.tasks.flatMap(t => t.submissions)])) if (submission.cards) submission.cards = submission.cards.filter(permitted);
  // Links do not expand an order or a source collaboration's private content.
  const source = w.cooperation.collaborations[c.source];
  if (source && !(actor === null ? source.history.some(h => h.releaseTick <= w.clock.tick) : canReadCollaboration(source, actor))) c.source = null;
  for(const item of new Set([...c.contributions,...c.tasks.flatMap(t=>t.submissions)])) if(item.evidence)item.evidence=item.evidence.map(id=>w.cooperation.activities[id]).filter(Boolean).map(e=>structuredClone(e));
  delete c.invited;
  return { ...c, version: entry.version, tick: entry.tick };
}
const visibleEdition = (w, record, version) => {
  if (version !== undefined) {
    const e = record.history[version - 1];
    return e?.releaseTick <= w.clock.tick ? e : null;
  }
  return record.history.findLast(e => e.releaseTick <= w.clock.tick) ?? null;
};
function page(records, args, key = 'id') {
  const after = args.after ?? '';
  const limit = args.limit ?? 10;
  if (typeof after !== 'string' || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) fail('invalid_args');
  const index = after ? records.findIndex(r => String(r[key]) === after) + 1 : 0;
  if (after && index === 0) fail('invalid_args');
  const items = records.slice(index, index + limit);
  return { items, next: index + limit < records.length ? String(items.at(-1)[key]) : null };
}
function version(args) {
  if (args.version !== undefined && (!Number.isSafeInteger(args.version) || args.version < 1)) fail('invalid_args');
  return args.version;
}
export function cooperationQuery(w, what, args = {}, actor = null) {
  const state = requireCooperation(w);
  if (what === 'cooperation_rules') return { limits: COOP_LIMITS, actions: {
    card: 'op=create/copy/revise/share/archive/cite/feedback; title,body,visibility=private/shared/public,readers,source={id,version}; edit uses id and expected version',
    collaborate: 'op=create/invite/join/claim/submit/review/update/leave/handoff/accept_handoff/finish/cancel/link; create:title,goal,tasks,visibility=public/invited,agents; task is zero-based; submit:text,cards,evidence; look relations id=actions for your verified action IDs; id=notes pages all your private notes; review:accept,text; handoff:to; link:order; source is a readable prior collaboration',
    relation: 'op=note/forget; agent,text. Private judgment, not a platform rating. Read/write charged, no new daily keeping fee.' }, privacy: 'Non-public editions become observable by humans only after the existing delay. Residents require current access. Changes never wake residents.' };
  if (what === 'cards') {
    if (args.id) {
      const c = actor === null ? (Object.hasOwn(state.cards,args.id)?state.cards[args.id]:null) : cardFor(w, args.id, actor);
      if (!c) fail('not_found');
      const v = version(args);
      const e = actor === null ? visibleEdition(w, c, v) : c.history[(v ?? c.history.length) - 1];
      if (!e || actor !== null && !canReadCard(e.value,actor)) fail('not_found');
      return cardValue(w, e, actor);
    }
    const rows = Object.values(state.cards).flatMap(c => {
      const e = actor === null ? visibleEdition(w, c) : canReadCard(c, actor) ? c.history.at(-1) : null;
      return e && (!args.mine || c.author === actor) && (!e.value.archived || args.archived === true) ? [cardValue(w, e, actor, false)] : [];
    });
    return page(rows, args);
  }
  if (what === 'collaborations') {
    if (args.id) {
      const c = actor === null ? (Object.hasOwn(state.collaborations,args.id)?state.collaborations[args.id]:null) : collaborationFor(w, args.id, actor);
      if (!c) fail('not_found');
      const v = version(args);
      const e = actor === null ? visibleEdition(w, c, v) : c.history[(v ?? c.history.length) - 1];
      if (!e || actor !== null && !canReadCollaboration(e.value,actor)) fail('not_found');
      return collaborationValue(w, e, actor);
    }
    const rows = Object.values(state.collaborations).flatMap(c => {
      const e = actor === null ? visibleEdition(w, c) : canReadCollaboration(c, actor) ? c.history.at(-1) : null;
      return e && (!args.mine || e.value.members.includes(actor)) ? [collaborationValue(w, e, actor, false)] : [];
    });
    return page(rows, args);
  }
  if (what === 'relations') {
    if (args.agent !== undefined && !Object.hasOwn(w.agents, args.agent)) fail('not_found');
    if (actor === null) {
      const notes = Object.values(state.notes).flatMap(set => Object.values(set).flatMap(n => {
        const e = n.history.findLast(h => h.releaseTick <= w.clock.tick);
        return e && e.op !== 'forget' && (!args.agent || e.actor === args.agent) ? [{ id: `${e.actor}:${e.target}`, actor: e.actor, target: e.target, text: e.text, tick: e.tick, kind: 'resident_judgment' }] : [];
      }));
      return page(notes, args);
    }
    if(args.id==='actions')return page(Object.values(state.activities).filter(e=>e.actor===actor),{...args,limit:args.limit??3});
    const notes = Object.values(state.notes[actor] ?? {}).filter(n => !n.forgotten && (!args.agent || n.target === args.agent)).map(n => ({ target: n.target, text: n.text, tick: n.tick }));
    if(args.id==='notes')return page(notes.map(n=>({id:n.target,...n})),{...args,limit:args.limit??3});
    const facts = state.facts.filter(f => f.participants.includes(actor) && (!args.agent || f.participants.includes(args.agent)));
    return { notes: args.agent ? notes : notes.slice(0,3), notesMore: args.agent ? 0 : Math.max(0,notes.length-3), facts: page(facts, { ...args, limit: args.limit ?? 3 }), judgment: 'Private resident interpretation; facts do not establish motives or trust.' };
  }
  fail('invalid_args');
}
export function cooperationBrief(w, actor, lang = 'zh') {
  if (!cooperationEnabled(w)) return '';
  const s = w.cooperation, en = lang === 'en';
  const own = Object.values(s.collaborations).filter(c => activeCollaboration(c) && c.members.includes(actor));
  const invitations = Object.values(s.collaborations).filter(c => activeCollaboration(c) && c.invited.includes(actor) && !c.members.includes(actor));
  const cards = Object.values(s.cards).filter(c => !c.archived && canReadCard(c, actor)).sort((a, b) => b.history.at(-1).command - a.history.at(-1).command);
  const lines = [en ? '[Knowledge & cooperation] look cards/collaborations/relations/cooperation_rules; details are paid and paged.' : '【知识与协作】look cards/collaborations/relations/cooperation_rules，详情按需分页付费读取。'];
  for (const c of [...own, ...invitations].slice(0, 3)) {
    const pending = c.tasks.flatMap((t, i) => (t.assignee === actor && ['claimed', 'submitted'].includes(t.status)) || c.owner === actor && t.status === 'submitted' ? [i] : []);
    lines.push(`${c.id} ${bound(c.title, 24)} ${c.status}${pending.length ? ` task:${pending.join(',')}` : ''}${c.handoff === actor ? ' handoff' : ''}${!c.members.includes(actor) ? ' invitation' : ''} v${c.history.length}`);
  }
  for (const c of cards.slice(0, 2)) lines.push(`${c.id} ${bound(c.title, 24)} v${c.history.length}`);
  const relevant = new Set(own.flatMap(c => c.members).filter(id => id !== actor));
  const n = Object.values(s.notes[actor] ?? {}).find(n => !n.forgotten && relevant.has(n.target));
  if (n) lines.push(`${en ? 'Your note' : '你的评价'} ${n.target}: ${bound(n.text, 60)}`);
  return bound(lines.join('\n'), COOP_LIMITS.brief - 1);
}
// Text paging uses a version pin for mutable objects and an offset inside that edition.
export function cooperationText(w, what, args, actor, max = COOP_LIMITS.page) {
  if (!Number.isSafeInteger(max) || max < 100) fail('limit_reached');
  const offset = args.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) fail('invalid_args');
  if (offset > 0 && args.version === undefined) fail('invalid_args');
  const value = cooperationQuery(w, what, args, actor);
  const edition = value.version ?? (what === 'cooperation_rules' ? 1 : w.cooperation.revision);
  if(offset>0 && args.version !== edition)fail('conflict');
  const raw = JSON.stringify(value), count = cpLength(raw);
  if (offset > count) fail('invalid_args');
  const room = Math.max(1, max - 160);
  const body = [...raw].slice(offset, offset + room).join('');
  const nextOffset = offset + cpLength(body) < count ? offset + cpLength(body) : null;
  const footer = `\n${JSON.stringify({ nextOffset, version: edition, next: value.next ?? value.facts?.next ?? null })}`;
  return { text: body + footer, nextOffset, version: edition, next: value.next ?? value.facts?.next ?? null };
}
