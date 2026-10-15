// 管理员公告属于人类运营信息；与实验世界及其快照独立保存。
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fail } from './accounts/store.js';
import { durableFile } from './durable-file.js';

export const ANNOUNCEMENT_PAGE_SIZE = 20;
function content(input) {
  if (input.status !== undefined) fail(400, 'invalid_announcement', '公告不支持草稿或直接指定状态。');
  const result = {};
  for (const [key, limit, label] of [['title', 100, '标题'], ['body', 10000, '正文']]) {
    if (typeof input[key] !== 'string' || !input[key].trim() || [...input[key].trim()].length > limit) fail(400, 'invalid_announcement', `${label}请输入 1–${limit.toLocaleString('en-US')} 字。`);
    result[key] = input[key].trim();
  }
  return result;
}
function cursor(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail(400, 'invalid_cursor', '分页位置无效，请刷新公告。');
  return Number(value);
}
const admin = actor => { if (actor?.role !== 'admin') fail(403, 'forbidden', '此操作需要管理员权限。'); };
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
export class AnnouncementStore {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'announcements.json');
    this.data = { version: 1, nextId: 1, nextOrder: 1, entries: [] };
    try { this.data = JSON.parse(readFileSync(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const d = this.data, ids = new Set(), orders = new Set();
    if (d.version !== 1 || !Number.isSafeInteger(d.nextId) || d.nextId < 1 || !Number.isSafeInteger(d.nextOrder) || d.nextOrder < 1 || !Array.isArray(d.entries)) throw Error('Invalid announcement store');
    for (const e of d.entries) {
      if (!/^a[1-9]\d*$/.test(e.id) || Number(e.id.slice(1)) >= d.nextId || ids.has(e.id) || !Number.isSafeInteger(e.order) || e.order < 1 || e.order >= d.nextOrder || orders.has(e.order) ||
          !['published', 'withdrawn'].includes(e.status) || !Number.isSafeInteger(e.revision) || e.revision < 1 || !date(e.publishedAt) || !date(e.createdAt) ||
          e.editedAt !== null && !date(e.editedAt) || e.withdrawnAt !== null && !date(e.withdrawnAt) || !Array.isArray(e.history) || e.history.length !== e.revision) throw Error('Invalid announcement entry');
      content({ title: e.title, body: e.body });
      for (const h of e.history) if (!['publish', 'edit', 'withdraw'].includes(h.action) || typeof h.actorId !== 'string' || typeof h.displayName !== 'string' || !date(h.at)) throw Error('Invalid announcement history');
      ids.add(e.id); orders.add(e.order);
    }
  }
  commit(change) {
    const next = structuredClone(this.data), result = change(next);
    durableFile(this.file, JSON.stringify(next));
    this.data = next;
    return structuredClone(result);
  }
  get(id, { management = false } = {}) {
    const e = this.data.entries.find(e => e.id === id && (management || e.status === 'published'));
    if (!e) fail(404, 'announcement_not_found', '公告不存在或已撤下。');
    return e;
  }
  view(e, { management = false, summary = false } = {}) {
    return { id: e.id, title: e.title, ...(!summary ? { body: e.body } : {}), publishedAt: e.publishedAt, editedAt: e.editedAt,
      ...(management ? { status: e.status, revision: e.revision, createdAt: e.createdAt, withdrawnAt: e.withdrawnAt, history: structuredClone(e.history) } : {}) };
  }
  list({ management = false, cursor: value = null } = {}) {
    const before = cursor(value), all = this.data.entries.filter(e => management || e.status === 'published').sort((a, b) => b.order - a.order);
    const eligible = all.filter(e => before === null || e.order < before), page = eligible.slice(0, ANNOUNCEMENT_PAGE_SIZE);
    return { announcements: page.map(e => this.view(e, { management, summary: !management })), total: all.length, nextCursor: eligible.length > page.length ? page.at(-1).order : null };
  }
  latest() { const e = this.data.entries.filter(e => e.status === 'published').sort((a, b) => b.order - a.order)[0]; return e ? this.view(e, { summary: true }) : null; }
  create(actor, input) {
    admin(actor); const text = content(input), at = new Date().toISOString();
    return this.commit(data => {
      const entry = { id: `a${data.nextId++}`, order: data.nextOrder++, ...text, status: 'published', revision: 1, createdAt: at, publishedAt: at, editedAt: null, withdrawnAt: null,
        history: [{ actorId: actor.id, displayName: actor.displayName, action: 'publish', at }] };
      data.entries.push(entry); return this.view(entry, { management: true });
    });
  }
  change(actor, id, action, input) {
    admin(actor); const e = this.get(id, { management: true });
    if (input.revision !== e.revision) fail(409, 'announcement_changed', '公告已被其他管理员修改，请刷新后重试。');
    const text = action === 'edit' ? content(input) : null;
    if (action === 'publish' && e.status !== 'withdrawn' || action === 'withdraw' && e.status !== 'published') fail(409, 'announcement_state', '公告状态已改变，请刷新后重试。');
    if (!['edit', 'publish', 'withdraw'].includes(action)) fail(400, 'invalid_action', '公告操作无效。');
    return this.commit(data => {
      const updated = data.entries.find(e => e.id === id), at = new Date().toISOString();
      if (action === 'edit') Object.assign(updated, text, { editedAt: at });
      if (action === 'publish') Object.assign(updated, { status: 'published', publishedAt: at, order: data.nextOrder++, withdrawnAt: null });
      if (action === 'withdraw') Object.assign(updated, { status: 'withdrawn', withdrawnAt: at });
      updated.revision++; updated.history.push({ actorId: actor.id, displayName: actor.displayName, action, at });
      return this.view(updated, { management: true });
    });
  }
}
