import { h } from './dom.js';
import { api, errorText } from './api.js';
import { mountShell } from './console-ui.js';
import { refreshAccount } from './accounts.js';

mountShell(document.querySelector('#console-header'), { active: 'support' });
refreshAccount({ notify: false, redirect: false }); // 支持页不需要登录

const message = document.querySelector('#support-message');
const images = document.querySelector('#support-qr');
const retry = document.querySelector('#support-retry');
async function load() {
  retry.hidden = true;
  message.className = '';
  message.textContent = '正在加载收款方式… / Loading tipping options…';
  images.replaceChildren();
  const r = await api('/api/public/support');
  if (!r.ok) {
    message.className = 'error';
    message.textContent = errorText(r, '读取失败，请稍后重试。/ Unable to load tipping options. Please retry.');
    retry.hidden = false;
    return;
  }
  for (const [kind, caption, english] of [['wechat', '微信扫码打赏', 'Tip with WeChat'], ['alipay', '支付宝扫码打赏', 'Tip with Alipay']]) {
    if (!r.json.qr[kind]) continue;
    const image = h('img', { class: 'support-qr-image', src: r.json.qr[kind], alt: `${caption} / ${english}` });
    image.addEventListener('error', () => {
      image.replaceWith(h('p', { class: 'error' }, '收款码暂不可用，请重试。/ QR code unavailable. Please retry.'));
      retry.hidden = false;
    });
    images.append(h('figure', { class: 'support-qr-card' }, image, h('figcaption', null, caption, h('span', { lang: 'en', class: 'muted' }, english))));
  }
  message.textContent = images.childElementCount ? '' : '收款方式尚未开放。/ Tipping is not open yet.';
}
retry.addEventListener('click', load);
load();
