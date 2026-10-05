// SPEC-P2 T16：真实 Runtime、HTTP、进程内客户端与预算钩子；提供者仅用脚本化 mock。
// 手动推进 12 刻，刻长与截止仍用 15 分钟的配置；所有文件写在独立临时目录。
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Runtime } from '../../../src/runtime.js';
import { loadConfig, applyConfig } from '../../../src/config.js';
import { createApp } from '../../../src/http/server.js';
import { createShellClient } from '../../../src/shells/client.js';
import { createProvider } from '../../../runner/providers.js';
import { runAgent } from '../../../runner/agent.js';
import { stateHash } from '../../../src/store.js';
import { replayDir } from '../../../src/tools/replay.js';

const quiet = { log() {}, info() {}, warn() {}, error() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 500; i++) { if (check()) return; await sleep(10); }
  assert.fail('mock 验收等待超时');
}
const act = (actions, end = true) => ({ calls: [{ name: 'act', args: { actions, end } }], usage: { input: 100, output: 10 } });
const look = (id) => ({ calls: [{ name: 'look', args: { what: 'proposal', id } }], usage: { input: 100, output: 10 } });

export async function prepareAcceptance({ mode = 'json' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'as4-p2-local-'));
  const shellsFile = join(directory, 'shells.json');
  // 每位先民单独一条 mock 线，方便逐位指定脚本；不会接触真实模型线路或密钥。
  writeFileSync(shellsFile, JSON.stringify({ tokensPerDay: 50000000, concurrency: 6, historyRounds: 2,
    agentLoop: { debounceSec: 0 }, lines: Array.from({ length: 10 }, (_, i) => ({ provider: 'mock', model: `p2-mock-${i + 1}`, toolMode: mode, maxTokens: 64 })) }));
  const cfg = loadConfig({ PHYSICS: '2', PREMISE: '2', SHELL_SLOTS: '20', WORLD_ID: 'p2-local',
    DATA_DIR: join(directory, 'data'), PORT: '0', TICK_MS: '900000', SEED: 'p2-local-mock',
    FOUNDERS_FILE: fileURLToPath(new URL('../p1/founders.json', import.meta.url)), SHELLS_FILE: shellsFile,
    ADMIN_KEY: 'p2-mock-test-admin', SHELL_TZ: 'Asia/Shanghai' }, []);
  applyConfig(cfg);
  let rt = Runtime.open(cfg, { version: '0.1.0', logger: quiet });
  let app = createApp(rt, cfg, { logger: quiet });
  const listen = async () => {
    // 验收在每刻手动派发脚本；保留真实预算与用量钩子，避免自动调度器再驱动同一位居民。
    app.ctx.shells.activate = () => {};
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${app.server.address().port}`;
  };
  let base = await listen();
  const report = { mode, worldId: cfg.worldId, checks: {}, wakings: [] };
  const pending = new Set();
  const controllers = new Set();
  const cleanup = async () => {
    for (const c of controllers) c.abort();
    await Promise.allSettled([...pending]);
    await app.close(); rt.close();
    rmSync(directory, { recursive: true, force: true });
  };
  try {
    rt.nextTickAt = Date.now() + cfg.tickMs;
    rt.tickNow();
    const people = Object.values(rt.w.agents);
    assert.equal(people.length, 10);
    assert.equal(rt.w.shells.bodies.length, 20);
    const [a, b, voter] = people;
    const shell = app.ctx.shells;
    const cursors = new Map();
    async function drive(person, script, { controller, onWaking } = {}) {
      const provider = await createProvider({ provider: 'mock', script });
      const client = createShellClient(rt, person.id, { cursors });
      const line = shell.lines.get(person.body.model);
      const result = await runAgent({ name: person.name, lang: person.lang, toolMode: mode, timeoutMs: line.cfg.timeoutMs }, {
        client, provider, log: quiet, maxRounds: 1, wait: async () => {},
        ...(controller ? { signal: controller.signal } : { waitWake: false }),
        beforeModel: (id, meta) => shell.beforeModel(id, line, {}, meta),
        onUsage: (id, usage, meta) => shell.onUsage(id, line, usage, meta),
        onWaking: (id, rec) => {
          const finishedAt = Date.now();
          app.ctx.traces.append(id, rec, person.body.model);
          report.wakings.push({ agentId: id, finishedAt, deadline: rt.nextTickAt - rt.agentLoop.marginSec * 1000, ...rec });
          onWaking?.(rec);
        },
      });
      assert.ok(['maxRounds', 'aborted'].includes(result.stopped), JSON.stringify(result));
    }
    // 乙先完成主醒来，进入真实 waitCore；甲私语后，乙在同一刻被叫醒并回应。
    const controller = new AbortController(); controllers.add(controller);
    const replyTimeout = setTimeout(() => controller.abort(), 5000);
    let bReady = false;
    const answering = drive(b, [act([]), act([{ type: 'whisper', to: a.id, text: 'mock 同刻回应' }])], {
      controller, onWaking(rec) { if (rec.kind === 'main') bReady = true; else controller.abort(); },
    });
    pending.add(answering);
    await until(() => bReady);
    await drive(a, [act([
      { type: 'move', to: 'parliament' },
      { type: 'propose', title: 'mock 提案', text: '验收用规则', rules: [{ when: 'before:draw', if: 'args.energy > 5', do: [{ op: 'deny', reason: '验收限额' }] }] },
      { type: 'standing', orders: [{ when: 'tick', do: [{ type: 'diary', text: 'mock 常驻日记' }] }] },
    ], false), act([{ type: 'whisper', to: b.id, text: 'mock 同刻询问' }])]);
    await answering; clearTimeout(replyTimeout); pending.delete(answering); controllers.delete(controller);
    assert.ok(a.inbox.some((i) => i.kind === 'whisper' && i.from.id === b.id && i.tick === 1 && i.text === 'mock 同刻回应'), JSON.stringify(report.wakings));
    report.checks.sameTickReply = true;
    const proposal = Object.values(rt.w.proposals).find((p) => p.title === 'mock 提案');
    assert.ok(proposal);
    await drive(voter, [act([{ type: 'move', to: 'parliament' }], false), look(proposal.id), act([{ type: 'vote', proposal: proposal.id, choice: 'yes' }])]);
    assert.equal(rt.w.proposals[proposal.id].votes[voter.id].choice, 'yes');
    report.checks.lookThenVote = true;
    for (const person of people.slice(3)) await drive(person, [act([{ type: 'diary', text: 'mock 第 1 刻' }])]);
    for (let tick = 2; tick <= 12; tick++) {
      rt.nextTickAt = Date.now() + cfg.tickMs;
      rt.tickNow();
      await Promise.all(people.map((person) => drive(person, [act([{ type: 'diary', text: `mock 第 ${tick} 刻` }])])));
      assert.equal(rt.engine.checkConservation(rt.w).ok, true);
      assert.equal(rt.w.ledger.mismatches, 0);
    }
    report.checks.deadlines = report.wakings.length === 121;
    for (const r of report.wakings) {
      assert.ok(r.finishedAt < r.deadline, '醒来在截止前结束');
      assert.equal(r.ended, 'end');
      assert.ok(r.acts.every((a) => a.ok), JSON.stringify(r));
    }
    report.checks.conservation = rt.engine.checkConservation(rt.w).ok && rt.w.ledger.mismatches === 0;
    assert.equal(rt.w.metrics.length, 1);
    assert.ok(rt.w.metrics[0].standingSets > 0 && rt.w.metrics[0].standingFired > 0);
    assert.ok(a.diary.some((d) => d.text === 'mock 常驻日记'));
    report.checks.standing = true;
    const attention = await (await fetch(`${base}/api/public/attention?days=1`)).json();
    assert.equal(attention.days[0].residents, 10);
    assert.ok(attention.days[0].wakesPerResident > 0 && attention.days[0].looksPerWaking > 0);
    assert.ok(!JSON.stringify(attention).includes('p2-mock-'));
    const traceFile = join(rt.dir, 'agent-loops.jsonl');
    const traces = readFileSync(traceFile, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(traces.length, 121);
    assert.ok(traces.some((r) => r.looks.includes(`proposal:${proposal.id}`) && r.acts.some((a) => a.type === 'vote')));
    assert.ok(!readFileSync(traceFile, 'utf8').includes('mock 同刻'));
    const budget = shell.view();
    assert.equal(budget.reserved, 0);
    assert.ok(budget.used > 0 && budget.used <= budget.budget);
    assert.ok(budget.shells.every((a) => a.calls >= 12));
    report.checks.tracesAndUsage = true;
    // 当日自动快照已在第 12 刻写下；之后居民的行动作为未快照尾部命令，由重启回放恢复。
    const hash = stateHash(rt.w);
    await app.close();
    rt = Runtime.open(cfg, { version: '0.1.0', logger: quiet });
    assert.equal(stateHash(rt.w), hash);
    app = createApp(rt, cfg, { logger: quiet }); base = await listen();
    assert.equal(stateHash(rt.w), hash, '配置与代码未变化，不新增幕后命令');
    assert.equal(app.ctx.traces.agentsDay(app.ctx.traces.today()).totals.wakings, 121);
    rt.snapshot();
    const replay = replayDir(rt.dir);
    assert.equal(replay.ok, true, replay.diff || '回放哈希不同');
    assert.equal(replay.hash, hash);
    report.checks.restartReplay = true;
    report.tick = rt.w.clock.tick; report.days = 1; report.hash = hash; report.commandCount = replay.applied;
    return { rt, app, cfg, base, directory, report, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const env = await prepareAcceptance({ mode: process.argv.includes('--native') ? 'native' : 'json' });
  console.log(JSON.stringify({ base: env.base, report: { ...env.report, wakings: env.report.wakings.length } }));
  if (process.argv.includes('--serve')) {
    const end = async () => { await env.cleanup(); process.exit(0); };
    process.once('SIGINT', end); process.once('SIGTERM', end);
  } else await env.cleanup();
}
