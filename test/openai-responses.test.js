import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, ProviderError, OPENAI_REASONING_EFFORTS } from '../runner/providers.js';
import { runnerConfig } from '../src/runner/manager.js';
import { parseRunnerConfig } from '../runner/agent.js';
import { parseShellsConfig } from '../src/shells/config.js';
import { modelForm } from '../public/runner-ui.js';
import { installFakeDom } from './fake-dom.js';

const reply = {
  status: 'completed',
  output: [
    { type: 'reasoning', summary: [{ type: 'summary_text', text: 'private reasoning' }] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"actions":' }, { type: 'output_text', text: '[]}' }] },
  ],
  usage: { input_tokens: 40, output_tokens: 30, output_tokens_details: { reasoning_tokens: 20 } },
};
const request = { system: 'SYSTEM', messages: [{ role: 'user', content: 'previous perception' }, { role: 'assistant', content: '{"actions":[]}' }, { role: 'user', content: 'current perception' }] };

test('Responses 请求保留系统与历史，映射推理/JSON/上限参数，正文与用量独立于思考项', async () => {
  let call;
  const provider = await createProvider({
    provider: 'openai-responses', model: 'test-model', baseURL: 'https://gateway.example/v1/',
    apiKeyEnv: 'TEST_KEY', reasoningEffort: 'high', maxTokens: 8000, jsonMode: true, temperature: 0.8,
    extraBody: { model: 'wrong', input: [], instructions: 'wrong', store: true, stream: true, top_p: 0.5, reasoning: { summary: 'auto', effort: 'low' } },
  }, { env: { TEST_KEY: 'unit-test-secret' }, fetch: async (url, init) => {
    call = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify(reply));
  } });
  assert.equal(provider.name, 'openai-responses');
  assert.deepEqual(await provider.complete(request), { text: '{"actions":[]}', stop: 'stop', usage: { input: 40, output: 30, reasoning: 20 } });
  assert.equal(call.url, 'https://gateway.example/v1/responses');
  assert.equal(call.init.headers.Authorization, 'Bearer unit-test-secret');
  assert.deepEqual(call.body, {
    model: 'test-model', input: request.messages, instructions: request.system, store: false, stream: false,
    reasoning: { summary: 'auto', effort: 'high' }, max_output_tokens: 8000, text: { format: { type: 'json_object' } },
  });
  assert.ok(!call.init.body.includes('unit-test-secret'));
});

test('两种 OpenAI 接口的默认强度不发参数；明确选择时使用各自参数与 token 上限', async () => {
  for (const kind of ['openai', 'openai-responses']) {
    for (const effort of [undefined, ...OPENAI_REASONING_EFFORTS]) {
      let body;
      const provider = await createProvider({ provider: kind, model: 'm', reasoningEffort: effort, maxTokens: 1000 }, { fetch: async (_url, init) => {
        body = JSON.parse(init.body); return new Response(JSON.stringify(kind === 'openai' ? { choices: [] } : reply));
      } });
      await provider.complete(request);
      const explicit = effort !== undefined && effort !== 'default';
      if (kind === 'openai') {
        assert.equal(body.reasoning_effort, explicit ? effort : undefined);
        assert.equal(body[explicit ? 'max_completion_tokens' : 'max_tokens'], 1000);
        assert.equal(body[explicit ? 'max_tokens' : 'max_completion_tokens'], undefined);
      } else {
        assert.deepEqual(body.reasoning, explicit ? { effort } : undefined);
        assert.equal(body.max_output_tokens, 1000);
        assert.equal(body.messages, undefined);
      }
    }
  }
});

test('Responses 拒绝和未完成的正文不能成为行动，但 token 用量仍然保留', async () => {
  for (const [payload, stop] of [
    [{ ...reply, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 'length'],
    [{ ...reply, status: 'incomplete', incomplete_details: { reason: 'content_filter' } }, 'incomplete'],
    [{ ...reply, status: 'in_progress' }, 'in_progress'],
    [{ ...reply, status: 'queued' }, 'queued'],
    [{ ...reply, output: [...reply.output, { type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'no' }] }] }, 'refusal'],
    [{ ...reply, output: [reply.output[0]] }, 'stop'],
  ]) {
    const provider = await createProvider({ provider: 'openai-responses', model: 'm' }, { fetch: async () => new Response(JSON.stringify(payload)) });
    assert.deepEqual(await provider.complete(request), { text: '', stop, usage: { input: 40, output: 30, reasoning: 20 } });
  }
});

test('Responses 错误分级、超时/取消，缺失凭据和非法强度都明确拒绝', async () => {
  for (const [status, fatal, retryable] of [[401, true, false], [404, true, false], [429, false, true], [503, false, true], [400, false, false]]) {
    const provider = await createProvider({ provider: 'openai-responses', model: 'm' }, { fetch: async () => new Response(JSON.stringify({ error: { message: 'test failure' } }), { status }) });
    await assert.rejects(provider.complete(request), e => e instanceof ProviderError && e.status === status && e.fatal === fatal && e.retryable === retryable);
  }
  for (const payload of [{ status: 'failed' }, { error: { message: 'failure' } }]) {
    const provider = await createProvider({ provider: 'openai-responses', model: 'm' }, { fetch: async () => new Response(JSON.stringify(payload)) });
    await assert.rejects(provider.complete(request), ProviderError);
  }
  const controller = new AbortController(); controller.abort();
  const provider = await createProvider({ provider: 'openai-responses', model: 'm' }, { fetch: async (_url, { signal }) => { signal.throwIfAborted(); } });
  await assert.rejects(provider.complete({ ...request, signal: controller.signal }), e => e.retryable);
  await assert.rejects(createProvider({ provider: 'openai-responses' }), e => e.fatal);
  await assert.rejects(createProvider({ provider: 'openai-responses', model: 'm', apiKeyEnv: 'MISSING' }, { env: {} }), e => e.fatal);
});

test('托管、自运行与躯壳配置都接受 Responses 和思考强度，旧 OpenAI 配置保持默认', () => {
  const config = { provider: 'openai-responses', model: 'm', reasoningEffort: 'xhigh' };
  assert.equal(runnerConfig(config).baseURL, 'https://api.openai.com/v1');
  assert.equal(runnerConfig(config).reasoningEffort, 'xhigh');
  assert.equal(runnerConfig({ provider: 'openai', model: 'm', effort: 'medium' }).reasoningEffort, 'default');
  assert.equal(parseRunnerConfig({ agents: [{ ...config, tokenEnv: 'TOKEN' }] }, { TOKEN: 'test-token' })[0].reasoningEffort, 'xhigh');
  assert.equal(parseShellsConfig({ lines: [config] }).lines[0].provider, 'openai-responses');
  for (const reasoningEffort of ['ultra', '', null, 1, false]) {
    assert.throws(() => runnerConfig({ ...config, reasoningEffort }), /思考强度/);
    assert.throws(() => parseRunnerConfig({ agents: [{ ...config, reasoningEffort, tokenEnv: 'TOKEN' }] }, { TOKEN: 'test-token' }), /思考强度/);
    assert.throws(() => parseShellsConfig({ lines: [{ ...config, reasoningEffort }] }), /思考强度/);
  }
});

test('模型表单回填 Responses 与强度，可切换自定义接口，私有 thinking 仅 Chat 显示', () => {
  const dom = installFakeDom();
  // The small fake DOM does not implement select.value; initialize it from the selected option here.
  const initialize = root => {
    for (const select of root.querySelectorAll('select')) select.value = select.children.find(o => o.selected)?.value || select.children[0].value;
    root.querySelector('select[name="provider"]').fire('change');
  };
  try {
    const form = modelForm({ provider: 'openai-responses', model: 'm', baseURL: 'https://gateway.example/v1', reasoningEffort: 'high' });
    initialize(form.root);
    const control = name => form.root.querySelector(`select[name="${name}"]`);
    assert.equal(control('preset').value, 'custom');
    assert.equal(control('provider').value, 'openai-responses');
    assert.equal(control('reasoningEffort').disabled, false);
    assert.equal(control('thinking').disabled, true);
    assert.equal(form.read().reasoningEffort, 'high');
    control('provider').value = 'anthropic'; control('provider').fire('change');
    assert.equal(control('reasoningEffort').disabled, true);
    assert.equal(control('effort').disabled, false);
    assert.equal(form.read().reasoningEffort, undefined);
    control('preset').value = 'responses'; control('preset').fire('change');
    assert.equal(form.read().provider, 'openai-responses');
    assert.equal(form.read().baseURL, 'https://api.openai.com/v1');
    assert.equal(control('thinking').disabled, true);
    const legacy = modelForm({ provider: 'openai', effort: 'medium', model: 'm' }); initialize(legacy.root);
    assert.equal(legacy.read().reasoningEffort, 'default');
  } finally { dom.restore(); }
});
