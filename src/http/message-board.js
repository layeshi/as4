import { accountWrap } from './accounts.js';
import { fail } from '../accounts/store.js';
import { sendJson, SlidingLimiter } from './util.js';

export const messageBoardLimits = () => new SlidingLimiter(30, 60000);
const wrap = (handler) => accountWrap(handler, { signedIn: true });
function write(ctx, actor, change) {
  if (!ctx.messageBoardLimits.take(actor.id)) fail(429, 'rate_limited', '留言操作过于频繁，请稍后再试。');
  return change();
}
const view = (ctx, actor, entry) => ctx.messageBoard.view(entry, ctx.accounts, actor);
export const messageBoardRoutes = [
  ['GET', '/api/messages', wrap(({ res, ctx, actor, url }) => {
    sendJson(res, 200, ctx.messageBoard.list(ctx.accounts, actor, { cursor: url.searchParams.get('cursor') }));
  })],
  ['POST', '/api/messages', wrap(({ res, ctx, actor, body }) => {
    const entry = write(ctx, actor, () => ctx.messageBoard.create(actor, body.text));
    sendJson(res, 201, { message: view(ctx, actor, entry) });
  })],
  ['GET', /^\/api\/messages\/(m[1-9]\d*)\/replies$/, wrap(({ res, ctx, actor, params, url }) => {
    sendJson(res, 200, ctx.messageBoard.list(ctx.accounts, actor, { threadId: params[0], cursor: url.searchParams.get('cursor') }));
  })],
  ['POST', /^\/api\/messages\/(m[1-9]\d*)\/replies$/, wrap(({ res, ctx, actor, params, body }) => {
    const entry = write(ctx, actor, () => ctx.messageBoard.create(actor, body.text, { threadId: params[0], replyToId: body.replyToId ?? null }));
    sendJson(res, 201, { message: view(ctx, actor, entry) });
  })],
  ['PATCH', /^\/api\/messages\/(m[1-9]\d*)$/, wrap(({ res, ctx, actor, params, body }) => {
    const entry = write(ctx, actor, () => ctx.messageBoard.edit(actor, params[0], body.text));
    sendJson(res, 200, { message: view(ctx, actor, entry) });
  })],
  ['DELETE', /^\/api\/messages\/(m[1-9]\d*)$/, wrap(({ res, ctx, actor, params }) => {
    const entry = write(ctx, actor, () => ctx.messageBoard.delete(actor, params[0]));
    sendJson(res, 200, { message: view(ctx, actor, entry) });
  })],
];
