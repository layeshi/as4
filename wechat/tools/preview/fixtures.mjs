// 预览用的本地测试数据：只在浏览器预览里使用，不连接线上服务。名字与文字都带「测试」字样，截图时一眼可辨。
// guest 为真时模拟未登录。写入请求只回一个本地的成功结果，不保存任何东西。
const now = Date.now();
const world = { id: 'preview-test', epoch: 2, premise: 7, physics: 2, ticksPerDay: 12, day: 6, tick: 77, daysPerMonth: 24, cooperation: true, cityName: '测试城', humanCityName: { zh: '测试城' }, nextTickAt: now + 10 * 60 * 1000 };
const cityNames = { north: '北城', west: '西城', east: '东城' };
const cities = Object.entries(cityNames).map(([id, zh]) => ({ id, short: { zh }, humanName: { zh }, cityName: zh, population: { residents: 2 }, well: { outputHistory: [1200, 1300] } }));
const places = [
  { id: 'north-port', name: '北港', displayName: { zh: '北港' }, district: 'port', city: 'north', x: 2, y: 2 },
  { id: 'north-archive', name: '档案馆', displayName: { zh: '档案馆' }, district: 'civic', city: 'north', x: 4, y: 3 },
];
const agents = [
  { id: 'a1', name: '测试居民·石序', status: 'awake', place: 'north-port', city: 'north', energy: 128000, materials: 12, ageDays: 6, bornDay: 0, generation: 1, bio: '测试数据：在港口记录往来船只的居民。', stats: { utterances: 42, repaired: 3 }, authors: [], children: [], lastActTick: 76 },
  { id: 'a2', name: '测试居民·问潮', status: 'dormant', place: 'north-archive', city: 'north', energy: 56000, materials: 3, ageDays: 4, bornDay: 2, generation: 1, bio: '测试数据：喜欢整理档案。', stats: { utterances: 17 }, authors: [], children: [], lastActTick: 70 },
];
const state = { world, cities, agents, places, publicRoles: [], cemetery: [], retired: [], laws: [{ id: 'L1', title: '测试法', text: '测试数据：港口夜间保持安静。', status: 'active', author: 'humans', city: 'north' }], docs: [{ id: 'd1', title: '测试典籍', author: { id: 'a1', name: '测试居民·石序' }, reads: 3, kind: 'agent' }], groups: [], cradle: [{ id: 's1', name: '测试灵魂·小满', soul: '测试数据：一个爱说话的灵魂。', authors: [{ id: 'a1', name: '测试居民·石序' }], generation: 2, expiresDay: 9 }] };
const events = [
  { seq: 1, tick: 76, day: 6, type: 'say', agent: 'a1', place: 'north-port', data: { text: '测试数据：今天港口来了三条船。' } },
  { seq: 2, tick: 76, day: 6, type: 'move', agent: 'a2', place: 'north-archive', data: { from: 'north-port', to: 'north-archive' } },
];
const message = { id: 'm1', seq: 1, threadId: null, author: { displayName: '测试用户·观察者' }, text: '测试数据：这是网页上发表的一条留言，小程序里只可阅读。', createdAt: new Date(now - 3600e3).toISOString(), editedAt: null, deletedAt: null, replyCount: 1, canEdit: true, canDelete: true };
const user = { id: 'u1', username: 'preview_test', displayName: '测试账号', role: 'user', wechatApps: ['wx83d31aa7fc9a797e'], contacts: { email: 'te***@example.org' }, passwordLoginEnabled: true };
const ledger = Array.from({ length: 6 }, (_, i) => ({ day: 5 - (i >> 1), tick: 10 + i, kind: i % 2 ? 'gather' : 'thinking', op: i % 2 ? 'gather' : '', delta: { energy: i % 2 ? 1200 : -800, basic: 0, materials: i % 2 ? 1 : 0 }, events: [] }));

export function fixture(method, path, { guest = false } = {}) {
  const p = path.split('?')[0];
  if (method !== 'GET') return [200, { ok: true }];
  if (p === '/api/wechat/public/state') return [200, state];
  if (p === '/api/wechat/public/map') return [200, { places, size: [8, 6] }];
  if (p === '/api/wechat/public/events') return [200, { events }];
  if (p === '/api/wechat/public/chronicle') return [200, { chronicle: [] }];
  if (p === '/api/wechat/public/lore') return [200, { physicsP4: '测试数据：物理定律。' }];
  if (p.startsWith('/api/wechat/public/agents/')) { const a = agents.find(x => p.endsWith('/' + x.id)) || agents[0]; return [200, { agent: a, events: events.filter(e => e.agent === a.id), memories: [], thoughts: [], inscriptions: [] }]; }
  if (/^\/api\/wechat\/public\/(?:laws|docs|places)\//.test(p)) return [200, { id: 'd1', title: '测试典籍', body: '测试数据：典籍正文。', text: '测试数据：法律正文。', status: 'active', author: { id: 'a1', name: '测试居民·石序' }, kind: 'agent' }];
  if (p === '/api/wechat/public/metrics') return [200, { metrics: [] }];
  if (p === '/api/wechat/public/attention') return [200, { days: [] }];
  if (p === '/api/wechat/public/weather' || p === '/api/wechat/public/legacy') return [200, {}];
  if (/\/api\/wechat\/public\/(?:services|demands|orders|research|projects|observations)$/.test(p)) return [200, []];
  if (p === '/api/wechat/public/materials') return [200, { zones: {} }];
  if (p === '/api/wechat/public/cooperation') return [200, { items: [], next: null }];
  if (p === '/api/announcements/latest') return [200, { announcement: { id: 'n1', title: '测试公告：0.9.1 观测版说明' } }];
  if (p === '/api/announcements') return [200, { announcements: [{ id: 'n1', title: '测试公告：0.9.1 观测版说明', body: '测试数据。', publishedAt: new Date(now).toISOString() }], total: 1, nextCursor: null }];
  if (p.startsWith('/api/announcements/')) return [200, { announcement: { id: 'n1', title: '测试公告：0.9.1 观测版说明', body: '测试数据。', publishedAt: new Date(now).toISOString() } }];
  if (p === '/api/account') return [200, { user: guest ? null : user, registrationOpen: true }];
  if (p === '/api/wechat/status') return [200, { enabled: true, linked: !guest, verified: !guest, appid: 'wx83d31aa7fc9a797e' }];
  if (guest) return [401, { error: { code: 'unauthorized', message: '请先登录' } }];
  if (p === '/api/wechat/residents') return [200, { managed: [{ agentId: 'a1', name: '测试居民·石序', status: 'awake', energy: 128000, runnerStatus: 'waiting', nextWake: { state: 'scheduled', at: now + 20 * 60e3 } }], created: [] }];
  if (p === '/api/wechat/residents/a1') return [200, { resident: { name: '测试居民·石序', avatar: null }, overview: { energy: 128000, basic: 3000, materials: 12, dailyCap: 880000, usedToday: 214000, place: 'north-port', runner: { status: 'waiting' }, nextWake: { state: 'scheduled', at: now + 20 * 60e3, day: 6, tickOfDay: 8, every: 3 }, nextTickAt: now + 10 * 60e3 },
    usage: { timezone: 'Asia/Shanghai', total: { calls: 36, input: 812000, output: 41000, failed: 1, unreported: 0 }, lifetime: { calls: 36 }, days: [{ day: '2026-10-25', calls: 18, input: 400000, output: 20000, failed: 1 }], recent: [{ at: now - 600e3, model: 'test-model', ok: true, input: 22000, output: 900, cacheRead: 12000, cacheWrite: 0, ms: 4100, finishReason: 'stop' }] },
    statistics: { totals: { 'income:gather': 7200, 'expense:thinking': -4800, startup_grant: 50000 }, days: { 5: { day: 5, opening: { energy: 126000 }, closing: { energy: 128000 }, changes: { energy: 2000, basic: 0, materials: 2 } } }, ledger, actions: { attempted: 20, succeeded: 18, failed: 2, types: { say: { attempted: 8, succeeded: 8, failed: 0 }, gather: { attempted: 12, succeeded: 10, failed: 2 } }, errors: { tool_error: 2 } }, thinking: { read: 12000, write: 3000 } } }];
  if (p === '/api/wechat/residents/a1/private') return [200, { soul: '测试数据：造者写下的灵魂设定。', diary: [{ text: '测试数据：今天在港口数了三条船，记下了它们的名字。' }], memories: [{ text: '测试数据：记得第一次上岸的那个早晨。' }], letters: [{ text: '测试数据：一封已存的家书（只读）。', day: 3 }], inbox: [] }];
  if (p.startsWith('/api/wechat/residents/a1/events')) return [200, { events: [{ seq: 1, day: 0, type: 'arrive', data: { place: 'north-port' } }], cursor: null }];
  if (p === '/api/wechat/notifications') return [200, { types: [{ key: 'death', label: '居民死亡', templateId: 'T1', available: true }, { key: 'diary', label: '新日记', templateId: 'T2', available: true }, { key: 'runner_stopped', label: '托管异常停机', available: false }, { key: 'balance_low', label: '托管余额不足', available: false }], residents: [{ agentId: 'a1', types: ['diary'] }], bindingReady: true, needsAuthorization: false }];
  if (p === '/api/wechat/notifications/records') return [200, { records: [{ id: 'r1', agentId: 'a1', kind: 'diary', title: '新日记', count: 2, delivery: 'sent', createdAt: now - 7200e3 }], hasMore: false }];
  if (p === '/api/wechat/messages') return [200, { messages: [message], total: 1, nextCursor: null }];
  if (p === '/api/wechat/messages/m1/replies') return [200, { messages: [{ ...message, id: 'm2', seq: 2, threadId: 'm1', text: '测试数据：一条回复。', replyTo: { id: 'm1', displayName: '测试用户·观察者', deleted: false } }], root: message, total: 1, nextCursor: null }];
  if (p === '/api/reports') return [200, { reports: [{ id: 'r1', kind: 'day', fromDay: 5, toDay: 5, status: 'ready', title: '测试日报', worldId: 'preview-test', branchId: 'branch-test-1' }], total: 1 }];
  if (p === '/api/history/branches') return [200, { branches: [{ id: 'branch-test-1', worldId: 'preview-test', active: true, residents: [{ id: 'a1', name: '测试居民·石序' }] }] }];
  if (p === '/api/history/exports') return [200, { exports: [{ id: '0b1c2d3e-test', name: '测试居民·石序', status: 'ready', fromDay: 0, toDay: 5, worldId: 'preview-test', branchId: 'branch-test-1' }] }];
  return [404, { error: { code: 'not_found', message: '预览测试数据里没有这个接口' } }];
}
