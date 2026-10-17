// Public OpenLux prices are USD per million tokens. Never use the page's
// cheapest-group view: the administrator must match the actual platform key.
export const MODEL_IDS = Object.freeze(['gpt-6-luna', 'gpt-6-astra', 'claude-opus-5-5', 'gemini-3.8-flash', 'gpt-6.1-sol', 'deepseek-v4.1-flash', 'deepseek-v4-pro', 'doubao-seed-2-0-mini-260428', 'grok-4.7']);
export const PRICING_URL = 'https://www.openlux.ai/api/pricing_new';
export const FX = 7;
export const RATE_KEYS = ['miss', 'hit', 'output', 'write', 'writeHour'];
const decimal = value => {
  const s = String(value);
  if (!/^(0|[1-9]\d*)(\.\d{1,12})?$/.test(s)) throw Error('价格或倍率须为非负十进制数（最多十二位小数）。');
  const [a, b = ''] = s.split('.');
  return [BigInt(a + b), 10n ** BigInt(b.length)];
};
export function product(values, micro = false) {
  let n = 1n, d = 1n;
  for (const value of values) { const [a, b] = decimal(value); n *= a; d *= b; }
  if (micro) {
    const result = Number((n * 1000000n + d - 1n) / d);
    if (!Number.isSafeInteger(result)) throw Error('价格超出支持范围。');
    return result;
  }
  // Source USD price retained with 12 decimal places, not binary float arithmetic.
  const scale = 1000000000000n, q = (n * scale + d - 1n) / d;
  return `${q / scale}.${String(q % scale).padStart(12, '0')}`;
}
export function checkMultiplier(value) {
  decimal(value);
  if (!(Number(value) > 0 && Number(value) <= 100)) throw Error('计费倍率须大于 0 且不超过 100。');
  return String(value);
}
export function selectCatalog(payload) {
  if (payload?.success !== true || !Array.isArray(payload.data) || !payload.group_ratio) throw Error('OpenLux 定价响应无效。');
  return MODEL_IDS.map(id => {
    const found = payload.data.filter(m => m.model_name === id);
    if (found.length !== 1) return { id, error: '官方目录中没有唯一匹配的模型 ID。', groups: [] };
    const m = found[0];
    const groups = (m.enable_groups ?? []).filter(g => Object.hasOwn(payload.group_ratio, g)).map(group => ({ group, ratio: payload.group_ratio[group] }));
    const source = Object.fromEntries(['quota_type', 'model_ratio', 'completion_ratio', 'cache_ratio', 'cache_creation_ratio', 'cache_creation_5m_ratio', 'cache_creation_1h_ratio', 'step_ratios', 'supported_endpoint_types', 'model_type', 'tags'].map(k => [k, m[k] ?? null]));
    // Unknown per-model overrides cannot silently fall back to the group price.
    const overrides = payload.group_model_ratio;
    if (overrides && Object.keys(overrides).length) return { id, groups, error: '存在尚未支持的分组模型专属倍率，请核实后扩展适配。' };
    return { id, groups, source };
  });
}
export function priceModel(entry, group, multiplier) {
  checkMultiplier(multiplier);
  if (entry.error) throw Error(entry.error);
  const m = entry.source, g = entry.groups.find(g => g.group === group);
  if (!g) throw Error('请选择与平台 Key 匹配的有效分组。');
  if (m.quota_type !== 0 || !m.supported_endpoint_types?.some(p => ['openai', 'openai-response'].includes(p))) throw Error('仅支持按 token 计费且兼容 OpenAI 工具调用的文本模型。');
  if (m.model_type !== '对话') throw Error('模型不是文本对话模型。');
  const base = [2, m.model_ratio, g.ratio];
  const factors = { miss: 1, output: m.completion_ratio, hit: m.cache_ratio, write: m.cache_creation_5m_ratio ?? m.cache_creation_ratio, writeHour: m.cache_creation_1h_ratio };
  const rates = extra => {
    const usd = {}, pricesMicro = {};
    for (const k of RATE_KEYS) {
      const f = factors[k];
      if (f == null) { usd[k] = null; pricesMicro[k] = null; continue; }
      const inputs = [...base, f, extra[k] ?? 1];
      usd[k] = product(inputs); pricesMicro[k] = product([...inputs, FX, multiplier], true);
    }
    if (pricesMicro.miss == null || pricesMicro.output == null) throw Error('缺少输入或输出单价。');
    return { usd, pricesMicro };
  };
  const steps = m.step_ratios;
  let tiers;
  if (steps?.length) {
    let previous = 0;
    tiers = steps.map(s => {
      if (!Number.isSafeInteger(s.step_size) || s.step_size <= previous || s.completion_step_size !== -1 || s.prompt_thinking_step_ratio !== 0 || s.completion_thinking_step_ratio !== 0) throw Error('暂不支持此阶梯计费结构。');
      for (const key of ['prompt_step_ratio', 'completion_step_ratio', 'cache_step_ratio']) decimal(s[key]);
      previous = s.step_size;
      return { upTo: s.step_size, ...rates({ miss: s.prompt_step_ratio, output: s.completion_step_ratio, hit: s.cache_step_ratio }) };
    });
  } else tiers = [{ upTo: null, ...rates({}) }];
  return { id: entry.id, group, provider: m.supported_endpoint_types.includes('openai-response') ? 'openai-responses' : 'openai', tiers, pricesMicro: tiers[0].pricesMicro, usd: tiers[0].usd, exchangeRate: FX, multiplier: String(multiplier) };
}
export function applicablePrices(model, input) {
  if (!model.tiers) return model.pricesMicro;
  const tier = model.tiers.find(t => t.upTo === null || input <= t.upTo);
  if (!tier) throw Error('模型用量超出已核验的价格阶梯。');
  return tier.pricesMicro;
}
export function reservePrices(model) {
  if (!model.tiers) return model.pricesMicro;
  return Object.fromEntries(RATE_KEYS.map(k => [k, Math.max(0, ...model.tiers.map(t => t.pricesMicro[k] ?? 0))]));
}
