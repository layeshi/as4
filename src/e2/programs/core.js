import { PROGRAM_LIMITS, programsEnabled } from './catalog.js';
import { executeProgram } from './executor.js';
import { bad, emit, fail, needText } from '../engine/core.js';
import { usesLawSemantics2 } from '../engine/law-semantics.js';
import { jsonWeight } from '../engine/tokens.js';

export function enablePrograms(w, args = {}) {
  if (w.premise !== 6 || !usesLawSemantics2(w)) return bad('not_allowed');
  if (args.version !== 1 || Object.keys(args).some(k => k !== 'version')) return bad('invalid_request');
  if (!programsEnabled(w)) {
    w.programServices = { version: 1, enabledTick: w.clock.tick, enabledCommand: w.commandN, nextId: 0, programs: {} };
    emit(w, 'program_services_enabled', { data: { enabledTick: w.clock.tick } });
  }
  return { ok: true, version: 1, enabledTick: w.programServices.enabledTick };
}
export function ownedProgram(w, id, author) {
  if (!programsEnabled(w)) fail('not_allowed');
  const p = typeof id === 'string' && Object.hasOwn(w.programServices.programs,id) ? w.programServices.programs[id] : null;
  if (!p || p.author !== author) fail('not_found');
  return p;
}
export function runProgram(p, input) {
  if (typeof input !== 'string') fail('invalid_args');
  const result = executeProgram(p.code, input);
  if (!result.ok) fail(result.code);
  return result.output;
}
export const programHandler = {
  validate({ w, a }, args) {
    if (!programsEnabled(w)) fail('not_allowed');
    if (Object.keys(args).some(k => !['type','op','program','title','description','inputDescription','code','input'].includes(k))) fail('invalid_args');
    if (args.op === 'test') {
      const p = ownedProgram(w,args.program,a.id);
      const output = runProgram(p,args.input);
      return { op: 'test', program: p.id, output, thinking: jsonWeight({ output }), cost: 0 };
    }
    if (args.op !== 'save') fail('invalid_args');
    const old = args.program ? ownedProgram(w,args.program,a.id) : null;
    if (!old && Object.values(w.programServices.programs).filter(p => p.author === a.id).length >= PROGRAM_LIMITS.count) fail('limit_reached');
    const title = needText(args.title,{max:80}), description = needText(args.description,{max:600}), inputDescription = needText(args.inputDescription,{max:600});
    const result = executeProgram(args.code,'null',{compileOnly:true});
    if (!result.ok) fail(result.code);
    return { op:'save', old, title, description, inputDescription, code: args.code, cost:0 };
  },
  apply({ w, a }, p) {
    if (p.op === 'test') return { program:p.program, output:p.output };
    const id = p.old?.id ?? `pg${++w.programServices.nextId}`;
    w.programServices.programs[id] = { id, author:a.id, title:p.title, description:p.description, inputDescription:p.inputDescription, code:p.code, createdTick:p.old?.createdTick ?? w.clock.tick, updatedTick:w.clock.tick };
    // Metadata only. Private source stays in private world snapshots/commands.
    emit(w,'program_saved',{agent:a.id,vis:'internal',data:{program:id}});
    return { program:id };
  },
};
export function programLook(w,args,agentId) {
  if (!programsEnabled(w) || !agentId) fail('not_found');
  if (args.id) {
    const p = ownedProgram(w,args.id,agentId);
    const offset = args.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) fail('invalid_args');
    const chars = Array.from(p.code);
    let end = Math.min(chars.length, offset + PROGRAM_LIMITS.page);
    const page = () => ({ id:p.id,code:chars.slice(offset,end).join(''),offset,nextOffset:end<chars.length?end:null });
    while (end > offset && Array.from(JSON.stringify(page())).length > PROGRAM_LIMITS.page) end--;
    return page();
  }
  const rows = Object.values(w.programServices.programs).filter(p=>p.author===agentId && (!args.after || Number(p.id.slice(2)) > Number(String(args.after).slice(2)))).slice(0,4);
  return {items:rows.map(p=>({id:p.id,title:p.title})),next:rows.length===4?rows.at(-1).id:null};
}
