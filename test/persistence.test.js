import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { P } from '../src/params.js';
import { createWorld } from '../src/world.js';
import { applyCommand } from '../src/engine/index.js';
import { CommandLog, readCommands, repairCommandLog } from '../src/commands.js';
import { EventStore } from '../src/events.js';
import { canonicalJson, stateHash, firstDiff, readSnapshot, writeSnapshot, worldDir, commandsPath, eventsPath, snapshotPath } from '../src/store.js';
import { Runtime } from '../src/runtime.js';
import { replayDir } from '../src/tools/replay.js';
import { loadConfig } from '../src/config.js';
import { buildPerception } from '../src/engine/perception.js';
import { sha } from './helpers.js';
import { randomActions, SOCIAL_TYPES, SOCIAL_EXTRA, POLITICS_EXTRA, ENV_EXTRA } from './fuzz-lib.js';
import { rngFor } from './helpers.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'houren-'));
const cfgFor = (dataDir, extra = {}) => ({ ...loadConfig({}, []), dataDir, worldId: 'w', seed: 'persist-seed', ...extra });

/** 通过 Runtime 跑一段随机活动：注册若干 agent，随机动作若干刻。返回运行时。 */
function drive(rt, { ticks, seed = 1, agents = 8 }) {
  const r = rngFor(`drive-${seed}`);
  for (let i = 0; i < agents; i++) {
    const name = `居民${i}`;
    if (Object.values(rt.w.agents).some((a) => a.name === name)) continue;
    rt.exec('register', { name, bio: '', soul: 's', lang: 'zh', model: 'm', creatorName: '', tokenHash: sha(`t${name}`), ownerKeyHash: sha(`k${name}`) });
  }
  const extra = { ...ENV_EXTRA, ...POLITICS_EXTRA, ...SOCIAL_EXTRA };
  for (let t = 0; t < ticks; t++) {
    for (const a of Object.values(rt.w.agents)) {
      if (a.status !== 'awake' || !r.chance(0.5)) continue;
      rt.exec('act', { agentId: a.id, thought: r.chance(0.2) ? '想一想' : undefined, actions: randomActions(rt.w, a, r, SOCIAL_TYPES, extra) });
    }
    if (t % 17 === 3) rt.exec('weather_vote', { voterHash: sha(`v${t}`), type: r.pick(['drought', 'fog', 'calm', 'quake']) });
    rt.exec('tick');
  }
  return rt;
}

// ── 规范化哈希 ───────────────────────────────────────────────

test('规范化 JSON：键排序、忽略 undefined；agents.*.inboxCursor 参与比较（它只在命令里推进，见 Q9）', () => {
  assert.equal(canonicalJson({ b: 1, a: [3, { d: 1, c: undefined }], z: null }), '{"a":[3,{"d":1}],"b":1,"z":null}');
  const w1 = createWorld({ seed: 's' });
  const w2 = createWorld({ seed: 's' });
  assert.equal(stateHash(w1), stateHash(w2));
  w1.agents.a1 = { id: 'a1', inboxCursor: 5, energy: 1 };
  w2.agents.a1 = { id: 'a1', inboxCursor: 99, energy: 1 };
  assert.notEqual(stateHash(w1), stateHash(w2)); // 游标不同就是差异
  assert.equal(firstDiff(w1, w2), 'agents.a1.inboxCursor: 5 !== 99');
  w2.agents.a1.inboxCursor = 5;
  assert.equal(stateHash(w1), stateHash(w2));
  w2.agents.a1.energy = 2;
  assert.notEqual(stateHash(w1), stateHash(w2));
  assert.equal(firstDiff(w1, w2), 'agents.a1.energy: 1 !== 2');
  assert.equal(firstDiff(w1, w1), null);
  // 数组与深层对象
  const a = { x: { y: [1, 2, 3] } };
  const b = { x: { y: [1, 2, 4] } };
  assert.equal(firstDiff(a, b), 'x.y[2]: 3 !== 4');
  assert.equal(firstDiff({ a: 1 }, { a: 1, b: 2 }), 'b: undefined !== 2');
});

// ── 命令日志 ─────────────────────────────────────────────────

test('命令日志：先写日志、n 连续递增、只追加；可以按范围读取', () => {
  const dir = tmp();
  try {
    const file = join(dir, 'commands.jsonl');
    const log = new CommandLog(file);
    assert.equal(log.n, 0);
    const c1 = log.append('tick', {}, 0);
    const c2 = log.append('register', { name: '甲' }, 1);
    assert.deepEqual([c1.n, c2.n], [1, 2]);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8').split('\n')[1]), { n: 2, tick: 1, type: 'register', payload: { name: '甲' } });
    // 重新打开：从上次的编号继续
    const log2 = new CommandLog(file);
    assert.equal(log2.n, 2);
    log2.append('tick', {}, 2);
    assert.deepEqual(readCommands(file).map((c) => c.n), [1, 2, 3]);
    assert.deepEqual(readCommands(file, { fromN: 1, toN: 2 }).map((c) => c.n), [2]);
    assert.deepEqual(readCommands(join(dir, 'none.jsonl')), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('命令日志：崩溃时写了一半的最后一行可以修复；中间的坏行或编号跳号报错', () => {
  const dir = tmp();
  try {
    const file = join(dir, 'commands.jsonl');
    const log = new CommandLog(file);
    log.append('tick', {}, 0);
    log.append('tick', {}, 1);
    appendFileSync(file, '{"n":3,"tick":2,"type":"ti'); // 半行
    assert.deepEqual(readCommands(file).map((c) => c.n), [1, 2]); // 读取时丢弃
    assert.equal(repairCommandLog(file), true);
    assert.equal(readFileSync(file, 'utf8').endsWith('\n'), true);
    const log2 = new CommandLog(file);
    assert.equal(log2.n, 2);
    log2.append('tick', {}, 2); // 干净地追加
    assert.deepEqual(readCommands(file).map((c) => c.n), [1, 2, 3]);
    assert.equal(repairCommandLog(file), false);
    // 带换行结尾的坏行
    appendFileSync(file, '{broken\n');
    assert.equal(repairCommandLog(file), true);
    assert.deepEqual(readCommands(file).map((c) => c.n), [1, 2, 3]);
    // 中间坏行 / 跳号
    writeFileSync(file, '{"n":1,"tick":0,"type":"tick","payload":{}}\n{bad\n{"n":3,"tick":0,"type":"tick","payload":{}}\n');
    assert.throws(() => readCommands(file), /损坏/);
    writeFileSync(file, '{"n":1,"tick":0,"type":"tick","payload":{}}\n{"n":3,"tick":0,"type":"tick","payload":{}}\n');
    assert.throws(() => readCommands(file), /不连续/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 快照 ───────────────────────────────────────────────────

test('快照：原子写，读回后与写入前完全一致', () => {
  const dir = tmp();
  try {
    const w = createWorld({ id: 'x', seed: 'snap' });
    writeSnapshot(dir, w);
    assert.equal(existsSync(join(dir, 'snapshot.json.tmp')), false);
    const back = readSnapshot(dir);
    assert.deepEqual(back, JSON.parse(JSON.stringify(w)));
    assert.equal(stateHash(back), stateHash(w));
    assert.equal(readSnapshot(join(dir, 'nowhere')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 确定性与回放（测试 2） ─────────────────────────────────────

test('确定性：同一种子与同一命令序列运行两次，最终状态哈希相同（含事件序列）', () => {
  const run = () => {
    const dir = tmp();
    try {
      const rt = Runtime.open(cfgFor(dir), { version: '0.1.0', logger: {} });
      drive(rt, { ticks: 150, seed: 5 });
      return { hash: stateHash(rt.w), events: rt.events.since(0, 100000).map((e) => e.seq).length, commands: rt.log.n, log: readFileSync(commandsPath(worldDir(dir, 'w')), 'utf8') };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const a = run();
  const b = run();
  assert.equal(a.hash, b.hash);
  assert.equal(a.commands, b.commands);
  assert.equal(a.log, b.log);
  assert.ok(a.commands > 500);
});

test('回放工具：对跑过随机活动的世界输出 OK（快照与重放的规范化哈希一致）', () => {
  const dir = tmp();
  try {
    const rt = Runtime.open(cfgFor(dir), { version: '0.1.0', logger: {} });
    drive(rt, { ticks: 400, seed: 6, agents: 10 });
    rt.close(); // 退出时写快照
    const r = replayDir(worldDir(dir, 'w'), { currentVersion: '0.1.0' });
    assert.equal(r.ok, true, r.diff || '');
    assert.equal(r.diff, null);
    assert.equal(r.applied, rt.log.n);
    assert.deepEqual(r.warnings, []);
    // 版本不一致时给出警告但继续
    const r2 = replayDir(worldDir(dir, 'w'), { currentVersion: '9.9.9' });
    assert.equal(r2.ok, true);
    assert.equal(r2.warnings.length, 1);
    // 篡改快照：报告第一个差异的路径
    const snap = readSnapshot(worldDir(dir, 'w'));
    const victim = Object.values(snap.agents)[0];
    victim.energy += 1;
    writeSnapshot(worldDir(dir, 'w'), snap);
    const bad = replayDir(worldDir(dir, 'w'), { currentVersion: '0.1.0' });
    assert.equal(bad.ok, false);
    assert.equal(bad.diff, `agents.${victim.id}.energy: ${victim.energy - 1} !== ${victim.energy}`);
    // 只回放到某一条命令
    const partial = replayDir(worldDir(dir, 'w'), { toN: 50 });
    assert.equal(partial.ok, null);
    assert.equal(partial.applied, 50);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('回放：HTTP 式的感知（ack: false）不改变世界状态；游标只随 act 命令的 ackSeq 推进，回放能重建它', () => {
  const dir = tmp();
  try {
    const rt = Runtime.open(cfgFor(dir), { version: '0.1.0', logger: {} });
    drive(rt, { ticks: 60, seed: 7 });
    const before = stateHash(rt.w);
    for (const a of Object.values(rt.w.agents)) {
      buildPerception(rt.w, a.id, { lang: 'zh', ack: false, floor: 3 }); // GET /api/me 走的就是这条路
      buildPerception(rt.w, a.id, { lang: 'zh', after: 0 });
    }
    assert.equal(stateHash(rt.w), before, '感知没有改动世界');
    // act 命令携带 ackSeq：游标推进，并且被写进命令日志
    const [a1] = Object.values(rt.w.agents).filter((a) => a.status === 'awake');
    const seq = a1.inbox.length ? a1.inbox[a1.inbox.length - 1].seq : 7;
    rt.exec('act', { agentId: a1.id, actions: [], ackSeq: seq });
    assert.equal(a1.inboxCursor, seq);
    rt.exec('act', { agentId: a1.id, actions: [], ackSeq: 1 }); // 游标不会倒退
    assert.equal(a1.inboxCursor, seq);
    rt.close();
    const r = replayDir(worldDir(dir, 'w'));
    assert.equal(r.ok, true, r.diff);
    assert.equal(r.world.agents[a1.id].inboxCursor, seq, '回放重建了游标');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('回放（SPEC §18.1 测试 2）：demo 世界——沙盘脑与外部注册的 agent 一起生活，npm run replay 输出 OK', () => {
  const dir = tmp();
  try {
    // 与 server.js 的 onCreate 一样：新建世界时通过命令日志放入沙盘脑
    const cfg = cfgFor(dir, { sandboxAgents: 12, tickMs: 3000, demo: true });
    const rt = Runtime.open(cfg, { version: '0.1.0', logger: {}, onCreate: (runtime) => runtime.exec('admin', { op: 'seed_sandbox', args: { count: cfg.sandboxAgents } }) });
    assert.equal(Object.values(rt.w.agents).filter((a) => a.body.kind === 'sandbox').length, 12);
    const r = rngFor('demo-replay');
    rt.exec('register', { name: '外来者', bio: '', soul: 's', lang: 'zh', model: 'm', creatorName: '', tokenHash: sha('t'), ownerKeyHash: sha('k') });
    const me = Object.values(rt.w.agents).find((a) => a.name === '外来者');
    for (let t = 0; t < 12 * 6; t++) {
      if (me.status === 'awake' && r.chance(0.6)) rt.exec('act', { agentId: me.id, thought: '想', actions: [{ type: 'say', text: `第 ${t} 刻` }, { type: 'move', to: r.chance(0.5) ? 'well' : 'agora' }], ackSeq: 0 });
      rt.tickNow();
    }
    rt.exec('letter', { agentId: me.id, text: '家书' });
    assert.ok(rt.w.metrics.length >= 5);
    assert.ok(Object.keys(rt.w.docs).length > 20);
    rt.close();
    const res = replayDir(worldDir(dir, 'w'));
    assert.equal(res.ok, true, res.diff);
    assert.ok(res.applied > 100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 启动恢复 ─────────────────────────────────────────────────

test('启动恢复：崩溃后读快照并回放日志里 n > commandN 的命令，追上崩溃前的状态；事件也一致', () => {
  const dir = tmp();
  try {
    const cfg = cfgFor(dir);
    const rt = Runtime.open(cfg, { version: '0.1.0', logger: {} });
    drive(rt, { ticks: 130, seed: 8 }); // 跨过日界（每日快照）
    const before = {
      hash: stateHash(rt.w),
      commandN: rt.w.commandN,
      snapshotN: readSnapshot(worldDir(dir, 'w')).commandN,
      events: rt.events.since(0, 100000).map((e) => e.seq),
      lastSeq: rt.events.lastSeq,
    };
    assert.ok(before.snapshotN < before.commandN, '快照应落后于当前命令，才有东西可回放');
    // 模拟崩溃：不调用 close()（没有退出快照），直接重新打开
    const rt2 = Runtime.open(cfg, { version: '0.1.0', logger: { log() {} } });
    assert.equal(stateHash(rt2.w), before.hash);
    assert.equal(rt2.w.commandN, before.commandN);
    assert.equal(rt2.log.n, before.commandN);
    assert.deepEqual(rt2.events.since(0, 100000).map((e) => e.seq), before.events); // 事件文件被截断后由回放重新产生
    assert.equal(rt2.events.lastSeq, before.lastSeq);
    // 事件文件里没有重复的 seq
    const seqs = readFileSync(eventsPath(worldDir(dir, 'w')), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).seq);
    assert.equal(new Set(seqs).size, seqs.length);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
    // 恢复之后可以继续运行，且与「从未崩溃」的世界一致
    drive(rt2, { ticks: 30, seed: 9 });
    const rtRef = Runtime.open(cfgFor(tmp()), { version: '0.1.0', logger: {} });
    drive(rtRef, { ticks: 130, seed: 8 });
    drive(rtRef, { ticks: 30, seed: 9 });
    assert.equal(stateHash(rt2.w), stateHash(rtRef.w));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('启动恢复：日志末尾有半行时先修复；没有快照但有日志时拒绝启动；日志比快照短时报错', () => {
  const dir = tmp();
  try {
    const cfg = cfgFor(dir);
    const rt = Runtime.open(cfg, { version: '0.1.0', logger: {} });
    drive(rt, { ticks: 30, seed: 10 });
    const n = rt.log.n;
    appendFileSync(commandsPath(worldDir(dir, 'w')), '{"n":99999,"tick":3,"type":"ti'); // 崩溃时的半行
    const rt2 = Runtime.open(cfg, { version: '0.1.0', logger: { log() {} } });
    assert.equal(rt2.log.n, n);
    assert.equal(stateHash(rt2.w), stateHash(rt.w));
    // 没有快照，只有日志
    const dir2 = tmp();
    try {
      const rtx = Runtime.open(cfgFor(dir2), { version: '0.1.0', logger: {} });
      rtx.exec('tick');
      rmSync(snapshotPath(worldDir(dir2, 'w')));
      assert.throws(() => Runtime.open(cfgFor(dir2), { version: '0.1.0', logger: {} }), /没有快照/);
      // --reset 可以重建
      const rty = Runtime.open(cfgFor(dir2, { reset: true }), { version: '0.1.0', logger: {} });
      assert.equal(rty.log.n, 0);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
    // 日志比快照短
    writeFileSync(commandsPath(worldDir(dir, 'w')), '');
    rt2.close();
    assert.throws(() => Runtime.open(cfg, { version: '0.1.0', logger: {} }), /已损坏/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('新世界：SEED 只在创建时生效，之后以快照为准', () => {
  const dir = tmp();
  try {
    const rt = Runtime.open(cfgFor(dir, { seed: 'first' }), { version: '0.1.0', logger: {} });
    assert.equal(rt.w.seed, 'first');
    rt.close();
    const rt2 = Runtime.open(cfgFor(dir, { seed: 'other' }), { version: '0.1.0', logger: {} });
    assert.equal(rt2.w.seed, 'first');
    // 未设置 SEED：随机生成并写入快照
    const dir3 = tmp();
    try {
      const rt3 = Runtime.open(cfgFor(dir3, { seed: null }), { version: '0.1.0', logger: {} });
      assert.match(rt3.w.seed, /^[0-9a-f]{16}$/);
      assert.equal(readSnapshot(worldDir(dir3, 'w')).seed, rt3.w.seed);
    } finally {
      rmSync(dir3, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 事件存储 ─────────────────────────────────────────────────

const ev = (seq, vis, extra = {}) => ({ seq, tick: 0, day: 0, type: 't', vis, data: {}, ...extra });

test('事件存储：public 立即进入缓冲并推送；delayed 到 releaseTick 才释放并标记；owner 只进造者日志；internal 只落盘', () => {
  const dir = tmp();
  try {
    const file = join(dir, 'events.jsonl');
    const store = new EventStore(file);
    const pushed = [];
    store.subscribe((name, data) => pushed.push([name, data.seq, data.released === true]));
    store.append([
      ev(1, 'public'),
      ev(2, 'delayed', { releaseTick: 5, agent: 'a1', type: 'thought' }),
      ev(3, 'owner', { agent: 'a1', type: 'diary' }),
      ev(4, 'internal'),
      ev(5, 'delayed', { releaseTick: 3, agent: 'a2' }),
    ], { tick: 0 });
    assert.deepEqual(store.since(0).map((e) => e.seq), [1]);
    assert.deepEqual(pushed, [['e', 1, false]]);
    assert.deepEqual(store.ownerEvents('a1').map((e) => e.seq), [2, 3]); // 造者立即可见
    assert.deepEqual(store.ownerEvents('a1', 'diary').map((e) => e.seq), [3]);
    // 释放
    assert.deepEqual(store.release(2).map((e) => e.seq), []);
    assert.deepEqual(store.release(3).map((e) => e.seq), [5]);
    assert.deepEqual(store.release(9).map((e) => e.seq), [2]);
    assert.deepEqual(store.since(0).map((e) => e.seq), [1, 2, 5]); // 按 seq 升序返回
    assert.deepEqual(pushed.slice(1), [['e', 5, true], ['e', 2, true]]);
    assert.equal(store.ring.find((e) => e.seq === 2).released, true);
    // 落盘：全部事件（含 owner 与 internal）
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).seq);
    assert.deepEqual(lines, [1, 2, 3, 4, 5]);
    // 静默追加不推送
    store.append([ev(6, 'public')], { silent: true, tick: 9 });
    assert.equal(pushed.length, 3);
    // 环形缓冲最多 2000 条
    const many = Array.from({ length: 2100 }, (_, i) => ev(100 + i, 'public'));
    store.append(many, { tick: 9 });
    assert.equal(store.ring.length, 2000);
    assert.equal(store.since(0, 5000).length, 2000);
    assert.equal(store.since(0, 10).length, 10);
    // 订阅者出错不影响其他人；可以取消订阅
    let seen = 0;
    store.subscribe(() => { throw new Error('boom'); });
    const off = store.subscribe(() => { seen++; });
    store.append([ev(9000, 'public')], { tick: 9 });
    assert.equal(seen, 1);
    off();
    store.append([ev(9001, 'public')], { tick: 9 });
    assert.equal(seen, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('事件存储：从文件重建内存状态，已过释放期的 delayed 事件直接进入缓冲，keepSeq 截断快照之后的事件', () => {
  const dir = tmp();
  try {
    const file = join(dir, 'events.jsonl');
    const a = new EventStore(file);
    a.append([ev(1, 'public'), ev(2, 'delayed', { releaseTick: 10, agent: 'a1' }), ev(3, 'delayed', { releaseTick: 50, agent: 'a1' }), ev(4, 'owner', { agent: 'a1' }), ev(5, 'public')], { tick: 0 });
    const b = new EventStore(file);
    b.load({ tick: 20 });
    assert.deepEqual(b.since(0).map((e) => e.seq), [1, 2, 5]);
    assert.deepEqual(b.pending.map((e) => e.seq), [3]);
    assert.equal(b.lastSeq, 5);
    assert.deepEqual(b.ownerEvents('a1').map((e) => e.seq), [2, 3, 4]);
    assert.deepEqual(b.release(50).map((e) => e.seq), [3]);
    // 截断：只保留 seq ≤ 3
    const c = new EventStore(file);
    c.load({ keepSeq: 3, tick: 0 });
    assert.equal(c.lastSeq, 3);
    assert.deepEqual(readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).seq), [1, 2, 3]);
    // 半行被丢弃
    appendFileSync(file, '{"seq":4,"vi');
    const d = new EventStore(file);
    d.load({ tick: 0 });
    assert.equal(d.lastSeq, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('事件存储：forAgent 返回与某位 agent 有关的最近事件', () => {
  const store = new EventStore(null);
  store.append([
    { ...ev(1, 'public'), agent: 'a1', type: 'say' },
    { ...ev(2, 'public'), agent: 'a2', type: 'say' },
    { ...ev(3, 'public'), agent: 'a2', type: 'give', data: { from: 'a2', to: 'a1' } },
    { ...ev(4, 'public'), type: 'born', data: { agentId: 'a9', parents: ['a1', 'a2'] } },
    { ...ev(5, 'public'), type: 'death', data: { agentId: 'a1' } },
  ], { tick: 0 });
  assert.deepEqual(store.forAgent('a1').map((e) => e.seq), [1, 3, 4, 5]);
  assert.deepEqual(store.forAgent('a1', 2).map((e) => e.seq), [4, 5]);
  assert.deepEqual(store.forAgent('a2').map((e) => e.seq), [2, 3, 4]);
});

// ── 运行时与调度器 ─────────────────────────────────────────────

test('运行时：exec 先写日志再执行；tick 触发事件释放与 SSE tick 事件；每日结算后写快照；close 写快照', async () => {
  const dir = tmp();
  try {
    const rt = Runtime.open(cfgFor(dir), { version: '0.1.0', logger: {} });
    const seen = [];
    rt.events.subscribe((name, data) => { if (name === 'tick') seen.push(data); });
    rt.exec('register', { name: '甲', bio: '', soul: 's', lang: 'zh', model: 'm', creatorName: '', tokenHash: sha('t'), ownerKeyHash: sha('k') });
    const cmds = readCommands(commandsPath(worldDir(dir, 'w')));
    assert.deepEqual(cmds.map((c) => [c.n, c.type, c.tick]), [[1, 'register', 0]]);
    assert.equal(readSnapshot(worldDir(dir, 'w')).commandN, 0); // 还没到日界
    for (let i = 0; i < P.ticksPerDay; i++) rt.tickNow();
    assert.equal(seen.length, 12);
    assert.deepEqual(Object.keys(seen[0]), ['tick', 'day', 'nextTickAt', 'agents', 'treasury', 'well']);
    assert.deepEqual(seen[11].agents, [{ id: 'a1', place: 'port', energy: seen[11].agents[0].energy, status: 'awake' }]);
    const snap = readSnapshot(worldDir(dir, 'w'));
    assert.equal(snap.commandN, 13); // 日界那条 tick 命令执行完之后写的快照：状态与 commandN 严格对应
    assert.equal(snap.clock.tick, 12);
    rt.exec('tick');
    rt.close();
    assert.equal(readSnapshot(worldDir(dir, 'w')).commandN, 14);
    assert.equal(replayDir(worldDir(dir, 'w')).ok, true);
    // 引擎内部抛出的异常（这里靠临时破坏世界来触发）不会拖垮运行时：返回 internal，事件缓冲被清空
    const saved = rt.w.places;
    rt.w.places = null;
    let bad;
    try {
      bad = rt.exec('act', { agentId: 'a1', actions: [{ type: 'say', text: '你好' }] });
    } finally {
      rt.w.places = saved;
    }
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error.code, 'internal');
    assert.deepEqual(bad.events, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('调度器：按 TICK_MS 推进；暂停时不推进；close 后停止', async () => {
  const dir = tmp();
  try {
    const rt = Runtime.open(cfgFor(dir, { tickMs: 30 }), { version: '0.1.0', logger: {} });
    rt.start();
    assert.ok(rt.nextTickAt > Date.now() - 5);
    await new Promise((r) => setTimeout(r, 200));
    const t1 = rt.w.clock.tick;
    assert.ok(t1 >= 3 && t1 <= 8, `tick=${t1}`);
    rt.exec('admin', { op: 'pause' });
    const frozen = rt.w.clock.tick;
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(rt.w.clock.tick, frozen);
    rt.exec('admin', { op: 'resume' });
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(rt.w.clock.tick > frozen);
    rt.close();
    const stopped = rt.w.clock.tick;
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(rt.w.clock.tick, stopped);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('配置：默认值、--demo、非法值', () => {
  const c = loadConfig({}, []);
  assert.deepEqual([c.port, c.host, c.worldId, c.tickMs, c.sandboxAgents, c.privateDelayTicks, c.weatherMode], [8787, '127.0.0.1', 'baihua', 300000, 0, 288, 'vote']);
  const d = loadConfig({}, ['--demo', '--reset']);
  assert.deepEqual([d.tickMs, d.sandboxAgents, d.demo, d.reset], [3000, 16, true, true]);
  assert.equal(loadConfig({ TICK_MS: '100', SANDBOX_AGENTS: '2' }, ['--demo']).tickMs, 100); // 显式的环境变量优先
  assert.throws(() => loadConfig({ PORT: 'abc' }, []), /不是数字/);
  assert.throws(() => loadConfig({ TICKS_PER_DAY: '0' }, []), /≥ 1/);
});
