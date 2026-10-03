// 手动世界存档与每日覆盖的 snapshot.json 分开；只保存确定性世界及对应日志。
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { stateHash } from './store.js';
import { fail } from './accounts/store.js';

const compress = promisify(gzip);
const validId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
function durableWrite(file, data) {
  const fd = openSync(file, 'wx', 0o600);
  try { writeFileSync(fd, data); fsyncSync(fd); }
  finally { closeSync(fd); }
}
function syncDirectory(dir) {
  const fd = openSync(dir, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export class WorldSnapshots {
  constructor(rt) {
    this.rt = rt;
    this.root = join(rt.dir, 'snapshots');
    this.saving = false;
  }

  async save(body, authorize = () => {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'label') ||
      (body.label !== undefined && (typeof body.label !== 'string' || body.label.length > 120))) {
      fail(400, 'invalid_snapshot', '快照备注最多 120 个字符，请勿传入其他字段。');
    }
    if (this.saving) fail(409, 'snapshot_busy', '已有快照正在保存，请稍后重试。');
    this.saving = true;
    let staging;
    try {
      const { rt } = this;
      const metadata = {
        id: randomUUID(), createdAt: new Date().toISOString(), label: (body.label || '').trim(),
        worldId: rt.w.id, physics: rt.engine.physics, tick: rt.w.clock.tick,
        day: rt.engine.clockDay(rt.w), commandN: rt.w.commandN, eventSeq: rt.w.counters.event,
        codeVersion: rt.w.codeVersion, runtimeVersion: rt.version, stateHash: stateHash(rt.w),
      };
      // 在第一次 await 之前抓取三份数据：刻调度器、HTTP 命令无法插入这个边界。
      // 白名单保证账号、运行器、模型密钥和以前的存档不会被递归打包。
      const files = { 'snapshot.json': JSON.stringify(rt.w) };
      for (const name of ['commands.jsonl', 'events.jsonl']) {
        const file = join(rt.dir, name);
        files[name] = existsSync(file) ? readFileSync(file, 'utf8') : '';
      }
      const archive = await compress(JSON.stringify({ format: 'houren-world-snapshot', version: 1, metadata, files }));
      authorize(); // 压缩期间可能退出登录或撤销管理员权限，发布前再次检查。
      const manifest = { ...metadata, bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex') };
      mkdirSync(this.root, { recursive: true, mode: 0o700 });
      staging = join(this.root, `.tmp-${metadata.id}`);
      mkdirSync(staging, { mode: 0o700 });
      durableWrite(join(staging, 'archive.json.gz'), archive);
      durableWrite(join(staging, 'manifest.json'), JSON.stringify(manifest));
      syncDirectory(staging);
      renameSync(staging, join(this.root, metadata.id));
      staging = null;
      syncDirectory(this.root);
      return manifest;
    } finally {
      if (staging) rmSync(staging, { recursive: true, force: true });
      this.saving = false;
    }
  }

  list(page = 1) {
    const snapshots = [];
    if (existsSync(this.root)) for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !validId(entry.name)) continue;
      const file = join(this.root, entry.name, 'manifest.json');
      // 中断的临时目录与不完整的存档不展示；无法读的文件仍报错以便管理员重试。
      if (!existsSync(file) || !existsSync(join(this.root, entry.name, 'archive.json.gz'))) continue;
      snapshots.push(JSON.parse(readFileSync(file, 'utf8')));
    }
    snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { snapshots: snapshots.slice((page - 1) * 20, page * 20), page, pageSize: 20, total: snapshots.length };
  }

  download(id) {
    if (!validId(id)) fail(404, 'not_found', '快照不存在。');
    const file = join(this.root, id, 'archive.json.gz');
    if (!existsSync(file)) fail(404, 'not_found', '快照不存在。');
    return file;
  }
}
