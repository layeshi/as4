// 人类公告公开阅读页，复用会员页的纸页、细线与原生组件。
import { h, clear } from './dom.js';
import { api, errorText } from './api.js';
import { initAccounts, refreshAccount } from './accounts.js';
import { mountShell, pageHead, card, emptyState, btn, tr, setNotice } from './console-ui.js';
export const announcementTime = value => `${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))} UTC+8`;
export const announcementMeta = item => h('p', { class: 'announcement-meta muted' }, h('time', { datetime: item.publishedAt }, announcementTime(item.publishedAt)),
  item.editedAt ? ` · ${tr('已更新', 'Updated')} ${announcementTime(item.editedAt)}` : '');
export async function mountAnnouncements({ header, head, message, content, id = null }) {
  let generation = 0, disposed = false, currentId = id, items = [], nextCursor = null;
  setNotice(text => { message.textContent = text; });
  mountShell(header, { active: 'announcements' });
  initAccounts(null, { onAccountChange: () => load(currentId) });
  const row = item => h('article', { class: 'announcement-row' }, h('h3', null,
    h('a', { href: '/announcements.html?id=' + encodeURIComponent(item.id) }, item.title)), announcementMeta(item),
    h('a', { class: 'announcement-read', href: '/announcements.html?id=' + encodeURIComponent(item.id) }, tr('阅读全文 →', 'Read announcement →')));
  async function load(selected = currentId, more = false) {
    currentId = selected; const version = ++generation;
    message.textContent = '';
    pageHead(head, { eyebrow: tr('后人纪', 'The Heirs'), title: tr('公告', 'Announcements'), lead: tr('维护通知、版本更新与运营说明。', 'Maintenance notices, updates and news.'),
      back: { href: selected ? '/announcements.html' : '/', label: selected ? tr('全部公告', 'All announcements') : tr('返回观测站', 'Observatory') },
      actions: [btn(tr('刷新', 'Refresh'), () => load(currentId))] });
    if (!more) clear(content).append(h('p', { class: 'muted', role: 'status' }, tr('正在加载公告…', 'Loading announcements…')));
    const path = selected ? '/api/announcements/' + encodeURIComponent(selected) : '/api/announcements' + (more && nextCursor ? '?cursor=' + nextCursor : '');
    const result = await api(path);
    if (disposed || version !== generation) return;
    if (!result.ok) {
      const text = errorText(result, tr('请检查网络后重试。', 'Check your connection and retry.'));
      if (more) { message.textContent = text; return; }
      clear(content).append(emptyState(tr('无法读取公告', 'Unable to load announcements'), text, btn(tr('重试', 'Retry'), () => load(selected)))); return;
    }
    clear(content);
    if (selected) {
      const item = result.json.announcement;
      content.append(card('', '', h('article', { class: 'announcement-detail' }, h('h2', null, item.title), announcementMeta(item), h('div', { class: 'announcement-text' }, item.body))));
    } else {
      items = more ? [...items, ...result.json.announcements.filter(item => !items.some(old => old.id === item.id))] : result.json.announcements;
      nextCursor = result.json.nextCursor;
      if (!items.length) content.append(emptyState(tr('暂无公告', 'No announcements yet'), tr('维护通知与版本更新将在这里发布。', 'Maintenance notices and updates will appear here.')));
      else content.append(card(tr('全部公告', 'All announcements'), tr(`共 ${result.json.total} 条 · 按发布时间排序`, `${result.json.total} announcements · Newest first`), items.map(row)));
      if (nextCursor) content.append(btn(tr('加载更多', 'Load more'), () => load(null, true)));
    }
  }
  await Promise.all([refreshAccount({ notify: false, redirect: false }), load(id)]);
  return { load, dispose() { disposed = true; generation++; } };
}
