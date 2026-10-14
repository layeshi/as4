// 人类留言的“月下城”页面，复用现有 Canvas 组件与原生输入层。
const N = require('../ui/nodes');
const T = require('../ui/text');
const { C, size, font } = require('../ui/theme');
const { usable } = require('../utils/feed');
function realTime(value) {
  const date = new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000), pad = n => String(n).padStart(2, '0');
  if (!Number.isFinite(date.getTime())) return '—';
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC+8`;
}
const name = item => usable(item.author?.displayName) ? item.author.displayName : '用户';
function login(app, W, title = '留言板') {
  return { top: { kind: 'back', title }, tabbar: false, nodes: [N.empty(W, '微信登录后参与讨论', '留言仅对登录用户可见。使用同一账号，可接续网页上的讨论。'), N.button(W, '前往我的并登录', { type: 'messageLogin' }, { variant: 'primary' })] };
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
    const actions = [{ label: '回复', action: { type: 'messageCompose', kind: 'reply', id: item.id }, variant: 'secondary' }];
    if (item.canEdit && visible) actions.push({ label: '编辑', action: { type: 'messageCompose', kind: 'edit', id: item.id }, variant: 'secondary' });
    if (item.canDelete) actions.push({ label: '删除', action: { type: 'messageDelete', id: item.id }, variant: 'danger' });
    if (root) actions.push({ label: '讨论', action: { type: 'messageThread', id: item.id }, variant: 'secondary' });
    if (long) actions.push({ label: expanded ? '收起' : '全文', action: { type: 'messageExpand', id: item.id }, variant: 'text' });
    rows.push(N.buttonRow(iw, actions, 8));
    return rows;
  }, { gap: 12 });
}
function messages(app, W) {
  if (!app.user || !app.wechatVerified) return login(app, W);
  const b = app.messageBoard, nodes = [N.text(W, '人类之间的交流，跨纪元保留。', { style: 'meta', color: C.text2 }),
    N.section(W, '留言讨论', { small: true, sub: `${b.total} 条`, link: { label: '刷新', action: { type: 'messageRefresh' } } })];
  if (b.error) nodes.push(N.banner(W, { title: '无法读取留言', body: b.error, actions: [{ label: '重试', action: { type: 'messageRefresh' }, variant: 'secondary' }] }));
  if (b.loading) nodes.push(N.text(W, '正在加载留言…', { style: 'meta', color: C.text3 }));
  if (!b.loaded && !b.loading && !b.error) nodes.push(N.empty(W, '正在读取留言…'));
  if (b.loaded && !b.roots.length) nodes.push(N.empty(W, '尚无留言', '点击下方“发表留言”，开始交流。'));
  for (const item of b.roots) nodes.push(messageCard(app, W, item, true));
  if (b.cursor) nodes.push(N.button(W, b.loading ? '正在加载…' : '加载更多留言', { type: 'messageMore' }, { variant: 'secondary' }));
  return { top: { kind: 'back', title: '留言板' }, nodes, tabbar: false, pull: true, footer: N.button(W, '发表留言', { type: 'messageCompose', kind: 'new' }, { variant: 'primary' }) };
}
function messageThread(app, W) {
  if (!app.user || !app.wechatVerified) return login(app, W, '留言讨论');
  const b = app.messageBoard, root = b.get(b.threadId), state = b.replies.get(b.threadId), nodes = [];
  if (root) nodes.push(messageCard(app, W, root));
  nodes.push(N.section(W, '回复', { small: true, sub: root ? `${root.replyCount} 条` : '', link: { label: '刷新', action: { type: 'messageRefresh' } } }));
  if (state?.error) nodes.push(N.banner(W, { title: '无法读取回复', body: state.error, actions: [{ label: '重试', action: { type: 'messageRefresh' }, variant: 'secondary' }] }));
  if (!state || state.loading || !state.loaded && !state.messages.length && !state.error) nodes.push(N.text(W, '正在加载回复…', { style: 'meta', color: C.text3 }));
  if (state?.loaded && !state.messages.length) nodes.push(N.empty(W, '暂无回复', '可以回应主留言，也可以回复其中某条发言。'));
  for (const item of state?.messages || []) nodes.push(messageCard(app, W, item));
  if (state?.cursor) nodes.push(N.button(W, '加载更多回复', { type: 'messageRepliesMore' }, { variant: 'secondary' }));
  return { top: { kind: 'back', title: '留言讨论' }, nodes, tabbar: false, pull: true,
    footer: root ? N.button(W, '回复主留言', { type: 'messageCompose', kind: 'reply', id: root.id }, { variant: 'primary' }) : undefined };
}
function messageEditor(app, W) {
  if (!app.user || !app.wechatVerified) return login(app, W);
  const editor = app.messageBoard.editor;
  if (!editor) return { top: { kind: 'back', title: '留言板' }, nodes: [N.empty(W, '留言已变更，请返回后重试。')], tabbar: false };
  const title = editor.kind === 'delete' ? '删除留言' : editor.kind === 'edit' ? '编辑留言' : editor.kind === 'reply' ? '发表回复' : '发表留言';
  const nodes = [];
  if (editor.item) nodes.push(N.text(W, (editor.kind === 'reply' ? '回复对象：' : '作者：') + name(editor.item) + (editor.item.deletedAt ? '（留言已删除）' : ''), { style: 'meta', color: C.text2 }));
  if (editor.kind === 'delete') nodes.push(N.banner(W, { title: '确认删除这条留言？', body: '正文将隐藏，已有回复仍然保留。删除后无法再编辑。' }));
  else nodes.push(N.card(W, iw => [
    N.field(iw, editor.kind === 'edit' ? '修改你的留言' : '写下你的想法', app.form.messageText || '', { type: 'field', name: 'messageText', multiple: true, max: 4000 }, { multiline: true, lines: 8, counter: 2000, error: Array.from((app.form.messageText || '').trim()).length > 2000, placeholder: '支持换行，最多 2,000 字' }),
    N.text(iw, '提交前检查文字，成功后对登录用户可见。', { style: 'caption', color: C.text3 }),
  ], { gap: 12 }));
  if (app.error) nodes.push(N.text(W, app.error, { style: 'meta', color: C.danger }));
  return { top: { kind: 'back', title }, nodes, tabbar: false,
    footer: N.buttonRow(W, [{ label: '取消', action: { type: 'messageCancel' }, variant: 'secondary' },
      { label: app.busy ? '正在处理…' : editor.kind === 'delete' ? '确认删除' : editor.kind === 'edit' ? '保存修改' : '发布', action: { type: 'messageSubmit' }, variant: 'primary' }], 12) };
}
module.exports = { messages, messageThread, messageEditor, realTime };
