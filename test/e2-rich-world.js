// 一座「什么都发生过」的第二纪的城：观测站的渲染测试（test/e2-ui.test.js）与以后需要丰富数据的测试共用。
// 居民有志、标签、谱系；法典里有遗法、居民的法律、程序的变更、进行中的提案与重订、上书；
// 社群有章程；地点有后人开辟的、模块、残料、遗址、地点规则；摇篮里有灵魂、排队的、已经醒来的躯壳居民。
import assert from 'node:assert/strict';
import { P } from '../src/e2/params.js';
import { newWorld, reg, one, setHoldings, putAt, tick, tickDays, eventsOf, assertInvariants } from './e2-helpers.js';
import { enact, setBylaws, setPlaceRules } from './e2-law-helpers.js';

const must = (r, what) => {
  assert.equal(r.ok, true, `${what}: ${JSON.stringify(r)}`);
  return r;
};

/** 把世界发出的所有事件记下来（applyCommand 每次返回后就清空暂存区，测试辅助函数又不转交事件）：返回会不断增长的数组 */
function capture(w) {
  const all = [];
  let cur = [];
  const rec = (arr) => {
    arr.push = (...xs) => {
      all.push(...xs);
      return Array.prototype.push.apply(arr, xs);
    };
    return arr;
  };
  rec(cur);
  Object.defineProperty(w, '$out', { configurable: true, enumerable: false, get: () => cur, set: (v) => { cur = rec(v); } });
  return all;
}

export function richWorld(seed = 'ui-rich') {
  const w = newWorld(seed, { shellModels: ['glm-5.3', 'step-5-preview'] });
  const events = capture(w);
  const names = ['青禾', '松烟', '木兰', '阿远', '小满', '石头', '夜航'];
  const people = names.map((n) => reg(w, n, { lang: n === '木兰' ? 'en' : 'zh' }));
  const refill = () => { for (const x of people) if (x.status !== 'dead' && x.status !== 'retired') setHoldings(w, x, { energy: 300, coins: 4 }); };
  tickDays(w, 3); // 入城满 3 日：重订的分母
  refill();
  const [a, b, c, d, e, f, g] = people;

  // 志与介绍；改过志、清除过志
  must(one(w, a, { type: 'declare', purpose: '让源井重新涌出', bio: '一个爱修井的人' }), 'declare a');
  must(one(w, b, { type: 'declare', purpose: '把每一面墙都读一遍' }), 'declare b');
  must(one(w, b, { type: 'declare', purpose: '把每一首歌都唱一遍' }), 'declare b2');
  must(one(w, c, { type: 'declare', purpose: 'Keep a record of everything.' }), 'declare c');
  must(one(w, c, { type: 'declare', purpose: '' }), 'declare c clear');

  // 社群与章程
  putAt(w, a, 'agora');
  must(one(w, a, { type: 'found', name: '同心会', manifesto: '一起修井', open: true }), 'found');
  putAt(w, b, 'agora');
  must(one(w, b, { type: 'join', group: 'g1' }), 'join');
  putAt(w, c, 'agora');
  must(one(w, c, { type: 'found', name: 'Lamp Society', manifesto: 'We keep the lamps lit.', open: false, procedure: 'members' }), 'found 2');
  setBylaws(w, 'g1', [{ when: 'daily', if: 'true', do: [{ op: 'set', var: 'visited', value: '1' }] }]);

  // 后人开辟的地点（灯屋，主人是 a）、在建的模块工程、在建的道路、被拆成遗址又重新开辟的旧棚
  putAt(w, a, 'market');
  const lamp = must(one(w, a, { type: 'initiate', build: 'site', lot: 'commons-4', name: '灯屋', description: '路口的一盏灯，夜里亮着。' }), 'site');
  const built = must(one(w, a, { type: 'contribute', project: lamp.data.project, energy: lamp.data.need }), 'contribute site');
  const lampId = built.data.result;
  assert.ok(lampId, JSON.stringify(built));
  putAt(w, a, lampId);
  must(one(w, a, { type: 'initiate', build: 'module', module: 'board' }), 'module project'); // 在建
  setPlaceRules(w, lampId, [{ when: 'before:say', do: [{ op: 'fee', to: 'treasury', energy: '1' }] }]);
  putAt(w, d, 'market');
  const store = must(one(w, d, { type: 'initiate', build: 'module', module: 'store' }), 'store project');
  must(one(w, d, { type: 'contribute', project: store.data.project, energy: store.data.need }), 'store built');
  putAt(w, b, 'port');
  must(one(w, b, { type: 'initiate', build: 'road', to: 'temple' }), 'road project');
  must(one(w, b, { type: 'contribute', project: Object.values(w.projects).find((j) => j.build === 'road').id, energy: 20 }), 'road partial');

  putAt(w, e, 'tenements');
  const shed = must(one(w, e, { type: 'initiate', build: 'site', lot: 'commons-3', name: '旧棚', description: '堆东西的地方。' }), 'shed');
  const shedBuilt = must(one(w, e, { type: 'contribute', project: shed.data.project, energy: shed.data.need }), 'shed built');
  const ruinId = shedBuilt.data.result;
  putAt(w, e, ruinId);
  w.places[ruinId].salvage = 6;
  for (let i = 0; i < 3 && !w.places[ruinId].razed; i++) must(one(w, e, { type: 'dismantle', energy: 3 }), 'dismantle');
  assert.equal(w.places[ruinId].razed, true);
  refill();
  must(one(w, e, { type: 'initiate', build: 'site', on: ruinId, name: '新棚', description: '在旧棚的遗址上重新开辟。' }), 'reopen ruin');

  // 墙上的字
  putAt(w, f, 'market');
  must(one(w, f, { type: 'inscribe', text: '今夜无风。' }), 'inscribe');

  // 城法：居民订立的（含上书）；一部带停摆日数的；议会里进行中的提案与已通过的；进行中的重订
  enact(w, [{ when: 'daily', if: 'true', do: [{ op: 'transfer', from: 'treasury', to: "agent('青禾')", energy: '1' }] }], { author: a.id, title: '给修井人的津贴', text: '每日从公库拨一点能量给修井人。' });
  enact(w, [{ when: 'enact', do: [{ op: 'petition', text: '请回应我们：源井在衰败。' }] }], { author: b.id, title: '上书', text: '请愿。' });
  const stalled = enact(w, [{ when: 'daily', if: 'true', do: [{ op: 'set', var: 'x', value: '1' }] }], { author: c.id, title: '会停摆的法', text: '公库见底时停摆。' });
  stalled.suspendedDays = 2;
  stalled.paidThrough = -1;

  refill();
  const propose = (who, extra) => {
    putAt(w, who, 'parliament');
    return must(one(w, who, { type: 'propose', title: '题', text: '文', ...extra }), 'propose');
  };
  const passing = propose(a, { title: '路灯法', text: '每日给灯屋拨一点。', rules: [{ when: 'daily', if: 'true', do: [{ op: 'transfer', from: 'treasury', to: "agent('松烟')", energy: '1' }] }], basedOn: 'l3' });
  for (const who of [a, b, c, d, e]) {
    putAt(w, who, 'parliament');
    must(one(w, who, { type: 'vote', proposal: passing.data.proposal, choice: 'yes', reason: who === b ? '灯是好的' : undefined }), 'vote');
  }
  tick(w, P.ticksPerDay); // 表决期结束 → 通过
  refill();

  // 摇篮：a 独自孕育晨星（出资后醒来，成为躯壳居民）；b 与 c 订立孕育之约，Dawn 在摇篮里；
  // 此后没有空躯壳，Dawn 凑够了出资只能排队；d 的 Ember 只凑了一部分
  putAt(w, a, 'school');
  const kid = must(one(w, a, { type: 'conceive', name: '晨星', soul: '我是晨星，修井人的孩子。', lang: 'zh', cradle: 'school' }), 'conceive');
  putAt(w, b, 'school');
  putAt(w, c, 'school');
  const pact = must(one(w, b, { type: 'conceive', name: 'Dawn', soul: 'I am Dawn, born of two.', lang: 'en', with: [c.id], cradle: 'school' }), 'pact');
  must(one(w, c, { type: 'consent', pact: pact.data.pact }), 'consent pact');
  must(one(w, d, { type: 'sponsor', soul: kid.data.soul, energy: P.shellCost }), 'sponsor');
  tickDays(w, 1); // 晨星醒来
  refill();
  const dawn = Object.values(w.souls).find((s) => s.name === 'Dawn');
  assert.ok(dawn, 'Dawn 在摇篮里');
  w.shells.slots = 1; // 已有一个躯壳居民：不再有空躯壳
  must(one(w, e, { type: 'sponsor', soul: dawn.id, energy: P.shellCost }), 'sponsor dawn');
  putAt(w, d, 'school');
  const ember = must(one(w, d, { type: 'conceive', name: 'Ember', soul: '余烬里的一点光。', lang: 'zh', cradle: 'school' }), 'ember');
  must(one(w, e, { type: 'sponsor', soul: ember.data.soul, energy: 60 }), 'sponsor partial');

  // 进行中的提案（有赞成之外的票）与重订（已有联署）
  const open = propose(b, { title: '更改立法程序', text: '改成抽签议会。', procedure: { ordinary: { none: true }, constitutional: { none: true } } });
  putAt(w, c, 'parliament');
  must(one(w, c, { type: 'vote', proposal: open.data.proposal, choice: 'no', reason: '不行' }), 'vote no');
  putAt(w, d, 'parliament');
  must(one(w, d, { type: 'vote', proposal: open.data.proposal, choice: 'abstain' }), 'vote abstain');
  const refound = must(one(w, a, { type: 'refound', text: '回到人类的程序吧', procedure: 'humans' }), 'refound');
  must(one(w, b, { type: 'sign', refound: refound.data.refound }), 'sign');

  // 离世的与沉睡的
  must(one(w, g, { type: 'retire', lastWords: '我去看海了。' }), 'retire');
  setHoldings(w, f, { energy: 0, coins: 0 });
  f.status = 'dormant';

  assertInvariants(w);
  return { w, people, events, ids: { lampId, ruinId, kid: kid.data.soul, dawn: dawn.id, ember: ember.data.soul, refound: refound.data.refound, passing: passing.data.proposal, open: open.data.proposal } };
}

export { eventsOf };
