import { h, clear } from './dom.js';
import { t, getLang, colon } from './i18n.js';
import { api, errorText } from './api.js';

const label = (key, input) => { input.setAttribute('aria-label', t(key)); return h('label', { class: 'field' }, h('span', null, t(key)), input); };
const input = (name, value = '', props = {}) => h('input', { name, value, autocomplete: 'off', ...props });
const select = (name, options, value) => h('select', { name }, options.map(([id, text]) => h('option', { value: id, selected: id === value }, text)));
const presets = {
  openai: ['openai', 'https://api.openai.com/v1', ''],
  responses: ['openai-responses', 'https://api.openai.com/v1', ''],
  glm: ['openai', 'https://open.bigmodel.cn/api/paas/v4', ''],
  glmCoding: ['openai', 'https://open.bigmodel.cn/api/coding/paas/v4', ''],
  anthropic: ['anthropic', 'https://api.anthropic.com', ''],
  custom: ['openai', '', ''],
  mock: ['mock', '', 'mock'],
};

/** Configuration controls only; secrets remain in the form and never enter browser storage. */
export function modelForm(config = {}) {
  const preset = select('preset', [['openai', t('presetOpenai')], ['responses', t('presetResponses')], ['glm', t('presetGlm')], ['glmCoding', t('presetGlmCoding')], ['anthropic', t('presetAnthropic')], ['custom', t('presetCustom')], ['mock', t('presetMock')]], config.provider === 'mock' ? 'mock' : config.provider === 'anthropic' ? 'anthropic' : config.baseURL && config.baseURL !== presets.openai[1] ? 'custom' : config.provider === 'openai-responses' ? 'responses' : 'openai');
  const provider = select('provider', [['openai', t('presetOpenai')], ['openai-responses', t('presetResponses')], ['anthropic', t('presetAnthropic')]], config.provider || 'openai');
  const baseURL = input('baseURL', config.baseURL || presets.openai[1], { type: 'url', maxlength: 500, placeholder: 'https://…/v1' });
  const model = input('model', config.model || '', { maxlength: 100, placeholder: t('modelPlaceholder') });
  const apiKey = input('modelApiKey', '', { type: 'password', autocomplete: 'new-password', maxlength: 4096, placeholder: config.hasApiKey ? t('keyKeep') : t('keyPlaceholder') });
  const clearApiKey = input('clearApiKey', '', { type: 'checkbox' });
  const realFields = h('div', { class: 'model-fields' }, label('interfaceType', provider), label('modelUrl', baseURL), label('f_model', model), label('modelKey', apiKey),
    config.hasApiKey ? h('label', { class: 'check' }, clearApiKey, ' ', t('clearModelKey')) : null);
  const thinking = select('thinking', [['default', t('thinkingDefault')], ['enabled', t('thinkingEnabled')], ['disabled', t('thinkingDisabled')]], config.thinking || 'default');
  const effort = select('effort', [['low', t('effortLow')], ['medium', t('effortMedium')], ['high', t('effortHigh')]], config.effort || 'medium');
  const reasoningEffort = select('reasoningEffort', [['default', t('thinkingDefault')], ['none', t('effortNone')], ['minimal', t('effortMinimal')], ['low', t('effortLow')], ['medium', t('effortMedium')], ['high', t('effortHigh')], ['xhigh', t('effortXhigh')], ['max', t('effortMax')]], config.reasoningEffort || 'default');
  const every = input('actEveryTicks', config.actEveryTicks ?? 1, { type: 'number', min: 1, max: 100, required: true });
  const history = input('historyRounds', config.historyRounds ?? 6, { type: 'number', min: 0, max: 20, required: true });
  const maxTokens = input('maxTokens', config.maxTokens ?? '', { type: 'number', min: 64, max: 32000, placeholder: t('providerDefault') });
  const timeout = input('timeoutSeconds', (config.timeoutMs ?? 120000) / 1000, { type: 'number', min: 1, max: 120, step: 1, required: true });
  const thinkingField = label('thinkingMode', thinking), effortField = label('thinkingEffort', effort), reasoningField = label('thinkingEffort', reasoningEffort);
  const advanced = h('details', { class: 'runner-advanced' }, h('summary', null, t('advancedSettings')),
    h('div', { class: 'model-fields' }, label('actEvery', every), label('memoryRounds', history), label('maxOutput', maxTokens), label('modelTimeout', timeout), thinkingField, effortField, reasoningField),
    h('p', { class: 'muted' }, t('thinkingHelp')), h('p', { class: 'muted' }, t('reasoningHelp')));
  const mockNote = h('p', { class: 'entry-note', hidden: true }, t('mockHelp'));
  const root = h('div', { class: 'model-form' }, label('modelService', preset), realFields, mockNote, advanced, h('p', { class: 'muted' }, t('modelKeyHelp')));
  const update = () => {
    const mock = preset.value === 'mock';
    realFields.hidden = mock; mockNote.hidden = !mock;
    provider.disabled = mock || preset.value !== 'custom';
    baseURL.disabled = mock; model.disabled = mock; apiKey.disabled = mock; clearApiKey.disabled = mock;
    baseURL.required = !mock; model.required = !mock;
    thinkingField.hidden = mock || provider.value !== 'openai'; effortField.hidden = mock || provider.value !== 'anthropic';
    reasoningField.hidden = mock || !['openai', 'openai-responses'].includes(provider.value);
    thinking.disabled = thinkingField.hidden; effort.disabled = effortField.hidden; reasoningEffort.disabled = reasoningField.hidden;
  };
  preset.addEventListener('change', () => {
    const [type, url, name] = presets[preset.value];
    provider.value = type === 'mock' ? 'openai' : type; baseURL.value = url; model.value = name; apiKey.value = ''; clearApiKey.checked = false;
    update();
  });
  provider.addEventListener('change', update);
  update();
  return { root, valid: () => validate(root), read: () => ({
    provider: preset.value === 'mock' ? 'mock' : provider.value,
    model: preset.value === 'mock' ? 'mock' : model.value.trim(),
    baseURL: preset.value === 'mock' ? '' : baseURL.value.trim(),
    apiKey: preset.value === 'mock' ? '' : apiKey.value.trim(), clearApiKey: clearApiKey.checked,
    actEveryTicks: Number(every.value), historyRounds: Number(history.value), timeoutMs: Number(timeout.value) * 1000,
    ...(maxTokens.value ? { maxTokens: Number(maxTokens.value) } : {}),
    thinking: provider.value === 'openai' ? thinking.value : 'default', effort: effort.value,
    ...(preset.value !== 'mock' && ['openai', 'openai-responses'].includes(provider.value) ? { reasoningEffort: reasoningEffort.value } : {}),
  }) };
}

function validate(root) {
  for (const control of root.querySelectorAll('input, textarea, select')) {
    if (!control.disabled && !control.checkValidity()) {
      const details = control.closest('details'); if (details) details.open = true;
      control.reportValidity(); return false;
    }
  }
  return true;
}

export function entryWizard(ctx, pane, { mode = 'register', subject, success }) {
  clear(pane);
  const name = input('name', '', { required: true, maxlength: 24 });
  const bio = h('textarea', { name: 'bio', rows: 2, maxlength: 200 });
  const soul = h('textarea', { name: 'soul', rows: 6, maxlength: 4000, required: true, placeholder: t('soulPlaceholder') });
  const lang = select('lang', [['zh', '中文'], ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'], ['ru', 'Русский'], ['ja', '日本語'], ['ko', '한국어'], ['ar', 'العربية'], ['hi', 'हिन्दी']], getLang());
  const creator = input('creatorName', '', { maxlength: 60 });
  const invite = input('invite', '', { maxlength: 100 });
  const template = select('soulTemplate', [['observer', t('soulObserver')], ['builder', t('soulBuilder')], ['explorer', t('soulExplorer')]], 'observer');
  template.setAttribute('aria-label', t('soulTemplateLabel'));
  const applyTemplate = h('button', { type: 'button', class: 'btn small' }, t('applySoulTemplate'));
  applyTemplate.addEventListener('click', () => { soul.value = t(`soulTemplate_${template.value}`); });
  const identity = h('section', { class: 'wizard-step' }, h('h3', null, t(mode === 'register' ? 'createResident' : mode === 'adopt' ? 'adoptTab' : 'fosterTab')),
    mode === 'register' ? [label('f_name', name), label('f_bio', bio), h('div', { class: 'soul-template' }, template, applyTemplate), label('f_soul', soul), h('p', { class: 'muted' }, t('soulHint')), label('f_lang', lang)] : [h('p', { class: 'entry-note' }, subject.name), mode === 'adopt' ? h('details', null, h('summary', null, t('soulFull')), h('p', { class: 'soul' }, subject.soul)) : null],
    label('f_creator', creator), label('f_invite', invite));
  const settings = modelForm();
  const testBtn = h('button', { type: 'button', class: 'btn' }, t('testModel'));
  const modelMsg = h('p', { class: 'muted', role: 'status' });
  const connection = h('section', { class: 'wizard-step', hidden: true }, h('h3', null, t('connectModel')), settings.root, testBtn, modelMsg);
  const summary = h('dl', { class: 'entry-summary' });
  const confirmation = h('section', { class: 'wizard-step', hidden: true }, h('h3', null, t('entryStart')), summary, h('p', { class: 'entry-note' }, t('entryHostedHelp')));
  const steps = [identity, connection, confirmation];
  const progress = h('ol', { class: 'entry-progress', 'aria-label': t('entrySteps') }, [t('createResident'), t('connectModel'), t('entryStart')].map((text, i) => h('li', null, h('span', { class: 'step-number' }, i + 1), text)));
  const prev = h('button', { class: 'btn ghost', type: 'button', hidden: true }, t('previousStep'));
  const next = h('button', { class: 'btn primary', type: 'button' }, t('nextStep'));
  const submit = h('button', { class: 'btn primary', type: 'submit', hidden: true }, t('entryStart'));
  const msg = h('p', { class: 'error', role: 'alert' });
  const form = h('form', { class: 'form entry-wizard', novalidate: true }, progress, steps, h('div', { class: 'form-actions' }, prev, next, submit), msg);
  pane.append(form);
  let step = 0, tested = null, busy = false;
  const fingerprint = () => JSON.stringify({ ...settings.read(), invite: invite.value.trim() });
  const update = () => {
    steps.forEach((s, i) => { s.hidden = step !== i; });
    [...progress.children].forEach((s, i) => { if (i === step) s.setAttribute('aria-current', 'step'); else s.removeAttribute('aria-current'); });
    prev.hidden = step === 0; prev.disabled = busy;
    next.hidden = step === 2; next.disabled = busy || (step === 1 && tested !== fingerprint());
    submit.hidden = step !== 2; submit.disabled = busy || tested !== fingerprint(); testBtn.disabled = busy;
  };
  const invalidate = () => { tested = null; modelMsg.textContent = ''; update(); };
  settings.root.addEventListener('input', invalidate); settings.root.addEventListener('change', invalidate); invite.addEventListener('input', invalidate);
  prev.addEventListener('click', () => { step = Math.max(0, step - 1); msg.textContent = ''; update(); });
  next.addEventListener('click', () => {
    if (!validate(steps[step])) return;
    if (step === 1 && tested !== fingerprint()) return;
    step++;
    if (step === 2) {
      clear(summary); const cfg = settings.read();
      for (const [k, v] of [['f_name', mode === 'register' ? name.value : subject.name], ['modelService', cfg.provider === 'mock' ? t('presetMock') : cfg.provider === 'anthropic' ? t('presetAnthropic') : cfg.provider === 'openai-responses' ? t('presetResponses') : t('presetOpenai')], ['f_model', cfg.model], ['actEvery', cfg.actEveryTicks], ['memoryRounds', cfg.historyRounds]]) summary.append(h('dt', null, t(k)), h('dd', null, String(v)));
    }
    update(); steps[step].querySelector('input, select, button')?.focus();
  });
  testBtn.addEventListener('click', async () => {
    if (!settings.valid()) return;
    const snap = fingerprint(); busy = true; modelMsg.textContent = t('testingModel'); update();
    const result = await api('/api/port/model', { method: 'POST', body: { ...settings.read(), invite: invite.value.trim() } });
    busy = false;
    if (snap !== fingerprint()) { tested = null; modelMsg.textContent = t('modelChanged'); }
    else { tested = result.ok ? snap : null; modelMsg.textContent = result.ok ? t('modelTestOk') : errorText(result, t('networkError')); }
    update();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || step !== 2 || tested !== fingerprint()) return;
    busy = true; msg.textContent = t('entryStarting'); update();
    const cfg = settings.read();
    const body = { model: cfg.model, creatorName: creator.value.trim(), invite: invite.value.trim(), runner: cfg,
      ...(mode === 'register' ? { name: name.value.trim(), bio: bio.value.trim(), soul: soul.value, lang: lang.value } : mode === 'adopt' ? { soulId: subject.id } : { agentId: subject.id || subject.agentId }) };
    // Freeze the complete draft while registration and connection validation are in flight.
    const controls = [...form.querySelectorAll('input, textarea, select')];
    const disabled = controls.map((c) => c.disabled); controls.forEach((c) => { c.disabled = true; });
    const entryPaths = { register: '/api/port/register', adopt: '/api/port/adopt', foster: '/api/port/foster' };
    const result = await api(entryPaths[mode], { method: 'POST', body });
    if (result.ok) { success(pane, result.json); ctx.refresh(); }
    else { busy = false; controls.forEach((c, i) => { c.disabled = disabled[i]; }); msg.textContent = errorText(result, t('networkError')); tested = null; step = 1; modelMsg.textContent = t('testAgain'); update(); }
  });
  update();
}

function statusContent(view) {
  const result = h('div', { class: 'runner-status' }, h('span', { class: `chip runner-${view.status}` }, t(`runnerStatus_${view.status}`)),
    view.lastActionAt ? h('span', { class: 'muted' }, `${t('lastRunnerAction')}${colon()}${new Date(view.lastActionAt).toLocaleString(getLang() === 'en' ? 'en' : 'zh-CN')}`) : null,
    view.lastError ? h('p', { class: 'error', role: 'alert' }, view.lastError) : null);
  if (view.logs?.length) result.append(h('details', null, h('summary', null, t('runnerRecent')),
    h('ul', { class: 'plain' }, view.logs.slice().reverse().map((entry) => h('li', null, new Date(entry.at).toLocaleTimeString(), ' · ', entry.actions.length ? entry.actions.map((a) => `${a.ok ? '✓' : '✗'} ${a.type}${a.error ? ` (${a.error})` : ''}`).join(' · ') : t('noRunnerAction'))))));
  return result;
}

export function runnerPanel(initial, key) {
  const root = h('section', { class: 'runner-panel' }, h('h4', null, t('runnerManagement')));
  const state = h('div'), msg = h('p', { class: 'error', role: 'alert' });
  const start = h('button', { class: 'btn small primary', type: 'button' }, t('startRunner'));
  const pause = h('button', { class: 'btn small', type: 'button' }, t('pauseRunner'));
  const refresh = h('button', { class: 'btn small ghost', type: 'button' }, t('refresh'));
  const settings = modelForm(initial.config || {});
  const token = input('agentToken', '', { type: 'password', autocomplete: 'new-password', maxlength: 128 });
  const tokenField = label('agentToken', token); tokenField.hidden = !!initial.config;
  const testBtn = h('button', { class: 'btn small', type: 'button' }, t('testModel'));
  const saveBtn = h('button', { class: 'btn small primary', type: 'submit' }, t('saveRunner'));
  const edit = h('details', { class: 'runner-editor' }, h('summary', null, t('editRunner')));
  const form = h('form', { class: 'form', novalidate: true }, settings.root, tokenField, h('div', { class: 'form-actions' }, testBtn, saveBtn));
  edit.append(form);
  let view = initial, busy = false;
  const show = (v) => {
    view = v; clear(state); state.append(statusContent(v));
    start.disabled = busy || !v.config || ['starting', 'thinking', 'waiting'].includes(v.status);
    // Error may represent a running retry loop, so start remains idempotent on the server.
    pause.disabled = busy || !v.config || ['paused', 'stopped'].includes(v.status);
    testBtn.disabled = busy; saveBtn.disabled = busy; refresh.disabled = busy;
    tokenField.hidden = !!v.config;
  };
  const request = async (op, body = {}) => {
    if (busy) return;
    busy = true; msg.textContent = t('loading'); show(view);
    const controls = [...form.querySelectorAll('input, select')];
    const disabled = controls.map((c) => c.disabled);
    controls.forEach((c) => { c.disabled = true; });
    const result = await api('/api/owner/runner', { key, method: op ? 'POST' : 'GET', ...(op ? { body: { op, ...body } } : {}) });
    busy = false;
    controls.forEach((c, i) => { c.disabled = disabled[i]; });
    if (result.ok) {
      if (op === 'test') { msg.textContent = t('modelTestOk'); show(view); }
      else {
        show(result.json); msg.textContent = op === 'save' ? t('runnerSaved') : '';
        if (op === 'save') { token.value = ''; clear(edit); const nextSettings = runnerPanel(result.json, key); root.replaceWith(nextSettings); nextSettings.querySelector('[role=alert]').textContent = t('runnerSaved'); }
      }
    } else { msg.textContent = errorText(result, t('networkError')); show(view); }
  };
  start.addEventListener('click', () => request('start')); pause.addEventListener('click', () => request('pause')); refresh.addEventListener('click', () => request());
  testBtn.addEventListener('click', () => { if (settings.valid()) request('test', { config: settings.read() }); });
  form.addEventListener('submit', (event) => { event.preventDefault(); if (settings.valid()) request('save', { config: settings.read(), agentToken: token.value.trim() }); });
  root.append(state, h('div', { class: 'form-actions' }, start, pause, refresh), edit, msg);
  show(initial);
  // Stop polling after the panel is removed. Never replace an in-progress configuration form.
  const timer = setInterval(async () => {
    if (!root.isConnected) { clearInterval(timer); return; }
    if (busy || document.hidden) return;
    const result = await api('/api/owner/runner', { key });
    if (root.isConnected && !busy && result.ok) show(result.json);
  }, 3000);
  return root;
}
