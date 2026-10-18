import test from 'node:test';
import assert from 'node:assert/strict';
import { minigame } from './wechat-minigame-helpers.js';

test('WeChat assistant screen never paints unreviewed assistant drafts', () => {
  const m = minigame(), screens = m.load(new URL('../wechat/minigame/screens/index.js', import.meta.url).pathname);
  m.game.user = { id: 'alice' }; m.game.assistant.sync();
  m.game.assistant.conversation = { id: 'c', messages: [{ id: 'q', role: 'assistant', status: 'pending', text: 'SECRET-DRAFT', sources: [{ id: 's', title: 'SECRET-SOURCE' }] }] };
  m.game.tab = 'assistant'; m.game.render();
  assert.ok(!JSON.stringify(m.game.blocks).includes('SECRET')); assert.match(JSON.stringify(m.game.blocks), /审核/);
});
test('assistant account switch and background clear keys, messages and drafts', () => {
  const m = minigame(), a = m.game.assistant;
  m.game.user = { id: 'alice' }; a.sync(); a.conversation = { messages: [{ text: 'private' }] }; m.game.form.assistantAdminKey = 'key'; m.game.form.assistantText = 'private';
  m.game.user = { id: 'bob' }; a.sync(); assert.equal(a.conversation, null); assert.equal(m.game.form.assistantAdminKey, undefined);
  a.conversation = { messages: [{ text: 'private' }] }; m.game.form.assistantText = 'private'; m.game.hide();
  assert.equal(a.conversation, null); assert.equal(m.game.form.assistantText, undefined);
});
test('assistant question sends verification in headers, scopes days, and rejects account-switch callback', async () => {
  const m = minigame(), a = m.game.assistant; let request;
  m.game.user = { id: 'alice' }; a.sync(); a.scope = { mode: 'research', branchId: 'b' };
  m.game.form.assistantText = 'question'; m.game.form.assistantAdminKey = 'private-key'; m.game.form.assistantFrom = '1';
  m.wx.request = options => { request = options; };
  const pending = a.handle({ type: 'assistantAsk' });
  assert.equal(request.header['X-Admin-Key'], 'private-key'); assert.equal(request.header['X-Houren-Client'], 'wechat'); assert.equal(request.data.scope.fromDay, 0); assert.ok(!JSON.stringify(request.data).includes('private-key'));
  m.game.user = { id: 'bob' }; a.sync(); request.success({ statusCode: 202, data: { conversationId: 'old', questionId: 'q' } }); await pending;
  assert.equal(a.conversation, null);
});

for (const status of ['generating', 'failed', 'cancelled', 'withheld']) test(`WeChat ${status} answers never paint partial text or source titles`, () => {
  const m = minigame(); m.game.user = { id: 'alice' }; m.game.assistant.sync();
  m.game.assistant.conversation = { id: 'c', messages: [{ id: 'q', role: 'assistant', status, text: 'SECRET-DRAFT', sources: [{ id: 's', title: 'SECRET-SOURCE' }] }] };
  m.game.tab = 'assistant'; m.game.render(); assert.ok(!JSON.stringify(m.game.blocks).includes('SECRET'));
});
test('WeChat complete answer exposes approved sources and cancel uses persisted question ID', async () => {
  const m = minigame(); m.game.user = { id: 'alice' }; const a = m.game.assistant; a.sync();
  a.conversation = { id: 'c', messages: [{ id: 'q', role: 'assistant', status: 'complete', text: 'Approved answer', sources: [{ id: 's', title: 'Approved source' }] }] };
  m.game.tab = 'assistant'; m.game.render(); assert.match(JSON.stringify(m.game.blocks), /Approved answer/); assert.match(JSON.stringify(m.game.blocks), /Approved source/);
  a.conversation.messages[0].status = 'generating'; a.refresh = async () => {};
  await a.handle({ type: 'assistantCancel' }); assert.ok(m.requests.includes('/api/assistant/questions/q/cancel'));
});

test('WeChat source moderation stays hidden and can recover after polling', async () => {
  let reviewed = false;
  const m = minigame({ respond: path => path === '/api/assistant/status' ? { signedIn: true, available: true } : path.includes('/sources/') ? reviewed ? { source: { id: 's', title: 'Approved source', text: 'Reviewed evidence' } } : { source: { id: 's', title: '回答依据', text: '内容审核中' }, moderation: { pending: 1 } } : { conversation: { id: 'c', messages: [] } } });
  m.game.user = { id: 'alice' }; m.game.tab = 'assistant'; const a = m.game.assistant; a.sync(); a.conversation = { id: 'c', messages: [] };
  await a.handle({ type: 'assistantSource', id: 's' }); m.game.render();
  assert.match(JSON.stringify(m.game.blocks), /审核中/); assert.ok([...m.timers.values()].some(t => t.delay === 1500));
  reviewed = true; await m.fire(1500); m.game.render(); assert.match(JSON.stringify(m.game.blocks), /Reviewed evidence/);
});
test('historical resident ID overrides current resident choice within selected branch', () => {
  const m = minigame(); m.game.user = { id: 'alice' }; const a = m.game.assistant; a.sync(); a.scope = { mode: 'resident', agentId: 'current', branchId: 'historic' }; m.game.form.assistantResidentId = 'old';
  assert.equal(a.questionScope().agentId, 'old'); assert.equal(a.questionScope().branchId, 'historic');
});
