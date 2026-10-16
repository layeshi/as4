import { h } from './dom.js';
import { getLang } from './i18n.js';
import { api, errorText } from './api.js';
import { mountLoginChallenge } from './turnstile.js';

const tr = (zh, en) => getLang() === 'en' ? en : zh;

export function passwordControl(input) {
  const ns = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(ns, 'svg');
  for (const [key, value] of Object.entries({ width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) icon.setAttribute(key, String(value));
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0');
  const pupil = document.createElementNS(ns, 'circle');
  pupil.setAttribute('cx', '12'); pupil.setAttribute('cy', '12'); pupil.setAttribute('r', '3');
  icon.append(path, pupil);
  const toggle = h('button', { type: 'button', class: 'password-toggle', 'aria-label': tr('显示密码', 'Show password'), title: tr('显示密码', 'Show password'), 'aria-pressed': 'false', onClick: () => {
    const visible = input.getAttribute('type') === 'password';
    input.setAttribute('type', visible ? 'text' : 'password');
    toggle.setAttribute('aria-pressed', String(visible));
    toggle.setAttribute('aria-label', visible ? tr('隐藏密码', 'Hide password') : tr('显示密码', 'Show password'));
    toggle.setAttribute('title', visible ? tr('隐藏密码', 'Hide password') : tr('显示密码', 'Show password'));
  } }, icon);
  return h('span', { class: 'password-control' }, input, toggle);
}

export function contactVerification({ purpose, siteKey = null, channels = { email: true, phone: true } } = {}) {
  let proof = '', challengeId = '', sentTo = '', challenge = null;
  const status = h('p', { class: 'account-message', role: 'status', 'aria-live': 'polite' });
  const kinds = Object.entries(channels).filter(([, enabled]) => enabled).map(([channel]) => channel);
  if (!kinds.length) {
    status.textContent = tr('验证服务暂未配置。', 'Verification is not configured.');
    return { node: h('div', { class: 'contact-verification' }, status), get proof() { return ''; }, reset() {}, dispose() {} };
  }
  const select = h('select', { 'aria-label': tr('验证渠道', 'Verification channel') },
    kinds.map(kind => h('option', { value: kind }, kind === 'email' ? tr('邮箱', 'Email') : tr('手机号', 'Phone'))));
  select.value = kinds[0] || '';
  const destination = h('input', { type: 'email', autocomplete: 'email', placeholder: tr('邮箱地址', 'Email address'), 'aria-label': tr('邮箱地址', 'Email address') });
  const code = h('input', { type: 'text', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code', placeholder: tr('6 位验证码', '6-digit code'), 'aria-label': tr('验证码', 'Verification code') });
  const challengeNode = siteKey ? h('div', { class: 'login-turnstile', role: 'status', 'aria-live': 'polite' }) : null;
  if (challengeNode) challenge = mountLoginChallenge(challengeNode, siteKey, 'verify');
  const reset = () => { proof = ''; challengeId = ''; sentTo = ''; status.textContent = ''; code.value = ''; };
  select.addEventListener('change', () => {
    reset();
    const phone = select.value === 'phone';
    destination.type = phone ? 'tel' : 'email';
    destination.placeholder = phone ? tr('+86 手机号', '+86 phone number') : tr('邮箱地址', 'Email address');
    destination.setAttribute('aria-label', destination.placeholder);
    destination.value = '';
  });
  destination.addEventListener('input', reset);
  const send = h('button', { type: 'button', class: 'btn', onClick: async () => {
    if (send.disabled) return;
    if (siteKey && !challenge?.token()) { status.textContent = tr('请完成人机验证。', 'Complete verification first.'); return; }
    send.disabled = true; status.className = 'account-message'; status.textContent = tr('正在发送…', 'Sending…');
    const value = destination.value.trim();
    const r = await api('/api/account/verification/request', { method: 'POST', body: { purpose, channel: select.value, value, ...(siteKey ? { turnstileToken: challenge.token() } : {}) } });
    challenge?.reset();
    send.disabled = false;
    if (r.ok) { proof = ''; challengeId = r.json.challengeId; sentTo = value; status.textContent = r.json.message || tr('验证码已发送。', 'Code sent.'); }
    else { status.className = 'account-message error'; status.textContent = errorText(r, tr('发送失败，请稍后重试。', 'Could not send the code.')); }
  } }, tr('发送验证码', 'Send code'));
  const verify = h('button', { type: 'button', class: 'btn', onClick: async () => {
    if (!challengeId || sentTo !== destination.value.trim()) { status.textContent = tr('请先发送验证码。', 'Send a code first.'); return; }
    verify.disabled = true;
    const r = await api('/api/account/verification/confirm', { method: 'POST', body: { challengeId, code: code.value.trim() } });
    verify.disabled = false;
    if (r.ok) { proof = r.json.proof; status.className = 'account-message'; status.textContent = tr('联系方式已验证。', 'Contact verified.'); }
    else { status.className = 'account-message error'; status.textContent = errorText(r, tr('验证码无效。', 'Invalid code.')); }
  } }, tr('验证', 'Verify'));
  const node = h('div', { class: 'contact-verification' },
    h('div', { class: 'contact-entry' }, select, destination, send),
    h('div', { class: 'contact-code' }, code, verify), challengeNode, status);
  return { node, get proof() { return proof; }, get channel() { return select.value; }, get value() { return destination.value.trim(); }, reset, dispose: () => challenge?.dispose() };
}
