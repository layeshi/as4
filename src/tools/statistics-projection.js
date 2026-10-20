// Run offline against a fixed snapshot and its command prefix. No server or models.
import { writeFileSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readSnapshot, commandsPath } from '../store.js';
import { iterateCommands } from '../commands.js';
import { loadConfig, applyConfig } from '../config.js';
import { buildStatisticsProjection } from '../statistics-projection.js';

const args = process.argv.slice(2);
const option = name => { const i=args.indexOf(name); return i < 0 ? null : args[i+1]; };
const input = option('--world-dir'), output = option('--output');
if (!input || !output) {
  console.error('Usage: node src/tools/statistics-projection.js --world-dir COPY_WORLD_DIR --output PROJECTION_FILE');
  process.exit(2);
}
let temporary;
try {
  const dir=resolve(input), destination=resolve(output);
  if (['snapshot.json','commands.jsonl','events.jsonl'].some(name=>destination===resolve(dir,name))) throw new Error('Output must not overwrite experiment evidence');
  applyConfig(loadConfig(process.env,[]));
  const snapshot=readSnapshot(dir);
  if (!snapshot) throw new Error('Snapshot is missing');
  const projection=buildStatisticsProjection(snapshot,iterateCommands(commandsPath(dir),{toN:snapshot.commandN}));
  temporary=`${destination}.${randomUUID()}.tmp`;
  writeFileSync(temporary,JSON.stringify(projection),{mode:0o600,flag:'wx'});
  renameSync(temporary,destination);temporary=null;
  console.log(JSON.stringify({version:projection.version,throughCommand:projection.throughCommand,sourceHash:projection.sourceHash,metrics:projection.metrics.length,residents:Object.keys(projection.residents).length,unresolved:projection.unresolved}));
} catch(e) {
  if(temporary)rmSync(temporary,{force:true});
  console.error(`Statistics projection failed: ${e.message}`);process.exitCode=1;
}
