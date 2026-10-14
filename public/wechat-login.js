import { h, clear } from './dom.js';
import { api, errorText } from './api.js';
import { getLang } from './i18n.js';
const tr = (zh, en) => getLang() === 'en' ? en : zh;
export function mountWechatLogin(root, onLogin, { request = api, schedule = setTimeout, unschedule = clearTimeout, now = Date.now } = {}) {
  let alive = true, version = 0, timer = null, current = null;
  const message = h('p', { class: 'account-message', role: 'status', 'aria-live': 'polite' });
  const code = h('p', { class: 'wechat-check-code' });
  const image = h('img', { class: 'wechat-login-code', alt: tr('用微信扫一扫登录后人纪', 'Scan with WeChat to sign in'), width: 240, height: 240, hidden: true });
  const refresh = h('button', { class: 'btn', type: 'button', onClick: () => create() }, tr('刷新二维码', 'Refresh code'));
  clear(root).append(image, code, message, h('p', { class: 'muted login-note' }, tr('微信扫码后，请核对手机与网页上的核对码，并在手机上确认。二维码三分钟内有效。', 'Scan with WeChat, compare the code on both screens, then confirm on your phone. The code expires in three minutes.')), refresh);
  const post = (path, body) => request('/api/wechat/qr/' + path, { method: 'POST', body });
  const valid = v => alive && version === v;
  function error(r) { message.textContent = errorText(r, tr('连接失败，请刷新二维码重试。', 'Connection failed. Refresh the code to retry.')); }
  async function poll(v) {
    if (!valid(v) || !current) return;
    if (now() >= current.expiresAt) { image.hidden = true; message.textContent = tr('二维码已过期，请刷新。', 'Code expired. Please refresh.'); return; }
    const r = await post('status', { scene: current.scene });
    if (!valid(v)) return;
    if (!r.ok) { error(r); image.hidden = true; return; }
    if (r.json.state === 'approved') {
      message.textContent = tr('已确认，正在登录…', 'Confirmed. Signing in…');
      const done = await post('consume', { scene: current.scene });
      if (!valid(v)) return;
      if (done.ok) { current = null; onLogin(); }
      else error(done);
      return;
    }
    if (r.json.state === 'denied') { image.hidden = true; message.textContent = tr('手机已取消登录，可以刷新二维码重试。', 'Login cancelled on your phone. Refresh to try again.'); return; }
    message.textContent = r.json.state === 'scanned' ? tr('已扫码，请在手机上确认登录。', 'Scanned. Confirm on your phone.') : tr('等待微信扫码…', 'Waiting for WeChat scan…');
    timer = schedule(() => poll(v), 2000);
  }
  async function create() {
    const previousScene = current?.scene;
    const v = ++version; unschedule(timer); current = null;
    refresh.disabled = true; image.hidden = true; code.textContent = '';
    message.textContent = tr('正在生成微信登录码…', 'Creating a WeChat login code…');
    const r = await post('create', { ...(previousScene ? { previousScene } : {}) });
    if (!valid(v)) {
      if (r.ok) post('cancel', { scene: r.json.scene });
      return;
    }
    refresh.disabled = false;
    if (!r.ok) { error(r); return; }
    current = r.json;
    // Only our fixed, authenticated image route is accepted, never an upstream URL.
    if (!/^\/api\/wechat\/qr\/image\/[a-f0-9]{32}$/.test(current.imageUrl)) { error({}); return; }
    image.setAttribute('src', current.imageUrl); image.hidden = false;
    code.textContent = tr('核对码：', 'Verification code: ') + current.checkCode;
    message.textContent = tr('等待微信扫码…', 'Waiting for WeChat scan…');
    timer = schedule(() => poll(v), 2000);
  }
  const ready = create();
  return { ready, dispose() {
    alive = false; version++; unschedule(timer);
    if (current) post('cancel', { scene: current.scene });
    current = null;
  } };
}
