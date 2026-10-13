import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider } from '../runner/providers.js';

for (const method of ['complete', 'step']) test(`DeepSeek cache usage in ${method}, OpenAI details take precedence`, async () => {
  for (const [details, expected] of [[undefined, 60], [{ cached_tokens: 20 }, 20], [{ cached_tokens: 0 }, 0]]) {
    const p = await createProvider({ provider: 'openai', model: 'test', baseURL: 'https://example.invalid' }, { fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{}', tool_calls: [] }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 5, prompt_cache_hit_tokens: 60, ...(details ? { prompt_tokens_details: details } : {}) } })) });
    const result = await p[method]({ system: 's', messages: [], transcript: [], tools: [] });
    assert.deepEqual(result.usage, { input: 100, output: 5, cacheRead: expected });
  }
});
