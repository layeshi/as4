import { fail, emit } from '../core.js';
export const routineHandlers = {
  routine: {
    validate(ctx, args) {
      const routine = { ...ctx.a.routine };
      const keys = ['every', 'called', 'brief'].filter(k => args[k] !== undefined);
      if (!keys.length) fail('invalid_args');
      for (const k of keys) {
        const v = args[k];
        if (k === 'every' && (!Number.isInteger(v) || v < 0 || v > 36)) fail('invalid_args');
        if (k === 'called' && typeof v !== 'boolean') fail('invalid_args');
        if (k === 'brief' && !['full', 'short'].includes(v)) fail('invalid_args');
        routine[k] = v;
      }
      return { routine, cost: 0 };
    },
    apply(ctx, plan) {
      ctx.a.routine = plan.routine;
      emit(ctx.w, 'routine', { vis: 'delayed', agent: ctx.a.id, place: ctx.a.place, data: { routine: { ...plan.routine } } });
      return { routine: { ...plan.routine } };
    },
  },
};
