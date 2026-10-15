// 公告阅读：沿用月下城的卡片、列表行、排版和 44px 触控区域。
const N = require('../ui/nodes');
const { C } = require('../ui/theme');
function realTime(value) {
  const d = new Date(new Date(value).getTime() + 8 * 3600000), pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC+8`;
}
const meta = item => realTime(item.publishedAt) + (item.editedAt ? '\n已更新 ' + realTime(item.editedAt) : '');
function preview(app, W) {
  const b = app.announcements;
  if (!b) return [];
  if (b.latestError) return [N.banner(W, { title: '暂时无法读取公告', body: '城市观测仍可继续。', actions: [{ label: '重试', action: { type: 'announcementLatest' }, variant: 'secondary' }, { label: '全部公告', action: { type: 'announcements' }, variant: 'text' }] })];
  if (!b.latest) return [];
  return [N.card(W, iw => [N.text(iw, '最新公告', { style: 'caption', color: C.text3 }), N.text(iw, b.latest.title, { style: 'body', color: C.moon, maxLines: 3 }),
    N.text(iw, '点击阅读全文 →', { style: 'meta', color: C.text2 })], { action: { type: 'announcement', id: b.latest.id }, gap: 8 })];
}
function announcements(app, W) {
  const b = app.announcements, nodes = [N.section(W, '管理员公告', { small: true, sub: '维护通知、版本更新与运营说明', link: { label: '刷新', action: { type: 'announcementRefresh' } } })];
  if (b.loading) nodes.push(N.text(W, '正在加载公告…', { style: 'meta', color: C.text3 }));
  if (b.error) nodes.push(N.banner(W, { title: '无法读取公告', body: b.error, actions: [{ label: '重试', action: { type: 'announcementRefresh' }, variant: 'secondary' }] }));
  if (b.loaded && !b.items.length && !b.loading && !b.error) nodes.push(N.empty(W, '暂无公告', '维护通知与版本更新将在这里发布。'));
  for (const item of b.items) nodes.push(N.card(W, iw => [N.text(iw, item.title, { style: 'heading', bold: true }), N.text(iw, meta(item), { style: 'caption', color: C.text3 }),
    N.button(iw, '阅读全文 →', { type: 'announcement', id: item.id }, { variant: 'text' })], { gap: 8 }));
  if (b.cursor && !b.loading) nodes.push(N.button(W, '加载更多', { type: 'announcementMore' }, { variant: 'secondary' }));
  return { top: { kind: 'back', title: '公告' }, nodes, tabbar: false, pull: true };
}
function announcement(app, W) {
  const b = app.announcements, item = b.detail, nodes = [];
  if (b.loading) nodes.push(N.text(W, '正在加载公告…', { style: 'body', color: C.text3 }));
  else if (b.error) nodes.push(N.banner(W, { title: '无法读取公告', body: b.error, actions: [{ label: '重试', action: { type: 'announcementRefresh' }, variant: 'secondary' }, { label: '全部公告', action: { type: 'announcements' }, variant: 'text' }] }));
  else if (item) nodes.push(N.card(W, iw => [N.text(iw, item.title, { style: 'title', bold: true }), N.text(iw, meta(item), { style: 'caption', color: C.text3 }), N.text(iw, item.body, { style: 'body', color: C.text })], { gap: 12 }));
  return { top: { kind: 'back', title: '公告' }, nodes, tabbar: false, pull: true };
}
module.exports = { announcements, announcement, preview };
