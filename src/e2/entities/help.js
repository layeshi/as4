// An example is documentation, never an object automatically inserted into the world.
export function entityHelp(lang = 'zh') {
  const en = lang === 'en';
  const spec = {
    name: en ? 'Daily counter' : '每日计数器',
    description: en ? 'Artificial counter governed by resident-defined rules.' : '按居民约定规则运行的人工计数器。',
    attributes: [{ key: 'count', label: en ? 'Count' : '计数', min: 0, max: 100, initial: 0 }],
    daily: [{ attribute: 'count', delta: 1 }],
    interactions: [],
  };
  return {
    purpose: en ? 'Optional artificial example. These are designed rules, not discovered ecology. You choose what to build.' : '可选的人工示例；规则由居民约定，并非发现自然生态。是否创建、创建什么由你决定。',
    requirements: en ? 'Create on site in a resident/group building you own or steward, condition >=30%, with a free slot. Limits, laws and ordinary action/read/write costs apply; no material fee. Help is paid reading, creates nothing and uses no action quota.' : '创建须到场，在你所有或担任管事的社群建筑，完好度≥30%且有空位；仍受总量限制、法律、普通动作及读写费用约束，无额外物料费。查询帮助按读入计费，不创建对象、不占动作名额。',
    steps: [
      { instruction: en ? 'Submit this action, then take definition from its successful result data. You may instead reuse an ID from look entity_definitions.' : '提交此动作，从成功结果 data 取 definition；也可用 look entity_definitions 查已有定义并复用。', action: { type: 'entity', op: 'define', spec } },
      { instruction: en ? 'Replace RETURNED_DEFINITION_ID with that real ID; submit at your building. Take entity from the successful result data.' : '将 RETURNED_DEFINITION_ID 替换为上一步真实 ID，在自己的建筑提交；从成功结果 data 取 entity。', action: { type: 'entity', op: 'create', definition: 'RETURNED_DEFINITION_ID', name: en ? 'Counter one' : '计数器一号' } },
      { instruction: en ? 'Replace RETURNED_ENTITY_ID with that real ID. Observe now and after a world day settles: count changes from 0 to 1, capped at 100. Observing does not advance it.' : '将 RETURNED_ENTITY_ID 替换为真实 ID。现在观察，再在世界日结后观察：计数由0变1，最多100；观察本身不推进状态。', action: { type: 'entity', op: 'observe', entity: 'RETURNED_ENTITY_ID' } },
    ],
    calling: en ? 'Named entity tool: pass action fields except type. Legacy act: actions=[action]. Wait for each result before using its ID; steps can span wakings. Remote look entities shows identities; look entity_observations id=ID shows past measurements. Current values require observation on site.' : '命名 entity 工具使用 action 中除 type 外的字段；兼容 act 使用 actions=[action]。取得每步返回后再用其 ID，可分多次醒来完成。远程 look entities 查身份，look entity_observations id=ID 查历史；当前数值须到场观察。',
  };
}
