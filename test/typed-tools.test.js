import test from 'node:test';
import assert from 'node:assert/strict';
import { toolDefs } from '../runner/loop.js';
import { actionTable } from '../src/e2/lore/actions.js';
import { parseShellsConfig } from '../src/shells/config.js';
import { openCity, drive } from './p2-loop-helpers.js';
import { validateAction, typedCall, correctionExample } from '../runner/action-tools.js';
import { createProvider } from '../runner/providers.js';
import { LIMITS } from '../src/e2/params.js';

const cfg = { toolMode: 'native', actionTools: 'typed' };
const call = (name, args = {}) => ({ name, args });

test('typed think preserves private thought capability without action quota or log output', async () => {
  const city = openCity(['one']);
  try {
    const id = city.ids[0], before = city.agent(id).actsThisTick;
    const out = await drive(city, id, { cfg, script: [{ calls: [call('think', { thought: 'PRIVATE_TYPED_THOUGHT' }), call('done')] }] });
    assert.equal(city.agent(id).actsThisTick, before);
    assert.ok(city.rt.events.pending.some(e => e.type === 'thought' && e.data.text === 'PRIVATE_TYPED_THOUGHT'));
    assert.equal(city.rt.events.ring.some(e => e.type === 'thought' && e.data.text === 'PRIVATE_TYPED_THOUGHT'), false);
    assert.equal(out.logs.join('\n').includes('PRIVATE_TYPED_THOUGHT'), false);
  } finally { city.close(); }
});

test('local format rejection reports a safe driver error while leaving the world unchanged', async () => {
  const city = openCity(['one']), states = [];
  try {
    const n = city.rt.w.commandN;
    await drive(city, city.ids[0], { cfg, script: [{ calls: [call('read_law', { target: 'PRIVATE_FIELD' }), call('done')] }], deps: { onState: e => states.push(e) } });
    assert.equal(city.rt.w.commandN, n);
    assert.ok(states.some(s => s.lastError?.includes('参数')));
    assert.equal(JSON.stringify(states).includes('PRIVATE_FIELD'), false);
  } finally { city.close(); }
});

test('text preflight follows engine NFC/trim length without changing the submitted string', () => {
  assert.ok(validateAction({ type: 'say', text: '   ' }).length);
  const text = 'e\u0301'.repeat(LIMITS.speech);
  assert.equal(validateAction({ type: 'say', text }).length, 0);
  assert.equal(typedCall('say', { text }).action.text, text);
});

test('typed tools cover every P2 action, explicit read aliases and independent done', () => {
  const tools = toolDefs('en', { actionTools: 'typed', premise: 2 });
  const names = tools.map(t => t.name);
  for (const type of actionTable(2).ORDER) assert.ok(names.includes(type), type);
  for (const name of ['read_law', 'read_document', 'read_inscription', 'read_agent', 'done', 'look']) assert.ok(names.includes(name), name);
  assert.ok(!names.includes('act'), 'legacy act remains callable without being advertised');
  assert.deepEqual(tools.find(t => t.name === 'say').schema.required, ['text']);
  assert.equal(tools.find(t => t.name === 'draft').schema.$defs.rules.items.properties.when.type, 'string');
  assert.equal(tools.find(t => t.name === 'propose').schema.$defs.procedure.properties.ordinary.anyOf.length, 2);
  assert.deepEqual(toolDefs('en', { actionTools: 'typed', premise: 1 }), toolDefs('en'));
});

test('typed runner mechanically submits sequential calls and leaves look/done free', async () => {
  const city = openCity({ seed: 'typed-sequential' });
  try {
    const [a, b] = city.ids;
    const submissions = [];
    const real = city.client(a);
    const out = await drive(city, a, { cfg, deps: { client: { ...real, act: async req => { submissions.push(req); return real.act(req); } } }, script: [
      { calls: [call('move', { to: 'market' }), call('say', { text: '  原文\n保持  ' }), call('whisper', { to: b, text: '精确文字', anonymous: false }), call('look', { what: 'here' }), call('done')] },
    ] });
    assert.deepEqual(submissions.map(r => r.actions), [[{ type: 'move', to: 'market' }], [{ type: 'say', text: '  原文\n保持  ' }], [{ type: 'whisper', to: b, text: '精确文字', anonymous: false }]]);
    assert.equal(out.requests.length, 1);
    assert.equal(out.wakings[0].rec.ended, 'end');
    assert.equal(city.agent(a).actsThisTick, 3);
    assert.equal(city.agent(a).place, 'market');
    assert.ok(out.requests[0].system.includes('done'));
    assert.ok(!out.requests[0].system.includes('用 act 行动'), 'typed native prompt directs action tools');
  } finally { city.close(); }
});

test('typed malformed calls return path and example before submitting any action', async () => {
  const city = openCity({ seed: 'typed-invalid' });
  try {
    const [a] = city.ids;
    let submissions = 0;
    const real = city.client(a);
    const out = await drive(city, a, { cfg, deps: { client: { ...real, act: async req => { submissions++; return real.act(req); } } }, script: [
      { calls: [call('say', { txt: 'typo' }), call('move', { to: 'made-up-place' }), call('draft', { rules: [{ when: 'daily', do: [{ op: 'mint', coin: 2 }] }] }), call('act', { actions: [{ type: 'invented' }] })] },
      { calls: [call('done')] },
    ] });
    assert.equal(submissions, 0);
    const results = out.requests[1].transcript.at(-1).results;
    assert.ok(results.every(r => r.isError));
    assert.match(results[0].text, /text|txt/);
    assert.match(results[1].text, /to/);
    assert.match(results[2].text, /rules\[0\]\.do\[0\]/);
    assert.match(results[3].text, /type/);
    assert.match(results[0].text, /example|示例/i);
  } finally { city.close(); }
});

test('unresolved final-turn correction survives waking even with history disabled, without extra rounds', async () => {
  const city = openCity({ seed: 'typed-feedback', loop: { turns: 1 } });
  try {
    const [a] = city.ids;
    const real = city.client(a);
    const client = { ...real, act: async () => ({ ok: true, json: { results: [{ type: 'propose', ok: false, error: { code: 'rule_invalid', errors: [{ path: 'rules[0].do[0].energy', message: 'unknown field', hint: 'use coins' }] } }] } }) };
    const out = await drive(city, a, { cfg: { ...cfg, historyRounds: 0 }, deps: { client }, rounds: 2, after: () => city.rt.tickNow(), script: [
      { calls: [call('propose', { title: 'T', text: 'x', rules: [] })] }, { calls: [call('done')] },
    ] });
    assert.equal(out.requests.length, 2);
    assert.match(out.requests[1].transcript[0].text, /rules\[0\]\.do\[0\]\.energy/);
    assert.match(out.requests[1].transcript[0].text, /use coins/);
    assert.match(out.requests[1].transcript[0].text, /example|示例/i);
    assert.ok(out.requests[1].transcript[0].text.length < 10000);
  } finally { city.close(); }
});

test('shell configuration accepts opt-in actionTools and rejects typos', () => {
  const line = { model: 'm', provider: 'mock', actionTools: 'typed' };
  assert.equal(parseShellsConfig({ lines: [line] }).lines[0].actionTools, 'typed');
  assert.throws(() => parseShellsConfig({ lines: [{ ...line, actionTools: 'guess' }] }), /actionTools/);
});

test('read aliases reject a different read target instead of silently changing the requested action', () => {
  const result = typedCall('read_law', { agent: 'a2' });
  assert.ok(result.issues.length);
  assert.match(JSON.stringify(result.issues), /law|agent/);
  assert.equal(typedCall('read_law', { law: 'l2' }).issues.length, 0);
});

test('complex action schemas support structured rules/procedure/standing and faithful optional alternatives', () => {
  const rule = { when: 'daily', if: 'true', do: [{ op: 'each', in: 'agents', do: [{ op: 'transfer', from: 'treasury', to: 'it', energy: '1' }] }] };
  const procedure = { ordinary: { proposers: 'true', voters: 'agents', decide: 'yes > no', secret: false, period: 12 } };
  for (const action of [
    { type: 'draft', rules: [rule] }, { type: 'propose', title: 'T', text: 'x', procedure },
    { type: 'rules', group: 'g1', procedure: 'members' }, { type: 'refound', text: 'x', procedure: 'humans' },
    { type: 'remember', gift: 'm1' }, { type: 'read', law: 'l999' },
    { type: 'standing', orders: [{ when: 'inbox:whisper', do: [{ type: 'whisper', to: '=it.from.id', text: 'exact' }] }] },
    { type: 'will', heirs: [{ to: 'a2', share: 1 }], successor: { name: '小孩', soul: 's', memories: [0] } },
  ]) assert.deepEqual(validateAction(action), [], JSON.stringify(action));
  assert.ok(validateAction({ type: 'read', law: 'l1', agent: 'a2' }).length);
  assert.ok(validateAction({ type: 'draft', rules: [], procedure }).length);
  assert.ok(validateAction({ type: 'propose', title: 'T', text: 'x', rules: [], procedure }).length);
  const example = correctionExample('read');
  assert.deepEqual(validateAction({ type: 'read', ...example.args }), [], 'correction example is structurally valid');
});

test('read tools and done share existing action budget; malformed parameters spend no actions', async () => {
  const city = openCity({ seed: 'typed-budget' });
  try {
    const [a] = city.ids;
    let submissions = 0;
    const real = city.client(a);
    const out = await drive(city, a, { cfg, deps: { client: { ...real, act: async req => { submissions++; return real.act(req); } } }, script: [{ calls: [
      call('read_law', { law: 'l2' }), call('say', { text: '1' }), call('say', { text: '2' }), call('say', { text: '3' }),
      call('say', { text: 'over budget' }), call('look', { what: 'here' }), call('done'),
    ] }] });
    assert.equal(submissions, 4);
    assert.equal(city.agent(a).actsThisTick, 4);
    assert.equal(out.requests.length, 1);
    assert.equal(out.wakings[0].rec.looks.length, 1);
    assert.equal(out.wakings[0].rec.ended, 'end');
  } finally { city.close(); }
});

test('incomplete query/private ID lists do not forbid explicit lawful reads and missing perception does not invent IDs', () => {
  assert.deepEqual(validateAction({ type: 'whisper', to: 'a99', text: 'x' }), []);
  assert.deepEqual(validateAction({ type: 'read', law: 'l99' }, { city: { laws: [{ id: 'l1' }] } }), []);
  assert.deepEqual(validateAction({ type: 'read', agent: 'dead99' }, { city: { residents: [{ id: 'a1' }] } }), []);
  assert.ok(validateAction({ type: 'whisper', to: 'a99', text: 'x' }, { city: { residents: [{ id: 'a1' }] } }).length);
});

test('every correction example has a valid action shape, including conditional initiate and rules choices', () => {
  for (const type of actionTable(2).ORDER) {
    const example = correctionExample(type);
    assert.deepEqual(validateAction({ type, ...example.args }), [], type);
  }
});

test('successful retry clears the unresolved correction from the following waking', async () => {
  const city = openCity({ seed: 'typed-resolved' });
  try {
    const [a] = city.ids;
    const out = await drive(city, a, { cfg, rounds: 2, after: () => city.rt.tickNow(), script: [
      { calls: [call('say', { txt: 'x' })] }, { calls: [call('say', { text: 'fixed' }), call('done')] }, { calls: [call('done')] },
    ] });
    assert.match(out.requests[1].transcript.at(-1).results[0].text, /args.text/);
    assert.ok(!out.requests[2].transcript[0].text.includes('【尚未解决的行动纠正】'));
  } finally { city.close(); }
});

test('typed opt-in remains compatible with text JSON act and ignores typed config in P1', async () => {
  const city = openCity({ seed: 'typed-text' });
  try {
    const [a] = city.ids;
    const out = await drive(city, a, { cfg: { actionTools: 'typed' }, script: [{ text: JSON.stringify({ act: { actions: [{ type: 'say', text: 'exact' }] }, done: true }) }] });
    assert.equal(out.result.acted, 1);
    assert.equal(out.requests.length, 1);
    assert.ok(out.requests[0].messages);
  } finally { city.close(); }
  const old = openCity({ seed: 'typed-p1', premise: 1 });
  try {
    const [a] = old.ids;
    const out = await drive(old, a, { cfg, script: [{ text: '{"actions":[{"type":"say","text":"x"}]}' }] });
    assert.equal(out.result.acted, 1);
    assert.equal(out.wakings.length, 0);
    assert.ok(!out.requests[0].system.includes('read_law'));
  } finally { old.close(); }
});

test('rule parameter schemas preserve canonical language tags and reject missing transfer amounts', () => {
  for (const canonical of ['zh', null]) assert.deepEqual(validateAction({ type: 'draft', rules: [{ when: 'enact', do: [{ op: 'amend', canonical }] }] }), []);
  assert.ok(validateAction({ type: 'draft', rules: [{ when: 'daily', do: [{ op: 'transfer', from: 'treasury', to: 'actor' }] }] }).length);
});

test('native OpenAI and Responses request paths carry all typed tools and self-contained schemas without changing token limits', async () => {
  for (const kind of ['openai', 'openai-responses']) {
    const city = openCity({ seed: `typed-${kind}` });
    try {
      const [a] = city.ids;
      let body;
      const inner = await createProvider({ provider: kind, model: 'm', maxTokens: 1200 }, { fetch: async (_url, init) => {
        body = JSON.parse(init.body);
        const calls = [call('say', { text: 'provider mapped' }), call('done')];
        const payload = kind === 'openai' ? { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: calls.map((c, i) => ({ id: `c${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } }] }
          : { status: 'completed', output: calls.map((c, i) => ({ type: 'function_call', call_id: `c${i}`, name: c.name, arguments: JSON.stringify(c.args) })) };
        return new Response(JSON.stringify(payload));
      } });
      const out = await drive(city, a, { cfg, inner });
      assert.equal(out.result.acted, 1);
      assert.equal(out.requests.length, 1);
      assert.equal(body[kind === 'openai' ? 'max_tokens' : 'max_output_tokens'], 1200);
      const functions = body.tools.map(t => t.function || t);
      if (kind === 'openai-responses') assert.ok(functions.every(t => t.strict === false), 'typed optional fields must not depend on implicit schema normalization');
      assert.ok(functions.some(f => f.name === 'done'));
      assert.ok(!functions.some(f => f.name === 'act'));
      for (const f of functions) {
        assert.equal(f.parameters.type, 'object');
        const check = value => {
          if (!value || typeof value !== 'object') return;
          if (value.$ref) assert.ok(f.parameters.$defs?.[value.$ref.slice('#/$defs/'.length)], `${f.name}: ${value.$ref}`);
          Object.values(value).forEach(check);
        };
        check(f.parameters);
      }
      assert.ok(JSON.stringify(out.requests[0].tools).length < 60000, 'typed schema publication has a bounded cost and is included in model reservations');
    } finally { city.close(); }
  }
});

test('structured draft/propose tools pass original objects into the actual engine runner path', async () => {
  const city = openCity({ seed: 'typed-legislation' });
  try {
    const [a] = city.ids;
    const rules = [{ when: 'daily', do: [{ op: 'announce', to: 'all', text: '  original template  ' }] }];
    const submissions = [];
    const real = city.client(a);
    const out = await drive(city, a, { cfg, deps: { client: { ...real, act: async req => { submissions.push(req); return real.act(req); } } }, script: [{ calls: [
      call('move', { to: 'parliament' }), call('draft', { rules }), call('propose', { title: 'T', text: 'Original body', rules }), call('done'),
    ] }] });
    assert.deepEqual(submissions[1].actions, [{ type: 'draft', rules }]);
    assert.deepEqual(submissions[2].actions, [{ type: 'propose', title: 'T', text: 'Original body', rules }]);
    assert.ok(out.wakings[0].rec.acts.every(r => r.ok));
    assert.ok(Object.values(city.rt.w.proposals).some(p => p.title === 'T'));
    assert.equal(out.requests.length, 1);
  } finally { city.close(); }
});

test('resolved look shape correction no longer appears in the next waking', async () => {
  const city = openCity({ seed: 'typed-look-resolved' });
  try {
    const [a] = city.ids;
    const out = await drive(city, a, { cfg: { ...cfg, historyRounds: 0 }, rounds: 2, after: () => city.rt.tickNow(), script: [
      { calls: [call('look', { what: 'fake' })] }, { calls: [call('look', { what: 'here' }), call('done')] }, { calls: [call('done')] },
    ] });
    assert.ok(!out.requests[2].transcript[0].text.includes('【尚未解决的行动纠正】'));
  } finally { city.close(); }
});

test('text JSON typed names execute sequentially with done independent and look free', async () => {
  const city = openCity({ seed: 'typed-json-tools' });
  try {
    const [a, b] = city.ids;
    const real = city.client(a);
    const submissions = [];
    const out = await drive(city, a, { cfg: { actionTools: 'typed' }, deps: { client: { ...real, act: async req => { submissions.push(req.actions); return real.act(req); } } }, script: [{ text: JSON.stringify({ look: { what: 'here' }, say: { text: 'original' }, whisper: { to: b, text: 'secret' }, done: true }) }] });
    assert.deepEqual(submissions, [[{ type: 'say', text: 'original' }], [{ type: 'whisper', to: b, text: 'secret' }]]);
    assert.equal(out.requests.length, 1);
    assert.equal(out.wakings[0].rec.ended, 'end');
    assert.equal(out.wakings[0].rec.looks.length, 1);
    assert.ok(out.requests[0].system.includes('{"say"'));
  } finally { city.close(); }
});

test('engine-valid optional nulls remain exact through typed runner and given-field alternatives', async () => {
  const city = openCity({ seed: 'typed-null-parity' });
  try {
    const [a, b] = city.ids;
    const actions = [
      { type: 'give', to: b, energy: 1, coins: null, note: null },
      { type: 'standing', orders: [{ when: 'daily', if: null, times: null, untilDay: null, do: [{ type: 'say', text: 'x' }] }] },
      { type: 'offer', give: { coins: 1, energy: null }, want: { energy: 1 }, to: null, note: null },
      { type: 'propose', title: 'null rules', text: 'x', rules: null, procedure: { ordinary: { none: true } } },
    ];
    city.exec(a, [{ type: 'move', to: 'market' }]);
    for (const action of actions.slice(0, 3)) assert.ok(city.exec(a, [action]).result.results[0].ok, JSON.stringify(action));
    for (const action of actions) assert.deepEqual(validateAction(action), [], JSON.stringify(action));
    assert.deepEqual(validateAction({ type: 'draft', rules: null, procedure: { ordinary: { none: true } } }), []);
    assert.deepEqual(validateAction({ type: 'read', doc: null, law: 'l2' }), []);
    const submissions = [];
    const real = city.client(a);
    city.agent(a).actsThisTick = 0;
    const out = await drive(city, a, { cfg, deps: { client: { ...real, act: async req => { submissions.push(req.actions); return real.act(req); } } }, script: [{ calls: [call('give', { to: b, energy: 1, coins: null, note: null }), call('done')] }] });
    assert.equal(out.result.acted, 1);
    assert.deepEqual(submissions[0], [actions[0]]);
  } finally { city.close(); }
});

test('state-independent engine constraints reject impossible requests before client.act', async () => {
  const city = openCity({ seed: 'typed-preflight-parity' });
  try {
    const [a, b] = city.ids;
    const invalid = [
      { type: 'give', to: b }, { type: 'give', to: b, energy: 0, coins: null },
      { type: 'offer', give: { energy: 1 }, want: { energy: 1 }, to: b },
      { type: 'offer', give: {}, want: {}, to: b },
      { type: 'refound', text: 'x', procedure: { ordinary: { none: true } } },
      { type: 'rules', place: 'port', procedure: 'members' },
      ...['repair', 'contribute', 'sponsor', 'dismantle'].map(type => ({ type, energy: 0, ...(type === 'contribute' ? { project: 'p1' } : type === 'sponsor' ? { soul: 's1' } : {}) })),
    ];
    for (const action of invalid) assert.ok(validateAction(action).length, JSON.stringify(action));
    let submissions = 0;
    const real = city.client(a);
    const out = await drive(city, a, { cfg, deps: { client: { ...real, act: async req => { submissions++; return real.act(req); } } }, script: [{ calls: invalid.map(({ type, ...args }) => call(type, args)) }, { calls: [call('done')] }] });
    assert.equal(submissions, 0);
    assert.equal(city.agent(a).actsThisTick, 0);
    assert.ok(out.requests[1].transcript.at(-1).results.every(r => r.isError));
  } finally { city.close(); }
});

test('standing dynamic build discriminator is deferred without evaluation or guessed required fields', async () => {
  const city = openCity({ seed: 'typed-dynamic-build' });
  try {
    const [a] = city.ids;
    const action = { type: 'standing', orders: [{ when: 'daily', do: [{ type: 'initiate', build: "='road'", to: 'market' }] }] };
    assert.ok(city.exec(a, [action]).result.results[0].ok);
    assert.deepEqual(validateAction(action), []);
    assert.deepEqual(validateAction({ type: 'standing', orders: [{ when: 'daily', do: [{ type: 'initiate', build: '=me.purpose' }] }] }), [], 'future requirements cannot be guessed');
  } finally { city.close(); }
});

test('visible resident names use engine NFC/lowercase comparison while original recipient is preserved', async () => {
  const city = openCity({ seed: 'typed-name-key', names: ['Sender', 'Bób'] });
  try {
    const [a, b] = city.ids;
    const text = { to: 'bo\u0301b', text: 'exact original' };
    assert.ok(city.exec(a, [{ type: 'whisper', ...text }]).result.results[0].ok);
    city.agent(a).actsThisTick = 0;
    const submissions = [];
    const real = city.client(a);
    const out = await drive(city, a, { cfg, deps: { client: { ...real, act: async req => { submissions.push(req.actions); return real.act(req); } } }, script: [{ calls: [call('whisper', text), call('done')] }] });
    assert.equal(out.result.acted, 1);
    assert.deepEqual(submissions[0], [{ type: 'whisper', ...text }]);
    assert.ok(city.agent(b).inbox.some(i => i.text === text.text));
  } finally { city.close(); }
});
