import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { mountAssistant } from '../public/assistant-ui.js';
import { setLang } from '../public/i18n.js';

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const now = new Date().toISOString();
const p7 = (over = {}) => ({
  signedIn: true, available: true, model: 'gpt-6-luna',
  world: { id: 'p7-20261016', branchId: 'b7', day: 11, epoch: 2, paused: true, ended: false, observedAt: now, cities: [{ id: 'north', name: '北城' }, { id: 'west', name: '西城' }, { id: 'east', name: '东城' }] },
  branches: [
    { id: 'b7', worldId: 'p7-20261016', epoch: 2, premise: 7, day: 11, active: true, residents: [{ id: 'a1', name: '乙居民', managed: true }, { id: 'a2', name: '甲居民', managed: false }] },
    { id: '75b643ab-0000', worldId: 'p6-20261001', epoch: 1, premise: 6, day: 30, active: false, residents: [] },
  ],
  residents: [{ id: 'a1', name: '乙居民', managed: true }, { id: 'a2', name: '甲居民', managed: false }],
  conversations: [{ id: 'c1', title: '三城公库最近为什么差这么多？', updatedAt: now }],
  quota: { used: 2, remaining: 18, limit: 20, resetAt: '2026-10-18T16:00:00.000Z' },
  ...over,
});
const observation = { worldId: 'p7-20261016', branchId: 'b7-full-branch-id', epoch: 2, day: 11, observedAt: now, paused: true, ended: false };
const conversation = {
  id: 'c1', title: '三城公库最近为什么差这么多？',
  messages: [
    { id: 'm1', role: 'user', text: '三城公库最近为什么差这么多？', status: 'complete', at: now, scope: { mode: 'public' }, sources: [] },
    { id: 'm2', role: 'assistant', status: 'complete', at: now, scope: { mode: 'public' }, observation, sources: [{ id: 's1', title: '北城公库', label: 'S1' }],
      text: '## 结论\n北城公库**最高** [S1]。\n\n| 城 | 公库 |\n|---|---|\n| 北城 | 1,234 |\n\n[看这里](javascript:alert(1)) <img src=x onerror=alert(1)> ![图](https://x.example/a.png)' },
    { id: 'm3', role: 'user', text: '东城呢？', status: 'complete', at: now, sources: [] },
    { id: 'm4', role: 'assistant', text: '', status: 'failed', at: now, error: '回答超过等待时限。', sources: [] },
    { id: 'm5', role: 'user', text: '', status: 'withheld', at: now, sources: [], error: '权限已变化或内容已过期。' },
    { id: 'm6', role: 'assistant', text: '', status: 'withheld', at: now, sources: [], error: '权限已变化或内容已过期。' },
    { id: 'm7', role: 'user', text: '西城？', status: 'complete', at: now, sources: [] },
    { id: 'm8', role: 'assistant', text: '西城的井况**正在', status: 'cancelled', at: now, observation, sources: [] },
  ],
};

/** 装好假 DOM 与假接口，挂上页面；routes 按「方法 路径」返回 { status, body } 或直接返回 body */
async function mount(t, { user = { id: 'test', username: 'test', displayName: 'Tester' }, status = p7(), routes = {}, search = '?lawId=law-1', lang = 'zh' } = {}) {
  const dom = installFakeDom(), saved = { fetch: globalThis.fetch, location: globalThis.location, window: globalThis.window };
  setLang(lang);
  globalThis.window = { addEventListener() {} };
  globalThis.location = { pathname: '/assistant.html', search, hash: '' };
  const calls = [];
  globalThis.fetch = async (path, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ path, method, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined });
    const route = routes[`${method} ${path}`];
    const reply = path === '/api/account' ? { body: { user, loginRequired: true } } : path === '/api/assistant/status' ? { body: typeof status === 'function' ? status() : status } : typeof route === 'function' ? route() : route ?? { body: {} };
    const code = reply.status ?? 200;
    return { ok: code < 400, status: code, json: async () => reply.body };
  };
  for (const id of ['console-header', 'message', 'content']) { const el = document.createElement('div'); dom.register(id, el); dom.root.append(el); }
  const controller = await mountAssistant();
  await settle();
  t.after(() => { controller.dispose(); globalThis.fetch = saved.fetch; globalThis.location = saved.location; globalThis.window = saved.window; setLang('zh'); dom.restore(); });
  const content = document.getElementById('content');
  return { dom, calls, content, $: sel => content.querySelector(sel), $$: sel => content.querySelectorAll(sel) };
}

test('guest sees only the sign-in prompt', async t => {
  const { content, $ } = await mount(t, { user: null, status: { signedIn: false, available: false } });
  assert.match(content.textContent, /登录后向实验提问/);
  assert.equal($('.assistant-workbench'), null);
  assert.equal($('textarea'), null);
  assert.doesNotMatch(content.textContent, /undefined|null|\[object Object\]/);
});

test('signed-in workbench keeps questions central: one-line scope, quota line, a single primary button', async t => {
  const { content, $, $$ } = await mount(t);
  const text = content.textContent;
  assert.match(text, /范围：全部公开记录/);
  assert.match(text, /法律 law-1/);
  assert.match(text, /今日剩余 18 \/ 20 次 · 北京时间零点恢复 · 失败、停止和重试也计次/);
  assert.match(text, /世界已暂停/);
  assert.match(text, /向实验提问/);
  assert.equal($('.assistant-session-title').textContent, '三城公库最近为什么差这么多？');
  assert.equal($$('.btn.primary').length, 1);
  assert.equal($('.assistant-scope-panel').hidden, true);
  assert.ok($('textarea'));
  // 旧版的说明文字都不在了
  assert.doesNotMatch(text, /本次问题范围|只读问答|最长等待|回答会附来源/);
  assert.doesNotMatch(text, /undefined|null|\[object Object\]/);
});

test('English copy follows the page language', async t => {
  const { content } = await mount(t, { lang: 'en', search: '' });
  assert.match(content.textContent, /Scope: all public records/);
  assert.match(content.textContent, /Remaining today 18 \/ 20 · Resets at midnight Beijing time · Failures, stops and retries count/);
});

test('answers render the Markdown subset with source chips, AI marking and state callouts; sources open in a modal', async t => {
  const { dom, content, $, $$, calls } = await mount(t, { routes: {
    'GET /api/assistant/conversations/c1': { body: { conversation } },
    'GET /api/assistant/conversations/c1/sources/s1': { body: { source: { id: 's1', title: '北城公库', label: 'S1', text: '{\n  "treasury": 1234\n}', worldId: 'p7-20261016', epoch: 2, branchId: 'b7-full-branch-id', day: 11, observedAt: now } } },
  } });
  $('.assistant-session').click();
  await settle();
  assert.equal($('.assistant-session').getAttribute('aria-current'), 'true');
  assert.equal($('.assistant-title').textContent, '三城公库最近为什么差这么多？');
  const thread = $('.assistant-thread');
  assert.equal(thread.querySelectorAll('.assistant-question').length, 4);
  assert.equal(thread.querySelectorAll('.assistant-answer').length, 4);
  assert.deepEqual(thread.querySelectorAll('.assistant-answer > .ai-note').map(n => n.textContent), ['AI 生成', 'AI 生成']);
  assert.equal(thread.querySelectorAll('.assistant-notice').length, 2);
  assert.equal(thread.querySelectorAll('.assistant-notice .ai-note').length, 0);
  assert.equal(thread.querySelector('.assistant-prose h3').textContent, '结论');
  assert.equal(thread.querySelector('.assistant-prose strong').textContent, '最高');
  assert.equal(thread.querySelector('.assistant-prose td.num').textContent, '1,234');
  assert.equal(thread.querySelectorAll('a').length + thread.querySelectorAll('img').length + thread.querySelectorAll('script').length, 0);
  assert.match(thread.textContent, /看这里 <img src=x onerror=alert\(1\)> 图/);
  assert.doesNotMatch(thread.textContent, /javascript:|x\.example/);
  assert.deepEqual(thread.querySelectorAll('.assistant-cite').map(n => n.textContent), ['S1', 'S1']);
  assert.match(thread.querySelector('.assistant-foot').textContent, /^依据S1 · 第 12 日 · 截至 \d\d:\d\d$/);
  assert.match(thread.querySelector('.assistant-foot').getAttribute('title'), /世界 p7-20261016 · 第 2 纪 · 分支 b7-full-branch-id/);
  assert.match(thread.querySelector('.callout.bad').textContent, /^生成失败 · 回答超过等待时限。重试（计 1 次）$/);
  assert.match(thread.querySelector('.callout.warn').textContent, /^内容未展示：权限已变化或审核未通过刷新重试（计 1 次）$/);
  assert.match(thread.textContent, /问题未展示/);
  assert.match(thread.textContent, /西城的井况\*\*正在已停止 · 回答不完整重试（计 1 次）/);
  assert.equal($('.assistant-tools').textContent, '刷新删除');
  assert.doesNotMatch(content.textContent, /undefined|null|\[object Object\]/);
  thread.querySelector('.assistant-prose .assistant-cite').click();
  await settle();
  assert.ok(calls.some(c => c.path === '/api/assistant/conversations/c1/sources/s1'));
  const modal = dom.root.querySelector('.modal.wide');
  assert.equal(modal.querySelector('.modal-head h2').textContent, '北城公库');
  assert.match(modal.querySelector('.assistant-source-meta').textContent, /^世界 p7-20261016 · 第 2 纪 · 分支 b7-full- · 第 12 日 · 截至 \d\d:\d\d$/);
  assert.ok(modal.querySelector('.assistant-source-text').classList.contains('structured'));
});

test('private records default to all residents: the question goes out without a resident and the scope summary lists only what differs', async t => {
  let asked = false;
  const { $, $$, calls } = await mount(t, { routes: {
    'POST /api/assistant/questions': () => { asked = true; return { status: 202, body: { conversationId: 'c2', questionId: 'q2' } }; },
    'GET /api/assistant/conversations/c2': { body: { conversation: { id: 'c2', title: '乙最近在做什么？', messages: [
      { id: 'u2', role: 'user', text: '乙最近在做什么？', status: 'complete', at: now, sources: [] },
      { id: 'q2', role: 'assistant', text: '', status: 'generating', at: now, sources: [] },
    ] } } },
  } });
  $('.assistant-scope-summary').click();
  const panel = $('.assistant-scope-panel');
  assert.equal(panel.hidden, false);
  assert.deepEqual(panel.querySelectorAll('.assistant-segment').map(n => n.textContent), ['公开记录', '我的居民私人记录']);
  panel.querySelector('[name="mode-resident"]').click();
  assert.equal($('.assistant-segment[aria-pressed="true"]').textContent, '我的居民私人记录');
  assert.deepEqual($('select[name="agent"]').querySelectorAll('option').map(n => n.textContent), ['全部居民', '乙居民']);
  assert.equal($('input[name="owner-key"]'), null);
  const city = $('select[name="city"]');
  assert.deepEqual(city.querySelectorAll('option').map(n => n.textContent), ['三城', '北城', '西城', '东城']);
  city.value = 'north'; city.fire('change');
  for (const [name, value] of [['fromDay', '10'], ['toDay', '12']]) { const day = $(`input[name="${name}"]`); day.value = value; day.fire('input'); }
  assert.equal($('.assistant-scope-text').textContent, '我的居民私人记录 · 北城 · 第 10–12 日');
  const branch = $('select[name="branch"]');
  assert.deepEqual(branch.querySelectorAll('option').map(n => n.textContent), ['当前世界 · 第 2 纪', 'p6-20261001 · 第 1 纪 · 75b643ab']);
  const input = $('textarea');
  input.value = '乙最近在做什么？'; input.fire('input');
  $('.assistant-composer').fire('submit');
  await settle();
  assert.ok(asked);
  const post = calls.find(c => c.method === 'POST' && c.path === '/api/assistant/questions');
  assert.deepEqual(post.body, { text: '乙最近在做什么？', scope: { mode: 'resident', lawId: 'law-1', city: 'north', fromDay: 9, toDay: 11 } });
  assert.equal($('.assistant-scope-panel').hidden, true);
  assert.equal(input.value, '');
  const stop = $('.assistant-send');
  assert.equal(stop.textContent, '停止');
  assert.ok(!stop.classList.contains('primary'));
  assert.equal($$('.btn.primary').length, 0);
  assert.match($('.assistant-answer').textContent, /^AI 生成正在生成…$/);
  assert.ok($('.assistant-answer .assistant-caret'));
});

test('the private option disappears in a P6+ branch you manage no one in; legacy worlds ask for the owner key instead of a resident', async t => {
  const none = p7();
  none.branches[0].residents = none.branches[0].residents.map(r => ({ ...r, managed: false }));
  const plain = await mount(t, { status: none });
  plain.$('.assistant-scope-summary').click();
  assert.deepEqual(plain.$$('.assistant-segment').map(n => n.textContent), ['公开记录']);

  const legacy = p7({ world: { id: 'w4', branchId: 'b4', day: 3, epoch: 1, paused: false, ended: true, cities: [] }, branches: [{ id: 'b4', worldId: 'w4', epoch: 1, premise: 4, day: 3, active: true, residents: [{ id: 'x1', name: '旧居民', managed: false }] }], residents: [] });
  const old = await mount(t, { status: legacy, user: { id: 'admin', role: 'admin', displayName: 'Admin' } });
  assert.match(old.$('.assistant-flags').textContent, /^已结束$/);
  old.$('.assistant-scope-summary').click();
  assert.deepEqual(old.$$('.assistant-segment').map(n => n.textContent), ['公开记录', '我的居民私人记录', '管理员私人研究']);
  assert.equal(old.$('select[name="city"]'), null);
  assert.equal(old.$('select[name="branch"]'), null);
  old.$('[name="mode-resident"]').click();
  assert.ok(old.$('input[type="password"][name="owner-key"]'));
  assert.equal(old.$('select[name="agent"]'), null);
  old.$('[name="mode-research"]').click();
  assert.ok(old.$('input[type="password"][name="admin-key"]'));
  assert.equal(old.$('input[name="owner-key"]'), null);
  old.$('[name="reset"]').click();
  assert.equal(old.$('.assistant-scope-text').textContent, '范围：全部公开记录');
  old.$('.assistant-composer').fire('keydown', { key: 'Escape' });
  assert.equal(old.$('.assistant-scope-panel').hidden, true);
});

test('quota and availability: exhausted or unavailable disables asking with a warning line', async t => {
  const spent = await mount(t, { status: p7({ quota: { used: 20, remaining: 0, limit: 20, resetAt: '2026-10-18T16:00:00.000Z' } }) });
  assert.equal(spent.$('.assistant-quota').textContent, '今日次数已用完 · 北京时间零点恢复');
  assert.ok(spent.$('.assistant-quota').classList.contains('warn'));
  assert.equal(spent.$('textarea').disabled, true);
  assert.equal(spent.$('.assistant-send').disabled, true);
  const down = await mount(t, { status: p7({ available: false }) });
  assert.equal(down.$('.assistant-quota').textContent, '助手暂不可用');
  assert.equal(down.$('textarea').disabled, true);
});

test('deleting asks for confirmation in a modal and then clears the conversation', async t => {
  let list = [{ id: 'c1', title: '三城公库最近为什么差这么多？', updatedAt: now }];
  const { dom, $, calls } = await mount(t, { status: () => p7({ conversations: list }), routes: {
    'GET /api/assistant/conversations/c1': { body: { conversation } },
    'DELETE /api/assistant/conversations/c1': () => { list = []; return { body: { ok: true } }; },
  } });
  $('.assistant-session').click();
  await settle();
  $('.assistant-tools').querySelectorAll('.assistant-tool')[1].click();
  const modal = dom.root.querySelector('.modal');
  assert.equal(modal.querySelector('.modal-head h2').textContent, '删除这段对话？');
  assert.equal(calls.filter(c => c.method === 'DELETE').length, 0);
  modal.querySelector('.btn.danger').click();
  await settle();
  assert.equal(calls.filter(c => c.method === 'DELETE').length, 1);
  assert.equal(dom.root.querySelector('.modal'), null);
  assert.equal($('.assistant-title').textContent, '新对话');
  assert.equal($('.assistant-session'), null);
  assert.match($('.assistant-thread').textContent, /^向实验提问$/);
});
