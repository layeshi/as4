import {tmpdir} from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { boot } from './http-helpers.js';

const source = fileURLToPath(new URL('../wechat/miniprogram/', import.meta.url));
function client(base, { intercept } = {}) {
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
    const ctx = { scale() {}, fillRect() {}, strokeRect() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}, fillText() {}, measureText(text) { return { width: Array.from(text).length * 8 }; } };
    wx.createCanvas = () => ({ getContext: () => ctx }); wx.getWindowInfo = () => ({ windowWidth: 375, windowHeight: 812, pixelRatio: 2, statusBarHeight: 28, safeArea: { bottom: 790 } });
    for (const name of ['TouchStart', 'TouchMove', 'TouchEnd', 'Hide', 'Show', 'WindowResize', 'KeyboardConfirm', 'KeyboardComplete', 'ShareAppMessage']) wx['on' + name] = fn => { wx['emit' + name] = fn; };
    wx.login = options => options.success({code:'test-wechat-code'}); wx.showKeyboard = () => {}; wx.hideKeyboard = () => {}; wx.showShareMenu = () => {};
    wx.setClipboardData = options => { wx.copied = options.data; options.success({}); };
    const { SocietyGame } = load(resolve(source, '../minigame/society.js'));
    return new SocietyGame();
  }
  return { api: load(resolve(source, '../minigame/utils/api.js')), view: load(resolve(source, 'utils/view.js')), page, game, wx, app, storage, requests, timers };
}

test('P6 miniGame integration: WeChat login, creation, private authorization, letters and session logout', async t => {
  const dir=mkdtempSync(resolve(tmpdir(),'houren-wx-p6-')), file=resolve(dir,'physics.json');
  writeFileSync(file, JSON.stringify({version:1,regrowth:{baseByZone:{wilds:20,scrapyard:15,solarfield:10},thresholdByZone:{wilds:30,scrapyard:25,solarfield:15},factorPermille:500},construction:{fullActionsPerTick:2,factorPermille:500}}));
  const env = await boot({ physics: 2, premise: 6, shellSlots:0, hiddenPhysicsFile:file, map: 'compact-materials-v1', wechatAppId: 'wx216f3fb724629f67', wechatAppSecret: 'test-server-secret' }, {dir}); t.after(() => env.close());
  env.app.ctx.wechat.fetcher = async url => ({ok:true,json:async()=>url.pathname === '/sns/jscode2session' ? {openid:'test-openid-123456'} : url.pathname === '/cgi-bin/token' ? {access_token:'test-token',expires_in:7200} : {errcode:0,result:{suggest:'pass'}}});
  const c = client(env.base), g = c.game();
  await g.start();
  assert.equal(g.tab,'startup'); assert.equal(c.requests.length,0); assert.equal(c.timers.size,0);
  assert.ok(g.blocks.some(b=>b.text==='适龄提示：16 岁及以上'));
  assert.ok(g.blocks.some(b=>b.text==='抵制不良游戏，拒绝盗版游戏。注意自我保护，谨防受骗上当。适度游戏益脑，沉迷游戏伤身。合理安排时间，享受健康生活。'));
  assert.ok(!g.hits.some(h=>h.action.type==='tab'));
  c.wx.emitHide(); c.wx.emitShow(); assert.equal(g.tab,'startup'); assert.equal(c.requests.length,0);
  await g.dispatch({type:'tab',tab:'account'}); assert.equal(g.tab,'startup'); assert.equal(c.requests.length,0);
  await g.dispatch({type:'start'}); assert.equal(g.state.world.premise, 6); assert.ok(g.hits.some(h=>h.action.kind==='place'));
  c.wx.emitHide(); assert.equal(c.timers.size,0);
  await g.dispatch({type:'tab',tab:'account'}); await g.dispatch({type:'wechatLogin'}); assert.match(g.error,/隐私/);
  g.form.accepted=true; await g.dispatch({type:'wechatLogin'}); assert.equal(g.error,''); assert.equal(g.user.role,'user'); assert.equal(g.wechatVerified,true);
  await g.dispatch({type:'entry'}); Object.assign(g.form,{name:'小游戏居民',soul:'独立观察这座城市',entryAccepted:true});
  await g.dispatch({type:'create'}); assert.equal(g.error,''); assert.ok(g.residentId); assert.equal(g.tab,'owner');
  const id=g.residentId, relation=env.rt.w.access.residents[id]; assert.equal(relation.managerAccountId,g.user.id);
  g.form.letter='一封来自微信的家书'; await g.dispatch({type:'letter'}); assert.equal(g.error,''); assert.equal(env.rt.w.agents[id].letters.at(-1).text,'一封来自微信的家书');
  const stranger=await env.app.ctx.accounts.create({username:'stranger',password:'test-other-password'});
  const token=env.app.ctx.accounts.issue(stranger.id);
  assert.equal((await env.call('/api/wechat/residents/'+id+'/private',{headers:{Cookie:'houren_session='+token}})).status,403);
  assert.ok(c.requests.some(r=>r.url.includes('/api/wechat/public/state')));
  assert.ok(!c.requests.some(r=>r.url.includes('/api/owner')||r.url.includes('/api/port/register')));
  assert.ok([...c.storage.values()].every(v=>!v.includes('test-openid')&&!v.includes('test-server-secret')));
  await g.dispatch({type:'tab',tab:'account'}); await g.dispatch({type:'logout'}); assert.equal(g.error,''); assert.equal(c.storage.size,0); assert.equal(g.user,null);
});
