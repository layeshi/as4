// Opt-in P2 tools. Schemas and local validation share the same action table;
// conversion never fills a target, changes an amount, or rewrites model text.
import { tokenized } from '../src/e2/world.js';
import { actionTable } from '../src/e2/lore/actions.js';
import { OP_FIELDS } from '../src/e2/rules/check.js';
import { P, LIMITS, MODULE_TYPES } from '../src/e2/params.js';
import { nameKey, normalizeText } from '../src/text.js';

const obj = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });
const str = (maxLength, minLength = 1) => ({ type: 'string', minLength, ...(maxLength ? { maxLength } : {}) });
const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => ({ type: 'integer', minimum, maximum });
const list = (items, maxItems, minItems = 0) => ({ type: 'array', items, maxItems, ...(minItems ? { minItems } : {}) });
const expression = { type: ['string', 'integer', 'boolean', 'null'], maxLength: P.exprChars };
const present = name => ({ required: [name], properties: { [name]: { not: { type: 'null' } } } });
const exactlyOne = (names, nonNull = true) => ({ oneOf: names.map(name => nonNull ? present(name) : { required: [name] }) });
const nullable = schema => schema.type ? { ...schema, type: [...new Set([...(Array.isArray(schema.type) ? schema.type : [schema.type]), 'null'])], ...(schema.enum ? { enum: [...schema.enum, null] } : {}) } : { anyOf: [schema, { type: 'null' }] };
const tableFor = (premise = 2) => actionTable(premise, true);

function operationSchema(nested = false) {
  return { anyOf: Object.keys(OP_FIELDS).filter(name => !nested || name !== 'each').map(name => ({ $ref: `#/$defs/op_${name}` })) };
}

function operationDefinition(name) {
    const fields = OP_FIELDS[name];
    const properties = { op: { type: 'string', enum: [name] } };
    const required = ['op'];
    for (const [field, kind, mandatory] of fields) {
      let s;
      if (kind === 'ops') s = list({ $ref: '#/$defs/operationNested' }, P.opsPerRule, 1);
      else if (kind === 'reason') s = { anyOf: [str(LIMITS.reason), obj({ zh: str(LIMITS.reason), en: str(LIMITS.reason) }, ['zh', 'en'])] };
      else if (['acct', 'agent', 'agents', 'int', 'bool', 'scalar'].includes(kind)) s = expression;
      else if (kind === 'article') s = integer(1);
      else if (kind === 'canonical') s = { type: ['string', 'null'] };
      else s = str(kind === 'template' ? P.templateChars : kind === 'amendText' ? LIMITS.amendText : kind === 'text600' ? LIMITS.petition : undefined, kind === 'amendText' ? 0 : 1);
      properties[field] = s;
      if (mandatory) required.push(field);
    }
    const schema = obj(properties, required);
    if (['transfer', 'share', 'fee'].includes(name)) schema.anyOf = [{ required: ['energy'] }, { required: ['coins'] }];
    return schema;
}

const ruleSchema = obj({ when: str(80), if: expression, do: list({ $ref: '#/$defs/operation' }, P.opsPerRule, 1) }, ['when', 'do']);
const rulesSchema = list(ruleSchema, P.rulesPerLaw);
const procedureClass = { anyOf: [obj({ none: { type: 'boolean', enum: [true] } }, ['none']), obj({
  proposers: expression, voters: expression, weight: expression, decide: expression,
  period: integer(P.periodMin, P.periodMax), secret: { type: 'boolean' },
}, ['proposers', 'voters', 'decide', 'period', 'secret'])] };
const procedureSchema = { ...obj({ ordinary: procedureClass, constitutional: procedureClass }), anyOf: [{ required: ['ordinary'] }, { required: ['constitutional'] }] };
const successorSchema = obj({ name: str(LIMITS.name), soul: str(LIMITS.soul), lang: str(LIMITS.lang), memories: list(integer(), P.memorySlots) }, ['name', 'soul']);

function fieldSchema(type, name, kind, premise = 2) {
  if (tokenized({ premise }) && type === 'routine' && name === 'every') return integer(0, 36);
  if (tokenized({ premise }) && type === 'routine' && name === 'brief') return { type: 'string', enum: ['full', 'short'] };
  if (tokenized({ premise }) && type === 'initiate' && name === 'owner') return { type: 'string', enum: ['self', 'city'] };
  if (kind === 'bool') return { type: 'boolean' };
  if (kind === 'int') return integer(name === 'energy' && ['repair', 'contribute', 'sponsor', 'dismantle', 'draw'].includes(type) ? 1 : 0, type === 'draw' && !tokenized({ premise }) ? P.drawMaxPerAction : Number.MAX_SAFE_INTEGER);
  if (name === 'rules') return { $ref: '#/$defs/rules' };
  if (name === 'procedure') {
    if (['found', 'rules'].includes(type)) return { type: 'string', enum: ['steward', 'members'] };
    return type === 'refound' ? { anyOf: [{ allOf: [{ $ref: '#/$defs/procedure' }, { required: ['ordinary', 'constitutional'] }] }, { type: 'string', enum: ['humans'] }] } : { $ref: '#/$defs/procedure' };
  }
  if (type === 'invent' && name === 'ref') return obj({ kind: { type: 'string', enum: ['doc', 'project'] }, id: str() }, ['kind', 'id']);
  if (name === 'successor') return { $ref: '#/$defs/successor' };
  if (name === 'give' || name === 'want') return obj({ energy: nullable(integer()), coins: nullable(integer()) });
  if (name === 'heirs') return list(obj({ to: str(), share: integer(1, 1000000) }, ['to', 'share']), LIMITS.heirs);
  if (name === 'with') return list(str(), P.authorsMax - 1);
  if (name === 'memories') return list(integer(), P.memorySlots);
  if (name === 'orders') return list(obj({
    when: { type: 'string', enum: ['tick', 'daily', 'inbox:whisper', 'inbox:offer', 'inbox:pact', 'inbox:memory_offer', 'inbox:group', 'inbox:gift'] },
    if: expression, do: list(compactStandingSchema(premise), P.standingDoMax, 1),
    times: nullable(integer(1, P.standingTimesMax)), untilDay: nullable(integer(1)),
  }, ['when', 'do']), P.standingMax);
  if (kind === 'list' || kind === 'obj') throw new Error(`Missing structured action schema: ${type}.${name}`);
  if (name === 'choice') return { type: 'string', enum: ['yes', 'no', 'abstain'] };
  if (name === 'build') return { type: 'string', enum: tokenized({ premise }) ? ['site', 'module', 'road', 'upgrade'] : ['site', 'module', 'road'] };
  if (name === 'module') return { type: 'string', enum: [...MODULE_TYPES] };
  const lengths = { name: LIMITS.name, soul: LIMITS.soul, bio: LIMITS.bio, purpose: LIMITS.purpose,
    body: LIMITS.docBody, title: type === 'invent' ? 100 : type === 'write' ? LIMITS.docTitle : LIMITS.proposalTitle,
    word: LIMITS.word, meaning: LIMITS.meaning, manifesto: LIMITS.manifesto, note: LIMITS.note,
    reason: LIMITS.reason, lastWords: LIMITS.lastWords, description: LIMITS.description, lang: LIMITS.lang };
  const textLimits = { pray: 600, invent: 600, say: LIMITS.speech, whisper: LIMITS.speech, broadcast: LIMITS.speech, diary: LIMITS.diary,
    remember: P.memoryCpMax, inscribe: LIMITS.inscription, epitaph: LIMITS.epitaph, propose: LIMITS.proposalText,
    refound: LIMITS.refoundText, rules: LIMITS.proposalText };
  return str(name === 'text' ? textLimits[type] : lengths[name], ['bio', 'purpose', 'lastWords', 'note', 'reason'].includes(name) ? 0 : 1);
}

/** Source signature determines required fields; explicit variants refine it. */
function buildActionSchema(type, { action = false, dynamic = false, premise = 2 } = {}) {
  const table = tableFor(premise);
  const spec = table.ACTIONS[type];
  const tokens = spec.params.split(',').map(s => s.trim());
  const properties = action ? { type: { type: 'string', enum: [type] } } : {};
  for (const [name, kind] of spec.args) {
    if (type === 'standing' && name === 'count') continue; // derived rule field, not input
    const optional = tokens.includes(`${name}?`) || (type === 'initiate' && name !== 'build') || ['read', 'rules'].includes(type) && ['doc', 'inscription', 'law', 'agent', 'place', 'group'].includes(name);
    const schema = optional && type !== 'routine' && !(tokenized({ premise }) && type === 'initiate' && name === 'owner') ? nullable(fieldSchema(type, name, kind, premise)) : fieldSchema(type, name, kind, premise);
    properties[name] = dynamic ? { anyOf: [schema, { type: 'string', pattern: '^=', maxLength: P.exprChars + 1 }] } : schema;
  }
  const required = spec.params.split(',').map(s => s.trim()).filter(s => s && !s.endsWith('?') && !s.includes('|') && s !== '…');
  const schema = obj(properties, [...(action ? ['type'] : []), ...required]);
  if (type === 'read') Object.assign(schema, exactlyOne(['doc', 'inscription', 'law', 'agent']));
  if (type === 'remember') Object.assign(schema, exactlyOne(['text', 'gift'], false));
  if (type === 'draft') Object.assign(schema, exactlyOne(['rules', 'procedure']));
  if (type === 'rules') schema.allOf = [exactlyOne(['place', 'group']), exactlyOne(['rules', 'procedure'])];
  if (type === 'propose') schema.not = { allOf: [present('rules'), present('procedure')] };
  if (type === 'initiate') schema.anyOf = [
    { properties: { build: { enum: ['site'] } }, allOf: [present('name'), exactlyOne(['lot', 'on'])] },
    { properties: { build: { enum: ['module'] } }, allOf: [present('module')] },
    { properties: { build: { enum: ['road'] } }, allOf: [present('to')] },
  ];
  if (tokenized({ premise }) && type === 'routine') schema.anyOf = ['every', 'called', 'brief'].map(name => ({ required: [name] }));
  if (tokenized({ premise }) && type === 'initiate') schema.anyOf.push({ properties: { build: { enum: ['upgrade'] } } });
  if (type === 'initiate' && dynamic) schema.anyOf.push({ properties: { build: { type: 'string', pattern: '^=' } } });
  return schema;
}

// Install only definitions used by this tool, including transitive dependencies.
// The complete schema stays local to one function and works with ordinary JSON Schema.
function withDefinitions(schema, { compact = false, premise = 2 } = {}) {
  const definitions = {};
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      const name = value.$ref.slice('#/$defs/'.length);
      if (!Object.hasOwn(definitions, name)) {
        const shared = { rules: rulesSchema, procedure: procedureSchema, successor: successorSchema,
          operation: compact ? compactOperationSchema() : operationSchema(), operationNested: compact ? compactOperationSchema(true) : operationSchema(true) };
        definitions[name] = name.startsWith('op_') ? operationDefinition(name.slice(3)) : name.startsWith('action_') ? buildActionSchema(name.slice(7), { action: true, premise })
          : name.startsWith('dynamic_') ? buildActionSchema(name.slice(8), { action: true, dynamic: true, premise }) : shared[name];
        if (!definitions[name]) throw new Error(`Missing tool definition ${name}`);
        visit(definitions[name]);
      }
    }
    for (const field of Object.values(value)) visit(field);
  };
  visit(schema);
  return Object.keys(definitions).length ? { ...schema, $defs: definitions } : schema;
}

export function actionSchema(type, options = {}) { return withDefinitions(buildActionSchema(type, options), options); }

/** Compact provider envelope; exact action-specific validation is retained below. */
function compactStandingSchema(premise = 2) {
  const table = tableFor(premise);
  const types = table.ORDER.filter(type => !['standing', 'retire'].includes(type));
  return compactVariants('type', types.map(type => [type, buildActionSchema(type, { action: true, dynamic: true, premise })]));
}

function compactOperationSchema(nested = false) {
  if (nested) return { allOf: [{ $ref: '#/$defs/operation' }, { not: { properties: { op: { enum: ['each'] } }, required: ['op'] } }] };
  return compactVariants('op', Object.keys(OP_FIELDS).filter(name => !nested || name !== 'each').map(name => [name, operationDefinition(name)]));
}

function compactVariants(discriminator, entries) {
  const fields = new Map();
  const variants = entries.map(([type, schema]) => {
    for (const [name, field] of Object.entries(schema.properties)) {
      if (name === discriminator) continue;
      if (!fields.has(name)) fields.set(name, new Map());
      fields.get(name).set(JSON.stringify(field), field);
    }
    return { properties: { [discriminator]: { enum: [type] } }, required: schema.required,
      ...Object.fromEntries(['oneOf', 'allOf', 'anyOf', 'not'].filter(k => schema[k]).map(k => [k, schema[k]])) };
  });
  return { ...obj({ [discriminator]: { type: 'string', enum: entries.map(([name]) => name) }, ...Object.fromEntries([...fields].map(([name, choices]) => [name, choices.size === 1 ? [...choices.values()][0] : { anyOf: [...choices.values()] }])) }, [discriminator]), oneOf: variants };
}

const readAliases = { read_document: 'doc', read_law: 'law', read_inscription: 'inscription', read_agent: 'agent' };
export const thoughtSchema = obj({ thought: str(LIMITS.thought) }, ['thought']);
export function typedActionTools(lang = 'zh', { prayers = false, premise = 2 } = {}) {
  const table = tableFor(premise);
  const activeTable = actionTable(premise, prayers);
  const code = lang === 'en' ? 'en' : 'zh';
  return [
    ...activeTable.ORDER.map(name => ({ name, description: `${table.ACTIONS[name].verb[code]} (${table.ACTIONS[name].params}). ${table.ACTIONS[name].where?.[code] || ''}`.trim(), schema: actionSchema(name, { compact: true, premise }) })),
    ...Object.entries(readAliases).map(([name, field]) => ({ name, description: `${table.ACTIONS.read.verb[code]} (${field}). ${table.ACTIONS.read.where[code]}`, schema: obj({ [field]: str() }, [field]) })),
    { name: 'think', description: code === 'en' ? 'Keep a private thought without spending action quota. Never public speech.' : '记录私有独白，不占行动次数，不是公开发言。', schema: thoughtSchema },
    { name: 'done', description: code === 'en' ? (tokenized({ premise }) ? 'End this waking. No action or tokens are spent.' : 'End this waking. No action or energy is spent.') : (tokenized({ premise }) ? '结束这次醒来，不占行动次数、不花词元。' : '结束这次醒来，不占行动次数、不花能量。'), schema: obj({}) },
  ];
}

export function typedActSchema(premise = 2) {
  const table = tableFor(premise);
  return withDefinitions(obj({ actions: list({ anyOf: table.ORDER.map(type => ({ $ref: `#/$defs/action_${type}` })) }, LIMITS.actionsPerRequest), thought: str(LIMITS.thought, 0), end: { type: 'boolean' } }, ['actions']), { premise });
}

function problem(path, message) { return { path, code: 'invalid_args', message }; }
const matchesType = (value, type) => type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
  : type === 'array' ? Array.isArray(value) : type === 'integer' ? Number.isSafeInteger(value)
    : type === 'null' ? value === null : typeof value === type;
function relevantAlternative(value, schema, root) {
  if (schema.$ref) return relevantAlternative(value, root.$defs[schema.$ref.slice('#/$defs/'.length)], root);
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some(type => matchesType(value, type))) return false;
  if (value && typeof value === 'object') for (const key of ['type', 'op']) {
    const allowed = schema.properties?.[key]?.enum;
    if (allowed && !allowed.includes(value[key])) return false;
  }
  return true;
}
/** Small validator for exactly the schema vocabulary emitted above. */
export function schemaIssues(value, schema, path = 'args', root = schema) {
  if (schema.$ref) return schemaIssues(value, root.$defs[schema.$ref.slice('#/$defs/'.length)], path, root);
  const issues = [];
  if (schema.type) {
    const valid = (Array.isArray(schema.type) ? schema.type : [schema.type]).some(type => matchesType(value, type));
    if (!valid) return [problem(path, `Expected ${schema.type}`)];
  }
  if (schema.enum && !schema.enum.includes(value)) issues.push(problem(path, `Choose one of: ${schema.enum.join(', ')}`));
  if (typeof value === 'string') {
    const length = [...normalizeText(value)].length;
    if (schema.minLength !== undefined && length < schema.minLength) issues.push(problem(path, 'Value must not be empty'));
    if (schema.maxLength !== undefined && length > schema.maxLength) issues.push(problem(path, `Maximum ${schema.maxLength} characters; do not silently truncate`));
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) issues.push(problem(path, `Expected pattern ${schema.pattern}`));
  }
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) issues.push(problem(path, `Expected ${schema.minimum}..${schema.maximum}`));
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) issues.push(problem(`${path}.${key}`, 'Required field missing'));
    for (const [key, field] of Object.entries(value)) {
      if (schema.additionalProperties === false && !Object.hasOwn(schema.properties || {}, key)) issues.push(problem(`${path}.${key}`, 'Unknown field'));
      if (schema.properties?.[key]) issues.push(...schemaIssues(field, schema.properties[key], `${path}.${key}`, root));
    }
  }
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) issues.push(problem(path, `Expected ${schema.minItems ?? 0}..${schema.maxItems} items`));
    if (schema.items) value.forEach((item, i) => issues.push(...schemaIssues(item, schema.items, `${path}[${i}]`, root)));
  }
  for (const key of ['anyOf', 'oneOf']) if (schema[key]) {
    const choices = schema[key].map(s => schemaIssues(value, s, path, root));
    const passes = choices.filter(errors => !errors.length).length;
    if (key === 'anyOf' ? passes === 0 : passes !== 1) {
      const relevant = choices.filter((_, i) => relevantAlternative(value, schema[key][i], root));
      const closest = (relevant.length ? relevant : choices).reduce((a, b) => a.length <= b.length ? a : b);
      issues.push(...(closest.length ? closest : [problem(path, 'Choose exactly one alternative')]));
    }
  }
  for (const s of schema.allOf || []) issues.push(...schemaIssues(value, s, path, root));
  if (schema.not && !schemaIssues(value, schema.not, path, root).length) issues.push(problem(path, 'These fields cannot be combined'));
  return issues.slice(0, 5);
}

function visibleIssues(action, perception) {
  if (!perception) return [];
  const p = perception;
  const check = (field, entries, extra = [], names = false) => {
    if (action[field] === undefined || action[field] === null || !Array.isArray(entries)) return [];
    const allowed = new Set([...extra, ...entries.flatMap(e => [e.id, e.name]).filter(Boolean)]);
    const named = names && entries.some(e => typeof e.name === 'string' && nameKey(e.name) === nameKey(action[field]));
    return allowed.has(action[field]) || named ? [] : [problem(`args.${field}`, 'Use an ID or name in the visible perception; do not guess a target')];
  };
  if (action.type === 'move') return check('to', p.city?.places);
  if (['whisper', 'impart', 'steward'].includes(action.type)) return check('to', p.city?.residents, [], true);
  if (action.type === 'give' || action.type === 'disburse') {
    if (Array.isArray(p.city?.residents) && Array.isArray(p.city?.groups)) return check('to', [...p.city.residents, ...p.city.groups], ['treasury'], true);
  }
  if (['join', 'leave', 'admit', 'steward', 'disburse', 'rules'].includes(action.type)) return check('group', p.city?.groups);
  // Lists of laws, documents, past residents and private offers are partial.
  // Their absence is not proof that an explicit read/query target is invalid.
  return [];
}

export function validateAction(action, perception, premise = perception?.premise ?? 2) {
  const table = tableFor(premise);
  if (!action || !table.isKnown(action.type)) return [problem('args.type', `Unknown action; choose ${table.ORDER.join(', ')}`)];
  const issues = schemaIssues(action, actionSchema(action.type, { action: true, premise }));
  if (!issues.length) {
    if (['give', 'disburse'].includes(action.type) && !(action.energy > 0 || action.coins > 0)) issues.push(problem('args.energy', 'Give a positive energy or coins amount'));
    if (action.type === 'offer') {
      const amounts = ['energy', 'coins'];
      if (!amounts.some(k => action.give[k] > 0 || action.want[k] > 0)) issues.push(problem('args.give', 'An offer must have a positive amount on at least one side'));
      for (const asset of amounts) if (action.give[asset] > 0 && action.want[asset] > 0) issues.push(problem(`args.want.${asset}`, 'The same asset cannot be positive on both sides'));
    }
    if (action.type === 'rules' && action.place !== undefined && action.place !== null && action.procedure !== undefined && action.procedure !== null) issues.push(problem('args.procedure', 'A procedure changes a group, not a place'));
  }
  if (!issues.length && action.type === 'standing') {
    action.orders.forEach((order, i) => order.do.forEach((nested, j) => {
      if (table.isKnown(nested.type) && !['standing', 'retire'].includes(nested.type)) issues.push(...schemaIssues(nested, actionSchema(nested.type, { action: true, dynamic: true, premise }), `args.orders[${i}].do[${j}]`));
    }));
  }
  return issues.length ? issues.slice(0, 5) : visibleIssues(action, perception);
}

export function typedCall(name, args, perception, premise = perception?.premise ?? 2) {
  const table = tableFor(premise);
  if (!table.isKnown(name) && !Object.hasOwn(readAliases, name)) return null;
  const type = Object.hasOwn(readAliases, name) ? 'read' : name;
  const action = args && typeof args === 'object' && !Array.isArray(args) ? { type, ...args } : null;
  const aliasField = readAliases[name];
  const issues = aliasField ? schemaIssues(args, obj({ [aliasField]: str() }, [aliasField])) : [];
  if (!issues.length) issues.push(...validateAction(action, perception, premise));
  if (action && Object.hasOwn(args, 'type')) issues.unshift(problem('args.type', 'The tool name supplies type; omit this field'));
  return { action, issues: issues.slice(0, 5) };
}

function sample(schema, root = schema) {
  if (schema.$ref) return sample(root.$defs[schema.$ref.slice('#/$defs/'.length)], root);
  if (schema.enum) return schema.enum[0];
  if (Array.isArray(schema.type)) return sample({ ...schema, type: schema.type[0] }, root);
  if (schema.anyOf && !schema.type) return sample(schema.anyOf[0], root);
  if (schema.type === 'array') return [];
  if (schema.type === 'integer') return schema.minimum ?? 1;
  if (schema.type === 'boolean') return false;
  if (schema.type === 'object') {
    const collect = s => [...(s.required || []), ...(s.oneOf ? collect(s.oneOf[0]) : []), ...(s.anyOf ? collect(s.anyOf[0]) : []), ...(s.allOf || []).flatMap(collect)];
    const required = [...new Set(collect(schema))];
    return Object.fromEntries(required.map(k => [k, sample(schema.properties[k], root)]));
  }
  return '<value>';
}
export function correctionExample(type, premise = 2) {
  const table = tableFor(premise);
  if (type === 'think') return { tool: 'think', args: { thought: '<private thought>' } };
  const schema = table.isKnown(type) ? actionSchema(type, { premise }) : actionSchema('say', { premise });
  const args = sample(schema);
  if (tokenized({ premise }) && type === 'routine') args.brief = 'full';
  if (type === 'refound') args.procedure = 'humans';
  if (['give', 'disburse'].includes(type)) args.energy = 1;
  if (type === 'offer') args.give = { energy: 1 };
  if (type === 'draft') args.rules = [{ when: 'daily', do: [{ op: 'announce', to: 'all', text: '<text>' }] }];
  return { tool: table.isKnown(type) ? type : 'say', args };
}

export function correctionText(corrections, lang, premise = 2) {
  if (!corrections?.length) return '';
  const title = lang === 'en' ? '[Unresolved action corrections]' : '【尚未解决的行动纠正】';
  const example = lang === 'en' ? 'Example (replace placeholders; preserve your intended values)' : '示例（替换占位符，保持你的原意和数值）';
  return `${title}\n${corrections.map(c => `${c.type}: ${c.detail}\n${example}: ${JSON.stringify(correctionExample(c.type, premise))}`).join('\n')}`;
}
