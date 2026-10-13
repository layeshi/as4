const shared = require('./shared-text');
const PROVIDERS = ['openai', 'openai-responses', 'anthropic'];

function normalize(list) {
  if (!Array.isArray(list) || !list.length || list.length > 20) return null;
  const out = [];
  for (const p of list) {
    if (!p || !/^[a-z][a-z0-9-]{0,31}$/.test(p.id) || typeof p.name !== 'string' || p.name.length > 40 || !Array.isArray(p.variants) || !p.variants.length || p.variants.length > 8) return null;
    const variants = [];
    for (const v of p.variants) {
      if (!v || !/^[a-z][a-z0-9-]{0,31}$/.test(v.id) || typeof v.name !== 'string' || v.name.length > 40 || !PROVIDERS.includes(v.provider) || typeof v.baseURL !== 'string' || v.baseURL.length > 500 || (p.id !== 'custom' && !/^https:\/\/[a-z0-9.-]+(?:\/[a-z0-9_./-]*)?$/i.test(v.baseURL)) || !Array.isArray(v.models) || v.models.length > 20 || v.models.some(m => typeof m !== 'string' || !/^[\w./:-]{1,100}$/.test(m))) return null;
      variants.push({ id: v.id, name: v.name, provider: v.provider, baseURL: v.baseURL, models: v.models.slice() });
    }
    out.push({ id: p.id, name: p.name, hint: typeof p.hint === 'string' ? p.hint.slice(0, 200) : '', variants });
  }
  if (!out.some(p => p.id === 'custom')) return null;
  return out;
}
module.exports = { PROVIDERS, normalize, bundled: normalize(shared.MODEL_PRESETS) };
