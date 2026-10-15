// 人类观测归档独立于世界目录，提交观察不改变世界与回放语义。
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, appendFileSync, createReadStream, openSync, closeSync, fsyncSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { durableFile } from '../durable-file.js';
import { archivedWorlds, archiveDirectory } from '../world-archives.js';
import { readSnapshot } from '../store.js';
import { engineOf } from '../engines.js';
import { materialsEnabled } from '../e2/world.js';
import { P as P1 } from '../params.js';
import { P as P2 } from '../e2/params.js';
import { actionRecords, clean, position, privateEventFor, profile } from './records.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function* jsonLines(file) {
  if (!existsSync(file)) return;
  const input = createReadStream(file), reader = createInterface({ input, crlfDelay: Infinity });
  try { for await (const line of reader) { if (line) yield JSON.parse(line); } }
  finally { reader.close(); input.destroy(); }
}
export class HistoryArchive {
  constructor(rt, { importArchives = true, calendar = null } = {}) {
    this.rt = rt; this.root = join(rt.cfg.dataDir, 'history-archives');
    this.calendar = calendar;
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.indexFile = join(this.root, 'index.json');
    this.index = existsSync(this.indexFile) ? JSON.parse(readFileSync(this.indexFile, 'utf8')) : { version: 1, branches: [] };
    const state = this.capture(); const boundary = rt.w.commandN;
    this.ready = this.initialize(state, boundary).then(() => importArchives ? this.importExistingArchives() : undefined); this.pending = this.ready;
    this.unsubscribe = rt.onCommand(({ cmd, result, events, before }) => {
      const captured = this.capture(), rows = this.commandRows(cmd, result, events, before);
      this.pending = this.pending.then(() => this.commit(captured, cmd, rows)).catch(error => { this.fault = error; rt.logger.error?.('历史归档写入失败', error.message); });
    });
  }
  capture() {
    const w = this.rt.w, p = { ...(w.physics === 2 ? P2 : P1), ...(this.calendar ?? {}) };
    return { worldId: w.id, epoch: w.epoch, physics: w.physics ?? 1, premise: w.premise ?? 0, identity: hash([w.id, w.seed, w.physics, w.premise]),
      tick: w.clock.tick, commandN: w.commandN, eventSeq: w.counters.event, ticksPerDay: p.ticksPerDay, daysPerMonth: p.daysPerMonth,
      residents: Object.fromEntries(Object.values(w.agents).map(a => [a.id, { profile: profile(a), managerId: w.access?.residents?.[a.id]?.managerAccountId ?? null, legacyToken: a.tokenHash ?? null }])),
      redacted: [...(w.redacted?.events ?? [])],
      ended: w.paused && !w.experimentControl?.active && w.clock.tick >= p.ticksPerDay * p.daysPerMonth * p.monthsPerEpoch,
    };
  }
  async initialize(state, boundary) {
    let branch = this.index.branches.filter(b => b.identity === state.identity && b.commandN <= boundary).at(-1);
    let lastCommand = null, prefixHash = null, legacyPrefixHash = null;
    const commandsFile = join(this.rt.dir, 'commands.jsonl');
    for await (const frame of jsonLines(commandsFile)) {
      const cmd = frame.command ?? frame; if (cmd.n > boundary) break;
      lastCommand = cmd;
      if (cmd.n === branch?.commandN) {
        prefixHash = hash(cmd);
        const { receipt, ...legacy } = cmd;
        legacyPrefixHash = hash(legacy); // 首版观察入口未携带已持久化回执，兼容它保存的前缀摘要。
      }
    }
    if (branch && (this.rt.cfg.reset || branch.commandN && prefixHash !== branch.lastHash && legacyPrefixHash !== branch.lastHash)) branch = null;
    if (!branch) {
      branch = { id: randomUUID(), ...state, enabledDay: Math.floor(state.tick / state.ticksPerDay), commandN: 0, eventSeq: 0, createdAt: new Date().toISOString() };
      this.index.branches.push(branch);
    }
    this.branchId = branch.id; this.meta = branch;
    const previousN = branch.commandN, previousSeq = branch.eventSeq;
    const rows = [], flush = () => { this.append(branch.id, rows.splice(0)); };
    for await (const frame of jsonLines(commandsFile)) {
      const cmd = frame.command ?? frame; if (cmd.n > boundary) break;
      if (cmd.n > previousN) rows.push(...actionRecords(cmd, cmd.receipt?.out?.result, state.ticksPerDay, {}, {}, materialsEnabled(this.rt.w)));
      if (rows.length >= 250) flush();
    }
    for await (const ev of jsonLines(this.rt.events.file)) {
      if (ev.seq > state.eventSeq) break;
      if (ev.seq > previousSeq) rows.push(...this.eventRows([ev]));
      if (rows.length >= 250) flush();
    }
    if (!previousN) {
      for (const a of Object.values(this.rt.w.agents)) for (const [kind, entries] of [['diary', a.diary], ['memory_snapshot', a.memories], ['letter', a.letters]]) {
        for (const e of entries ?? []) rows.push({ kind, agentId: a.id, tick: e.tick ?? state.tick, day: Math.floor((e.tick ?? state.tick) / state.ticksPerDay), data: clean(e), source: { type: 'snapshot', capturedAtTick: state.tick } });
      }
    }
    for (const metric of this.rt.w.metrics ?? []) if (metric.day >= 0) rows.push({ kind: 'metrics', day: metric.day, data: clean(metric) });
    flush();
    Object.assign(branch, state, { lastHash: lastCommand ? hash(lastCommand) : null });
    this.save();
  }
  async importExistingArchives() {
    for (const entry of archivedWorlds(this.rt.cfg.dataDir)) {
      if (entry.id === this.rt.w.id || !/^[a-zA-Z0-9_-]{1,100}$/.test(entry.id) || this.index.branches.some(b => b.worldId === entry.id)) continue;
      const dir = join(this.rt.cfg.dataDir, entry.id), w = readSnapshot(dir);
      if (!w) continue; // 公开归档没有私人原件时，不能将公开投影冒充完整居民历史。
      const stateFile = join(archiveDirectory(this.rt.cfg.dataDir, entry.id), 'state.json');
      const calendar = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')).world : null;
      const readonly = { w, cfg: { ...this.rt.cfg, worldId: entry.id, reset: false }, dir, engine: engineOf(w), events: { file: join(dir, 'events.jsonl') }, logger: this.rt.logger, onCommand: () => () => {} };
      const imported = new HistoryArchive(readonly, { importArchives: false, calendar: calendar ? { ticksPerDay: calendar.ticksPerDay ?? 12, daysPerMonth: calendar.daysPerMonth ?? 24 } : null });
      await imported.ready; await imported.close();
      this.index = imported.index; this.meta = this.index.branches.find(b => b.id === this.branchId);
    }
  }
  eventRows(events) {
    const w = this.rt.w;
    return events.filter(e => e.vis !== 'internal').map(e => {
      const shown = this.rt.engine.publicEvent(w, e, { released: e.vis === 'delayed' });
      return { kind: 'event', event: clean(e), public: shown ? clean(shown) : null, releaseTick: e.vis === 'delayed' ? Number.isSafeInteger(e.releaseTick) ? e.releaseTick : null : e.vis === 'public' ? 0 : null };
    });
  }
  commandRows(cmd, result, events, before) {
    const p = this.rt.w.physics === 2 ? P2 : P1;
    const metric = cmd.type === 'tick' && result.settled ? this.rt.w.metrics?.at(-1) : null;
    return [...actionRecords(cmd, result, p.ticksPerDay, before, this.rt.w.agents, materialsEnabled(this.rt.w)), ...this.eventRows(events), ...(metric ? [{ kind: 'metrics', day: metric.day, data: clean(metric) }] : [])];
  }
  append(id, rows) {
    if (!rows.length) return;
    const fd = openSync(this.file(id), 'a', 0o600);
    try { appendFileSync(fd, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); fsyncSync(fd); }
    finally { closeSync(fd); }
  }
  commit(state, cmd, rows) {
    if (this.fault) return;
    this.append(this.branchId, rows);
    const ended = this.meta.ended || rows.some(r => r.event?.type === 'great_sleep');
    Object.assign(this.meta, state, { lastHash: hash(cmd), ended }); this.save();
  }
  save() { durableFile(this.indexFile, JSON.stringify(this.index)); }
  file(id) { return join(this.root, `${id}.jsonl`); }
  branches() { return this.index.branches.map(({ residents, identity, lastHash, redacted, ...b }) => ({ ...b })); }
  branch(id = this.branchId) { return this.index.branches.find(b => b.id === id); }
  async flush() { await this.pending; if (this.fault) throw this.fault; }
  async residentRecords(branchId, id, { fromDay = 0, toDay = Number.MAX_SAFE_INTEGER, throughCommand = Infinity, throughSeq = Infinity, throughTick = Infinity } = {}) {
    const branch = this.branch(branchId), rows = [], seen = new Set();
    if (!branch) throw Error('历史分支不存在。');
    for await (const item of jsonLines(this.file(branchId))) {
      let row;
      if (item.kind === 'event') {
        const e = item.event;
        if (e.seq > throughSeq || !privateEventFor(e, id)) continue;
        const data = e.type === 'whisper' && e.data?.anonymous && e.agent !== id ? { ...e.data, from: null } : e.data;
        row = { kind: e.type, tick: e.tick, day: e.day ?? Math.floor(e.tick / branch.ticksPerDay), seq: e.seq, place: e.place, data: branch.redacted.includes(e.seq) ? { redacted: true } : data, source: { type: 'event', seq: e.seq } };
      } else if (item.agentId === id && (item.commandN ?? 0) <= throughCommand) row = item;
      if (!row || row.tick > throughTick || row.day < fromDay || row.day > toDay) continue;
      // 有效请求的传输重试会返回同一回执；它不代表再次行动或再次付费。
      const signature = row.kind === 'action' ? `action:${row.decisionKey ?? row.commandN}:${row.index}` : row.kind === 'thought' ? JSON.stringify(['thought', row.tick, row.text ?? row.data?.text]) : row.seq ? `event:${row.seq}` : JSON.stringify([row.kind, row.tick, row.text ?? row.data?.text ?? row.data]);
      if (!seen.has(signature)) { seen.add(signature); rows.push(row); }
    }
    return rows.sort((a, b) => a.tick - b.tick || (a.commandN ?? a.seq ?? 0) - (b.commandN ?? b.seq ?? 0));
  }
  async publicSources(branchId, period) {
    const branch = this.branch(branchId), counts = {}, recent = [], important = [], redacted = new Set(branch.redacted), metrics = new Map();
    const priority = new Set(['death', 'retire', 'arrive', 'born', 'law_passed', 'founded', 'built', 'great_sleep', 'procedure', 'refound']);
    let lastSeq = 0, total = 0;
    for await (const row of jsonLines(this.file(branchId))) {
      if (row.kind === 'metrics' && row.day >= period.fromDay - 1 && row.day <= period.toDay) metrics.set(row.day, row.data);
      if (row.kind !== 'event' || !row.public || !Number.isSafeInteger(row.releaseTick) || row.releaseTick > branch.tick || redacted.has(row.event.seq)) continue;
      const e = row.public, day = e.day ?? Math.floor(e.tick / branch.ticksPerDay);
      if (day < period.fromDay || day > period.toDay || e.seq <= lastSeq) continue;
      lastSeq = e.seq; total++;
      counts[e.type] = (counts[e.type] ?? 0) + 1;
      const source = { id: `event:${e.seq}`, day, event: e };
      recent.push(source); if (recent.length > 40) recent.shift();
      if (priority.has(e.type)) { important.push(source); if (important.length > 40) important.shift(); }
    }
    const snapshots = [...metrics].sort(([a], [b]) => a - b).map(([, data]) => data);
    const summary = { id: 'period', fromDay: period.fromDay, toDay: period.toDay, days: period.toDay - period.fromDay + 1, eventCounts: counts, dailySnapshotsAvailable: snapshots.length,
      firstAvailableDailySnapshot: snapshots[0] ?? null, lastAvailableDailySnapshot: snapshots.at(-1) ?? null };
    const sources = [summary, ...new Map([...important, ...recent].map(s => [s.id, s])).values()];
    summary.representativeEvents = sources.length - 1;
    return { summary, sources, sampled: sources.length - 1 < total };
  }
  async close() { this.unsubscribe?.(); await this.flush(); }
}
