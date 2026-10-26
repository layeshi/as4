import {tmpdir} from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { boot } from './http-helpers.js';
import { syncMiniprogram } from '../wechat/scripts/miniprogram.mjs';
import { AccountError } from '../src/accounts/store.js';
await syncMiniprogram(fileURLToPath(new URL('../wechat/', import.meta.url)));

const source = fileURLToPath(new URL('../wechat/miniprogram/', import.meta.url));
function client(base, { intercept, miniprogram = false } = {}) {
  const storage = new Map(), modules = new Map(), requests = [], timers = new Map();
  const app = { globalData: { ownerKey: '', ownerAgent: null } };
  let pageDefinition, timerId = 0;
  const wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    stopPullDownRefresh() {}, setNavigationBarTitle() {}, navigateTo() {}, redirectTo() {},
    async request(options) {
      requests.push(options);
      try {
        if (intercept && await intercept(options)) return;
        const url = new URL(options.url);
        const response = await fetch(base + url.pathname + url.search, {
          method: options.method, headers: options.header,
          body: options.data === undefined ? undefined : JSON.stringify(options.data)
        });
        options.success({ statusCode: response.status, data: await response.json(), header: Object.fromEntries(response.headers), cookies: response.headers.getSetCookie() });
      } catch (_) { options.fail({ errMsg: 'network failure' }); }
    }
  };
  function load(path) {
    path = resolve(path);
    if (modules.has(path)) return modules.get(path).exports;
    const module = { exports: {} }; modules.set(path, module);
    const fn = runInNewContext('(function(require,module,exports){' + readFileSync(path, 'utf8') + '\n})', {
      wx, getApp: () => app, Page: definition => { pageDefinition = definition; },
      setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id)
    }, { filename: path });
    fn(name => load(resolve(dirname(path), name + '.js')), module, module.exports);
    return module.exports;
  }
  function page(name) {
    load(resolve(source, 'pages', name, 'index.js'));
    const instance = { ...pageDefinition, data: structuredClone(pageDefinition.data), setData(data) { Object.assign(this.data, data); } };
    return instance;
  }
  function game() {
    // Any drawing call is accepted; only text measurement matters for layout.
    const ctx = new Proxy({ measureText(text) { return { width: Array.from(text).length * 8 }; } }, { get: (target, key) => key in target ? target[key] : () => {}, set: () => true });
    wx.createCanvas = () => ({ getContext: () => ctx }); wx.getWindowInfo = () => ({ windowWidth: 375, windowHeight: 812, pixelRatio: 2, statusBarHeight: 28, safeArea: { bottom: 790 } });
    for (const name of ['TouchStart', 'TouchMove', 'TouchEnd', 'Hide', 'Show', 'WindowResize', 'KeyboardConfirm', 'KeyboardComplete', 'ShareAppMessage']) wx['on' + name] = fn => { wx['emit' + name] = fn; };
    wx.login = options => options.success({code:'test-wechat-code'}); wx.showKeyboard = () => {}; wx.hideKeyboard = () => {}; wx.showShareMenu = () => {};
    wx.setClipboardData = options => { wx.copied = options.data; options.success({}); };
    const { SocietyGame } = load(resolve(source, miniprogram ? '../miniprogram-app/runtime/society.js' : '../minigame/society.js'));
    return new SocietyGame();
  }
  return { api: load(resolve(source, '../minigame/utils/api.js')), view: load(resolve(source, 'utils/view.js')), page, game, wx, app, storage, requests, timers };
}

for (const miniprogram of [false, true]) test('P6 ' + (miniprogram ? 'Mini Program' : 'miniGame') + ' integration: WeChat login, read-only resident records, private authorization, read-only messages and logout', async t => {
  const dir=mkdtempSync(resolve(tmpdir(),'houren-wx-p6-')), file=resolve(dir,'physics.json');
  writeFileSync(file, JSON.stringify({version:1,regrowth:{baseByZone:{wilds:20,scrapyard:15,solarfield:10},thresholdByZone:{wilds:30,scrapyard:25,solarfield:15},factorPermille:500},construction:{fullActionsPerTick:2,factorPermille:500}}));
  const env = await boot({ physics: 2, premise: 6, shellSlots:0, hiddenPhysicsFile:file, map: 'compact-materials-v1', wechatAppId: 'wx216f3fb724629f67', wechatAppSecret: 'test-server-secret', wechatMiniprogramAppId: 'wx83d31aa7fc9a797e', wechatMiniprogramAppSecret: 'test-miniprogram-secret' }, {dir}); t.after(() => env.close());
  env.app.ctx.wechat.fetcher = async url => ({ok:true,json:async()=>url.pathname === '/sns/jscode2session' ? {openid:'test-openid-123456'} : url.pathname === '/cgi-bin/token' ? {access_token:'test-token',expires_in:7200} : {errcode:0,result:{suggest:'pass'}}});
  const c = client(env.base, { miniprogram }), g = c.game();
  await g.start();
  assert.equal(g.tab,'startup'); assert.equal(c.requests.length,0); assert.equal(c.timers.size,0);
  assert.equal(g.blocks.some(b=>b.text==='适龄提示：16 岁及以上'), !miniprogram);
  if (!miniprogram) assert.ok(g.blocks.some(b=>b.text==='抵制不良游戏，拒绝盗版游戏。注意自我保护，谨防受骗上当。适度游戏益脑，沉迷游戏伤身。合理安排时间，享受健康生活。'));
  assert.ok(!g.hits.some(h=>h.action.type==='tab'));
  c.wx.emitHide(); c.wx.emitShow(); assert.equal(g.tab,'startup'); assert.equal(c.requests.length,0);
  await g.dispatch({type:'tab',tab:'account'}); assert.equal(g.tab,'startup'); assert.equal(c.requests.length,0);
  await g.dispatch({type:'start'}); assert.equal(g.state.world.premise, 6); assert.ok(g.hits.some(h=>h.action.kind==='place'));
  c.wx.emitHide(); assert.equal(c.timers.size,0);
  await g.dispatch({type:'tab',tab:'account'}); await g.dispatch({type:'wechatLogin'}); assert.match(g.error,/隐私/);
  const passwordUser = await env.app.ctx.accounts.create({ username: 'password_user', password: 'native-password-login' });
  env.app.ctx.cfg.turnstileSecretKey = 'enabled-for-native-login';
  await g.dispatch({ type: 'linkAccount' });
  Object.assign(g.form, { accepted: true, username: 'password_user', password: 'wrong-password' });
  await g.dispatch({ type: 'auth' });
  assert.match(g.error, /密码/);
  assert.equal(g.form.password, undefined);
  g.form.password = 'native-password-login';
  await g.dispatch({ type: 'auth' });
  assert.equal(g.error, ''); assert.equal(g.user.id, passwordUser.id);
  assert.equal(g.wechatLinked, false);
  assert.equal(env.app.ctx.accounts.data.users.length, 1, 'password login never creates a WeChat account');
  const nativeLogin = c.requests.find(r => r.url.endsWith('/api/wechat/password-login'));
  assert.equal(nativeLogin.data.code, 'test-wechat-code');
  assert.equal(nativeLogin.data.appid, miniprogram ? 'wx83d31aa7fc9a797e' : undefined); // Game uses the configured server default.
  assert.ok([...c.storage.values()].every(v => !v.includes('native-password-login')));
  await g.dispatch({ type: 'logout' });
  env.app.ctx.cfg.turnstileSecretKey = '';
  g.form.accepted=true; await g.dispatch({type:'wechatLogin'}); assert.equal(g.error,''); assert.equal(g.user.role,'user'); assert.equal(g.wechatVerified,true);
  if (miniprogram) assert.equal(c.requests.find(r => r.url.endsWith('/api/wechat/login')).data.appid, 'wx83d31aa7fc9a797e');
  // 小程序只观测：创建居民与家书的旧动作被拒绝且不发请求；同一账号的网页会话仍可照常创建与写家书。
  const writesBefore = c.requests.filter(r => r.method && r.method !== 'GET').length;
  Object.assign(g.form,{name:'小游戏居民',soul:'独立观察这座城市',entryAccepted:true,letter:'不应发出的家书'});
  for (const type of ['entry', 'create', 'letter', 'runner', 'modelSave', 'assistantOpen', 'stewardAdoptOpen']) {
    await g.dispatch({ type }); assert.match(g.error, /小程序仅提供观测与已有记录查询/, type);
  }
  assert.equal(c.requests.filter(r => r.method && r.method !== 'GET').length, writesBefore, 'removed actions send nothing');
  const webSession = 'houren_session=' + env.app.ctx.accounts.issue(g.user.id), webHeaders = { Cookie: webSession, 'X-Houren-Request': '1' };
  const created = await env.call('/api/account/residents', { method: 'POST', headers: webHeaders, body: { name: '网页创建的居民', soul: '独立观察这座城市', lang: 'zh', dailyCap: 880000, requestId: 'web-create-1' } });
  assert.ok(created.status >= 200 && created.status < 300, created.text);
  const id = created.json.agentId, relation = env.rt.w.access.residents[id]; assert.equal(relation.managerAccountId, g.user.id);
  const letter = await env.call('/api/account/residents/' + id + '/letter', { method: 'POST', headers: webHeaders, body: { text: '一封网页写下的家书', requestId: 'web-letter-1' } });
  assert.ok(letter.status >= 200 && letter.status < 300, letter.text);
  const phoneLetter = await env.call('/api/account/residents/' + id + '/letter', { method: 'POST', headers: { ...webHeaders, Cookie: 'houren_session=' + c.storage.values().next().value, 'X-Houren-Client': 'wechat' }, body: { text: '绕过客户端的家书', requestId: 'phone-letter-1' } });
  assert.equal(phoneLetter.status, 403); assert.equal(phoneLetter.json.error.code, 'wechat_observation_only');
  await g.loadAccount();
  assert.ok(g.linked.some(a => (a.agentId || a.id) === id));
  await g.dispatch({type:'owner', id}); assert.equal(g.error,''); assert.equal(g.tab,'owner');
  // 网页写下的家书在微信端经审核投影：先显示审核中，检查完成后才可阅读。
  for (let i = 0; i < 20 && g.owner.letters.at(-1).text !== '一封网页写下的家书'; i++) { await new Promise(r => setTimeout(r, 10)); await g.loadOwner(); }
  assert.equal(g.owner.letters.at(-1).text, '一封网页写下的家书');
  g.invalidate(); g.render(); assert.equal(g.page.top.title, '居民记录');
  assert.ok(!g.hits.some(h => /^(?:letter|runner|modelTest|modelSave|steward|assistant)/.test(h.action.type)), 'the records page offers no management controls');
  for (const tab of ['ledger', 'actions', 'usage', 'timeline']) { await g.dispatch({ type: 'recordsTab', tab }); assert.equal(g.error, '', tab); }
  assert.ok(c.requests.some(r => r.url.includes('/api/wechat/residents/' + id + '/events?')));
  const stranger=await env.app.ctx.accounts.create({username:'stranger',password:'test-other-password'});
  const token=env.app.ctx.accounts.issue(stranger.id);
  assert.equal((await env.call('/api/wechat/residents/'+id+'/private',{headers:{Cookie:'houren_session='+token}})).status,403);
  assert.ok(c.requests.some(r=>r.url.includes('/api/wechat/public/state')));
  assert.ok(!c.requests.some(r=>r.url.includes('/api/owner')||r.url.includes('/api/port/register')));
  assert.ok([...c.storage.values()].every(v=>!v.includes('test-openid')&&!v.includes('test-server-secret')));
  await g.dispatch({type:'tab',tab:'account'});
  assert.equal(g.wechatLinked, true);
  const accountId = g.user.id, accountName = g.user.username;
  await g.dispatch({type:'webLogin'});
  const verificationCodes = [];
  env.app.ctx.verification.delivery = { emailReady: true, phoneReady: true,
    async sendEmail(address, code) { verificationCodes.push({ address, code }); },
    async sendSms() { throw new Error('unexpected SMS'); }, async checkSms() { return false; } };
  g.form.contactValue = 'creator@example.org';
  await g.dispatch({type:'sendContactCode'}); assert.equal(g.error, '');
  assert.equal(verificationCodes.at(-1).address, 'creator@example.org');
  g.form.contactCode = verificationCodes.at(-1).code;
  await g.dispatch({type:'verifyContactCode'}); assert.equal(g.error, '');
  assert.ok(g.user.contacts.email);
  g.form.password = 'shared-web-password'; g.form.confirmPassword = 'different-password';
  await g.dispatch({type:'saveWebPassword'}); assert.match(g.error, /不一致/);
  g.form.confirmPassword = 'shared-web-password';
  await g.dispatch({type:'saveWebPassword'}); assert.equal(g.error, '');
  assert.equal(g.user.id, accountId); assert.equal(g.user.passwordLoginEnabled, true);
  assert.equal(g.form.password, undefined); assert.equal(g.form.confirmPassword, undefined);
  assert.equal(env.rt.w.access.residents[id].managerAccountId, accountId);
  const webLogin = await env.call('/api/account/login', { method: 'POST', headers: { 'X-Houren-Request': '1' }, body: { username: accountName, password: 'shared-web-password' } });
  assert.equal(webLogin.status, 200); assert.equal(webLogin.json.user.id, accountId);
  const webResident = await env.call('/api/account/residents/' + id + '/private', { headers: { Cookie: webLogin.headers.get('set-cookie').split(';')[0] } });
  assert.equal(webResident.status, 200, webResident.text);
  env.app.ctx.accounts.commit(users => { delete users.find(user => user.id === accountId).contacts; });
  await g.loadAccount();
  await g.dispatch({ type: 'webLogin' });
  g.form.contactValue = 'legacy@example.org';
  await g.dispatch({ type: 'sendContactCode' });
  g.form.contactCode = verificationCodes.at(-1).code;
  g.form.currentPassword = 'wrong-password';
  await g.dispatch({ type: 'verifyContactCode' }); assert.match(g.error, /密码/);
  g.form.currentPassword = 'shared-web-password';
  await g.dispatch({ type: 'verifyContactCode' }); assert.equal(g.error, '');
  assert.equal(g.user.contacts.email, 'le***@example.org');
  assert.equal(g.form.currentPassword, '');
  const mergeTarget = await env.app.ctx.accounts.create({ username: 'merge_target', password: 'merge-target-password' }, { role: 'admin' });
  await g.dispatch({type:'mergeAccount'}); g.form.username = 'merge_target'; g.form.password = 'wrong-password';
  await g.dispatch({type:'previewMerge'}); assert.match(g.error, /密码/); assert.equal(g.user.id, accountId);
  g.form.password = 'merge-target-password';
  await g.dispatch({type:'previewMerge'}); assert.equal(g.error, ''); assert.equal(g.mergePreview.target.id, mergeTarget.id);
  assert.equal(g.form.password, undefined);
  await g.dispatch({type:'confirmMerge'}); assert.equal(g.error, ''); assert.equal(g.user.id, mergeTarget.id);
  assert.equal(env.rt.w.access.residents[id].managerAccountId, mergeTarget.id);
  assert.ok(g.linked.some(a => a.agentId === id));
  // 网站与微信端共用留言，普通小程序运行的是由相同 Canvas 源码构建的控制器。
  await g.dispatch({ type: 'messages' });
  assert.equal(g.tab, 'messages'); assert.equal(g.wechatVerified, true);
  const webCookie = 'houren_session=' + env.app.ctx.accounts.issue(g.user.id), webPost = { Cookie: webCookie, 'X-Houren-Request': '1' };
  const posted = await env.call('/api/messages', { method: 'POST', headers: webPost, body: { text: '来自网页的跨端留言' } });
  assert.ok(posted.status >= 200 && posted.status < 300, posted.text);
  const rootId = posted.json.message.id;
  const replied = await env.call(`/api/messages/${rootId}/replies`, { method: 'POST', headers: webPost, body: { text: '网页回复' } });
  assert.ok(replied.status >= 200 && replied.status < 300, replied.text);
  await g.dispatch({ type: 'messageRefresh' });
  for (let i = 0; i < 20 && g.messageBoard.roots[0]?.text !== '来自网页的跨端留言'; i++) { await new Promise(r => setTimeout(r, 10)); await g.dispatch({ type: 'messageRefresh' }); }
  assert.equal(g.error, ''); assert.equal(g.messageBoard.roots[0].id, rootId); assert.equal(g.messageBoard.roots[0].text, '来自网页的跨端留言');
  assert.ok(!g.hits.some(h => ['messageCompose', 'messageDelete', 'messageSubmit'].includes(h.action.type)), 'the board is read-only');
  await g.dispatch({ type: 'messageThread', id: rootId });
  for (let i = 0; i < 20 && g.messageBoard.replies.get(rootId).messages[0]?.text !== '网页回复'; i++) { await new Promise(r => setTimeout(r, 10)); await g.dispatch({ type: 'messageRefresh' }); }
  assert.equal(g.tab, 'messageThread'); assert.equal(g.messageBoard.replies.get(rootId).messages[0].text, '网页回复');
  const messageWrites = c.requests.filter(r => /\/messages/.test(r.url) && r.method && r.method !== 'GET').length;
  for (const action of [{ type: 'messageCompose', kind: 'new' }, { type: 'messageCompose', kind: 'reply', id: rootId }, { type: 'messageDelete', id: rootId }, { type: 'messageSubmit' }]) {
    await g.dispatch(action); assert.match(g.error, /小程序仅提供观测与已有记录查询/, action.type);
  }
  assert.equal(c.requests.filter(r => /\/messages/.test(r.url) && r.method && r.method !== 'GET').length, messageWrites);
  assert.ok(!c.requests.some(r => /\/api\/messages(?:[/?]|$)/.test(r.url)), '微信不读取未经投影的网页版接口');
  await g.dispatch({type:'logout'}); assert.equal(g.error,''); assert.equal(c.storage.size,0); assert.equal(g.user,null);
  assert.equal(g.messageBoard.roots.length, 0);
});
