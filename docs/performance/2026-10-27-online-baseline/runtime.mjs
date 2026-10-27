import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, platform, availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node runtime.mjs <checkout-root> <result-file>');
const base = resolve(process.argv[2]);
const resultFile = resolve(process.argv[3]);
const { Runtime } = await import(base + '/src/runtime.js');
const { loadConfig } = await import(base + '/src/config.js');
const { HistoryArchive } = await import(base + '/src/history/archive.js');
const { stateHash } = await import(base + '/src/store.js');
const { makeReceipt, applyReceipt } = await import(base + '/src/command-receipt.js');
const hiddenPhysicsFile = base + '/test/fixtures/p7-hidden-physics.json';
const median = xs => [...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)] ?? 0;
const results=[];
for (const records of [0, 5000, 20000]) {
  const dir = mkdtempSync(join(tmpdir(), 'as4-core-diag-data-'));
  let rt, history;
  try {
    const cfg = { ...loadConfig({}, []), dataDir:dir, worldId:'diagnostic', seed:'diagnostic', physics:2, premise:7, map:'island-three-v1', shellSlots:0, hiddenPhysicsFile };
    rt=Runtime.open(cfg,{version:'0.1.0',logger:{}});
    const ids=[];
    for(let i=0;i<12;i++) {
      const result=rt.exec('account',{op:'create',accountId:`diagnostic-${i}`,requestId:`create-diagnostic-${i}`,name:`诊断居民${i}`,soul:'合成性能夹具',lang:'zh',model:'diagnostic',dailyCap:5000000,city:['north','west','east'][i%3]}).result;
      if(!result.ok)throw Error(JSON.stringify(result));
      ids.push(result.agentId);
    }
    // Synthetic history is input padding only; no live server or real data are read.
    for(let i=0;i<records;i++) {
      const a=rt.w.agents[ids[i%ids.length]];
      rt.w.residentStats[a.id].ledger.push({commandN:0,tick:0,day:0,kind:'diagnostic',op:null,delta:{energy:0,basic:0,materials:0},balance:{energy:a.energy,basic:a.basic,materials:a.materials},events:[]});
    }
    rt.snapshot();
    const worldBytes=Buffer.byteLength(JSON.stringify(rt.w));
    history=new HistoryArchive(rt,{importArchives:false}); await history.ready;
    let sample;
    const originalEngine=rt.engine;
    rt.engine={...originalEngine,prepareCommand(w,cmd){const t=performance.now();const out=originalEngine.prepareCommand(w,cmd);sample.prepare=performance.now()-t;sample.prepareEnd=performance.now();return out;}};
    const appendReceipt=rt.log.appendReceipt.bind(rt.log);
    rt.log.appendReceipt=(cmd,receipt)=>{const t=performance.now();sample.receipt=t-sample.prepareEnd;const out=appendReceipt(cmd,receipt);sample.persist=performance.now()-t;sample.persistEnd=performance.now();return out;};
    const appendEvents=rt.events.append.bind(rt.events);
    rt.events.append=(...args)=>{const t=performance.now();sample.commit=t-sample.persistEnd;const out=appendEvents(...args);sample.events=performance.now()-t;return out;};
    const snapshot=rt.snapshot.bind(rt);
    rt.snapshot=()=>{const t=performance.now();snapshot();if(sample)sample.snapshot=performance.now()-t;};
    const samples=[];
    for(let i=0;i<14;i++) {
      sample={};const start=performance.now();const out=rt.tickNow();sample.exec=performance.now()-start;
      if(!out.result.ok)throw Error(JSON.stringify(out.result));
      const historyStart=performance.now();await history.flush();sample.history=performance.now()-historyStart;
      sample.settled=out.result.settled;sample.tick=rt.w.clock.tick;
      if(i>=2)samples.push(sample);
    }
    // Phase samples use the same live command preparation on a cloned fixture.
    const before=structuredClone(rt.w),cmd={n:rt.log.n+1,tick:rt.w.clock.tick,type:'tick',payload:{}};
    const prepared=originalEngine.prepareCommand(before,cmd);
    const receipt=makeReceipt(before,prepared.candidate,prepared.out);
    const replay=structuredClone(before);applyReceipt(replay,{...cmd,receipt});
    if(stateHash(replay)!==stateHash(prepared.candidate))throw Error('receipt replay mismatch');
    const normal=samples.filter(s=>!s.settled), daily=samples.filter(s=>s.settled);
    const summarize=rows=>Object.fromEntries(['exec','prepare','receipt','persist','commit','events','history','snapshot'].map(k=>[k,Number(median(rows.map(r=>r[k]??0)).toFixed(3))]));
    const row={syntheticLedgerRecords:records,residents:ids.length,worldBytes,normalCount:normal.length,normalMedianMs:summarize(normal),dailySamplesMs:daily.map(s=>Object.fromEntries(['tick','exec','prepare','receipt','persist','commit','events','history','snapshot'].map(k=>[k,typeof s[k]==='number'?Number(s[k].toFixed(3)):s[k]]))),rssBytes:process.memoryUsage().rss,receiptReplayMatched:true};
    results.push(row);console.log(JSON.stringify(row));
  } finally { if(history)await history.close(); if(rt)rt.close();rmSync(dir,{recursive:true,force:true}); }
}
const output={node:process.version,platform:platform(),availableParallelism:availableParallelism(),baseline:'609fd27245b1e95e4a9957a685c04827e5f4bebf',note:'Limited local online Runtime tick path with HistoryArchive, synthetic P7 residents/history; no HTTP listeners/models; not production capacity data.',results};
writeFileSync(resultFile,JSON.stringify(output,null,2));
