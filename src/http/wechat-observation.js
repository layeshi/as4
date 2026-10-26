import { parseCookies } from './util.js';

// This is a permanent product boundary, not an audit-time feature flag.
// A phone session remains a phone session even if a caller omits its header.
// A browser QR login has only wechatIdentity, not wechat/client metadata.
export function isWechatObservation(ctx, req) {
  const session = ctx.accounts.sessionMetadata(parseCookies(req.headers.cookie).houren_session);
  return req.headers['x-houren-client'] === 'wechat' || session?.client === 'wechat' || !!session?.wechat;
}

const accountPosts = new Set([
  '/api/account/login', '/api/account/register', '/api/account/logout',
  '/api/account/recovery', '/api/account/contacts',
  '/api/account/verification/request', '/api/account/verification/confirm',
  '/api/wechat/login', '/api/wechat/password-login', '/api/wechat/password',
  '/api/wechat/merge/preview', '/api/wechat/merge/confirm',
  '/api/wechat/qr/scan', '/api/wechat/qr/confirm',
  '/api/wechat/notifications/preferences', '/api/wechat/notifications/authorization',
  '/api/wechat/notifications/authorization/result', '/api/wechat/notifications/records/read',
]);

export function wechatObservationAllows(method, pathname) {
  // No assistant conversations (including web-created answers), model catalogs,
  // administrator controls, or agent/owner tokens in the observation client.
  if (/^\/api\/(?:assistant|admin|me|owner|runner)(?:\/|$)/.test(pathname) ||
      pathname === '/api/port/model' ||
      /^\/api\/(?:wechat\/)?model-presets$/.test(pathname) ||
      /^\/api\/(?:wechat\/)?account\/(?:hosted|transfers|worlds)(?:\/|$)/.test(pathname)) return false;
  if (method === 'GET' || method === 'HEAD') return true;
  if (method === 'POST') {
    if (accountPosts.has(pathname)) return true;
    // These jobs package existing historical records; they do not invoke AI.
    return /^\/api\/history\/exports(?:\/[a-f0-9-]+\/retry)?$/.test(pathname);
  }
  if (method === 'PATCH') return pathname === '/api/account';
  if (method === 'DELETE') return /^\/api\/account\/(?:contacts\/(?:email|phone)|wechat\/[^/]+)$/.test(pathname);
  return false;
}

export const wechatObservationError = {
  error: { code: 'wechat_observation_only', message: '小程序仅提供观测与已有记录查询，此操作不可用。' },
};
