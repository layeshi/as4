// Startup fingerprints live outside the deterministic engine; changes enter via logged admin commands.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { premised } from './e2/facade.js';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PATHS = ['src/e2', 'src/text.js', 'src/rng.js', 'runner', 'mcp', 'src/shells', 'src/runner'];
export function codeFingerprint(root = ROOT) {
  const files = [];
  const walk = (path) => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) for (const name of readdirSync(path).sort()) walk(join(path, name));
    else files.push(path);
  };
  for (const path of PATHS) walk(join(root, path));
  files.sort((a, b) => relative(root, a) < relative(root, b) ? -1 : relative(root, a) > relative(root, b) ? 1 : 0);
  const hash = createHash('sha256');
  for (const path of files) hash.update(relative(root, path)).update('\0').update(readFileSync(path)).update('\0');
  return hash.digest('hex');
}
export function bodiesFingerprint(lines) {
  // Both reasoningEffort (OpenAI) and effort (Anthropic) are actual line fields.
  const keys = ['provider', 'model', 'maxTokens', 'extraBody', 'reasoningEffort', 'effort'];
  const data = lines.map((line) => Object.fromEntries(keys.filter((k) => Object.hasOwn(line, k)).map((k) => [k, line[k]])));
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}
export function checkBackstage(rt, shells, { root = ROOT, logger = console } = {}) {
  if (!premised(rt.w)) return;
  const fps = { code: codeFingerprint(root), bodies: shells ? bodiesFingerprint(shells.config.lines) : null, budget: shells ? String(shells.config.tokensPerDay) : null };
  for (const kind of ['code', 'bodies', 'budget']) {
    if (fps[kind] === null) continue;
    const old = rt.w.backstage[kind];
    if (old === null) { rt.exec('admin', { op: 'backstage', args: { kind, fp: fps[kind], initial: true } }); continue; }
    if (old === fps[kind]) continue;
    if (kind === 'bodies' && rt.w.shells.bodies.some((b) => b.model !== '' && !shells.config.lines.some((line) => line.model === b.model))) {
      logger.warn?.('有身体的模型在 SHELLS_FILE 里找不到线路：请用 POST /api/admin/rebody 换模型');
      continue;
    }
    const direction = kind === 'budget' ? (Number(fps.budget) > Number(old) ? 'up' : 'down') : undefined;
    rt.exec('admin', { op: 'backstage', args: { kind, fp: fps[kind], ...(direction ? { direction } : {}) } });
  }
}
