// 测试辅助：本机的 OpenAI 兼容假模型接口，与「等到条件成立」。托管运行器的用量与账号关联的测试共用。
import http from 'node:http';
import assert from 'node:assert/strict';

export async function eventually(fn, what = '条件') {
  for (let i = 0; i < 150; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail(`${what}没有在限定时间内成立`);
}

/** 一个本机的 OpenAI 兼容接口：连接测试照常通过；运行器的调用按 mode 回应 */
export async function startStub(usage = { prompt_tokens: 1234, completion_tokens: 56 }) {
  const stub = { mode: 'ok', usage, calls: [] };
  stub.server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    const probe = data.messages[0].content.startsWith('Connection test.');
    stub.calls.push({ probe, model: data.model });
    res.setHeader('Content-Type', 'application/json');
    if (!probe && stub.mode === 'hang') { req.on('close', () => res.destroy()); return; }
    if (!probe && stub.mode === 'limit') { res.writeHead(429).end(JSON.stringify({ error: { message: 'do-not-leak-upstream-detail' } })); return; }
    res.end(JSON.stringify({ choices: [{ message: { content: '{"actions":[]}' }, finish_reason: 'stop' }], ...(stub.usage ? { usage: stub.usage } : {}) }));
  });
  await new Promise((r) => stub.server.listen(0, '127.0.0.1', r));
  stub.config = (extra = {}) => ({ provider: 'openai', baseURL: `http://127.0.0.1:${stub.server.address().port}/v1`, model: 'test-model', apiKey: 'usage-test-api-key', ...extra });
  stub.close = () => new Promise((r) => { stub.server.close(r); stub.server.closeAllConnections(); });
  return stub;
}
