// Pure metadata: safe to import from runner clients without loading the executor.
export const PROGRAM_LIMITS = Object.freeze({ count: 16, code: 12000, input: 4000, output: 4000, page: 1200 });
export const programsEnabled = w => w.premise === 6 && w.programServices?.version === 1;
export const PROGRAM_ACTION = {
  base: 0, place: null, module: null, where: null, inner: true,
  params: 'op, program?, title?, description?, inputDescription?, code?, input?',
  args: [['op','str'],['program','str'],['title','str'],['description','str'],['inputDescription','str'],['code','str'],['input','str']],
  verb: { zh: '制作或试运行程序', en: 'Save or test a program' },
  desc: {
    zh: 'op=save 保存 JavaScript 函数体，提供 title、description、inputDescription、code；带 program 则修改自己的程序。op=test 带 program 和 input（JSON 字符串）试运行。代码使用 input 变量，以 return 返回 JSON 可表示的结果；不联网、不读写世界。代码仅作者可读。look programs 查看自己的目录，带 id、offset 分页读代码。',
    en: 'op=save stores a JavaScript function body with title, description, inputDescription, code; program edits your own saved program. op=test runs program with input (JSON string). Use input and return a JSON-serializable result. No network or world access. Only the author reads code. look programs lists your programs; id/offset reads code pages.',
  },
};
export function programCatalog(base) {
  const actions = { ...base.ACTIONS, program: PROGRAM_ACTION };
  for (const type of ['service_publish', 'service_edit']) {
    const a = actions[type];
    actions[type] = { ...a, params: a.params.replace('criterionTemplate,', 'criterionTemplate?,') + ', program?', args: [...a.args, ['program', 'str']], desc: {
      zh: a.desc.zh + ' 程序服务填 program（自己的程序），省略 criterionTemplate，按次定价自动交付。',
      en: 'For an automatic program service, supply your program ID, omit criterionTemplate, and set a fixed per-use price.',
    } };
  }
  const a = actions.service_order;
  actions.service_order = { ...a, params: 'service, targetArgs?, input?', args: [...a.args, ['input','str']], desc: {
    zh: '购买程序服务：提交 input（JSON 字符串），自动运行并返回结果，成功交付即付款，无需接单或验收。普通服务仍提交 targetArgs，按原约定履约。程序输入和结果进入公开订单记录，请勿提交私人资料。',
    en: 'Buy a program service with input (JSON string): automatic execution, result and payment on delivery. Ordinary services still use targetArgs and existing fulfillment. Program input and result are public order records; do not submit private information.',
  } };
  return Object.freeze({ ...base, ACTIONS: Object.freeze(actions), ORDER: Object.freeze([...base.ORDER,'program']), INNER: Object.freeze([...base.INNER,'program']), NO_BEFORE: Object.freeze([...base.NO_BEFORE,'program']), NO_AFTER: Object.freeze([...base.NO_AFTER,'program']), isKnown: t => typeof t === 'string' && Object.hasOwn(actions,t) });
}
