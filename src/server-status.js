// 服务器只读统计：请求只取缓存；后台每 5 秒采样，仅输出汇总数值，不暴露主机或接口标识。
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const readers = {
  cpus: os.cpus, loadavg: os.loadavg, totalmem: os.totalmem, freemem: os.freemem, uptime: os.uptime,
  memoryUsage: () => process.memoryUsage(), processUptime: () => process.uptime(),
  readFile, now: Date.now, monotonic: () => performance.now(),
};
const unavailableNetwork = () => ({ available: false, receiveBytes: null, transmitBytes: null, receiveBytesPerSecond: null, transmitBytesPerSecond: null });
function networkTotals(text) {
  if (text === null) return null;
  let receiveBytes = 0, transmitBytes = 0, found = false;
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const fields = line.slice(colon + 1).trim().split(/\s+/);
    if (fields.length !== 16 || fields.some(value => !/^\d+$/.test(value))) return null;
    found = true;
    if (line.slice(0, colon).trim() === 'lo') continue;
    receiveBytes += Number(fields[0]);
    transmitBytes += Number(fields[8]);
  }
  return found ? { receiveBytes, transmitBytes } : null;
}

export class ServerStatusSampler {
  constructor(overrides = {}) {
    this.readers = { ...readers, ...overrides };
    this.previous = null;
    this.pending = null;
    this.timer = null;
    this.closed = false;
    this.current = this.capture(null, null).status;
  }
  capture(meminfo, netdev) {
    const r = this.readers, cpus = r.cpus();
    const cpu = cpus.reduce((sum, { times: t }) => {
      sum.busy += t.user + t.nice + t.sys + t.irq;
      sum.idle += t.idle;
      return sum;
    }, { busy: 0, idle: 0 });
    const time = r.monotonic(), previous = this.previous;
    const busy = previous ? cpu.busy - previous.cpu.busy : 0;
    const idle = previous ? cpu.idle - previous.cpu.idle : 0;
    const busyPercent = previous && previous.cores === cpus.length && busy >= 0 && idle >= 0 && busy + idle > 0 ? busy / (busy + idle) * 100 : null;
    const totalBytes = r.totalmem();
    const available = meminfo?.match(/^MemAvailable:\s+(\d+)\s+kB\s*$/m);
    const availableBytes = Math.max(0, Math.min(totalBytes, available ? Number(available[1]) * 1024 : r.freemem()));
    const usedBytes = totalBytes - availableBytes, { rss, heapUsed } = r.memoryUsage();
    const totals = networkTotals(netdev), seconds = previous ? (time - previous.time) / 1000 : 0;
    const rate = key => totals && previous?.network && seconds > 0 && totals[key] >= previous.network[key] ? (totals[key] - previous.network[key]) / seconds : null;
    let systemSeconds = null;
    try { systemSeconds = r.uptime(); } catch { /* 部分沙箱不允许读取系统运行时间 */ }
    return {
      cpu, cores: cpus.length, network: totals, time,
      status: {
        sampledAt: new Date(r.now()).toISOString(),
        cpu: { busyPercent, cores: cpus.length, loadavg: r.loadavg() },
        memory: { totalBytes, availableBytes, usedBytes, usedPercent: totalBytes > 0 ? usedBytes / totalBytes * 100 : 0, rss, heapUsed },
        network: totals ? { available: true, ...totals, receiveBytesPerSecond: rate('receiveBytes'), transmitBytesPerSecond: rate('transmitBytes') } : unavailableNetwork(),
        uptime: { systemSeconds, processSeconds: r.processUptime() },
      },
    };
  }
  sample() {
    if (this.closed) return Promise.resolve(this.current);
    if (this.pending) return this.pending;
    // 同时最多两次文件读取；读取失败或平台不支持时只返回数值回退，不暴露错误详情。
    const read = async path => { try { return await this.readers.readFile(path, 'utf8'); } catch { return null; } };
    this.pending = Promise.all([read('/proc/meminfo'), read('/proc/net/dev')]).then(([meminfo, netdev]) => {
      if (!this.closed) {
        const sample = this.capture(meminfo, netdev);
        this.previous = sample;
        this.current = sample.status;
      }
      return this.current;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
  start() {
    if (this.timer || this.closed) return;
    const refresh = () => { this.sample().catch(() => {}); }; // 暂时采样失败时保留上次结果
    refresh();
    this.timer = setInterval(refresh, 5000);
    this.timer.unref?.();
  }
  view() { return this.current; }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.timer = null;
  }
}

export function registeredUserCounts(users, now = Date.now()) {
  const counts = { total: users.length, active: 0, disabled: 0, admins: 0, wechatLinked: 0, createdLast24Hours: 0, createdLast7Days: 0 };
  for (const user of users) {
    if (user.status === 'active') counts.active++;
    if (user.status === 'disabled') counts.disabled++;
    if (user.role === 'admin') counts.admins++;
    if (user.wechatIdentity) counts.wechatLinked++;
    const age = now - Date.parse(user.createdAt);
    if (age >= 0 && age <= 86400000) counts.createdLast24Hours++;
    if (age >= 0 && age <= 7 * 86400000) counts.createdLast7Days++;
  }
  return counts;
}
