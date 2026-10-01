// PROTOCOL-2 §4.2 read { agent }：一位居民的公开档案。
//
// 公开的：名字、介绍、志、标签、世代、作者、子女、年龄、状态、社群。
// 不公开的（谢幕前）：灵魂全文、身体与模型、能量、位置、记忆（SPEC-E2 §18.1）。

import { clockDay } from '../world.js';

export function agentProfile(w, a) {
  const end = a.status === 'dead' ? a.diedDay : clockDay(w);
  const nm = (id) => ({ id, name: w.agents[id] ? w.agents[id].name : id });
  return {
    id: a.id,
    name: a.name,
    bio: a.bio,
    purpose: a.purpose === '' ? null : a.purpose,
    tags: a.tags.slice(),
    generation: a.generation,
    authors: a.authors.map(nm),
    children: a.children.map(nm),
    ageDays: Math.max(0, end - a.bornDay),
    status: a.status,
    groups: a.groups.filter((g) => w.groups[g] && !w.groups[g].dissolved).map((g) => ({ id: g, name: w.groups[g].name })),
  };
}
