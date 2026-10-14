import { randomBytes, createHash } from 'node:crypto';
import { fail } from '../accounts/store.js';
const digest = value => createHash('sha256').update(value).digest('hex');
export const QR_TTL = 180000;
// The scene may be photographed; the independent browser proof never appears in it.
export class WechatWebLogin {
  constructor(ctx, { now = Date.now } = {}) { this.ctx = ctx; this.now = now; this.requests = new Map(); }
  get enabled() { return this.ctx.cfg.wechatWebLogin !== false && !!this.ctx.wechat.miniprogram?.enabled; }
  prune() { for (const [scene, r] of this.requests) if (r.expiresAt <= this.now()) this.requests.delete(scene); }
  async create() {
    if (!this.enabled) fail(503, 'wechat_qr_unavailable', '微信扫码登录尚未开放，请使用账号密码登录。');
    this.prune();
    if (this.requests.size >= 200) fail(429, 'busy', '扫码登录请求较多，请稍后重试。');
    const scene = randomBytes(16).toString('hex'), proof = randomBytes(32).toString('hex');
    const row = { proof: digest(proof), state: 'pending', expiresAt: this.now() + QR_TTL, checkCode: randomBytes(3).toString('hex').toUpperCase() };
    this.requests.set(scene, row);
    try {
      row.image = await this.ctx.wechat.miniprogram.loginCode(scene, this.ctx.cfg.wechatQrEnvironment || 'release');
      if (this.requests.get(scene) !== row || row.expiresAt <= this.now()) fail(410, 'qr_expired', '二维码已失效，请刷新。');
      return { scene, proof, expiresAt: row.expiresAt, checkCode: row.checkCode };
    } catch (error) { this.requests.delete(scene); throw error; }
  }
  get(scene) {
    if (typeof scene !== 'string' || !/^[a-f0-9]{32}$/.test(scene)) fail(400, 'invalid_qr', '登录二维码无效。');
    const row = this.requests.get(scene);
    if (!row || row.expiresAt <= this.now()) { this.requests.delete(scene); fail(410, 'qr_expired', '二维码已失效，请在网页刷新。'); }
    return row;
  }
  browser(scene, proof) {
    const row = this.get(scene);
    if (typeof proof !== 'string' || proof.length > 128 || row.proof !== digest(proof)) fail(403, 'qr_browser_mismatch', '请在生成此二维码的浏览器中继续。');
    return row;
  }
  user(row) {
    const u = this.ctx.accounts.get(row.userId);
    if (!u || u.status !== 'active' || u.mergePending || u.mergedTo || u.revision !== row.revision || (u.authRevision || 0) !== row.authRevision) fail(409, 'qr_account_changed', '账号已变化，请重新扫码登录。');
    return u;
  }
  scan(scene, user) {
    const row = this.get(scene);
    if (!['pending', 'scanned'].includes(row.state) || row.userId && row.userId !== user.id) fail(409, 'qr_claimed', '此二维码已处理或已被其他账号扫描，请刷新网页。');
    if (row.userId) this.user(row);
    else { row.userId = user.id; row.revision = user.revision; row.authRevision = user.authRevision || 0; }
    row.state = 'scanned';
    return { username: user.username, checkCode: row.checkCode, expiresAt: row.expiresAt };
  }
  decide(scene, actor, approve) {
    const row = this.get(scene);
    if (row.state !== 'scanned' || row.userId !== actor.id) fail(409, 'qr_claimed', '此二维码尚未验证或已处理。');
    this.user(row); row.state = approve ? 'approved' : 'denied';
  }
  consume(scene, proof) {
    const row = this.browser(scene, proof);
    if (row.state !== 'approved') fail(409, 'qr_unconfirmed', '请先在微信中确认登录。');
    const user = this.user(row);
    this.requests.delete(scene);
    return user;
  }
}
