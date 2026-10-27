import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { EventStore } from '../src/events.js';

test('event recovery preserves Unicode across read boundaries and repairs only the valid prefix', () => {
  const dir=mkdtempSync(join(tmpdir(),'houren-event-boundary-')),file=join(dir,'events.jsonl');
  try{
    const one={seq:1,tick:0,day:0,type:'say',vis:'public',data:{text:'字'.repeat(30000)}},two={...one,seq:2,data:{text:'第二条😀'}};
    const first=JSON.stringify(one)+'\n',second=JSON.stringify(two)+'\n';
    writeFileSync(file,first+second+'{"seq":3');
    const events=new EventStore(file);events.load({keepSeq:2});
    assert.equal(events.lastSeq,2);assert.equal(events.ring[0].data.text,one.data.text);assert.equal(readFileSync(file,'utf8'),first+second);
    events.load({keepSeq:1});assert.equal(readFileSync(file,'utf8'),first);
    writeFileSync(file,JSON.stringify(two));events.load({keepSeq:2});assert.equal(readFileSync(file,'utf8'),second);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a 36 MB event history recovers with a 40 MB JS heap and a bounded recent ring', () => {
  const dir=mkdtempSync(join(tmpdir(),'houren-event-memory-')),file=join(dir,'events.jsonl');
  try{
    writeFileSync(file,'');let lines=[];
    for(let seq=1;seq<=12000;seq++){
      lines.push(JSON.stringify({seq,tick:0,day:0,type:'say',vis:'public',data:{text:'x'.repeat(3000)}})+'\n');
      if(lines.length===100){appendFileSync(file,lines.join(''));lines=[];}
    }
    const script="import {EventStore} from './src/events.js';const events=new EventStore(process.argv[1]);events.load();console.log(events.lastSeq,events.ring.length);";
    const result=spawnSync(process.execPath,['--max-old-space-size=40','--input-type=module','-e',script,file],{encoding:'utf8',timeout:20000,windowsHide:true});
    assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'12000 2000');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
