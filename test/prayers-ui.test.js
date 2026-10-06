import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { getLang, setLang, describeEvent } from '../public/i18n.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));
const response = (status, json) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
const fixture = () => ({ enabled: true, rules: {}, accounts: [{ agentId: 'a1', name: '望川', status: 'awake', balance: 5, repairRemainder: 50, projectRemainder: 5, autoEarned: 2 }],
  prayers: [{ id: 'pr1', agentId: 'a1', name: '望川', residentStatus: 'awake', text: '<img src=x>请给予能量', status: 'pending', day: 1, tick: 14, reply: null }],
  inventions: [{ id: 'iv1', agentId: 'a1', name: '望川', residentStatus: 'awake', status: 'pending', title: '新水轮', text: '节省修缮', ref: { kind: 'doc', id: 'd1' }, awarded: false, day: 1, tick: 14,
    work: { kind: 'doc', id: 'd1', title: '水轮图', body: '<script>作品证据</script>', redacted: false }, history: [{ kind: 'submission', title: '旧水轮', text: '初稿', day: 0, tick: 0 }, { decision: 'rejected', reason: '补充验证', day: 0, tick: 1 }, { kind: 'submission', title: '新水轮', text: '已补充', day: 1, tick: 14 }] }],
  ledger: [{ id: 'pl1', agentId: 'a1', day: 1, tick: 14, kind: 'repair', amount: 2, balance: 5, sourceId: 'temple' }] });
function setup({ linked = true, user = { id: 'private-human', role: 'user' }, route } = {}) {
  const dom = installFakeDom(), oldFetch = globalThis.fetch, oldLang = getLang(), requests = [], data = fixture();
  setLang('zh');
  globalThis.fetch = async (url, options = {}) => {
    const req = { url, method: options.method || 'GET', body: options.body && JSON.parse(options.body), headers: options.headers };
    requests.push(req);
    const custom = route && await route(req, data); if (custom) return custom;
    if (url.startsWith('/api/public/prayers')) return response(200, data);
    if (url === '/api/account') return response(200, { user });
    if (url === '/api/account/agents') return response(200, { agents: linked ? [{ agentId: 'a1' }] : [] });
    if (url.startsWith('/api/account/prayers/audit')) return response(200, { enabled: true, audit: [{ kind: 'reply', actorId: 'private-human', agentId: 'a1', prayerId: 'pr1', text: '回应', energy: 1, cost: 2, day: 1, tick: 14 }] });
    if (url.startsWith('/api/admin/inventions')) return response(200, { enabled: true, inventions: data.inventions.map((i) => ({ ...i, canReview: !linked })) });
    return response(404, { error: { code: 'not_found' } });
  };
  return { dom, requests, data, restore() { dom.restore(); globalThis.fetch = oldFetch; setLang(oldLang); } };
}
const posts = (env) => env.requests.filter((r) => r.method === 'POST');

test('public prayer section renders balance, safe content, statuses, ledger and invention history without actor identity', async () => {
  const { prayerSection } = await import('../public/prayers-ui.js');
  const env = setup({ linked: false });
  try {
    env.data.prayers.push({ ...env.data.prayers[0], id: 'pr2', status: 'answered', reply: { text: '愿你醒来', energy: 2, cost: 3, day: 2, tick: 25 } }, { ...env.data.prayers[0], id: 'pr3', status: 'closed', residentStatus: 'dead', closedDay: 3, closedTick: 36 });
    const panel = prayerSection({ agentId: 'a1' }); env.dom.root.append(panel); await settle();
    assert.match(panel.textContent, /祈愿点.*5/); assert.match(panel.textContent, /待回应/); assert.match(panel.textContent, /已回应/); assert.match(panel.textContent, /已关闭/);
    assert.match(panel.textContent, /修缮.*\+2.*5/); assert.match(panel.textContent, /旧水轮.*初稿.*補充|旧水轮.*初稿.*补充/);
    assert.ok(panel.textContent.includes('<img src=x>')); assert.equal(panel.querySelector('img'), null); assert.equal(panel.querySelector('script'), null);
    assert.equal(panel.querySelector('form.prayer-reply'), null); assert.doesNotMatch(panel.textContent, /private-human/);
  } finally { env.restore(); }
});

test('linked reply previews combined cost, validates, disables duplicate requests and refreshes history after success', async () => {
  const { prayerSection } = await import('../public/prayers-ui.js');
  let complete;
  const env = setup({ route: (r, d) => r.method === 'POST' ? new Promise((resolve) => { complete = () => { d.accounts[0].balance = 2; d.prayers[0].status = 'answered'; d.prayers[0].reply = { text: r.body.text, energy: r.body.energy, cost: 3, day: 1, tick: 14 }; resolve(response(200, { ok: true })); }; }) : null });
  try {
    const panel = prayerSection({ agentId: 'a1' }); env.dom.root.append(panel); await settle();
    const form = panel.querySelector('form.prayer-reply'), text = form.querySelector('textarea'), energy = form.querySelector('input'), save = form.querySelector('button[type="submit"]');
    form.fire('submit'); await settle(); assert.equal(posts(env).length, 0);
    text.value = '请继续'; text.fire('input'); energy.value = '2'; energy.fire('input');
    assert.match(form.textContent, /总计.*3.*点/); assert.equal(save.disabled, false);
    form.fire('submit'); form.fire('submit'); await settle(); assert.equal(posts(env).length, 1); assert.equal(save.disabled, true);
    assert.deepEqual(posts(env)[0].body, { text: '请继续', energy: 2 }); assert.equal(posts(env)[0].headers['X-Houren-Request'], '1');
    complete(); await settle(); await settle();
    assert.equal(panel.querySelector('form.prayer-reply'), null); assert.match(panel.textContent, /已回应.*请继续/); assert.match(panel.textContent, /祈愿点.*2/);
    assert.ok(env.requests.filter((r) => r.url.startsWith('/api/public/prayers')).length >= 2);
  } finally { env.restore(); }
});

test('reply errors are translated by code and refresh current link/status without partial success', async () => {
  const { prayerSection } = await import('../public/prayers-ui.js');
  const env = setup({ route: (r, d) => { if (r.method === 'POST') { d.accounts[0].balance = 0; return response(409, { error: { code: 'insufficient_points', message: 'opaque', required: 1, balance: 0 } }); } } });
  try {
    const panel = prayerSection({ agentId: 'a1' }); env.dom.root.append(panel); await settle();
    const form = panel.querySelector('form'); form.querySelector('textarea').value = '答复'; form.querySelector('textarea').fire('input'); form.fire('submit'); await settle(); await settle();
    assert.match(panel.textContent, /祈愿点不足/); assert.doesNotMatch(panel.textContent, /opaque|回应已送达/); assert.equal(env.data.prayers[0].status, 'pending');
    assert.match(panel.textContent, /祈愿点.*0/); assert.equal(panel.querySelector('button[type="submit"]').disabled, true);
  } finally { env.restore(); }
});

test('anonymous, dead, disabled and explicit read-only views expose no reply controls; English loading/errors work', async () => {
  const { prayerSection } = await import('../public/prayers-ui.js');
  for (const mode of ['anonymous', 'dead', 'disabled', 'readOnly', 'error']) {
    const env = setup({ user: mode === 'anonymous' ? null : { id: 'x' }, route: (r) => mode === 'error' && r.url.startsWith('/api/public/prayers') ? response(0, null) : null });
    try {
      if (mode === 'dead') env.data.prayers[0].residentStatus = 'dead'; if (mode === 'disabled') env.data.enabled = false;
      setLang('en'); const panel = prayerSection({ agentId: 'a1', readOnly: mode === 'readOnly' }); env.dom.root.append(panel);
      assert.match(panel.textContent, /Loading/); await settle();
      assert.equal(panel.querySelector('form.prayer-reply'), null);
      if (mode === 'error') assert.match(panel.textContent, /Network error/);
      if (mode === 'disabled') assert.match(panel.textContent, /not available/);
    } finally { env.restore(); }
  }
});

test('independent admin reviews evidence/history with mandatory reason, while self-review has no controls', async () => {
  const { adminInventionsPanel } = await import('../public/inventions-ui.js');
  for (const [linked, decision] of [[true, 'approved'], [false, 'approved'], [false, 'rejected']]) {
    const env = setup({ linked, user: { id: 'admin', role: 'admin' }, route: (r, d) => { if (r.method === 'POST') { d.inventions[0].status = r.body.decision; d.inventions[0].awarded = r.body.decision === 'approved'; return response(200, { ok: true }); } } });
    try {
      const panel = adminInventionsPanel(); env.dom.root.append(panel); await settle();
      assert.match(panel.textContent, /水轮图.*作品证据/); assert.match(panel.textContent, /旧水轮.*初稿.*补充验证.*已补充/); assert.equal(panel.querySelector('script'), null);
      const form = panel.querySelector('form.invention-review');
      if (linked) { assert.equal(form, null); assert.match(panel.textContent, /独立/); continue; }
      assert.ok(form); form.fire('submit'); await settle(); assert.equal(posts(env).length, 0);
      form.querySelector('textarea').value = '已有实际验证'; form.querySelector('select').value = decision; form.fire('submit'); await settle(); await settle();
      assert.deepEqual(posts(env)[0].body, { decision, reason: '已有实际验证' }); assert.match(panel.textContent, decision === 'approved' ? /已认定/ : /已驳回/); assert.equal(panel.querySelector('form.invention-review'), null);
    } finally { env.restore(); }
  }
});

test('private audit loads explicit own/admin scopes and renders actual actor and transaction details', async () => {
  const { prayerAuditPanel } = await import('../public/prayers-ui.js');
  const env = setup();
  try {
    const own = prayerAuditPanel({ agentId: 'a1' }); env.dom.root.append(own); await settle();
    assert.ok(env.requests.some((r) => r.url === '/api/account/prayers/audit?scope=own&agentId=a1')); assert.match(own.textContent, /private-human.*pr1.*回应.*2/);
    const all = prayerAuditPanel({ scope: 'all' }); env.dom.root.append(all); await settle();
    assert.ok(env.requests.some((r) => r.url === '/api/account/prayers/audit?scope=all'));
  } finally { env.restore(); }
});

test('prayer/invention public event templates describe world behavior in both languages', () => {
  for (const lang of ['zh', 'en']) {
    setLang(lang);
    for (const type of ['pray', 'prayer_answered', 'prayer_closed', 'prayer_points', 'invent', 'invention_reviewed', 'prayer_enabled']) {
      const d = describeEvent({ type, agent: 'a1', data: { text: '求助', title: '水轮', energy: 2, cost: 3, amount: 1, balance: 5, kind: 'repair', reason: '测试', decision: 'approved' } });
      assert.notEqual(d.template, '{type}', `${lang} ${type} should have a human-readable template`);
    }
  }
  setLang('zh');
});

test('actual profile, temple and My Residents entries open the shared prayer flow without an owner key', async () => {
  const { renderProfile2, openPlace2 } = await import('../public/e2-profile.js');
  const { accountAgentsPanel } = await import('../public/account-usage-ui.js');
  const { closeAllModals } = await import('../public/modals.js');
  const env = setup({ route: (r) => r.url === '/api/account/agents' ? response(200, { agents: [{ agentId: 'a1', name: '望川', status: 'awake', usage: { tracked: false }, prayerPoints: 5, prayers: { enabled: true } }] }) : null });
  try {
    const a = { id: 'a1', name: '望川', status: 'awake', authors: [], children: [], groups: [], tags: [], generation: 0, ageDays: 1, energy: 2, coins: 0, bornDay: 0, stats: { repaired: 0, contributed: 0, drawn: 0 }, prayers: { enabled: true } };
    const temple = { id: 'temple', name: '神殿', district: 'city', origin: 'human', condition: null, open: true, modules: [], projects: [], inscriptions: [] };
    const ctx = { S: { state: { agents: [a], places: [temple], docs: [], prayers: { enabled: true } } }, lore: {}, placeName: () => '神殿', districtName: () => '城内' };
    const profile = renderProfile2(ctx, { agent: a, memories: [], thoughts: [], events: [] }); env.dom.root.append(profile); await settle();
    assert.ok(profile.querySelector('.prayer-panel')); assert.ok(profile.querySelector('form.prayer-reply'));
    openPlace2(ctx, 'temple'); await settle();
    assert.ok(env.dom.root.querySelector('.modal .prayer-panel')); closeAllModals();
    const mine = accountAgentsPanel({ savedOwners: () => [], openBackstage() { assert.fail('should not require owner key'); } }); env.dom.root.append(mine); await settle();
    const entry = mine.querySelectorAll('button').find((b) => b.textContent === '神殿祈祷'); assert.ok(entry); entry.click(); await settle();
    assert.ok(env.dom.root.querySelector('.modal form.prayer-reply'));
  } finally { closeAllModals(); env.restore(); }
});

test('prayer and audit dates use the configured one-based tick within each game day', async () => {
  const { prayerDate } = await import('../public/prayers-ui.js');
  const { clockConfig } = await import('../public/render.js');
  const old = clockConfig.ticksPerDay; setLang('zh');
  try {
    clockConfig.ticksPerDay = 12;
    assert.equal(prayerDate({ day: 0, tick: 0 }), '第 1 日 · 第 1 刻');
    assert.equal(prayerDate({ day: 1, tick: 14 }), '第 2 日 · 第 3 刻');
    clockConfig.ticksPerDay = 8;
    assert.equal(prayerDate({ day: 2, tick: 17 }), '第 3 日 · 第 2 刻');
  } finally { clockConfig.ticksPerDay = old; }
});

test('energy-only replies and 600-codepoint text use correct preview while invalid energy/text cannot submit', async () => {
  const { prayerSection } = await import('../public/prayers-ui.js');
  const env = setup({ route: (r) => r.method === 'POST' ? response(409, { error: { code: 'already' } }) : null });
  try {
    const panel = prayerSection({ agentId: 'a1' }); env.dom.root.append(panel); await settle();
    const form = panel.querySelector('form'), text = form.querySelector('textarea'), energy = form.querySelector('input'), submit = form.querySelector('button[type="submit"]');
    text.value = '🌱'.repeat(600); text.fire('input'); assert.equal(submit.disabled, false, 'Unicode codepoints, not UTF-16 units');
    text.value += '🌱'; text.fire('input'); form.fire('submit'); await settle(); assert.equal(posts(env).length, 0);
    text.value = ''; text.fire('input');
    for (const bad of ['-1', '1.5', '1000001']) { energy.value = bad; energy.fire('input'); form.fire('submit'); await settle(); assert.equal(posts(env).length, 0); }
    energy.value = '2'; energy.fire('input'); assert.match(form.textContent, /文字 0 点.*总计 2 点/); form.fire('submit'); await settle(); await settle();
    assert.deepEqual(posts(env)[0].body, { text: null, energy: 2 }); assert.match(panel.textContent, /记录已处理或关闭/);
  } finally { env.restore(); }
});

test('stale-link failure reloads current links and removes old adopter controls', async () => {
  const { prayerSection } = await import('../public/prayers-ui.js');
  let stale = false;
  const env = setup({ route: (r) => {
    if (r.method === 'POST') { stale = true; return response(403, { error: { code: 'stale_link', message: 'opaque' } }); }
    if (r.url === '/api/account/agents' && stale) return response(200, { agents: [] });
  } });
  try {
    const panel = prayerSection({ agentId: 'a1' }); env.dom.root.append(panel); await settle();
    const form = panel.querySelector('form'); form.querySelector('textarea').value = '答复'; form.querySelector('textarea').fire('input'); form.fire('submit'); await settle(); await settle();
    assert.equal(panel.querySelector('form'), null); assert.match(panel.textContent, /领养关联已失效/); assert.doesNotMatch(panel.textContent, /opaque/);
  } finally { env.restore(); }
});
