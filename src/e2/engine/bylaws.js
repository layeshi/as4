// SPEC-E2 §8.7、PROTOCOL-2 §6.11：社群章程、地点规则与社群的程序。
//
// 社群有两种程序（found 的 procedure 参数，缺省 steward）：
//   steward  只有管事能用 rules 动作，立即生效；
//   members  任何成员都能用 rules 动作，生成社群提案——成员在 groupVoteTicks 刻内表决，
//            参与者不少于成员的一半（voted × 2 ≥ 在世表决者数）且赞成多于反对（yes > no）即通过（一人一票，记名）。
// rules 动作有三种用途：设定社群章程（rules）、设定地点规则（place + rules，主人或社群所有时按社群的程序）、改社群的程序（procedure）。
// 章程与地点规则整体替换；空数组表示废除。社群提案不受城的立法程序与「每人 1 个提案」的限制，每个社群同时最多 3 个进行中的提案。

import { P } from '../params.js';
import { nextId, isAlive, ruleDay } from '../world.js';
import { fingerprintRules } from '../rules/fingerprint.js';
import { validateRules } from '../rules/check.js';
import { renderRules } from '../rules/render.js';
import { emit, pushInbox } from './core.js';
import { groupSet, placeSet, runEnact } from './rules.js';
import { staticLookup, setGroupProposalSettler } from './legislation.js';

export const GROUP_PROCEDURES = Object.freeze(['steward', 'members']);

/** 中英文引擎读法，形状同法律的读法（{ rules: [string…] }） */
const readings = (rules, scope) => ({
  zh: { rules: renderRules(rules, 'zh', scope ? { scope } : {}) },
  en: { rules: renderRules(rules, 'en', scope ? { scope } : {}) },
});

/** 一份新的规则持有物：章程（group.bylaws）与地点规则（place.rules）共用的形状 */
function newHolder(w, rules, setBy) {
  return { rules, fingerprints: fingerprintRules(rules), setTick: w.clock.tick, setBy, paidThrough: ruleDay(w), suspendedDays: 0 };
}

/**
 * 设定社群章程（整体替换；空数组废除）。rules 须已通过校验。执行它的 enact，记事件 bylaws。
 * 返回 enact 的结果。
 */
export function setGroupBylaws(w, g, rules, by, { title = null, text = null } = {}) {
  g.bylaws = rules.length === 0 ? null : newHolder(w, rules, by);
  const results = g.bylaws ? runEnact(w, groupSet(g)) : [];
  emit(w, 'bylaws', { data: { groupId: g.id, rules, reading: readings(rules, { kind: 'group', id: g.id }), setBy: by, title, text, results } });
  return results;
}

/** 设定地点规则（整体替换；空数组废除）。主人为全城时没有地点规则（调用者保证） */
export function setPlaceRulesOf(w, p, rules, by, { title = null, text = null } = {}) {
  p.rules = rules.length === 0 ? null : newHolder(w, rules, by);
  const results = p.rules ? runEnact(w, placeSet(p)) : [];
  emit(w, 'place_rules', { place: p.id, data: { placeId: p.id, rules, reading: readings(rules), setBy: by, title, text, results } });
  return results;
}

/** 改社群的程序 */
export function setGroupProcedure(w, g, procedure, by) {
  const from = g.procedure;
  g.procedure = procedure;
  emit(w, 'group_procedure', { data: { groupId: g.id, procedure, from, setBy: by } });
}

// ── 社群提案 ────────────────────────────────────────────────

/** 社群里进行中的提案 */
export const openGroupProposals = (w, gid) => Object.values(w.proposals).filter((p) => p.status === 'open' && p.scope === `group:${gid}`);

/**
 * 提出一个社群提案（执行者已通过各项校验并付过代价）。kind：bylaws | group_procedure | place_rules。
 * 表决者 = 当时的在世成员；记名；表决期 groupVoteTicks 刻。
 */
export function openGroupProposal(w, a, g, { kind, title, text, rules = null, procedure = null, place = null }) {
  const id = nextId(w, 'p');
  const voters = g.members.filter((m) => isAlive(w.agents[m])).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
  const p = {
    id,
    scope: `group:${g.id}`,
    title,
    text,
    rules,
    procedure,
    basedOn: null,
    kind,
    class: 'ordinary',
    spec: null,
    ...(place ? { place } : {}),
    proposer: a.id,
    openedTick: w.clock.tick,
    closesTick: w.clock.tick + P.groupVoteTicks,
    voters,
    secret: false,
    votes: {},
    status: 'open',
    tally: null,
    lawId: null,
  };
  w.proposals[id] = p;
  emit(w, 'propose', {
    agent: a.id,
    place: a.place,
    data: {
      proposalId: id, scope: p.scope, kind, title, text, class: 'ordinary', rules, procedure, ...(place ? { placeId: place } : {}),
      reading: rules ? readings(rules, kind === 'bylaws' ? { kind: 'group', id: g.id } : null) : null,
      closesTick: p.closesTick, voters: voters.length, secret: false,
    },
  });
  return p;
}

/** 计票（§8.7）：passed = voted × 2 ≥ 在世表决者数 且 yes > no（一人一票）；通过则生效 */
function settleGroupProposal(w, p) {
  const g = w.groups[p.scope.slice(6)];
  const live = p.voters.filter((id) => isAlive(w.agents[id]));
  let yes = 0;
  let no = 0;
  let abstain = 0;
  for (const id of live) {
    const v = p.votes[id];
    if (!v) continue;
    if (v.choice === 'yes') yes++;
    else if (v.choice === 'no') no++;
    else abstain++;
  }
  const voted = yes + no + abstain;
  const total = live.length;
  p.tally = { yes, no, abstain, voted, total, turnout: total > 0 ? Math.floor((voted * 1000) / total) : 0 };
  const passed = total > 0 && voted * 2 >= total && yes > no;
  const notify = (result) => {
    for (const id of new Set([p.proposer, ...Object.keys(p.votes)])) {
      const a = w.agents[id];
      if (a && isAlive(a)) pushInbox(w, a, 'law', { proposalId: p.id, lawId: null, result, title: p.title });
    }
  };
  if (!g || g.dissolved) {
    p.status = 'void';
    return;
  }
  if (passed && applyGroupProposal(w, p, g)) {
    p.status = 'passed';
    notify('passed');
    return;
  }
  // 没有通过，或通过时对象已经变了（地点易主、规则的引用失效）：记为否决
  p.status = passed ? 'void' : 'rejected';
  emit(w, 'law_rejected', { data: { proposalId: p.id, scope: p.scope, kind: p.kind, class: 'ordinary', tally: p.tally, ...(passed ? { void: true } : {}) } });
  notify('rejected');
}

/** 通过的社群提案生效。返回 false 表示生效时发现对象已变（不再有效） */
function applyGroupProposal(w, p, g) {
  const by = p.proposer;
  const meta = { title: p.title, text: p.text };
  if (p.kind === 'group_procedure') {
    setGroupProcedure(w, g, p.procedure, by);
    return true;
  }
  if (p.kind === 'bylaws') {
    const v = validateRules(p.rules, { scope: { kind: 'group', id: g.id }, lookup: staticLookup(w) });
    if (!v.ok) return false;
    setGroupBylaws(w, g, v.rules, by, meta);
    return true;
  }
  const place = w.places[p.place];
  if (!place || place.owner.kind !== 'group' || place.owner.id !== g.id) return false;
  const v = validateRules(p.rules, { scope: { kind: 'place', id: place.id }, lookup: staticLookup(w) });
  if (!v.ok) return false;
  setPlaceRulesOf(w, place, v.rules, by, meta);
  return true;
}

setGroupProposalSettler(settleGroupProposal);
