// WeChat credentials and OpenIDs stay on the server. Upstream errors are never logged.
import { createHash } from 'node:crypto';
import { fail } from '../accounts/store.js';
export const identityHash = (appid, openid) => createHash('sha256').update(`${appid}:${openid}`).digest('hex');
export class WechatService {
  constructor(cfg, { fetcher = fetch } = {}) {
    this.appid = cfg.wechatAppId; this.secret = cfg.wechatAppSecret;
    this.fetcher = fetcher; this.token = null; this.pendingToken = null;
    this.approved = new Map();
    if (cfg.wechatMiniprogramAppId) {
      if (!/^wx[a-f0-9]{16}$/.test(cfg.wechatMiniprogramAppId) || cfg.wechatMiniprogramAppId === this.appid) throw new Error('普通小程序 AppID 必须有效且独立于小游戏 AppID');
      this.miniprogram = new WechatService({ wechatAppId: cfg.wechatMiniprogramAppId, wechatAppSecret: cfg.wechatMiniprogramAppSecret }, { fetcher: (...args) => this.fetcher(...args) });
    }
  }
  get enabled() { return /^wx[a-f0-9]{16}$/.test(this.appid || '') && !!this.secret; }
  forApp(appid = this.appid) {
    if (appid === this.appid) return this;
    if (this.miniprogram && appid === this.miniprogram.appid) return this.miniprogram;
    fail(400, 'wechat_app_unknown', '此微信应用尚未配置。');
  }
  async json(url, options = {}) {
    try {
      const response = await this.fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw Error();
      return await response.json();
    } catch { fail(503, 'wechat_unavailable', '微信服务暂不可用，请稍后再试。'); }
  }
  async exchange(code, appid = this.appid) {
    const selected = this.forApp(appid);
    if (selected !== this) return selected.exchange(code);
    if (!this.enabled) fail(503, 'wechat_unconfigured', '微信登录尚未配置。');
    if (typeof code !== 'string' || !/^[\w-]{1,256}$/.test(code)) fail(400, 'invalid_code', '微信登录凭证无效。');
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.search = new URLSearchParams({ appid: this.appid, secret: this.secret, js_code: code, grant_type: 'authorization_code' });
    const data = await this.json(url);
    if (data.errcode || typeof data.openid !== 'string' || !/^[\w-]{10,128}$/.test(data.openid)) fail(401, 'wechat_login_failed', '微信登录失败，请重新登录。');
    // session_key and unionid are deliberately discarded.
    return { appid: this.appid, openid: data.openid, verifiedAt: Date.now() };
  }
  async loginCode(scene, environment = 'release') {
    if (!/^[a-f0-9]{32}$/.test(scene) || !['release', 'trial', 'develop'].includes(environment)) fail(400, 'invalid_qr', '扫码登录配置无效。');
    const token = await this.accessToken();
    try {
      const url = new URL('https://api.weixin.qq.com/wxa/getwxacodeunlimit');
      url.searchParams.set('access_token', token);
      const response = await this.fetcher(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene, page: 'pages/web-login/index', check_path: environment === 'release', env_version: environment, width: 430 }) });
      if (!response.ok) throw Error();
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 256 * 1024) throw Error();
      const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (!png && !jpeg) {
        try { if ([40001, 42001].includes(JSON.parse(bytes.toString()).errcode)) this.token = null; } catch {}
        throw Error();
      }
      return { bytes, type: png ? 'image/png' : 'image/jpeg' };
    } catch { fail(503, 'wechat_qr_unavailable', '暂时无法生成微信登录码，请稍后重试或使用密码登录。'); }
  }
  async accessToken() {
    if (!this.enabled) fail(503, 'wechat_unconfigured', '微信内容审核尚未配置。');
    if (this.token && this.token.until > Date.now()) return this.token.value;
    if (this.pendingToken) return this.pendingToken;
    this.pendingToken = (async () => {
      const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
      url.search = new URLSearchParams({ grant_type: 'client_credential', appid: this.appid, secret: this.secret });
      const data = await this.json(url);
      if (data.errcode || typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in) || data.expires_in < 120) fail(503, 'wechat_unavailable', '微信内容审核暂不可用。');
      this.token = { value: data.access_token, until: Date.now() + (data.expires_in - 60) * 1000 };
      return this.token.value;
    })();
    try { return await this.pendingToken; } finally { this.pendingToken = null; }
  }
  requireIdentity(identity) {
    if (identity && this.miniprogram && identity.appid === this.miniprogram.appid) return this.miniprogram.requireIdentity(identity);
    // The official v2 API requires an OpenID active in the last two hours.
    if (!identity || identity.appid !== this.appid || typeof identity.openid !== 'string' || !Number.isFinite(identity.verifiedAt) || Date.now() - identity.verifiedAt > 110 * 60000) fail(401, 'wechat_login_required', '请重新使用微信登录后继续。');
  }
  async check(content, identity, scene = 1) {
    if (identity && this.miniprogram && identity.appid === this.miniprogram.appid) return this.miniprogram.check(content, identity, scene);
    this.requireIdentity(identity);
    if (typeof content !== 'string') fail(400, 'invalid_text', '文本格式无效。');
    if (!content.trim()) return;
    const chars = Array.from(content);
    if (chars.length > 10000) fail(413, 'too_large', '文本过长，请缩短后再提交。');
    // Check every chunk: truncating the tail would allow unchecked text through.
    for (let i = 0; i < chars.length; i += 2000) {
      const text = chars.slice(i, i + 2000).join('');
      const key = createHash('sha256').update(`${scene}:${text}`).digest('hex');
      const until = this.approved.get(key);
      if (until > Date.now()) continue;
      const token = await this.accessToken();
      const url = new URL('https://api.weixin.qq.com/wxa/msg_sec_check');
      url.search = new URLSearchParams({ access_token: token });
      const data = await this.json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openid: identity.openid, scene, version: 2, content: text }) });
      if ([40001, 42001].includes(data.errcode)) this.token = null;
      if (data.errcode === 61010) fail(401, 'wechat_login_required', '微信访问记录已过期，请重新微信登录。');
      if (data.errcode) fail(503, 'moderation_unavailable', '内容审核暂不可用，内容尚未提交，请稍后重试。');
      if (data.result?.suggest !== 'pass') fail(422, 'moderated', '内容未通过安全检查，请修改后再提交。');
      if (this.approved.size >= 10000) this.approved.delete(this.approved.keys().next().value);
      this.approved.set(key, Date.now() + 24 * 60 * 60000);
    }
  }
}
