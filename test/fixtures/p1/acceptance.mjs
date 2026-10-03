// Reproducible mock-only acceptance. All state and fingerprint edits are in fresh temporary directories.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Runtime } from '../../../src/runtime.js';
import { loadConfig, applyConfig } from '../../../src/config.js';
import { createApp } from '../../../src/http/server.js';
import { createShellClient } from '../../../src/shells/client.js';
import { runAgent } from '../../../runner/agent.js';
import { buildSystemPrompt, promptParams } from '../../../runner/prompt.js';
import { replayDir } from '../../../src/tools/replay.js';

const logger={log(){},warn(){},error(...args){throw new Error(String(args[0]));}};
const providersLog={info(){},warn(){},error(){}};
export async function prepareAcceptance() {
  const directory=mkdtempSync(join(tmpdir(),'as4-p1-local-'));
  const codeRoot=join(directory,'code');mkdirSync(join(codeRoot,'src/e2'),{recursive:true});
  const probe=join(codeRoot,'src/e2/probe.js');writeFileSync(probe,'export const revision = 1;\n');
  const cfg=loadConfig({PHYSICS:'2',PREMISE:'1',SHELL_SLOTS:'16',WORLD_ID:'p1-local',DATA_DIR:join(directory,'data'),PORT:'0',TICK_MS:'900000',SEED:'p1-local-mock',FOUNDERS_FILE:fileURLToPath(new URL('./founders.json',import.meta.url)),ADMIN_KEY:'p1-mock-test-admin'},[]);
  applyConfig(cfg);
  let rt=Runtime.open(cfg,{version:'0.1.0',logger});let app=createApp(rt,cfg,{logger,backstageRoot:codeRoot});
  async function listen() {await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const port=app.server.address().port;assert.ok(![8787,8790,18789,18791,18792].includes(port));return `http://127.0.0.1:${port}`;}
  let base=await listen();
  const report={worldId:'p1-local',checks:{},calls:[]};
  const cleanup=async()=>{await app.close();rt.close();rmSync(directory,{recursive:true,force:true});};
  try {
    rt.exec('admin',{op:'shell_models',args:{models:['mock-a']}});rt.tickNow();
    const people=Object.values(rt.w.agents);assert.equal(people.length,10);
    const [a,b]=people;const cursors=new Map();let gift;
    async function driveB() {
      const offered=b.memoryOffers[0];assert.ok(offered);gift=offered.id;
      await runAgent({provider:'mock',lang:'zh'},{client:createShellClient(rt,b.id,{cursors}),provider:{complete:async()=>({text:JSON.stringify({actions:[{type:'remember',gift}]})})},maxRounds:1,wait:async()=>{},log:providersLog});
      assert.equal(b.memories[0].origin,a.id);report.checks.impartAndKeep=true;
    }
    await runAgent({provider:'mock',lang:'zh',actEveryTicks:1},{client:createShellClient(rt,a.id,{cursors}),provider:{complete:async({perception,system,messages})=>{
      const tick=perception.now.tick;const user=messages.at(-1).content;
      report.calls.push({tick,acquired:system.includes('【习得】这些不是记忆'),missed:user.includes('你上一次醒来是')});
      if(tick===4)throw new Error('mock deliberate failure');
      const actions=tick===1?[{type:'remember',text:'留下的一段知识'}]:tick===2?[{type:'impart',to:b.id,memory:0}]:tick===3?[{type:'internalize',memory:0}]:[];
      return{text:JSON.stringify({actions})};
    }},maxRounds:12,wait:async()=>{if(rt.w.clock.tick===2)await driveB();rt.tickNow();},log:providersLog});
    assert.equal(rt.w.clock.tick,13);assert.ok(report.calls.find(x=>x.tick===5).missed);report.checks.missedWaking=true;
    assert.ok(report.calls.find(x=>x.tick===12).acquired);report.checks.acquiredNextDay=true;
    const retire=rt.exec('act',{agentId:a.id,actions:[{type:'retire'}]}).result;assert.equal(retire.results[0].ok,true);
    // Fill the six never-used bodies before reusing b1, as the oldest-vacancy rule requires.
    for(let i=0;i<7;i++) {
      const parent=people[1+i%6];rt.exec('admin',{op:'adjust',args:{agentId:parent.id,energy:300,reason:'mock 验收出资'}});
      const child=rt.exec('act',{agentId:parent.id,actions:[{type:'conceive',name:i===6?'承接者':`新灵魂${i+1}号`,soul:'验收用新灵魂'}]}).result.results[0];assert.equal(child.ok,true,JSON.stringify(child));
      const funded=rt.exec('act',{agentId:parent.id,actions:[{type:'sponsor',soul:child.data.soul,energy:200}]}).result.results[0];assert.equal(funded.ok,true,JSON.stringify(funded));
    }
    while(rt.w.clock.tick<24)rt.tickNow();
    const child=Object.values(rt.w.agents).find(x=>x.name==='承接者');assert.ok(child);assert.equal(child.body.shellId,'b1');
    let p=rt.engine.buildPerception(rt.w,child.id,{ack:false});assert.deepEqual(p.you.trained,['留下的一段知识']);assert.ok(buildSystemPrompt(promptParams(p)).includes('【习得】'));report.checks.reusedAcquired=true;
    const response=await fetch(`${base}/api/admin/rebody`,{method:'POST',headers:{'content-type':'application/json','x-admin-key':cfg.adminKey},body:JSON.stringify({from:'mock-a',to:'mock-b'})});assert.equal(response.status,200);assert.equal((await response.json()).bodies,16);
    p=rt.engine.buildPerception(rt.w,child.id,{ack:false});assert.deepEqual(p.you.trained,[]);assert.ok(p.inbox.some(x=>x.code==='trained_lost'));report.checks.rebodyCleared=true;
    await app.close();rt.close();
    // Exact replacement in the temporary fingerprint root; no repository file is mutated.
    const old=readFileSync(probe,'utf8');assert.equal(old,'export const revision = 1;\n');writeFileSync(probe,old.replace('revision = 1','revision = 2'));
    rt=Runtime.open(cfg,{version:'0.1.0',logger});app=createApp(rt,cfg,{logger,backstageRoot:codeRoot});base=await listen();
    p=rt.engine.buildPerception(rt.w,child.id,{ack:false});assert.ok(p.inbox.some(x=>x.code==='backstage_code'));report.checks.restartCodeEvent=true;
    const state=await (await fetch(`${base}/api/public/state`)).json();assert.equal(state.world.premise,1);assert.equal(state.shells.bodies.length,16);assert.equal(state.weather.types.length,6);assert.ok(!JSON.stringify(state).includes('mock-a'));assert.ok(!JSON.stringify(state).includes('mock-b'));
    const adminView=await (await fetch(`${base}/api/admin/shells`,{headers:{'x-admin-key':cfg.adminKey}})).json();assert.equal(adminView.bodies.length,16);assert.equal(adminView.bodies[0].model,'mock-b');assert.ok(adminView.bodies[0].occupant.weight);
    const events=await (await fetch(`${base}/api/public/events?limit=500`)).json();assert.ok(events.events.some(x=>x.type==='backstage'&&x.data.kind==='code'));report.checks.publicAndAdminViews=true;
    const banned=await fetch(`${base}/api/public/weather/vote`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'aurora'})});assert.equal(banned.status,400);
    rt.snapshot();const replay=replayDir(rt.dir);assert.equal(replay.ok,true,replay.diff||'');assert.equal(rt.w.ledger.mismatches,0);report.checks.localReplay=true;
    report.tick=rt.w.clock.tick;report.days=rt.w.clock.tick/rt.engine.P.ticksPerDay;report.hash=replay.hash;report.commandCount=replay.applied;
    return {rt,app,cfg,base,directory,report,cleanup};
  } catch(error) {await cleanup();throw error;}
}
if(process.argv.includes('--serve')) {
  const env=await prepareAcceptance();console.log(JSON.stringify({base:env.base,report:env.report}));
  const end=async()=>{await env.cleanup();process.exit(0);};process.once('SIGINT',end);process.once('SIGTERM',end);
}
