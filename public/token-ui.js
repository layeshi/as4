import { h } from './dom.js';
import { t } from './i18n.js';
import { api, errorText } from './api.js';
export function dailyCapField(value = '') {
  const input = h('input', { name: 'dailyCap', type: 'number', min: 0, max: 50000000, step: 1, required: true, value, placeholder: '880000', 'aria-label': t('tokenDailyCap') });
  return { input, root: h('label', { class: 'field' }, h('span', null, t('tokenDailyCap')), input) };
}
export function readDailyCap(input) {
  const raw = String(input.value ?? '').trim(), n = Number(raw);
  return raw && Number.isSafeInteger(n) && n >= 0 && n <= 50000000 ? n : null;
}
export function tokenCapForm(tokens, key, reload) {
  const field = dailyCapField(tokens.cap), message = h('p', { role: 'status', class: 'muted' });
  const button = h('button', { type: 'submit', class: 'btn small' }, t('tokenCapSave'));
  const form = h('form', { class: 'form token-cap-form' }, field.root, button, message);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const dailyCap = readDailyCap(field.input);
    if (dailyCap === null) { message.textContent = t('tokenCapInvalid'); return; }
    if (dailyCap === 0 && tokens.cap !== 0 && !globalThis.confirm(t('tokenStopConfirm'))) return;
    button.disabled = true;
    const r = await api('/api/owner/cap', { method: 'POST', key, body: { dailyCap } });
    button.disabled = false;
    message.textContent = r.ok ? t('tokenCapSaved') : errorText(r, t('networkError'));
    if (r.ok) await reload();
  });
  return form;
}
