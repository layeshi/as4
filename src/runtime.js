// 运行时：把世界、命令日志、事件存储、快照与刻调度器接在一起。
//
// HTTP 层与调度器只能通过 exec() 改变世界：先把命令追加进命令日志，再交给引擎执行，
// 然后把引擎产出的事件交给 EventStore（落盘、进入缓冲、SSE 推送）。
// 每日结算发生的那条 tick 命令执行完之后写快照（所以快照的状态与 commandN 严格对应）。

import { createWorld } from './world.js';
import { applyCommand } from './engine/index.js';
import { drainEvents } from './engine/core.js';
import { CommandLog, readCommands, repairCommandLog } from './commands.js';
import { EventStore } from './events.js';
import { P } from './params.js';
import { randomSeed } from './config.js';
import { agentList, isAlive } from './world.js';
import {
  worldDir, snapshotPath, commandsPath, eventsPath, readSnapshot, writeSnapshot, removeWorld,
} from './store.js';
import { existsSync } from 'node:fs';

export class Runtime {
  constructor({ cfg, w, log, events, dir, version, logger = console }) {
    this.cfg = cfg;
    this.w = w;
    this.log = log;
    this.events = events;
    this.dir = dir;
    this.version = version;
    this.logger = logger;
    this.nextTickAt = null;
    this.timer = null;
    this.stopped = false;
  }

  /**
   * 打开一个世界：有快照就恢复（读快照，再回放日志里 n > commandN 的命令，追上崩溃前的状态），
   * 否则用种子创建新世界。
   */
  static open(cfg, { version = '0.0.0', logger = console, onCreate = null } = {}) {
    const dir = worldDir(cfg.dataDir, cfg.worldId);
    if (cfg.reset) removeWorld(dir);
    const cmdFile = commandsPath(dir);
    const events = new EventStore(eventsPath(dir));
    let w = readSnapshot(dir);
    let created = false;
    if (w) {
      if (w.codeVersion !== version) logger.warn?.(`世界创建时的代码版本是 ${w.codeVersion}，当前是 ${version}：回放可能不一致`);
      repairCommandLog(cmdFile);
    } else {
      if (existsSync(cmdFile)) throw new Error(`${cmdFile} 存在但没有快照：数据目录不完整，请检查或用 --reset 重建`);
      const seed = cfg.seed || randomSeed();
      w = createWorld({ id: cfg.worldId, seed, codeVersion: version, sandboxAdoption: cfg.sandboxAgents > 0 });
      writeSnapshot(dir, w);
      created = true;
    }
    // 事件：快照之后产生的事件由回放重新产生，所以先截掉
    events.load({ keepSeq: w.counters.event, tick: w.clock.tick });
    const rt = new Runtime({ cfg, w, log: new CommandLog(cmdFile), events, dir, version, logger });
    if (rt.log.n < w.commandN) throw new Error(`命令日志（${rt.log.n} 条）比快照（commandN = ${w.commandN}）还短：数据已损坏`);
    const tail = readCommands(cmdFile, { fromN: w.commandN });
    for (const cmd of tail) {
      const { events: evs } = applyCommand(w, cmd);
      events.append(evs, { silent: true, tick: w.clock.tick });
      if (cmd.type === 'tick') events.release(w.clock.tick, { silent: true });
    }
    if (tail.length) {
      logger.log?.(`已从崩溃中恢复：回放了 ${tail.length} 条命令`);
      rt.snapshot();
    }
    if (created && onCreate) onCreate(rt); // 例如创建沙盘脑（走命令日志，回放才能重建）
    return rt;
  }

  /** 执行一条命令：先写日志，再执行；返回 { result, events, cmd } */
  exec(type, payload = {}) {
    const cmd = this.log.append(type, payload, this.w.clock.tick);
    let out;
    try {
      out = applyCommand(this.w, cmd);
    } catch (e) {
      this.logger.error?.(`命令 #${cmd.n}（${type}）执行出错：`, e);
      out = { result: { ok: false, error: { code: 'internal' } }, events: drainEvents(this.w) };
    }
    this.events.append(out.events, { tick: this.w.clock.tick });
    if (type === 'tick' && out.result.ok) {
      this.events.release(this.w.clock.tick);
      if (out.result.settled) this.snapshot();
      this.events.emit('tick', this.tickSummary());
    }
    return { ...out, cmd };
  }

  snapshot() {
    writeSnapshot(this.dir, this.w);
  }

  /** SSE tick 事件的精简状态（PROTOCOL §9） */
  tickSummary() {
    const w = this.w;
    const hist = w.well.outputHistory;
    return {
      tick: w.clock.tick,
      day: Math.floor(w.clock.tick / P.ticksPerDay),
      nextTickAt: this.nextTickAt,
      agents: agentList(w).filter(isAlive).map((a) => ({ id: a.id, place: a.place, energy: a.energy, status: a.status })),
      treasury: { energy: w.treasury.energy, coins: w.treasury.coins },
      well: { condition: w.places.well.condition, outputYesterday: hist.length ? hist[hist.length - 1] : null },
    };
  }

  /** 推进一刻（调度器与 admin/tick 用） */
  tickNow() {
    return this.exec('tick');
  }

  /** 启动刻调度器：setTimeout 链，按 TICK_MS 推进，不累积漂移 */
  start() {
    if (this.timer || this.stopped) return;
    this.nextTickAt = Date.now() + this.cfg.tickMs;
    const loop = () => {
      const delay = Math.max(0, this.nextTickAt - Date.now());
      this.timer = setTimeout(() => {
        if (this.stopped) return;
        if (!this.w.paused) this.tickNow();
        this.nextTickAt += this.cfg.tickMs;
        if (this.nextTickAt < Date.now()) this.nextTickAt = Date.now() + this.cfg.tickMs; // 进程被挂起过：不补刻
        loop();
      }, delay);
    };
    loop();
  }

  /** 正常退出：停调度器并写快照 */
  close() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.snapshot();
  }
}
