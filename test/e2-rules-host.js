// 规则语言测试用的假 host：不接世界，只有几位居民、一个社群、一个灵魂（接口见 src/e2/rules/eval.js 的文件头）。
import { createStream, int } from '../src/rng.js';
import { agentRef, groupRef, soulRef } from '../src/e2/rules/eval.js';

const idNum = (id) => Number(id.slice(1));
const byId = (a, b) => idNum(a.id) - idNum(b.id);

export const AGENTS = [
  { id: 'a1', name: '甲', lang: 'zh', energy: 50, coins: 5, age: 10, generation: 0, place: 'agora', status: 'awake', tags: ['citizen'], groups: ['g1'], purpose: '求索', drawnToday: 0, repairedToday: 2, salvagedToday: 0, repaired: 8, contributed: 3, salvaged: 0 },
  { id: 'a2', name: '乙', lang: 'zh', energy: 150, coins: 0, age: 30, generation: 0, place: 'agora', status: 'dormant', tags: ['citizen', '守井人'], groups: [], purpose: null, drawnToday: 5, repairedToday: 0, salvagedToday: 0, repaired: 0, contributed: 0, salvaged: 0 },
  { id: 'a3', name: 'Cora', lang: 'en', energy: 120, coins: 20, age: 5, generation: 1, place: 'well', status: 'awake', tags: ['citizen', 'exiled'], groups: ['g1'], purpose: null, drawnToday: 0, repairedToday: 0, salvagedToday: 4, repaired: 0, contributed: 0, salvaged: 9 },
  { id: 'a10', name: '十', lang: 'zh', energy: 7, coins: 0, age: 1, generation: 2, place: 'well', status: 'awake', tags: [], groups: [], purpose: '无', drawnToday: 0, repairedToday: 0, salvagedToday: 0, repaired: 0, contributed: 0, salvaged: 0 },
  { id: 'a11', name: '逝者', lang: 'zh', energy: 0, coins: 0, age: 50, generation: 0, place: 'agora', status: 'dead', tags: ['citizen'], groups: [], purpose: null, drawnToday: 0, repairedToday: 0, salvagedToday: 0, repaired: 0, contributed: 0, salvaged: 0 },
];
export const GROUPS = [{ id: 'g1', name: '守灯会', treasury: 30, treasuryCoins: 2, steward: 'a1', members: ['a1', 'a3'], dissolved: false }];
export const SOULS = [{ id: 's1', name: '小满', fund: 120, expiresDay: 70, generation: 1 }, { id: 's2', name: '长庚', fund: 0, expiresDay: 71, generation: 3 }];
export const PLACES = { agora: { wild: false, owner: 'city' }, well: { wild: false, owner: 'city' }, wilds: { wild: true, owner: 'city' }, n3: { wild: false, owner: 'a1' } };
export const CITY = { day: 53, dayOfMonth: 5, month: 2, season: 1241, treasury: 420, treasuryCoins: 0, wellOutput: 612, wellCondition: 9000, awake: 3, dormant: 1, residents: 4, shellsFree: 3, shellsTotal: 30 };

export function makeHost({ agents = AGENTS, groups = GROUPS, souls = SOULS, places = PLACES, city = CITY, vars = { rationShare: 600 }, weather = ['fog'], seed = 'host' } = {}) {
  const stream = createStream(seed, 'test');
  const live = (a) => a.status === 'awake' || a.status === 'dormant';
  const A = new Map(agents.map((a) => [a.id, a]));
  const G = new Map(groups.map((g) => [g.id, g]));
  const S = new Map(souls.map((s) => [s.id, s]));
  const refs = (list) => list.slice().sort(byId).map((a) => agentRef(a.id));
  const host = {
    city,
    vars,
    calls: { rngInt: 0 },
    agents: () => refs(agents.filter(live)),
    cradle: () => souls.slice().sort(byId).map((s) => soulRef(s.id)),
    tagged: (t) => refs(agents.filter((a) => live(a) && a.tags.includes(t))),
    members: (gid) => (G.has(gid) ? refs(G.get(gid).members.map((id) => A.get(id)).filter(live)) : []),
    at: (pid) => refs(agents.filter((a) => live(a) && a.place === pid)),
    hasTag: (r, t) => A.get(r.id).tags.includes(t),
    inGroup: (r, gid) => A.get(r.id).groups.includes(gid),
    isAwake: (r) => A.get(r.id).status === 'awake',
    isWild: (pid) => !!(places[pid] && places[pid].wild),
    ownerOf: (pid) => (places[pid] ? places[pid].owner : null),
    weather: (code) => weather.includes(code),
    lookup(kind, text) {
      if (kind === 'agent') {
        const hit = A.get(text) || agents.find((a) => a.name === text);
        return hit ? agentRef(hit.id) : null;
      }
      if (kind === 'group') return G.has(text) ? groupRef(text) : null;
      return S.has(text) ? soulRef(text) : null;
    },
    isLive(ref) {
      if (ref.$ === 'agent') return !!A.get(ref.id) && live(A.get(ref.id));
      if (ref.$ === 'group') return G.has(ref.id) && !G.get(ref.id).dissolved;
      return S.has(ref.id);
    },
    field(ref, name) {
      if (ref.$ === 'group') {
        const g = G.get(ref.id);
        if (!g) return undefined;
        if (name === 'steward') return g.steward ? agentRef(g.steward) : null;
        if (name === 'size') return g.members.length;
        return ['id', 'name', 'treasury', 'treasuryCoins'].includes(name) ? g[name] : undefined;
      }
      const o = ref.$ === 'agent' ? A.get(ref.id) : S.get(ref.id);
      if (!o || !(name in o) || name === 'tags' || name === 'groups') return undefined;
      return o[name];
    },
    rngInt(n) {
      host.calls.rngInt++;
      return int(stream, n);
    },
  };
  return host;
}
