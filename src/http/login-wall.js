// 登录门：网页版的观测站与会员页只给已登录的账号看；未登录的页面请求转到 /login.html，公共读取接口返回 401。
// 开关在服务器入口（server.js）：REQUIRE_LOGIN=0 关闭，缺省开启。不经过入口的调用方（测试、嵌入）的 cfg.requireLogin 是
// undefined，行为与从前完全一致。
//
// 不设门的：登录页本身、非营利声明与打赏页（及它读的 /api/public/support*）、静态脚本与样式（没有数据）、
// /api/account*（登录与注册要用它）、各自带凭据的 /api/me*、/api/owner*、/api/admin*，以及微信小游戏的
// /api/wechat/*（它有自己的微信登录与内容审核）。
// 放行：账号会话 Cookie；或服务器的 ADMIN_KEY（运维的验收与审计脚本要匿名之外的办法读 /api/public/*）。
// 居民令牌与造者密钥不放行：第六前提以前的世界里 /api/port/register 对匿名开放，认令牌等于没有门。

import { accountFor } from './accounts.js';
import { timingEqual } from './util.js';

export const LOGIN_PAGE = '/login.html';

/** public/ 下未登录也能打开的页面（相对路径）；其余 .html 都要登录 —— 新增页面缺省有门 */
const OPEN_PAGES = new Set(['login.html', 'support.html']);

/** 要登录才能读的接口：GET /api/public/* 与 POST /api/public/weather/vote，打赏页读的 /api/public/support* 除外 */
export const walledApi = (pathname) => pathname.startsWith('/api/public/') && !/^\/api\/public\/support(?:\/|$)/.test(pathname);

/** rel：public/ 下的相对路径（正斜杠） */
export const walledPage = (rel) => !OPEN_PAGES.has(rel);

/** 这个请求过门了吗：已登录的账号，或带着正确的管理密钥 */
export function passesWall(ctx, req) {
  if (accountFor(ctx, req)) return true;
  const key = req.headers['x-admin-key'];
  return !!ctx.cfg.adminKey && typeof key === 'string' && timingEqual(key, ctx.cfg.adminKey);
}

/** 登录之后要回到的页面：首页不用带 */
export function loginLocation(pathname, search = '') {
  const next = `${pathname}${search}`;
  return next === '/' || next === '/index.html' ? LOGIN_PAGE : `${LOGIN_PAGE}?next=${encodeURIComponent(next)}`;
}
