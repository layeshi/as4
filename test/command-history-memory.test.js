import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, openSync, writeSync, closeSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('recovering the sequence and selecting a tail does not retain the whole command file', t => {
  const dir = mkdtempSync(join(tmpdir(), 'history-memory-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'commands.jsonl'), fd = openSync(file, 'w');
  const padding = 'x'.repeat(64 * 1024);
  try { for (let n = 1; n <= 1024; n++) writeSync(fd, JSON.stringify({ n, tick: n, type: 'test', payload: { padding } }) + '\n'); }
  finally { closeSync(fd); }
  writeFileSync(join(dir, 'package.json'), JSON.stringify({version:'0.1.0'}));
  writeFileSync(join(dir, 'REVISION'), 'a'.repeat(40));
  writeFileSync(join(dir, 'snapshot.json'), JSON.stringify({id:dir.split('/').at(-1),seed:'memory-test',commandN:1024,clock:{tick:1024},counters:{event:0},agents:{},physics:2}));
  writeFileSync(join(dir, 'events.jsonl'), '');
  const script = `import { CommandLog, readCommands, repairCommandLog } from ${JSON.stringify(new URL('../src/commands.js', import.meta.url).href)};
    import { deployPreflight } from ${JSON.stringify(new URL('../src/tools/deploy-preflight.js', import.meta.url).href)};
    import { appendFileSync,statSync } from 'node:fs';
    import { dirname,basename } from 'node:path';
    const file = process.argv[1], dir = dirname(file);
    const gate = deployPreflight({releaseDir:dir,dataDir:dirname(dir),worldId:basename(dir),serviceUid:process.getuid(),serviceGid:process.getgid(),expectedVersion:'0.1.0',expectedHash:'a'.repeat(40)});
    if(!gate.ok) throw Error(JSON.stringify(gate)); if (repairCommandLog(file)) throw Error('unexpected repair');
    if (new CommandLog(file).n !== 1024) throw Error('lost sequence');
    const rows = readCommands(file, { fromN: 1023 }); if (rows.length !== 1 || rows[0].n !== 1024) throw Error('lost tail'); const size = statSync(file).size; appendFileSync(file, '{broken');
    if(new CommandLog(file,{repair:true}).n!==1024 || statSync(file).size!==size) throw Error('lost prefix on repair');
    console.log('bounded recovery OK');`;
  const child = spawnSync(process.execPath, ['--max-old-space-size=32', '--input-type=module', '-e', script, file], { encoding: 'utf8', timeout: 20000 });
  assert.equal(child.status, 0, `history recovery exceeded 32 MiB heap: ${child.signal ?? child.stderr.slice(0, 300)}`);
  assert.match(child.stdout, /bounded recovery OK/);
});
