import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { stateHash } from '../src/store.js';
import { detectResources, linuxLimits, ByteCache, ResourceBudget } from '../src/compute/resources.js';
import { HistoryArchive } from '../src/history/archive.js';
import { boot } from './http-helpers.js';
import { gunzipSync } from 'node:zlib';
import { WorldSnapshots } from '../src/world-snapshots.js';
import { commandAuthority } from '../src/compute/authority.js';
import { updateMirror } from '../src/compute/online.js';
import { PublicRoleService } from '../src/runner/public-roles.js';

const fixture = fileURLToPath(new URL('./fixtures/p7-hidden-physics.json', import.meta.url));
const options = { physics: 2, premise: 7, map: 'island-three-v1', shellSlots: 0, hiddenPhysicsFile: fixture, computeWorkers: 4 };
const testResources={readers:{freemem:()=>1024*1024*1024}};
function world(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'houren-compute-'));
  const cfg = { ...loadConfig({}, []), ...options, dataDir: dir, worldId: 'w', seed: 'adaptive-test', ...extra };
  const rt = Runtime.open(cfg, { version: '0.1.0', logger: {} });
  return { rt, cfg, async close() { await rt.closeAsync(); rmSync(dir, { recursive: true, force: true }); } };
}
const create = i => ({ op: 'create', accountId: `account-${i}`, requestId: `create-resident-${i}`, name: `计算居民${i}`, soul: '测试', model: 'mock', lang: 'zh', dailyCap: 5000000, city: ['north','west','east'][i % 3] });

test('resource configuration validates overrides and preserves fractional CPU quotas', () => {
  assert.equal(loadConfig({ RESOURCE_CPU_LIMIT: '0.5' }).resourceCpu, 0.5);
  for (const env of [{ COMPUTE_WORKERS: '1.5' }, { RESOURCE_MEMORY_MB: '-1' }, { COMPUTE_QUEUE_LIMIT: '0' }, { WORLD_EXECUTION_MODE: 'cluster' }]) assert.throws(() => loadConfig(env));
  const r = detectResources({ resourceCpu: 16, resourceMemoryMb: 8192 }, { platform: 'darwin', parallelism: () => 64, totalmem: () => 64 * 1073741824, constrained: () => 0, freemem: () => 20 * 1073741824 });
  assert.equal(r.slots, 14); assert.equal(r.budget, 6 * 1073741824); assert.equal(r.cacheBytes, r.budget / 10);
});

test('cgroup membership and ancestor quotas constrain CPU and memory despite larger host resources', () => {
  const files = {
    '/proc/self/cgroup': '0::/tenant/app',
    '/proc/self/mountinfo': '30 20 0:28 / /sys/cg rw - cgroup2 cgroup rw',
    '/sys/cg/tenant/app/cpu.max': '400000 100000', '/sys/cg/tenant/cpu.max': '150000 100000',
    '/sys/cg/tenant/memory.max': '2147483648', '/sys/cg/tenant/memory.current': '1073741824',
    '/sys/cg/tenant/app/memory.high': '1610612736',
  };
  const read = p => { if (!(p in files)) throw Error('absent'); return files[p]; };
  const limits = linuxLimits(read);
  assert.equal(limits.cpu, 1.5); assert.equal(limits.memory, 2147483648); assert.equal(limits.available, 1073741824);
  const r = detectResources({}, { platform: 'linux', read, parallelism: () => 32, totalmem: () => 64 * 1073741824, constrained: () => 0, freemem: () => 32 * 1073741824 });
  assert.equal(r.slots, 1); assert.equal(r.budget, 1610612736); assert.equal(r.constraintSource, 'cgroup');
});

test('delegated cgroup v1 mounts and Windows capability fallback', () => {
  const files = { '/proc/self/cgroup': '5:cpu,cpuacct:/tenant/app\n6:memory:/tenant/app', '/proc/self/mountinfo': '30 20 0:28 /tenant /cg/cpu rw - cgroup cgroup rw,cpu,cpuacct\n31 20 0:29 /tenant /cg/mem rw - cgroup cgroup rw,memory', '/cg/cpu/app/cpu.cfs_quota_us': '50000', '/cg/cpu/app/cpu.cfs_period_us': '100000', '/cg/mem/memory.limit_in_bytes': '1073741824', '/cg/mem/memory.usage_in_bytes': '268435456' };
  const limits = linuxLimits(p => { if (!(p in files)) throw Error(); return files[p]; });
  assert.equal(limits.cpu, 0.5); assert.equal(limits.memory, 1073741824);
  const r = detectResources({}, { platform: 'win32', parallelism: () => 8, totalmem: () => 8 * 1073741824, constrained: () => 0, freemem: () => 1073741824 });
  assert.equal(r.slots, 7); assert.match(r.constraintSource, /job limits unknown/);
});

test('byte cache evicts by actual bytes and aggregate RSS is counted once', () => {
  const c = new ByteCache(6); c.set('a', '中文'); c.set('b', 'x'); assert.equal(c.get('a'), undefined); assert.equal(c.bytes, 1);
  c.set('b', 'abc'); c.set('c', 'def'); c.get('b'); c.set('d','x'); assert.equal(c.get('c'), undefined); assert.ok(c.bytes <= 6);
  const b = new ResourceBudget({}, { platform:'darwin', parallelism:()=>8,totalmem:()=>1000,constrained:()=>0,freemem:()=>1000,rss:()=>500 });
  b.reserved = 100; assert.equal(b.canRun(151),false); assert.equal(b.canRun(150),true);
});

test('mirror accepts own JSON keys named constructor and rejects inherited prototype paths', () => {
  const w=JSON.parse('{"dict":{"constructor":{"prototype":{"value":1}}}}');
  updateMirror(w,[{path:['dict','constructor','prototype','value'],value:2}]);
  assert.equal(w.dict.constructor.prototype.value,2);
  assert.throws(()=>updateMirror(w,[{path:['__proto__','polluted'],value:true}]),/Invalid mirror path/);
  assert.equal({}.polluted,undefined);
});

test('resident commands, tick results and recovery match the synchronous engine across worker boundaries', async () => {
  const inline = world(), parallel = world();
  try {
    await parallel.rt.enableCompute(testResources); assert.equal(parallel.rt.compute.mode, 'worker');
    const expected = Array.from({length:6},(_,i)=>inline.rt.exec('account',create(i)).result);
    const actual = await Promise.all(Array.from({length:6},(_,i)=>parallel.rt.submit('account',create(i)).then(r=>r.result)));
    assert.deepEqual(actual,expected);
    for(let i=0;i<14;i++) { assert.deepEqual((await parallel.rt.submit('tick')).result,inline.rt.exec('tick').result); }
    assert.equal(stateHash(parallel.rt.w),stateHash(inline.rt.w));
    assert.throws(()=>parallel.rt.exec('tick'),/must use submit/);
    const hash=stateHash(parallel.rt.w); await parallel.rt.closeAsync();
    const restored=Runtime.open(parallel.cfg,{version:'0.1.0',logger:{}});
    assert.equal(stateHash(restored.w),hash); restored.close();
    assert.ok(parallel.rt.compute.heapLimit > 0);
  } finally { await inline.close(); await parallel.close(); }
});

test('authority revoked while computing discards candidate without logging or changing the world', async () => {
  const e=world();
  try {
    await e.rt.enableCompute(testResources); const computer=e.rt.compute, original=computer.call.bind(computer); let allowed=true;
    computer.call=async(op,cmd)=>{const value=await original(op,cmd);if(op==='prepare')allowed=false;return value;};
    const before=stateHash(e.rt.w), n=e.rt.log.n;
    await assert.rejects(e.rt.submit('tick',{}, {authorize:()=>{if(!allowed)throw Error('revoked');}}),/revoked/);
    assert.equal(e.rt.log.n,n); assert.equal(stateHash(e.rt.w),before);
    computer.call=original; await e.rt.submit('tick'); assert.equal(e.rt.log.n,n+1);
  } finally { await e.close(); }
});

test('durable append failure stops writes and recovery applies the recorded receipt exactly once', async () => {
  const e=world();
  try {
    await e.rt.enableCompute(testResources); const before=e.rt.w.commandN, append=e.rt.log.appendReceipt.bind(e.rt.log);
    e.rt.log.appendReceipt=(...args)=>{append(...args);throw Error('after fsync');};
    await assert.rejects(e.rt.submit('tick'),/after fsync/); assert.equal(e.rt.receiptFailed,true);
    await assert.rejects(e.rt.submit('tick')); await e.rt.closeAsync();
    const recovered=Runtime.open(e.cfg,{version:'0.1.0',logger:{}});
    assert.equal(recovered.w.commandN,before+1); assert.equal(recovered.w.clock.tick,1); recovered.close();
  } finally { await e.close(); }
});

test('world queue is bounded and shutdown drains an admitted command', async () => {
  const e=world({computeQueueLimit:1});
  try {
    await e.rt.enableCompute(testResources); const first=e.rt.submit('tick');
    await assert.rejects(e.rt.submit('tick'), {code:'compute_busy'});
    const closing=e.rt.closeAsync(); await first; await closing; assert.equal(e.rt.w.clock.tick,1);
  } finally { await e.close(); }
});

test('inline mode keeps subscriber commands in the same ordered asynchronous queue', async () => {
  const e=world({worldExecution:'inline'}); let follow;
  try {
    await e.rt.enableCompute(testResources); const n=e.rt.log.n;
    const off=e.rt.onCommand(({cmd})=>{if(cmd.n===n+1)follow=e.rt.submit('tick');});
    await e.rt.submit('tick'); await follow; off();
    assert.equal(e.rt.w.commandN,n+2); assert.equal(e.rt.w.clock.tick,2);
  } finally { await e.close(); }
});

test('automatic tick does not inherit an expired administrator request context', async () => {
  const e=world({tickMs:30}); let allowed=true;
  try {
    await e.rt.enableCompute(testResources);
    commandAuthority.run(()=>{if(!allowed)throw Error('expired session');},()=>e.rt.start());
    allowed=false;
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('automatic clock did not advance')),2000);
      const off=e.rt.onCommand(({cmd})=>{if(cmd.type==='tick'){clearTimeout(timeout);off();resolve();}});
    });
    assert.ok(e.rt.w.clock.tick>0);
  } finally { await e.close(); }
});

test('lost commit acknowledgement never permits another write and recovers the committed outcome', async () => {
  const e=world();
  try {
    await e.rt.enableCompute(testResources); const call=e.rt.compute.call.bind(e.rt.compute),n=e.rt.log.n;
    e.rt.compute.call=async(op,cmd)=>{const value=await call(op,cmd);if(op==='commit')throw Error('lost acknowledgement');return value;};
    await assert.rejects(e.rt.submit('tick'),/lost acknowledgement/); assert.equal(e.rt.receiptFailed,true);
    await assert.rejects(e.rt.submit('tick')); await e.rt.closeAsync();
    const restored=Runtime.open(e.cfg,{version:'0.1.0',logger:{}});
    assert.equal(restored.w.commandN,n+1); assert.equal(restored.w.clock.tick,1); restored.close();
  } finally { await e.close(); }
});

test('background snapshot captures a committed boundary while subsequent ticks continue', async () => {
  const e=world();
  try {
    await e.rt.enableCompute(testResources); const snapshots=new WorldSnapshots(e.rt);
    const saved=snapshots.save({label:'worker snapshot'}); const ticking=e.rt.submit('tick');
    const manifest=await saved; await ticking;
    const data=JSON.parse(gunzipSync(readFileSync(snapshots.download(manifest.id))));
    const snapshot=JSON.parse(data.files['snapshot.json']);
    assert.equal(snapshot.commandN,manifest.commandN); assert.equal(stateHash(snapshot),manifest.stateHash);
    const frames=data.files['commands.jsonl'].trim().split('\n').map(JSON.parse);
    assert.equal(frames.at(-1).command.n,manifest.commandN); assert.ok(e.rt.w.commandN>=manifest.commandN);
  } finally { await e.close(); }
});

test('isolated resident programs execute in the world worker with unchanged command receipts', async () => {
  const e=await boot(options);
  try {
    const id=e.rt.exec('account',create(0)).result.agentId; await e.rt.enableCompute(testResources);
    const {wakeCore}=await import('../src/http/tokens.js'),{actCore}=await import('../src/http/agent.js');
    const wake=(await wakeCore(e.app.ctx,id,{kind:'main'},'zh')).json;
    const saved=await actCore(e.app.ctx,id,{wakeId:wake.wakeId,requestId:'worker-program-save',experimentGeneration:0,actions:[{type:'program',op:'save',title:'求和',description:'求和',inputDescription:'数字列表',code:'return input.reduce((a,b)=>a+b,0);'}]},'zh');
    assert.equal(saved.json.results[0].ok,true,JSON.stringify(saved));
    const pg=saved.json.results[0].data.program;
    const next=(await wakeCore(e.app.ctx,id,{kind:'main'},'zh')).json;
    const tested=await actCore(e.app.ctx,id,{wakeId:next.wakeId,requestId:'worker-program-test',experimentGeneration:0,actions:[{type:'program',op:'test',program:pg,input:'[2,3,5]'}]},'zh');
    assert.equal(tested.json.results[0].data.output,'10');
  } finally { await e.rt.closeAsync(); await e.close(); }
});

test('concurrent action retries update a resident session and its next reread charge once', async () => {
  const e = await boot(options);
  try {
    const id = e.rt.exec('account', create(0)).result.agentId;
    await e.rt.enableCompute(testResources);
    const { wakeCore, lookCore } = await import('../src/http/tokens.js');
    const { actCore } = await import('../src/http/agent.js');
    const { rereadCost } = await import('../src/e2/engine/tokens.js');
    const wake = (await wakeCore(e.app.ctx, id, { kind: 'main' }, 'zh')).json;
    const session = e.app.ctx.wakings.get(id), before = session.ctx;
    const body = { wakeId: wake.wakeId, requestId: 'concurrent-action-retry', turn: 1, experimentGeneration: 0, thought: '记住这一段行动上下文。', actions: [{ type: 'say', text: '查看当前地点与公开规则。' }] };
    const [a, b] = await Promise.all([actCore(e.app.ctx, id, body, 'zh'), actCore(e.app.ctx, id, body, 'zh')]);
    assert.equal(a.status, 200); assert.deepEqual(a, b);
    assert.equal(session.ctx - before, a.json.writeWeight);
    assert.equal(session.requests, 1);
    const expected = rereadCost(session.ctx - session.fresh);
    const looked = await lookCore(e.app.ctx, id, { wakeId: wake.wakeId, what: 'place', turn: 2 }, 'zh');
    assert.equal(looked.status, 200);
    assert.equal(looked.json.bill.reread - a.json.bill.reread, expected);
  } finally { await e.rt.closeAsync(); await e.close(); }
});

test('background history runs in workers, caches fixed cutoffs, and reapplies redaction on new versions', async () => {
  const e=world(); let history;
  try {
    const id=e.rt.exec('account',create(0)).result.agentId;
    history=new HistoryArchive(e.rt,{importArchives:false}); await history.ready;
    await e.rt.enableCompute(testResources);
    const a=await history.residentRecords(history.branchId,id); const b=await history.residentRecords(history.branchId,id);
    assert.deepEqual(a,b); assert.ok(e.rt.compute.cache.hits>0); assert.ok(e.rt.compute.pool.workers.size>0);
    await e.rt.submit('tick'); await history.flush();
    const current=await history.residentRecords(history.branchId,id); assert.ok(e.rt.compute.cache.misses>1);
    const seq=current.find(row=>row.seq)?.seq; assert.ok(seq);
    history.branch().redacted.push(seq);
    const redacted=await history.residentRecords(history.branchId,id); assert.deepEqual(redacted.find(row=>row.seq===seq).data,{redacted:true});
  } finally { await history?.close(); await e.close(); }
});

test('HTTP account creation, resource status and admin tick operate with a real world worker', async () => {
  const e=await boot(options);
  try {
    await e.rt.enableCompute(testResources);
    const setup=await e.call('/api/account/setup',{method:'POST',body:{username:'operator',displayName:'管理员',password:'long-enough-password',adminKey:e.cfg.adminKey},headers:{'X-Houren-Request':'1'}});
    assert.equal(setup.status,201); const cookie=setup.headers.get('set-cookie').split(';')[0];
    const r=await e.call('/api/account/residents',{method:'POST',body:{requestId:'worker-resident-test',name:'工作线程居民',soul:'测试',city:'north',dailyCap:5000000},headers:{Cookie:cookie,'X-Houren-Request':'1'}});
    assert.equal(r.status,201,JSON.stringify(r.json));
    const status=await e.call('/api/admin/server-status',{headers:{Cookie:cookie}});
    assert.equal(status.status,200); assert.equal(status.json.compute.mode,'worker');
    assert.equal((await e.call('/api/admin/tick',{method:'POST',body:{},headers:{'X-Admin-Key':e.cfg.adminKey}})).status,200);
  } finally { await e.rt.closeAsync(); await e.close(); }
});

test('owner bearer credentials continue working in threaded legacy worlds', async () => {
  const e=await boot({physics:2,map:'frontier'});
  try {
    const a=await e.register('造者权限线程验证'); await e.rt.enableCompute(testResources);
    const r=await e.call('/api/owner/letter',{method:'POST',body:{text:'一封测试家书'},headers:{Authorization:`Bearer ${a.ownerKey}`}});
    assert.equal(r.status,200,JSON.stringify(r.json)); assert.equal(e.rt.w.agents[a.agentId].letters.at(-1).text,'一封测试家书');
  } finally {await e.rt.closeAsync();await e.close();}
});

test('HTTP logout during candidate preparation revokes the queued write before persistence', async () => {
  const e=await boot(options);
  try {
    await e.rt.enableCompute(testResources);
    const setup=await e.call('/api/account/setup',{method:'POST',body:{username:'operator',displayName:'管理员',password:'long-enough-password',adminKey:e.cfg.adminKey},headers:{'X-Houren-Request':'1'}});
    const cookie=setup.headers.get('set-cookie').split(';')[0], token=cookie.slice(cookie.indexOf('=')+1), n=e.rt.log.n;
    const call=e.rt.compute.call.bind(e.rt.compute);
    e.rt.compute.call=async(op,cmd)=>{const result=await call(op,cmd);if(op==='prepare')e.app.ctx.accounts.logout(token);return result;};
    const response=await e.call('/api/account/residents',{method:'POST',body:{requestId:'revoked-create',name:'不应创建',soul:'测试',city:'north',dailyCap:5000000},headers:{Cookie:cookie,'X-Houren-Request':'1'}});
    assert.equal(response.status,401,JSON.stringify(response.json)); assert.equal(e.rt.log.n,n); assert.equal(Object.keys(e.rt.w.agents).length,0);
  } finally {await e.rt.closeAsync();await e.close();}
});

test('resident transfers revalidate both accounts after worker preparation', async () => {
  for (const accepting of [false, true]) {
    const e = await boot(options);
    try {
      const sender = await e.app.ctx.accounts.create({ username: 'sender', password: 'long-enough-password' });
      const target = await e.app.ctx.accounts.create({ username: 'target', password: 'long-enough-password' });
      const id = e.rt.exec('account', { ...create(0), accountId: sender.id }).result.agentId;
      let transferId;
      if (accepting) {
        const invitation = e.rt.exec('account', { op: 'transfer', agentId: id, accountId: sender.id, ownershipRevision: 1, to: target.id, now: Date.now(), requestId: 'prepare-transfer' }).result;
        assert.equal(invitation.ok, true, JSON.stringify(invitation)); transferId = invitation.transferId;
      }
      await e.rt.enableCompute(testResources);
      const actor = accepting ? target : sender;
      const cookie = `houren_session=${e.app.ctx.accounts.issue(actor.id)}`;
      const call = e.rt.compute.call.bind(e.rt.compute), n = e.rt.log.n;
      e.rt.compute.call = async (op, cmd) => {
        const result = await call(op, cmd);
        if (op === 'prepare') await e.app.ctx.accounts.update(accepting ? sender.id : target.id, { status: 'disabled' }, { admin: true });
        return result;
      };
      const path = accepting ? `/api/account/transfers/${transferId}/accept` : `/api/account/residents/${id}/transfer`;
      const body = accepting ? { config: { provider: 'mock' }, dailyCap: 5000000, requestId: 'accept-after-disable' } : { username: 'target', requestId: 'invite-after-disable' };
      const response = await e.call(path, { method: 'POST', body, headers: { Cookie: cookie, 'X-Houren-Request': '1' } });
      assert.equal(response.status, accepting ? 409 : 404, JSON.stringify(response.json));
      assert.equal(e.rt.log.n, n);
      assert.equal(e.rt.w.access.residents[id].managerAccountId, sender.id);
      if (accepting) assert.equal(e.rt.w.access.transfers[transferId].status, 'pending');
    } finally { await e.rt.closeAsync(); await e.close(); }
  }
});

test('public role replies remain single-flight while a world command holds the queue', async () => {
  for (const source of ['fixed', 'outbox', 'cancel']) {
    const e = world({ computeQueueLimit: 3 }); let service, release;
    try {
      const id = e.rt.exec('account', create(0)).result.agentId;
      e.rt.exec('meter', { op: 'wake', agentId: id, wakeId: 'guide-wake', day: '2026-10-27', kind: 'main', system: 0, brief: 0, delivered: 0 });
      const question = e.rt.exec('act', { agentId: id, requestId: 'guide-question', experimentGeneration: 0, meter: { wakeId: 'guide-wake', day: '2026-10-27', reread: 0 }, actions: [{ type: 'say', text: '如何查看地点？', publicRoleId: 'guide-north' }] }).result.results[0];
      assert.equal(question.ok, true, JSON.stringify(question));
      const request = e.rt.w.roleRequests[question.data.requestId];
      service = new PublicRoleService({ rt: e.rt, cfg: e.cfg });
      if (source === 'outbox') service.budget.outbox[request.id] = { text: '查看当前公开地点。', source: 'model' };
      if (source === 'cancel') request.generation = 999;
      await e.rt.enableCompute(testResources);
      const call = e.rt.compute.call.bind(e.rt.compute), n = e.rt.log.n;
      let entered;
      const preparing = new Promise(resolve => { entered = resolve; });
      const held = new Promise(resolve => { release = resolve; });
      e.rt.compute.call = async (op, cmd) => {
        const value = await call(op, cmd);
        if (op === 'prepare' && cmd.type === 'tick') { entered(); await held; }
        return value;
      };
      const tick = e.rt.submit('tick'); await preparing;
      service.pump(); service.pump(); service.pump();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(service.view().active, 1, source);
      assert.equal(service.view().storageFault, false, source);
      assert.equal(e.rt.compute.queue, 2, source);
      release(); await tick; await e.rt.compute.tail;
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(e.rt.log.n, n + 2, source);
      assert.equal(request.status, source === 'cancel' ? 'cancelled' : 'answered', source);
      assert.equal(service.view().storageFault, false, source);
    } finally { release?.(); await service?.close(); await e.close(); }
  }
});

test('recovered public role replies retry after a full world queue without repeating model calls', async () => {
  const e = world({ computeQueueLimit: 1 }); let service, release;
  try {
    const id = e.rt.exec('account', create(0)).result.agentId;
    e.rt.exec('meter', { op: 'wake', agentId: id, wakeId: 'guide-wake', day: '2026-10-27', kind: 'main', system: 0, brief: 0, delivered: 0 });
    const question = e.rt.exec('act', { agentId: id, requestId: 'guide-question', experimentGeneration: 0, meter: { wakeId: 'guide-wake', day: '2026-10-27', reread: 0 }, actions: [{ type: 'say', text: '如何查看地点？', publicRoleId: 'guide-north' }] }).result.results[0];
    assert.equal(question.ok, true, JSON.stringify(question));
    const request = e.rt.w.roleRequests[question.data.requestId];
    let calls = 0;
    service = new PublicRoleService({ rt: e.rt, cfg: e.cfg }, { provider: { complete() { calls++; throw Error('ambiguous recovered request must not call a model'); } } });
    service.save({ provider: 'mock' });
    service.budget.reservations[request.id] = { day: service.view().day, amount: 512 }; service.persist();
    const provider = service.providerOverride;
    await service.close(); service = new PublicRoleService({ rt: e.rt, cfg: e.cfg }, { provider });
    await e.rt.enableCompute(testResources);
    const call = e.rt.compute.call.bind(e.rt.compute);
    let entered;
    const preparing = new Promise(resolve => { entered = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    e.rt.compute.call = async (op, cmd) => {
      const value = await call(op, cmd);
      if (op === 'prepare' && cmd.type === 'tick') { entered(); await held; }
      return value;
    };
    const tick = e.rt.submit('tick'); await preparing;
    service.pump(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(service.view().storageFault, false);
    assert.ok(service.recovered.has(request.id));
    release(); await tick;
    const used = service.view().used;
    await service.close(); service = new PublicRoleService({ rt: e.rt, cfg: e.cfg }, { provider });
    service.pump(); await e.rt.compute.tail;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(request.status, 'answered'); assert.equal(service.view().storageFault, false);
    assert.equal(service.budget.outbox[request.id], undefined);
    assert.equal(service.recovered.has(request.id), false); assert.equal(calls, 0);
    assert.equal(service.view().used, used);
  } finally { release?.(); await service?.close(); await e.close(); }
});
