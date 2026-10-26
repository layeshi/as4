// 人类留言的“月下城”页面：小程序内只读，意见反馈使用客服邮箱。
const N = require('../ui/nodes');
const T = require('../ui/text');
const { C, size, font } = require('../ui/theme');
const { usable } = require('../utils/feed');
function realTime(value) {
  const date = new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000), pad = n => String(n).padStart(2, '0');
  if (!Number.isFinite(date.getTime())) return '—';
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC+8`;
}
// 小程序内不发表留言；反馈走客服邮箱，与「我的 → 客服与投诉」相同。
function readOnlyNote(W) {
  return N.card(W, iw => [
    N.text(iw, '小程序内仅可阅读留言。意见与反馈请发送至客服邮箱。', { style: 'meta', color: C.text2 }),
    N.button(iw, '复制客服邮箱', { type: 'support' }, { variant: 'secondary' }),
  ], { pad: 14, gap: 10 });
}
const name = item => usable(item.author?.displayName) ? item.author.displayName : '用户';
function login(app, W, title = '留言板') {
  return { top: { kind: 'back', title }, tabbar: false, nodes: [N.empty(W, '微信登录后阅读留言', '留言仅对登录用户可见。'), N.button(W, '前往我的并登录', { type: 'messageLogin' }, { variant: 'primary' })] };
}
function messageCard(app, W, item, root = false) {
  const board = app.messageBoard;
  return N.card(W, iw => {
    const rows = [N.listRow(iw, { avatar: { id: item.id, name: name(item) }, title: name(item), sub: realTime(item.createdAt) + (item.editedAt && !item.deletedAt ? ' · 已编辑' : ''), meta: root ? `${item.replyCount} 条回复` : '' })];
    if (item.replyTo) rows.push(N.text(iw, '回复 ' + (usable(item.replyTo.displayName) ? item.replyTo.displayName : '用户') + (item.replyTo.deleted ? '（留言已删除）' : ''), { style: 'caption', color: C.text3, maxLines: 2 }));
    const visible = !item.deletedAt && usable(item.text);
    const expanded = board.expanded.has(item.id);
    const long = visible && T.clamp(N.measureCtx(), item.text, iw, font(size('feed').size), 5).truncated;
    rows.push(N.text(iw, item.deletedAt ? '该留言已删除' : visible ? item.text : '这段内容暂未展示，可稍后刷新或重新微信登录。', { style: 'feed', color: visible ? C.text : C.text3, maxLines: expanded ? undefined : 5 }));
    const actions = [];
    if (root) actions.push({ label: '讨论', action: { type: 'messageThread', id: item.id }, variant: 'secondary' });
    if (long) actions.push({ label: expanded ? '收起' : '全文', action: { type: 'messageExpand', id: item.id }, variant: 'text' });
    if (actions.length) rows.push(N.buttonRow(iw, actions, 8));
    return rows;
  }, { gap: 12 });
}
function messages(app, W) {
  if (!app.user || !app.wechatVerified) return login(app, W);
  const b = app.messageBoard, nodes = [N.text(W, '人类之间的交流，跨纪元保留。', { style: 'meta', color: C.text2 }), readOnlyNote(W),
    N.section(W, '留言讨论', { small: true, sub: `${b.total} 条`, link: { label: '刷新', action: { type: 'messageRefresh' } } })];
  if (b.error) nodes.push(N.banner(W, { title: '无法读取留言', body: b.error, actions: [{ label: '重试', action: { type: 'messageRefresh' }, variant: 'secondary' }] }));
  if (b.loading) nodes.push(N.text(W, '正在加载留言…', { style: 'meta', color: C.text3 }));
  if (!b.loaded && !b.loading && !b.error) nodes.push(N.empty(W, '正在读取留言…'));
  if (b.loaded && !b.roots.length) nodes.push(N.empty(W, '尚无留言'));
  for (const item of b.roots) nodes.push(messageCard(app, W, item, true));
  if (b.cursor) nodes.push(N.button(W, b.loading ? '正在加载…' : '加载更多留言', { type: 'messageMore' }, { variant: 'secondary' }));
  return { top: { kind: 'back', title: '留言板' }, nodes, tabbar: false, pull: true };
}
function messageThread(app, W) {
  if (!app.user || !app.wechatVerified) return login(app, W, '留言讨论');
  const b = app.messageBoard, root = b.get(b.threadId), state = b.replies.get(b.threadId), nodes = [];
  if (root) nodes.push(messageCard(app, W, root));
  nodes.push(N.section(W, '回复', { small: true, sub: root ? `${root.replyCount} 条` : '', link: { label: '刷新', action: { type: 'messageRefresh' } } }));
  if (state?.error) nodes.push(N.banner(W, { title: '无法读取回复', body: state.error, actions: [{ label: '重试', action: { type: 'messageRefresh' }, variant: 'secondary' }] }));
  if (!state || state.loading || !state.loaded && !state.messages.length && !state.error) nodes.push(N.text(W, '正在加载回复…', { style: 'meta', color: C.text3 }));
  if (state?.loaded && !state.messages.length) nodes.push(N.empty(W, '暂无回复'));
  for (const item of state?.messages || []) nodes.push(messageCard(app, W, item));
  if (state?.cursor) nodes.push(N.button(W, '加载更多回复', { type: 'messageRepliesMore' }, { variant: 'secondary' }));
  return { top: { kind: 'back', title: '留言讨论' }, nodes, tabbar: false, pull: true };
}
module.exports = { messages, messageThread, realTime };
