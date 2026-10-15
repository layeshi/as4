// Untrusted JS runs only inside a fresh QuickJS WebAssembly runtime. This child
// has no inherited secrets; QuickJS receives no host functions or module loader.
import { readFileSync } from 'node:fs';
import { getQuickJS } from 'quickjs-emscripten';
const request = JSON.parse(readFileSync(0, 'utf8'));
const Q = await getQuickJS();
const runtime = Q.newRuntime();
runtime.setMemoryLimit(8 * 1024 * 1024);
runtime.setMaxStackSize(256 * 1024);
let steps = 0;
runtime.setInterruptHandler(() => ++steps > 128);
const vm = runtime.newContext();
let reply = { ok: false, code: 'program_failed' };
try {
  // No clock or random source: successful pure calculations are reproducible.
  const setup = vm.evalCode('delete globalThis.Date; delete Math.random;');
  setup.dispose();
  const fn = vm.evalCode(`new Function("input", ${JSON.stringify('"use strict";\n' + request.code)})`, 'program.js');
  if (fn.error) { fn.error.dispose(); reply.code = 'program_syntax'; }
  else {
    try {
      if (request.compileOnly) reply = { ok: true };
      else {
        // Parse input in the guest, never pass host object references.
        const arg = vm.unwrapResult(vm.evalCode(`JSON.parse(${JSON.stringify(request.input)})`));
        try {
          const result = vm.callFunction(fn.value, vm.undefined, arg);
          if (result.error) result.error.dispose();
          else {
            try {
              vm.setProp(vm.global, '__result', result.value);
              const encoded = vm.evalCode(`(() => {
                const v = __result;
                if (v === undefined || typeof v === 'function' || typeof v === 'symbol' || (v && typeof v.then === 'function')) throw Error();
                return JSON.stringify(v);
              })()`);
              if (encoded.error) encoded.error.dispose();
              else {
                try {
                  const output = vm.getString(encoded.value);
                  if (Buffer.byteLength(output, 'utf8') <= 4000) {
                    JSON.parse(output);
                    reply = { ok: true, output };
                  } else reply.code = 'program_output_limit';
                } finally { encoded.value.dispose(); }
              }
            } finally { result.value.dispose(); }
          }
        } finally { arg.dispose(); }
      }
    } finally { fn.value.dispose(); }
  }
} catch { /* Never return guest messages, stacks or source code. */ }
finally { vm.dispose(); runtime.dispose(); }
process.stdout.write(JSON.stringify(reply));
