// Pure metadata shared by engine, runner and MCP.
export const entitiesEnabled = w => [6, 7].includes(w.premise) && w.entities?.version === 1;
export const ENTITY_LOOKS = ['entity_help', 'entity_definitions', 'entities', 'entity_observations'];
export const ENTITY_LIMITS = Object.freeze({ definitions: 128, perAuthor: 16, instances: 256, slots: 2, attributes: 6, rules: 8, interactions: 4, specChars: 2200, records: 32, pageChars: 2600 });
export const ENTITY_ACTION = Object.freeze({
  base: 0, place: null, module: null, where: null,
  params: 'op, spec?, definition?, name?, entity?, operation?',
  args: [['op','str'],['spec','obj'],['definition','str'],['name','str'],['entity','str'],['operation','str']],
  verb: { zh: '定义、操作或观察实体', en: 'Define, operate or observe an entity' },
  toolHint: { zh: '在建筑承载自定义对象；define→create→observe。look entity_help 查看完整人工示例和使用条件。', en: 'Host custom objects in buildings: define→create→observe. Read look entity_help for a complete artificial example and requirements.' },
  desc: {
    zh: 'op=define 提交公开可复用的 spec；create 使用 definition 和 name 在自己或社群管事管理的建筑创建实例；interact 指定 entity、operation；observe 到场取得真实状态并留下公开记录；archive 到场永久封存释放承载位。每建筑2位；创建/操作须完好度≥30%。管理权随建筑。无额外物料费，照常计动作和读写词元。look entity_definitions/entities/entity_observations 支持 id、after、limit，entities 可用 target 筛选建筑。定义规则仅改变自身，不创造资源。',
    en: 'op=define publishes a reusable spec; create uses definition and name at a building you own or steward; interact uses entity and operation; observe measures on site and records public evidence; archive permanently stops an instance and frees its slot. Two slots per building. Creation/interaction requires >=30% condition. Management follows the building. Ordinary action/read/write costs, no material charge. look entity_definitions/entities/entity_observations accepts id, after, limit; entities accepts target (building). Rules change only their own attributes, never world resources.',
  },
});
const cache = new WeakMap();
export function entityCatalog(base) {
  if (cache.has(base)) return cache.get(base);
  const actions = Object.freeze({ ...base.ACTIONS, entity: ENTITY_ACTION });
  const table = Object.freeze({ ...base, ACTIONS: actions, ORDER: Object.freeze([...base.ORDER, 'entity']), isKnown: t => typeof t === 'string' && Object.hasOwn(actions, t) });
  cache.set(base, table);
  return table;
}
