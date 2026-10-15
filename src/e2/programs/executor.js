import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROGRAM_LIMITS } from './catalog.js';
const worker = fileURLToPath(new URL('./worker.js', import.meta.url));
// The OS watchdog also bounds long native builtins (e.g. pathological regexes)
// that do not necessarily visit QuickJS's instruction interrupt. Production
// outcomes are persisted by the command receipt; replay never reruns the child.
export function executeProgram(code, input = 'null', { compileOnly = false } = {}) {
  if (typeof code !== 'string' || !code.trim() || Buffer.byteLength(code) > PROGRAM_LIMITS.code)
    return { ok: false, code: 'invalid_args' };
  if (typeof input !== 'string' || Buffer.byteLength(input) > PROGRAM_LIMITS.input)
    return { ok: false, code: 'invalid_args' };
  try { JSON.parse(input); } catch { return { ok: false, code: 'invalid_args' }; }
  const child = spawnSync(process.execPath, ['--max-old-space-size=48', worker], {
    input: JSON.stringify({ code, input, compileOnly }), encoding: 'utf8',
    env: { TZ: 'UTC' }, timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 16384,
    windowsHide: true,
  });
  if (child.error || child.status !== 0) return { ok: false, code: 'program_failed' };
  try {
    const result = JSON.parse(child.stdout);
    if (result.ok === true && compileOnly) return { ok: true };
    if (result.ok === true && typeof result.output === 'string' && Buffer.byteLength(result.output) <= PROGRAM_LIMITS.output) {
      JSON.parse(result.output);
      return { ok: true, output: result.output };
    }
    return { ok: false, code: ['program_syntax','program_output_limit'].includes(result.code) ? result.code : 'program_failed' };
  } catch { return { ok: false, code: 'program_failed' }; }
}
