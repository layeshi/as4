import os from 'node:os';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

const MiB = 1048576;
const positive = n => Number.isFinite(n) && n > 0 ? n : Infinity;
const unescapePath = s => s.replace(/\\([0-7]{3})/g, (_, n) => String.fromCharCode(parseInt(n, 8)));

// Resolve membership against mount roots (including delegated/container mounts).
export function linuxLimits(read = file => readFileSync(file, 'utf8')) {
  const result = { cpu: Infinity, memory: Infinity, available: Infinity, high: Infinity, detected: false };
  const get = file => { try { return read(file).trim(); } catch { return ''; } };
  const allowed=get('/proc/self/status').match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1];
  if(allowed&&/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(allowed)) result.affinity=allowed.split(',').reduce((n,part)=>{const [a,b=a]=part.split('-').map(Number);return n+Math.max(0,b-a+1);},0);
  const groups = get('/proc/self/cgroup').split('\n').map(line => line.split(':'));
  for (const line of get('/proc/self/mountinfo').split('\n')) {
    const [left, right] = line.split(' - ');
    if (!right) continue;
    const fields = left.split(' '), [type, , options = ''] = right.split(' ');
    if (!['cgroup', 'cgroup2'].includes(type)) continue;
    const group = groups.find(g => type === 'cgroup2' ? g[0] === '0' : g[1]?.split(',').some(c => options.split(',').includes(c)));
    if (!group) continue;
    const root = unescapePath(fields[3]), mount = unescapePath(fields[4]), member = group.slice(2).join(':');
    if (member !== root && !member.startsWith(root === '/' ? '/' : root + '/')) continue;
    let dir = posix.join(mount, posix.relative(root, member));
    while (dir === mount || dir.startsWith(mount + '/')) {
      result.detected = true;
      if (type === 'cgroup2') {
        const [quota, period] = get(posix.join(dir, 'cpu.max')).split(/\s+/).map(Number);
        result.cpu = Math.min(result.cpu, positive(quota / period));
      } else {
        const quota = Number(get(posix.join(dir, 'cpu.cfs_quota_us'))), period = Number(get(posix.join(dir, 'cpu.cfs_period_us')));
        result.cpu = Math.min(result.cpu, positive(quota / period));
      }
      const limit = positive(Number(get(posix.join(dir, type === 'cgroup2' ? 'memory.max' : 'memory.limit_in_bytes'))));
      const currentText = get(posix.join(dir, type === 'cgroup2' ? 'memory.current' : 'memory.usage_in_bytes'));
      result.memory = Math.min(result.memory, limit);
      if (currentText && Number.isFinite(Number(currentText))) result.available = Math.min(result.available, Math.max(0, limit - Number(currentText)));
      if (type === 'cgroup2') result.high = Math.min(result.high, positive(Number(get(posix.join(dir, 'memory.high')))));
      if (dir === mount) break;
      dir = posix.dirname(dir);
    }
  }
  return result;
}

export function detectResources(cfg = {}, readers = {}) {
  const r = { platform: process.platform, parallelism: os.availableParallelism, totalmem: os.totalmem,
    freemem: process.availableMemory?.bind(process) ?? os.freemem, constrained: process.constrainedMemory?.bind(process) ?? (() => 0), ...readers };
  const linux = r.platform === 'linux' ? linuxLimits(r.read) : {};
  const cpu = Math.min(positive(linux.affinity ?? r.parallelism()), positive(linux.cpu), positive(cfg.resourceCpu));
  const memory = Math.min(positive(r.totalmem()), positive(r.constrained()), positive(linux.memory), positive(cfg.resourceMemoryMb * MiB));
  const integerCpu = Math.max(1, Math.floor(cpu));
  const slots = Math.min(Math.max(1, integerCpu - Math.max(1, Math.ceil(integerCpu / 8))), positive(cfg.computeWorkers));
  const budget = Math.floor(memory * 0.75);
  return { cpu, slots, memory, budget, cacheBytes: Math.min(budget, cfg.computeCacheMb == null ? Math.min(budget / 10, 4096 * MiB) : cfg.computeCacheMb * MiB),
    available: Math.min(r.freemem(), linux.available ?? Infinity), high: linux.high ?? Infinity,
    constraintSource: linux.detected ? 'cgroup' : r.platform === 'win32' ? 'system; job limits unknown' : 'system', platform: r.platform };
}

export class ResourceBudget {
  constructor(cfg = {}, readers = {}) { this.cfg = cfg; this.readers = readers; this.current = detectResources(cfg, readers); this.reserved = 0; this.worldActive = 0; this.backgroundActive = 0; this.pressure = null; }
  refresh() { this.current = detectResources(this.cfg, this.readers); return this.current; }
  canRun(bytes = 0, background = false) {
    const r = this.refresh(), rss = this.readers.rss?.() ?? process.memoryUsage.rss();
    this.pressure = rss + this.reserved + bytes > Math.min(r.budget, r.high) || bytes > r.available ? 'memory' : null;
    return !this.pressure && (!background || !this.worldActive && this.backgroundActive < Math.max(1, r.slots - 1));
  }
  view() { return { ...this.refresh(), reservedBytes: this.reserved, rssBytes: process.memoryUsage.rss(), worldActive: this.worldActive, backgroundActive: this.backgroundActive, pressure: this.pressure }; }
}

export class ByteCache {
  constructor(limit) { this.limit = limit; this.bytes = 0; this.items = new Map(); this.hits = 0; this.misses = 0; }
  get(key, admit) { const e = this.items.get(key); if (!e) { this.misses++; return; } if(admit)admit(e.bytes); this.hits++; this.items.delete(key); this.items.set(key, e); return e.value.toString('utf8'); }
  set(key, value) { const bytes = Buffer.byteLength(value); if (this.items.has(key)) { this.bytes -= this.items.get(key).bytes; this.items.delete(key); } if (bytes > this.limit) return; this.items.set(key, { value: Buffer.from(value), bytes }); this.bytes += bytes; while (this.bytes > this.limit || this.items.size > 10000) { const oldest = this.items.keys().next().value; this.bytes -= this.items.get(oldest).bytes; this.items.delete(oldest); } }
  clear() { this.items.clear(); this.bytes = 0; }
  view() { return { bytes: this.bytes, entries: this.items.size, hits: this.hits, misses: this.misses, limitBytes: this.limit }; }
}
