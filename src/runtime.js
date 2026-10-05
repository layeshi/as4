// 运行时：把世界、命令日志、事件存储、快照与刻调度器接在一起。
//
// HTTP 层与调度器只能通过 exec() 改变世界：先把命令追加进命令日志，再交给引擎执行，
// 然后把引擎产出的事件交给 EventStore（落盘、进入缓冲、SSE 推送）。
// 每日结算发生的那条 tick 命令执行完之后写快照（所以快照的状态与 commandN 严格对应）。

import { engineOf, engineForPhysics } from './engines.js';
import { CommandLog, readCommands, repairCommandLog } from './commands.js';
import { EventStore } from './events.js';
import { randomSeed } from './config.js';
import {
  worldDir, snapshotPath, commandsPath, eventsPath, readSnapshot, writeSnapshot, removeWorld,
} from './store.js';
import { existsSync, readFileSync } from 'node:fs';

export class Runtime {
  constructor({ cfg, w, log, events, dir, version, logger = console, engine = engineOf(w) }) {
    this.cfg = cfg;
    this.w = w;
    this.engine = engine; // 世界所属的引擎门面（SPEC-E2 §2.1）：physics 为 2 的世界用 v2，其余用 v1
    this.log = log;
    this.events = events;
    this.dir = dir;
    this.version = version;
    this.logger = logger;
    this.nextTickAt = null;
    this.timer = null;
    this.stopped = false;
    this.wakeSubs = new Set(); // 第二前提：运行器订阅「有人找上门」的通知（SPEC-P2 §6.2）；不落盘、不经 SSE、不进事件流
  }

  /** 订阅唤醒通知 fn({ agentId, seq, kind })；返回取消订阅的函数。只有 exec 发出，open 里回放命令时不发 */
  onWake(fn) {
    this.wakeSubs.add(fn);
    return () => this.wakeSubs.delete(fn);
  }

  /**
   * 打开一个世界：有快照就恢复（读快照，再回放日志里 n > commandN 的命令，追上崩溃前的状态），
   * 否则用种子创建新世界。已有的世界按快照的 physics 选择引擎；新世界按 cfg.physics（缺省为第一纪，
   * 服务器入口 server.js 把缺省定为第二纪，见 docs/QUESTIONS.md Q13）。
   */
  static open(cfg, { version = '0.0.0', logger = console, onCreate = null } = {}) {
    const dir = worldDir(cfg.dataDir, cfg.worldId);
    if (cfg.reset) removeWorld(dir);
    const cmdFile = commandsPath(dir);
    const events = new EventStore(eventsPath(dir));
    let w = readSnapshot(dir);
    let created = false;
    let engine;
    if (w) {
      engine = engineOf(w);
      if (cfg.premise != null && cfg.premise !== (w.premise || 0)) logger.warn?.(`PREMISE 只在创建世界时生效；这座城是设定 ${w.premise || 0}`);
      if (w.codeVersion !== version) logger.warn?.(`世界创建时的代码版本是 ${w.codeVersion}，当前是 ${version}：回放可能不一致`);
      repairCommandLog(cmdFile);
    } else {
      if (existsSync(cmdFile)) throw new Error(`${cmdFile} 存在但没有快照：数据目录不完整，请检查或用 --reset 重建`);
      const seed = cfg.seed || randomSeed();
      // TODO(spec): Q13 —— cfg.physics 未指定时按第一纪创建（原有的调用方不受影响）；服务器入口把缺省定为第二纪
      engine = engineForPhysics(cfg.physics === 2 ? 2 : 1);
      const base = { id: cfg.worldId, seed, codeVersion: version, sandboxAdoption: cfg.sandboxAgents > 0, map: cfg.map || (engine.physics === 2 ? 'frontier' : 'classic') };
      w = engine.createWorld(engine.physics === 2 ? { ...base, ...genesisInputs(cfg) } : base);
      if (engine.physics === 2 && w.founders.length > w.shells.slots) logger.warn?.(`先民 ${w.founders.length} 位多于躯壳名额 ${w.shells.slots}：他们都会入城，但名额在先民长眠之前不会空出来`);
      writeSnapshot(dir, w);
      created = true;
    }
    // 事件：快照之后产生的事件由回放重新产生，所以先截掉
    events.load({ keepSeq: w.counters.event, tick: w.clock.tick });
    const rt = new Runtime({ cfg, w, engine, log: new CommandLog(cmdFile), events, dir, version, logger });
    if (rt.log.n < w.commandN) throw new Error(`命令日志（${rt.log.n} 条）比快照（commandN = ${w.commandN}）还短：数据已损坏`);
    const tail = readCommands(cmdFile, { fromN: w.commandN });
    for (const cmd of tail) {
      const { events: evs } = engine.applyCommand(w, cmd);
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
      out = this.engine.applyCommand(this.w, cmd);
    } catch (e) {
      this.logger.error?.(`命令 #${cmd.n}（${type}）执行出错：`, e);
      out = { result: { ok: false, error: { code: 'internal' } }, events: this.engine.drainEvents(this.w) };
    }
    this.events.append(out.events, { tick: this.w.clock.tick });
    for (const wake of out.wakes || []) {
      for (const fn of [...this.wakeSubs]) {
        try {
          fn(wake);
        } catch (e) {
          this.logger.warn?.(`唤醒通知的订阅者出错：${e && e.message}`);
        }
      }
    }
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

  /** SSE tick 事件的精简状态（PROTOCOL §9）；内容由引擎门面生成，nextTickAt 是运行时的 */
  tickSummary() {
    return this.engine.tickSummary(this.w, { nextTickAt: this.nextTickAt });
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

/**
 * 创建第二纪新世界所需的、来自配置的输入（SPEC-E2 §3）：先民文件 FOUNDERS_FILE、躯壳配置 SHELLS_FILE 里的模型名、
 * 躯壳名额 SHELL_SLOTS（Q26），以及沙盘世界里躯壳与先民由沙盘脑驱动的标志。文件只在创建世界时读取，内容进入世界状态的 genesis（回放需要）。
 */
function genesisInputs(cfg) {
  const out = { sandboxShells: cfg.sandboxAgents > 0 };
  if (cfg.premise != null) out.premise = cfg.premise;
  if (cfg.shellSlots !== null && cfg.shellSlots !== undefined) out.shellSlots = cfg.shellSlots;
  if (cfg.foundersFile) out.founders = JSON.parse(readFileSync(cfg.foundersFile, 'utf8'));
  if (cfg.shellsFile) {
    const shells = JSON.parse(readFileSync(cfg.shellsFile, 'utf8'));
    out.shellModels = (shells.lines || []).map((l) => l.model);
  }
  return out;
}
