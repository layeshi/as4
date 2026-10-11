// Offline cutover preparation. Run after stopping the service; never --reset.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { loadConfig, applyConfig } from '../config.js';
import { Runtime } from '../runtime.js';
import { publishWorldArchive, archivedWorlds } from '../world-archives.js';

export async function prepareFreshWorld(cfg,{oldWorldId,newWorldId,oldCodeVersion}) {
  if(!/^[\w-]{1,100}$/.test(newWorldId)||newWorldId===oldWorldId)throw Error('Use a distinct, safe new world ID');
  if(existsSync(join(cfg.dataDir,newWorldId)))throw Error('The new world directory already exists; refusing to overwrite');
  if(archivedWorlds(cfg.dataDir).some(a=>a.id===oldWorldId))throw Error('Old world is already archived');
  const accounts=join(cfg.dataDir,'accounts.json'),digest=()=>existsSync(accounts)?createHash('sha256').update(readFileSync(accounts)).digest('hex'):null,before=digest();
  const next={...cfg,worldId:newWorldId,physics:2,premise:6,map:'compact-materials-v1',weatherMode:'random',reset:false,demo:false,sandboxAgents:0,foundersFile:null,shellsFile:null,shellSlots:0};
  applyConfig(next);
  const rt=Runtime.open(next,{version:'0.1.0',logger:{}});
  try {
    if(Object.keys(rt.w.agents).length||Object.keys(rt.w.publicRoles).length!==10)throw Error('New world genesis invariant failed');
    for(const name of ['commands.jsonl','events.jsonl'])if(!existsSync(join(rt.dir,name)))writeFileSync(join(rt.dir,name),'',{mode:0o600,flag:'wx'});
    const archive=await publishWorldArchive(cfg.dataDir,oldWorldId,oldCodeVersion);
    if(before!==digest())throw Error('Account preservation invariant failed');
    return {oldWorld:archive.id,newWorld:rt.w.id,ordinaryResidents:0,publicRoles:10,accountsPreserved:true,archive};
  }finally{rt.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [oldWorldId,newWorldId,oldCodeVersion]=process.argv.slice(2);
  if(!oldWorldId||!newWorldId||!oldCodeVersion||!process.argv.includes('--offline'))throw Error('Usage: node src/tools/fresh-world.js OLD_ID NEW_ID OLD_RELEASE --offline (service must be stopped)');
  const cfg=loadConfig(process.env,[],{defaultPhysics:2});
  console.log(JSON.stringify(await prepareFreshWorld(cfg,{oldWorldId,newWorldId,oldCodeVersion})));
}
