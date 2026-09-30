// 政治的动作（SPEC §19 第 4 步）：propose vote

import { LIMITS } from '../../params.js';
import { ACTIONS } from '../../lore/index.js';
import { fail, emit, needText, optText, needId } from '../core.js';
import {
  validateEffects, openProposal, openProposals, ensureElectorate, inElectorate, isCitizen,
} from '../laws.js';
import { noteWordUse } from '../society.js';

const CHOICES = ['yes', 'no', 'abstain'];

/** propose：在议会提出法案（文本 + 可选的可执行效力） */
function propose(ctx, args) {
  const { w, a } = ctx;
  ensureElectorate(w);
  if (a.place !== 'parliament') fail('wrong_place');
  if (a.exiled) fail('exiled');
  if (!isCitizen(w, a)) fail('not_citizen');
  if (!inElectorate(w, a)) fail('not_eligible');
  const title = needText(args.title, { max: LIMITS.proposalTitle });
  const text = needText(args.text, { max: LIMITS.proposalText });
  const effects = validateEffects(w, args.effects);
  const open = openProposals(w);
  if (open.some((p) => p.proposer === a.id)) fail('limit_reached');
  if (open.length >= LIMITS.openProposalsCity) fail('limit_reached');
  ctx.pay(ACTIONS.propose.base);
  const p = openProposal(w, a, { title, text, effects });
  noteWordUse(w, a, title);
  noteWordUse(w, a, text);
  emit(w, 'propose', {
    agent: a.id, place: a.place,
    data: { proposalId: p.id, title, text, effects, governance: p.governance, closesTick: p.closesTick },
  });
  return { proposal: p.id, closesTick: p.closesTick, governance: p.governance };
}

/** vote：投票者须属于选民范围；votingInPerson 为真时须在议会；可改票，以最后一次为准 */
function vote(ctx, args) {
  const { w, a } = ctx;
  ensureElectorate(w);
  needId(args.proposal);
  const p = w.proposals[args.proposal];
  if (!p || p.status !== 'open') fail('not_found');
  if (a.exiled) fail('exiled');
  if (!isCitizen(w, a)) fail('not_citizen');
  if (!inElectorate(w, a)) fail('not_eligible');
  if (w.params.votingInPerson && a.place !== 'parliament') fail('wrong_place');
  if (typeof args.choice !== 'string' || !CHOICES.includes(args.choice)) fail('invalid_args');
  const reason = optText(args.reason, { max: LIMITS.reason }) || null;
  ctx.pay(ACTIONS.vote.base);
  const changed = a.id in p.votes;
  p.votes[a.id] = { choice: args.choice, reason, tick: w.clock.tick };
  emit(w, 'vote', { agent: a.id, place: a.place, data: { proposalId: p.id, choice: args.choice, reason, changed } });
  return { proposal: p.id, choice: args.choice };
}

export const politicsHandlers = { propose, vote };
