// 首页与登录入口的轻量公告提示，不依赖城市数据或登录状态。
import { h, clear } from './dom.js';
import { api } from './api.js';
import { getLang } from './i18n.js';
const tr = (zh, en) => getLang() === 'en' ? en : zh;
export function mountLatestAnnouncement(root) {
  let generation = 0, disposed = false;
  async function refresh() {
    if (disposed) return;
    const version = ++generation;
    const result = await api('/api/announcements/latest');
    if (disposed || version !== generation) return;
    clear(root);
    const item = result.json?.announcement;
    root.hidden = result.ok && !item;
    if (!result.ok) {
      root.append(h('span', { class: 'muted' }, tr('暂时无法读取公告。', 'Announcements are unavailable.')), h('a', { href: '/announcements.html' }, tr('全部公告', 'All announcements')),
        h('button', { type: 'button', class: 'btn', onClick: refresh }, tr('重试', 'Retry')));
    } else if (item) root.append(h('span', { class: 'muted' }, tr('最新公告', 'Latest announcement')),
      h('a', { class: 'announcement-preview-title', href: '/announcements.html?id=' + encodeURIComponent(item.id) }, item.title),
      h('a', { href: '/announcements.html' }, tr('全部公告 →', 'All announcements →')));
  }
  const timer = setInterval(() => { if (!document.hidden) refresh(); }, 30000); timer.unref?.();
  refresh();
  return { refresh, dispose() { disposed = true; generation++; clearInterval(timer); } };
}
