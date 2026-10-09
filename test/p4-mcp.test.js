import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './http-helpers.js';
import { createMcp } from '../mcp/server.js';
import { pushInbox } from '../src/e2/engine/core.js';
const call = (name, args = {}) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
const content = r => r.result.content.map(c => c.text).join('\n');
async function setup(cap = 1000000) {
  const env = await boot({ physics: 2, premise: 4, tokenBasic: 500000 });
  const resident = await env.register('甲', { dailyCap: cap });
  const requests = [];
  const mcp = createMcp({ env: { HOUREN_SERVER: env.base, HOUREN_TOKEN: resident.agentToken, HOUREN_LANG: 'zh' }, fetch: (url, options) => {
    requests.push({ path: new URL(url).pathname, method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
    return fetch(url, options);
  } });
  return { env, resident, requests, mcp, a: env.rt.w.agents[resident.agentId] };
}

test('P4 T20: MCP uses paid endpoints, omits turns, returns bills, and keeps rules free without soul', async () => {
  const s = await setup();
  try {
    const listed = await s.mcp.handle({ jsonrpc: '2.0', id: 0, method: 'tools/list' });
    assert.equal(listed.result.tools.length, 5);
    assert.ok(listed.result.tools.find(t => t.name === 'houren_perceive').description.startsWith('醒来：'));
    assert.ok(listed.result.tools.find(t => t.name === 'houren_look').inputSchema.properties.what.enum.includes('inbox'));
    const rules = content(await s.mcp.handle(call('houren_rules')));
    assert.ok(rules.includes('【词元】'));
    assert.ok(!rules.includes('SECRET-SOUL-甲'));
    assert.ok(rules.endsWith('这一笔 0'));
    assert.equal(s.a.tokens.used, 0);
    const woke = content(await s.mcp.handle(call('houren_perceive')));
    assert.ok(woke.startsWith('【此刻】'));
    assert.ok(woke.endsWith(`这一笔 ${s.a.tokens.used}`));
    const wakeId = s.a.tokens.waking.id;
    const before = s.a.tokens.used;
    const looked = content(await s.mcp.handle(call('houren_look', { what: 'laws' })));
    assert.ok(looked.endsWith(`这一笔 ${s.a.tokens.used - before}`));
    const reread = s.a.tokens.bill.reread;
    const result = await s.mcp.handle(call('houren_act', { actions: [] }));
    assert.ok(!result.result.isError, content(result));
    assert.ok(s.a.tokens.bill.reread > reread, 'MCP unnumbered second request starts another round');
    const bodies = s.requests.filter(r => ['/api/me/look','/api/me/act'].includes(r.path)).map(r => r.body);
    assert.ok(bodies.every(b => b.wakeId === wakeId && !Object.hasOwn(b, 'turn')));
    assert.equal(s.requests.filter(r => r.path === '/api/me/wake').length, 1);
    assert.equal(s.requests.at(-1).path, '/api/me/act', 'successful action does not re-perceive');
    assert.equal((await s.mcp.handle(call('houren_refund'))).error.code, -32602);
  } finally { await s.env.close(); }
});

test('P4 T20: wait returns metadata without sender/text, then perception delivers it for a price', async () => {
  const s = await setup();
  try {
    await s.mcp.handle(call('houren_perceive'));
    const delivered = s.a.delivered, before = s.a.tokens.used;
    pushInbox(s.env.rt.w, s.a, 'whisper', { from: { id: 'a2', name: '隐藏发送者' }, text: '尚未付费的私语' });
    const waited = content(await s.mcp.handle(call('houren_wait', { timeoutMs: 1000 })));
    assert.ok(waited.includes('"kind":"whisper"'));
    assert.ok(!waited.includes('隐藏发送者') && !waited.includes('尚未付费的私语'));
    assert.equal(s.a.delivered, delivered);
    assert.equal(s.a.tokens.used, before);
    assert.ok(content(await s.mcp.handle(call('houren_perceive'))).includes('尚未付费的私语'));
    assert.ok(s.a.delivered > delivered);
  } finally { await s.env.close(); }
});

test('P4 T20: first act discovers no_waking without free perception; cap refusal has no paid text', async () => {
  const s = await setup(1);
  try {
    const act = await s.mcp.handle(call('houren_act', { actions: [] }));
    assert.equal(act.result.isError, true);
    assert.ok(content(act).includes('no_waking'));
    assert.equal(s.requests[0].path, '/api/me/act');
    assert.equal(s.a.tokens.used, 0);
    const woke = await s.mcp.handle(call('houren_perceive'));
    assert.equal(woke.result.isError, true);
    assert.ok(content(woke).includes('cap_reached'));
    assert.ok(!content(woke).includes('【此刻】'));
    assert.ok(content(woke).endsWith('这一笔 0'));
  } finally { await s.env.close(); }
});
