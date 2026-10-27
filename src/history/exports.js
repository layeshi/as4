import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { durableFile } from '../durable-file.js';
import { fail } from '../accounts/store.js';
import { clean, csvCell, escapeHtml as esc } from './records.js';
import { zip } from './zip.js';
import { renderTimelineRecord } from './render.js';

export function owns(ctx, archive, user, branchId, agentId) {
  const b = archive.branch(branchId), archived = b?.residents[agentId];
  if (!archived || !user) return false;
  if (branchId === archive.branchId) {
    const a = ctx.rt.w.agents[agentId], r = ctx.rt.w.access?.residents?.[agentId];
    if ((ctx.rt.w.premise === 6 || ctx.rt.w.premise === 7)) return r?.managerAccountId === user.id;
    return !!a?.owner && ctx.accounts.linksOf(user.id, ctx.rt.w.id).some(l => l.agentId === agentId && l.token === a.tokenHash);
  }
  if (archived.managerId) {
    let accountId = archived.managerId;
    const seen = new Set();
    while (!seen.has(accountId)) {
      seen.add(accountId); const merged = ctx.accounts.get?.(accountId)?.mergedTo;
      if (!merged) break; accountId = merged;
    }
    return accountId === user.id;
  }
  return ctx.accounts.linksOf(user.id, b.worldId).some(l => l.agentId === agentId && l.token === archived.legacyToken);
}
export function historyFiles(data, style) {
  const range = `第 ${data.fromDay + 1}–${data.toDay + 1} 日`;
  const html = '<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="dark light"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'self\'"><title>' + esc(data.resident.name) + ' · 居民历史</title><link rel="stylesheet" href="history.css"></head><body><main><p class="muted">后人纪 · 居民历史</p><h1>' + esc(data.resident.name) + '</h1><p>' + esc(range) + '</p><p class="muted">世界 ' + esc(data.worldId) + ' · 纪元 ' + esc(data.epoch) + ' · 分支 ' + esc(data.branchId) + '</p><p>' + esc(data.coverage.note) + '</p><details><summary>基本档案</summary><pre>' + esc(JSON.stringify(data.resident, null, 2)) + '</pre></details>' + data.records.map(r => renderTimelineRecord(r, data.ticksPerDay)).join('') + '</main></body></html>';
  const columns = ['世界日', '世界刻', '命令编号', '动作', '执行结果', '失败原因', '参数', '执行回执', '命令前状态', '命令后状态'];
  const csv = '\ufeff' + [columns, ...data.records.filter(r => r.kind === 'action').map(r => [r.day + 1, r.tick % data.ticksPerDay + 1, r.commandN, r.type, r.result.ok === true ? '成功' : r.result.ok === false ? '失败' : '未知', r.result.error?.code ?? r.result.note ?? '', r.parameters, r.result, r.commandBefore, r.commandAfter])].map(row => row.map(csvCell).join(',')).join('\r\n');
  return { 'index.html': html, 'history.css': style, 'history.json': JSON.stringify(clean(data), null, 2), 'actions.csv': csv };
}
export class ExportManager {
  constructor(ctx, archive) {
    this.ctx = ctx; this.archive = archive; this.file = join(archive.root, 'exports.json'); this.closed = false;
    this.jobs = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : [];
    for (const job of this.jobs) if (job.status === 'generating') job.status = 'queued';
    this.running = Promise.resolve();
  }
  save() { durableFile(this.file, JSON.stringify(this.jobs)); }
  authorize(user, job) {
    if (job.userId !== user?.id || !owns(this.ctx, this.archive, user, job.branchId, job.agentId)) fail(403, 'forbidden', '你没有此居民的历史下载权限。');
  }
  view(job) { const { userId, profile, requestId, ...shown } = job; return shown; }
  list(user) { return this.jobs.filter(j => j.userId === user.id && owns(this.ctx, this.archive, user, j.branchId, j.agentId)).slice().reverse().map(j => this.view(j)); }
  get(user, id) { const job = this.jobs.find(j => j.id === id); if (!job) fail(404, 'not_found', '导出记录不存在。'); this.authorize(user, job); return this.view(job); }
  async create(user, body) {
    await this.archive.flush();
    const branchId = body.branchId ?? this.archive.branchId, branch = this.archive.branch(branchId), agentId = body.agentId;
    if (!owns(this.ctx, this.archive, user, branchId, agentId)) fail(403, 'forbidden', '你没有此居民的历史下载权限。');
    const fromDay = body.fromDay ?? 0, toDay = body.toDay ?? Math.floor(branch.tick / branch.ticksPerDay);
    if (![fromDay, toDay].every(n => Number.isSafeInteger(n) && n >= 0) || toDay < fromDay || toDay > Math.floor(branch.tick / branch.ticksPerDay)) fail(400, 'invalid_range', '请选择有效的世界日起止范围。');
    const existing = body.requestId && this.jobs.find(j => j.userId === user.id && j.requestId === body.requestId);
    if (existing) { if (existing.branchId !== branchId || existing.agentId !== agentId || existing.fromDay !== fromDay || existing.toDay !== toDay) fail(409, 'conflict', '同一请求不能改变导出范围。'); return this.get(user, existing.id); }
    if (this.jobs.some(j => j.userId === user.id && ['queued', 'generating'].includes(j.status))) fail(429, 'export_busy', '已有历史正在生成，请完成后再创建。');
    const job = { id: randomUUID(), userId: user.id, branchId, agentId, name: branch.residents[agentId].profile.name, profile: branch.residents[agentId].profile, worldId: branch.worldId, epoch: branch.epoch, ticksPerDay: branch.ticksPerDay,
      fromDay, toDay, throughCommand: branch.commandN, throughSeq: branch.eventSeq, throughTick: branch.tick, requestId: body.requestId ?? null, status: 'queued', createdAt: new Date().toISOString() };
    this.jobs.push(job); this.save(); this.kick(); return this.view(job);
  }
  kick() { this.running = this.running.then(async () => {
    await this.archive.ready;
    const jobs=this.jobs.filter(job=>!this.closed&&job.status==='queued');
    const concurrency=this.ctx.rt.compute ? Math.max(1,this.ctx.rt.compute.budget.current.slots-1) : 1;
    let next=0;
    await Promise.all(Array.from({length:Math.min(jobs.length,concurrency)},async()=>{while(next<jobs.length&&!this.closed)await this.build(jobs[next++]);}));
  }); }
  async build(job) {
    job.status = 'generating'; this.save();
    try {
      const records = await this.archive.residentRecords(job.branchId, job.agentId, job);
      const data = { version: 1, worldId: job.worldId, epoch: job.epoch, branchId: job.branchId, resident: job.profile, fromDay: job.fromDay, toDay: job.toDay, ticksPerDay: job.ticksPerDay, throughTick: job.throughTick, generatedAt: new Date().toISOString(),
        coverage: { records: records.length, firstRecordDay: records[0]?.day ?? null, lastRecordDay: records.at(-1)?.day ?? null, unknownActionResults: records.filter(r => r.kind === 'action' && r.result.ok === null).length, note: '包含所选范围内已保存且可核实的记录。旧版本未保存的内容标为缺失或未知；资源与位置的前后状态以整次命令为范围。未保存的逐刻感知、内部推理及缺失历史不会补写。' }, records };
      const computed=this.ctx.rt.compute ? await this.ctx.rt.compute.pool.run('export',data,Math.max(16*1048576,Buffer.byteLength(JSON.stringify(data))*8)) : null;
      const style = computed ? null : await readFile(new URL('../../public/history-export.css', import.meta.url), 'utf8');
      const bytes = computed ? computed.bytes : zip(historyFiles(data, style));
      const user=this.ctx.accounts.get(job.userId);
      if(!user||user.status!=='active'||!owns(this.ctx,this.archive,user,job.branchId,job.agentId))throw new Error('Export permission changed');
      await writeFile(join(this.archive.root, `${job.id}.zip`), bytes, { mode: 0o600 });
      Object.assign(job, { status: 'ready', bytes: bytes.length, sha256: computed?.sha256 ?? createHash('sha256').update(bytes).digest('hex'), records: records.length, completedAt: data.generatedAt });
      delete job.error;
    } catch { job.status = 'failed'; job.error = '历史生成失败，请重试。'; }
    this.save();
  }
  async download(user, id) {
    const job = this.jobs.find(j => j.id === id); this.get(user, id);
    if (job.status !== 'ready') fail(409, 'not_ready', '历史尚未生成完成。');
    let bytes;
    try { bytes = await readFile(join(this.archive.root, `${job.id}.zip`)); } catch {}
    this.authorize(user, job);
    if (!bytes || bytes.length !== job.bytes || job.sha256 && createHash('sha256').update(bytes).digest('hex') !== job.sha256) {
      job.status = 'failed'; job.error = '历史包文件已失效，请重新生成。'; this.save();
      fail(409, 'export_missing', job.error);
    }
    return bytes;
  }
  async idle() { await this.running; }
  async close() { this.closed = true; await this.idle(); }
}
