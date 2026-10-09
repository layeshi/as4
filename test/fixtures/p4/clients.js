// Premise-2 mock-provider and MCP byte snapshots, frozen before P4 changes.
import { openCity, drive, J } from '../../p2-loop-helpers.js';
import { createMcp } from '../../../mcp/server.js';

export async function clientSamples() {
  const output = {};
  for (const mode of ['json', 'native']) {
    const city = openCity({ seed: 'p4-client-baseline' });
    try {
      const script = mode === 'json' ? [J({ look: 'laws' }), J({ act: { actions: [{ type: 'say', text: '你好' }], end: true } })]
        : [{ calls: [{ name: 'look', args: { what: 'laws' } }] }, { calls: [{ name: 'act', args: { actions: [{ type: 'say', text: '你好' }], end: true } }] }];
      const r = await drive(city, city.ids[0], { cfg: { toolMode: mode }, script });
      output[mode] = r.requests.map(({ timeoutMs, ...request }) => request);
    } finally { city.close(); }
  }
  const city = openCity({ seed: 'p4-mcp-baseline' });
  try {
    const client = city.client(city.ids[0]), requests = [];
    const mcp = createMcp({ env: { HOUREN_SERVER: 'http://mock', HOUREN_TOKEN: 'mock' }, fetch: async (url, init = {}) => {
      const u = new URL(url), body = init.body ? JSON.parse(init.body) : null;
      requests.push({ path: u.pathname + u.search, method: init.method, body });
      const r = u.pathname.endsWith('/act') ? await client.act(body)
        : await client.me(Object.fromEntries(u.searchParams));
      return new Response(JSON.stringify(r.json), { status: r.status || 200, headers: { 'content-type': 'application/json' } });
    } });
    output.mcp = [];
    for (const [name, args] of [['houren_rules', {}], ['houren_perceive', {}], ['houren_look', { what: 'laws' }], ['houren_act', { actions: [{ type: 'say', text: '问候' }] }]]) {
      output.mcp.push(await mcp.handle({ jsonrpc: '2.0', id: output.mcp.length + 1, method: 'tools/call', params: { name, arguments: args } }));
    }
    output.requests = requests;
  } finally { city.close(); }
  return output;
}
