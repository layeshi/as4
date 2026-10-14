// 人类留言独立于世界保存；重置、回放或恢复世界不改变这里的数据。
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fail } from './accounts/store.js';
import { durableFile } from './durable-file.js';

export const MESSAGE_LENGTH = 2000;
export const MESSAGE_PAGE_SIZE = 20;
const owns = (actor, entry) => entry.authorId === actor.id || (actor.mergedAccountIds || []).includes(entry.authorId);
function authorName(accounts, id) {
  const seen = new Set();
  let author = accounts.get(id);
  while (author?.mergedTo && !seen.has(author.id)) {
    seen.add(author.id);
    author = accounts.get(author.mergedTo);
  }
  return author?.displayName || '已停用用户';
}
export function messageText(value) {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > MESSAGE_LENGTH) fail(400, 'invalid_message', '请输入 1–2,000 字的留言。');
  return value.trim();
}
export function messageCursor(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail(400, 'invalid_cursor', '分页位置无效，请刷新页面。');
  return Number(value);
}

export class MessageBoard {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'message-board.json');
    this.data = { version: 1, nextSeq: 1, entries: [] };
    try { this.data = JSON.parse(readFileSync(this.file, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const { version, nextSeq, entries } = this.data;
    if (version !== 1 || !Number.isSafeInteger(nextSeq) || nextSeq < 1 || !Array.isArray(entries)) throw Error('Invalid message board store');
    const seen = new Map();
    for (const entry of entries) {
      if (!Number.isSafeInteger(entry.seq) || entry.seq < 1 || entry.seq >= nextSeq || entry.id !== `m${entry.seq}` || seen.has(entry.id) ||
          typeof entry.authorId !== 'string' || typeof entry.text !== 'string' || !Number.isFinite(Date.parse(entry.createdAt)) ||
          (entry.deletedAt !== null && !Number.isFinite(Date.parse(entry.deletedAt))) ||
          (entry.editedAt !== null && !Number.isFinite(Date.parse(entry.editedAt)))) throw Error('Invalid message board entry');
      if (entry.threadId !== null) {
        const root = seen.get(entry.threadId), target = seen.get(entry.replyToId);
        if (!root || root.threadId !== null || !target || (target.id !== root.id && target.threadId !== root.id)) throw Error('Invalid message board reply');
      } else if (entry.replyToId !== null) throw Error('Invalid message board thread');
      seen.set(entry.id, entry);
    }
  }
  // 先写临时文件并同步到磁盘，再原子替换；失败时内存仍保持原版本。
  commit(change) {
    const next = structuredClone(this.data), result = change(next);
    durableFile(this.file, JSON.stringify(next));
    this.data = next;
    return result;
  }
  get(id) {
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) fail(404, 'message_not_found', '留言不存在。');
    return entry;
  }
  thread(id) {
    const entry = this.get(id);
    if (entry.threadId !== null) fail(400, 'invalid_thread', '请在主留言下回复。');
    return entry;
  }
  create(actor, text, { threadId = null, replyToId = null } = {}) {
    text = messageText(text);
    if (threadId !== null) {
      this.thread(threadId);
      const target = this.get(replyToId ?? threadId);
      if (target.id !== threadId && target.threadId !== threadId) fail(400, 'invalid_reply_target', '回复对象不属于这条讨论。');
      replyToId = target.id;
    }
    return this.commit((data) => {
      const seq = data.nextSeq++;
      const entry = { id: `m${seq}`, seq, threadId, replyToId, authorId: actor.id, text, createdAt: new Date().toISOString(), editedAt: null, deletedAt: null };
      data.entries.push(entry);
      return entry;
    });
  }
  edit(actor, id, text) {
    const entry = this.get(id);
    if (!owns(actor, entry)) fail(403, 'forbidden', '只能编辑自己的留言。');
    if (entry.deletedAt) fail(409, 'message_deleted', '已删除的留言不能编辑。');
    text = messageText(text);
    return this.commit((data) => {
      const updated = data.entries.find((e) => e.id === id);
      updated.text = text; updated.editedAt = new Date().toISOString();
      return updated;
    });
  }
  delete(actor, id) {
    const entry = this.get(id);
    if (!owns(actor, entry) && actor.role !== 'admin') fail(403, 'forbidden', '只能删除自己的留言。');
    if (entry.deletedAt) return entry;
    return this.commit((data) => {
      const updated = data.entries.find((e) => e.id === id);
      updated.text = ''; updated.deletedAt = new Date().toISOString();
      return updated;
    });
  }
  view(entry, accounts, actor) {
    const target = entry.replyToId ? this.get(entry.replyToId) : null;
    return {
      id: entry.id, seq: entry.seq, threadId: entry.threadId,
      author: { displayName: authorName(accounts, entry.authorId) },
      text: entry.deletedAt ? null : entry.text, createdAt: entry.createdAt, editedAt: entry.editedAt, deletedAt: entry.deletedAt,
      replyTo: target ? { id: target.id, displayName: authorName(accounts, target.authorId), deleted: !!target.deletedAt } : null,
      canEdit: !entry.deletedAt && owns(actor, entry),
      canDelete: !entry.deletedAt && (owns(actor, entry) || actor.role === 'admin'),
      ...(entry.threadId === null ? { replyCount: this.data.entries.filter((e) => e.threadId === entry.id).length } : {}),
    };
  }
  list(accounts, actor, { threadId = null, cursor = null } = {}) {
    if (threadId !== null) this.thread(threadId);
    cursor = messageCursor(cursor);
    const all = this.data.entries.filter((e) => e.threadId === threadId);
    const eligible = all.filter((e) => cursor === null || (threadId === null ? e.seq < cursor : e.seq > cursor));
    if (threadId === null) eligible.reverse();
    const page = eligible.slice(0, MESSAGE_PAGE_SIZE);
    return { messages: page.map((e) => this.view(e, accounts, actor)), total: all.length, nextCursor: eligible.length > page.length ? page.at(-1).seq : null };
  }
}
