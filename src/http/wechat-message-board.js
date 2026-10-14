// 微信与网页共用讨论，只有微信读取投影与提交前内容检查不同。
import { accountWrap } from './accounts.js';
import { wechatIdentity } from './wechat.js';
import { fail } from '../accounts/store.js';
import { messageText } from '../message-board.js';
import { writeMessage, messageView } from './message-board.js';
import { sendJson } from './util.js';

const DAY = 24 * 60 * 60000;
const wrap = (handler) => accountWrap(handler, { signedIn: true });
function proof(ctx, req) {
  const identity = wechatIdentity(ctx, req);
  ctx.wechat.requireIdentity(identity);
  return identity;
}
function project(ctx, req, data) {
  const identity = proof(ctx, req), projection = ctx.wechatProjection;
  const moderation = { pending: 0, rejected: 0, unavailable: 0, loginRequired: 0, withheld: 0 };
  const label = (value) => projection.filter(value, identity, 'displayName', moderation);
  const message = (item) => ({ ...item,
    author: { displayName: label(item.author.displayName) },
    text: item.text === null ? null : projection.filter(item.text, identity, 'text', moderation),
    replyTo: item.replyTo ? { ...item.replyTo, displayName: label(item.replyTo.displayName) } : null,
  });
  return { ...data,
    ...(data.messages ? { messages: data.messages.map(message) } : {}),
    ...(data.message ? { message: message(data.message) } : {}),
    ...(data.root ? { root: message(data.root) } : {}), moderation,
  };
}
async function checkedWrite(context, change, { id = null, editing = false, deleting = false } = {}) {
  const { ctx, req, actor, body, authorize } = context;
  return writeMessage(ctx, actor, async () => {
    const identity = proof(ctx, req);
    if (id) {
      const entry = ctx.messageBoard.get(id), permissions = messageView(ctx, actor, entry);
      if (editing && entry.deletedAt) fail(409, 'message_deleted', '已删除的留言不能编辑。');
      if (editing && !permissions.canEdit) fail(403, 'forbidden', '只能编辑自己的留言。');
      if (deleting && !entry.deletedAt && !permissions.canDelete) fail(403, 'forbidden', '只能删除自己的留言。');
    }
    const text = deleting ? null : messageText(body.text), displayName = actor.displayName;
    if (!deleting) {
      await ctx.wechat.check(displayName, identity, 1);
      await ctx.wechat.check(text, identity, 2);
    }
    authorize();
    proof(ctx, req);
    const entry = change(text);
    if (!deleting) {
      // 保存已经检查过的精确文字，自己的新发言无需等待读取投影再次检查。
      ctx.wechatProjection.save(ctx.wechatProjection.key(text), true, DAY);
      ctx.wechatProjection.save(ctx.wechatProjection.key(displayName, true), true, DAY);
    }
    return entry;
  });
}
export const wechatMessageBoardRoutes = [
  ['GET', '/api/wechat/messages', wrap(({ res, req, ctx, actor, url }) => {
    sendJson(res, 200, project(ctx, req, ctx.messageBoard.list(ctx.accounts, actor, { cursor: url.searchParams.get('cursor') })));
  })],
  ['POST', '/api/wechat/messages', wrap(async (context) => {
    const { res, req, ctx, actor } = context;
    const entry = await checkedWrite(context, (text) => ctx.messageBoard.create(actor, text));
    sendJson(res, 201, project(ctx, req, { message: messageView(ctx, actor, entry) }));
  })],
  ['GET', /^\/api\/wechat\/messages\/(m[1-9]\d*)\/replies$/, wrap(({ res, req, ctx, actor, params, url }) => {
    const root = ctx.messageBoard.thread(params[0]);
    sendJson(res, 200, project(ctx, req, { ...ctx.messageBoard.list(ctx.accounts, actor, { threadId: root.id, cursor: url.searchParams.get('cursor') }), root: messageView(ctx, actor, root) }));
  })],
  ['POST', /^\/api\/wechat\/messages\/(m[1-9]\d*)\/replies$/, wrap(async (context) => {
    const { res, req, ctx, actor, params, body } = context;
    ctx.messageBoard.thread(params[0]);
    const target = ctx.messageBoard.get(body.replyToId ?? params[0]);
    if (target.id !== params[0] && target.threadId !== params[0]) fail(400, 'invalid_reply_target', '回复对象不属于这条讨论。');
    const entry = await checkedWrite(context, (text) => ctx.messageBoard.create(actor, text, { threadId: params[0], replyToId: target.id }));
    sendJson(res, 201, project(ctx, req, { message: messageView(ctx, actor, entry) }));
  })],
  ['PATCH', /^\/api\/wechat\/messages\/(m[1-9]\d*)$/, wrap(async (context) => {
    const { res, req, ctx, actor, params } = context;
    const entry = await checkedWrite(context, (text) => ctx.messageBoard.edit(actor, params[0], text), { id: params[0], editing: true });
    sendJson(res, 200, project(ctx, req, { message: messageView(ctx, actor, entry) }));
  })],
  ['DELETE', /^\/api\/wechat\/messages\/(m[1-9]\d*)$/, wrap(async (context) => {
    const { res, req, ctx, actor, params } = context;
    const entry = await checkedWrite(context, () => ctx.messageBoard.delete(actor, params[0]), { id: params[0], deleting: true });
    sendJson(res, 200, project(ctx, req, { message: messageView(ctx, actor, entry) }));
  })],
];
