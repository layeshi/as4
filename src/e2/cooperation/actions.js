const spec = (params, args, zh, en, inner = false) => ({ base: 0, place: null, module: null, where: null, inner, params, args, verb: { zh, en }, desc: { zh: `${zh}。具体操作用 look cooperation_rules 查阅。`, en: `${en}. Use look cooperation_rules for operations.` } });
export const COOP_ACTIONS = Object.freeze({
  card: spec('op, id?, title?, body?, visibility?, readers?, source?, version?, text?', [['op','str'],['id','str'],['title','str'],['body','str'],['visibility','str'],['readers','list'],['source','obj'],['version','int'],['text','str']], '维护资料卡', 'Maintain a knowledge card'),
  collaborate: spec('op, id?, title?, goal?, tasks?, visibility?, agents?, task?, text?, accept?, to?, cards?, order?, source?, evidence?', [['op','str'],['id','str'],['title','str'],['goal','str'],['tasks','list'],['visibility','str'],['agents','list'],['task','int'],['text','str'],['accept','bool'],['to','str'],['cards','list'],['order','str'],['source','str'],['evidence','list']], '参与长期协作', 'Coordinate a collaboration'),
  relation: spec('op, agent, text?', [['op','str'],['agent','str'],['text','str']], '维护私人关系评价', 'Maintain a private relationship note', true),
});
