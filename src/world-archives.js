import { receiptChecksum } from './command-receipt.js';
import { existsSync, readFileSync, mkdirSync, openSync, readSync, fstatSync, writeSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { engineOf } from './engines.js';
import { readSnapshot } from './store.js';
import { durableFile } from './durable-file.js';

export const archiveIndex = root => join(root, 'world-archives.json');
export const archivedWorlds = root => existsSync(archiveIndex(root)) ? JSON.parse(readFileSync(archiveIndex(root), 'utf8')).worlds : [];
export const archiveDirectory = (root, id) => join(root, 'public-archives', id);

function completeLines(file) {
  if(!existsSync(file))return;
  const fd=openSync(file,'r');
  try {const size=fstatSync(fd).size;if(size){const byte=Buffer.alloc(1);readSync(fd,byte,0,1,size-1);if(byte[0]!==10)throw Error('Incomplete log tail; refusing archive');}}
  finally{closeSync(fd);}
}

// Called offline after the old process has closed its snapshot and log.
// Original world, credentials, runners and account files are never rewritten.
export async function publishWorldArchive(root, id, codeVersion) {
  if(!/^[\w-]{1,100}$/.test(id))throw Error('Invalid world ID');
  const dir=join(root,id), w=readSnapshot(dir);
  if(!w||w.id!==id)throw Error('A complete existing world snapshot is required');
  if(archivedWorlds(root).some(a=>a.id===id))throw Error('World is already archived');
  completeLines(join(dir,'commands.jsonl'));completeLines(join(dir,'events.jsonl'));
  let last=0;
  for await(const line of createInterface({input:createReadStream(join(dir,'commands.jsonl')),crlfDelay:Infinity})){
    if(!line)continue;
    const frame=JSON.parse(line);
    if(frame.format&&frame.format!=='command-receipt-v1')throw Error('Unknown command frame');
    if(frame.format&&frame.sha256!==receiptChecksum(frame.command))throw Error('Command receipt checksum failed');
    const command=frame.format?frame.command:frame;
    if(command.n!==last+1)throw Error('Command log is not continuous');
    last=command.n;
  }
  if(last!==w.commandN)throw Error('World is not at a clean offline snapshot boundary');
  const engine=engineOf(w),destination=archiveDirectory(root,id),temporary=`${destination}.tmp`;
  mkdirSync(temporary,{recursive:true,mode:0o700});
  if((w.premise===6 || w.premise === 7))durableFile(join(temporary,'relations.json'),JSON.stringify(w.access.residents));
  // 私有：居民的灵魂原文与形象，只供原管理者或创作者在新世界新建居民时带入（docs/plans/2026-10-16-three-cities.md 决定 25），不公开
  if((w.premise===6 || w.premise === 7))durableFile(join(temporary,'souls.json'),JSON.stringify(Object.fromEntries(Object.values(w.agents).map(a=>[a.id,{name:a.name,lang:a.lang,bio:a.bio??'',soul:a.soul,avatar:a.avatar??null,status:a.status}]))));
  durableFile(join(temporary,'state.json'),JSON.stringify(engine.publicState(w,{nextTickAt:null})));
  const fd=openSync(join(temporary,'events.jsonl'),'w',0o600);
  let lastEvent=0;
  try {
    for await(const line of createInterface({input:createReadStream(join(dir,'events.jsonl')),crlfDelay:Infinity})){
      if(!line)continue;
      const event=JSON.parse(line);
      if(event.seq!==lastEvent+1)throw Error('Event log is not continuous');
      lastEvent=event.seq;
      if(event.seq>w.counters.event)throw Error('Event log exceeds snapshot');
      const shown=engine.publicEvent(w,event,{released:event.releaseTick<=w.clock.tick});
      if(shown)writeSync(fd,JSON.stringify(shown)+'\n');
    }
    if(lastEvent!==w.counters.event)throw Error('Event log does not reach snapshot boundary');
    fsyncSync(fd);
  }finally{closeSync(fd);}
  renameSync(temporary,destination);
  const parent=openSync(join(root,'public-archives'),'r');try{fsyncSync(parent);}finally{closeSync(parent);}
  const manifest={id,cityName:w.cityName,physics:engine.physics,premise:w.premise??0,tick:w.clock.tick,day:engine.clockDay(w),commandN:w.commandN,eventSeq:w.counters.event,archivedAt:new Date().toISOString(),codeVersion};
  durableFile(archiveIndex(root),JSON.stringify({version:1,worlds:[...archivedWorlds(root),manifest]}));
  return manifest;
}
