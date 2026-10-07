// SPEC-M1 §10：事件的落盘、环形缓冲、SSE 分发与延迟释放。
//
//   events.jsonl   全部事件（含 owner 与 internal），只追加；
//   环形缓冲       最近 2000 条「公开可见」的事件（public 立即进入；delayed 在释放时进入）；
//   延迟队列       delayed 事件按 releaseTick 排序，每刻释放到期的并推送（标记 delayed: true）；
//   造者日志       每个 agent 最近的 owner / delayed 事件（独白、梦、家书……），造者立即可见。

import { closeSync, fsyncSync, openSync, renameSync, appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FiscalView } from './fiscal-view.js';

const RING_SIZE = 2000;
const OWNER_KEEP = 300;

/** 事件是否与某位 agent 有关（用于公开档案里的「与它有关的最近事件」） */
export function involves(ev, id) {
  if (ev.agent === id) return true;
  const d = ev.data;
  if (!d) return false;
  if (d.agentId === id || d.from === id || d.to === id || d.with === id || d.deceased === id || d.target === id) return true;
  if (Array.isArray(d.parents) && d.parents.includes(id)) return true;
  // 第二纪才有的字段：灵魂与出生的作者、章程与地点规则的设置者、联署者（第一纪的事件没有这些字段）
  return (Array.isArray(d.authors) && d.authors.includes(id)) || d.setBy === id || d.signer === id;
}

export class EventStore {
  /** @param {string|null} file events.jsonl 的路径；null 表示不落盘（沙盘与测试） */
  constructor(file = null) {
    this.file = file;
    this.ring = []; // 已公开的事件：{ ...event, released?: true }
    this.pending = []; // 等待释放的 delayed 事件，按 releaseTick 升序
    this.owner = new Map(); // agentId → 最近的 owner / delayed 事件
    this.subscribers = new Set(); // (name, data) => void
    this.lastSeq = 0;
    this.fiscal = new FiscalView();
    if (file) mkdirSync(dirname(file), { recursive: true });
  }

  /**
   * 启动时从 events.jsonl 重建内存状态。
   * keepSeq：只保留 seq ≤ keepSeq 的事件（崩溃恢复：快照之后的事件会由回放重新产生，先截掉）。
   * tick：当前刻，用来决定哪些 delayed 事件已经释放。
   */
  load({ keepSeq = Infinity, tick = 0 } = {}) {
    this.fiscal = new FiscalView();
    this.ring = [];
    this.pending = [];
    this.owner = new Map();
    this.lastSeq = 0;
    if (!this.file || !existsSync(this.file)) return;
    const original = readFileSync(this.file, 'utf8');
    const keep = [];
    for (const line of original.split('\n')) {
      if (line === '') continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        break; // 崩溃时写了一半的最后一行
      }
      if (ev.seq > keepSeq) break;
      keep.push(line);
      this.index(ev, tick);
      this.lastSeq = ev.seq;
    }
    const retained = keep.length ? `${keep.join('\n')}\n` : '';
    if (retained !== original) {
      // A startup crash must leave either the original log or the complete
      // retained prefix, never truncate events already covered by a snapshot.
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, retained, { mode: 0o600 });
      syncFile(temporary);
      renameSync(temporary, this.file);
      syncFile(dirname(this.file));
    }
  }

  /** A snapshot may acknowledge events only after this durability barrier. */
  sync() {
    if (!this.file || !existsSync(this.file)) return;
    syncFile(this.file);
    syncFile(dirname(this.file));
  }

  /** 把一条事件放进内存索引（不落盘、不推送） */
  index(ev, tick) {
    this.fiscal.index(ev);
    if (ev.vis === 'public') this.pushRing(ev);
    else if (ev.vis === 'delayed') {
      this.addOwner(ev);
      if (ev.releaseTick <= tick) this.pushRing({ ...ev, released: true });
      else this.insertPending(ev);
    } else if (ev.vis === 'owner') this.addOwner(ev);
  }

  pushRing(ev) {
    this.ring.push(ev);
    if (this.ring.length > RING_SIZE) this.ring.shift();
  }

  insertPending(ev) {
    let i = this.pending.length;
    while (i > 0 && this.pending[i - 1].releaseTick > ev.releaseTick) i--;
    this.pending.splice(i, 0, ev);
  }

  addOwner(ev) {
    if (ev.agent === undefined) return;
    let list = this.owner.get(ev.agent);
    if (!list) this.owner.set(ev.agent, (list = []));
    list.push(ev);
    if (list.length > OWNER_KEEP) list.shift();
  }

  /**
   * 处理一条命令产出的事件：落盘、进入缓冲或队列、推送。
   * silent：崩溃恢复时重放尾部命令用，不推送 SSE。
   */
  append(events, { silent = false, tick = 0 } = {}) {
    if (events.length === 0) return;
    if (this.file) appendFileSync(this.file, `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
    for (const ev of events) {
      this.lastSeq = ev.seq;
      this.index(ev, tick);
      if (ev.vis === 'public' && !silent) this.emit('e', ev);
    }
  }

  /** 每刻释放到期的 delayed 事件，返回被释放的事件 */
  release(tick, { silent = false } = {}) {
    const out = [];
    while (this.pending.length && this.pending[0].releaseTick <= tick) {
      const ev = this.pending.shift();
      const shown = { ...ev, released: true };
      this.pushRing(shown);
      out.push(shown);
      if (!silent) this.emit('e', shown);
    }
    return out;
  }

  // ── SSE ──
  subscribe(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  emit(name, data) {
    for (const fn of this.subscribers) {
      try {
        fn(name, data);
      } catch {
        // 一个订阅者出错不影响其他人
      }
    }
  }

  // ── 查询 ──
  /** seq 之后的公开事件（按 seq 升序），最多 limit 条 */
  since(seq = 0, limit = 200) {
    const out = [];
    for (const ev of this.ring) if (ev.seq > seq) out.push(ev);
    out.sort((a, b) => a.seq - b.seq);
    return out.slice(0, limit);
  }

  /** 与某位 agent 有关的最近 n 条公开事件 */
  forAgent(id, n = 100) {
    const out = [];
    for (let i = this.ring.length - 1; i >= 0 && out.length < n; i--) if (involves(this.ring[i], id)) out.push(this.ring[i]);
    return out.reverse();
  }

  /** 满足条件的最近 n 条公开事件（按 seq 升序；第二纪用它取与某部法律有关的事件） */
  recent(predicate, n = 100) {
    const out = [];
    for (let i = this.ring.length - 1; i >= 0 && out.length < n; i--) if (predicate(this.ring[i])) out.push(this.ring[i]);
    return out.reverse();
  }

  /** 造者能看到的最近事件（独白、梦、家书、日记……），可按类型过滤 */
  ownerEvents(id, type = null) {
    const list = this.owner.get(id) || [];
    return type ? list.filter((e) => e.type === type) : list.slice();
  }
}

function syncFile(file) {
  const fd = openSync(file, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
