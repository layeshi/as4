import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { durableFile } from '../durable-file.js';
import { runnerConfig, RunnerError } from '../runner/manager.js';
import { MODEL_IDS, PRICING_URL, FX, selectCatalog, priceModel, checkMultiplier } from './catalog.js';
import { modelURL, modelFetch } from '../runner/endpoint.js';
import { BillingStore, emptyUsage, addUsage, reservationMicro, costMicro } from './billing.js';

const defaults = () => ({ enabled: false, baseURL: 'https://api.deepseek.com', model: '', apiKey: '', thinking: 'default', maxOutputTokens: 4096, pricesMicro: null });
export class HostedService {
  constructor(ctx, { now = Date.now, provider, pricingFetch } = {}) {
    this.ctx = ctx; this.providerOverride = provider; this.pricingFetch = pricingFetch;
    const dir = join(ctx.cfg.dataDir, 'hosted'); mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'model.enc'); this.keyFile = join(dir, 'model.key'); this.config = defaults();
    if (existsSync(this.file)) {
      const key = readFileSync(this.keyFile), e = JSON.parse(readFileSync(this.file, 'utf8'));
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'hex')); d.setAuthTag(Buffer.from(e.tag, 'hex'));
      this.config = this.validate(JSON.parse(Buffer.concat([d.update(Buffer.from(e.data, 'hex')), d.final()]).toString()));
      chmodSync(this.file, 0o600); chmodSync(this.keyFile, 0o600);
    }
    this.billing = new BillingStore({ file: join(dir, 'billing.json'), timezone: ctx.cfg.shellTz, now });
    this.saving = Promise.resolve();
  }
  validate(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new RunnerError('请填写托管模型配置。');
    if (raw.version === 2) return raw; // encrypted, server-created snapshots only; HTTP writes use saveCatalogSettings
    const previous = this.config, merged = { ...previous, ...raw };
    if (raw.apiKey !== undefined && (typeof raw.apiKey !== 'string' || raw.apiKey.length > 4096)) throw new RunnerError('API Key 格式或长度不正确。');
    if (raw.clearApiKey !== undefined && typeof raw.clearApiKey !== 'boolean') throw new RunnerError('清除密钥开关必须为布尔值。');
    if (typeof merged.baseURL !== 'string') throw new RunnerError('模型接口地址必须为字符串。');
    if (typeof merged.enabled !== 'boolean') throw new RunnerError('托管开关必须为布尔值。');
    if (!Number.isSafeInteger(merged.maxOutputTokens) || merged.maxOutputTokens < 256 || merged.maxOutputTokens > 32000) throw new RunnerError('最大输出须为 256–32000 token。');
    if (merged.pricesMicro === null && merged.enabled) throw new RunnerError('开放托管前请填写三个模型单价。');
    if (merged.pricesMicro !== null && (!merged.pricesMicro || !['miss','hit','output'].every(k => Number.isSafeInteger(merged.pricesMicro[k]) && merged.pricesMicro[k] >= 0))) throw new RunnerError('三个单价须为非负整数微元 / 百万 token。');
    const pricesMicro = merged.pricesMicro === null ? null : Object.fromEntries(['miss','hit','output'].map(k => [k, merged.pricesMicro[k]]));
    if (pricesMicro) reservationMicro(1000000, merged.maxOutputTokens, pricesMicro);
    const model = merged.model;
    if (typeof model !== 'string') throw new RunnerError('模型名称无效。');
    const baseURL = merged.baseURL || 'https://api.deepseek.com';
    try { modelURL(baseURL); } catch { throw new RunnerError('模型接口须为完整 HTTP(S) 地址，不能包含凭据、查询参数或片段。'); }
    // Key retention deliberately differs from resident BYOK: the admin owns this shared endpoint.
    const apiKey = raw.clearApiKey === true ? '' : raw.apiKey?.trim() || previous.apiKey;
    const parsed = runnerConfig({ provider: 'openai', model: model || 'unconfigured', baseURL, apiKey, thinking: merged.thinking, maxTokens: merged.maxOutputTokens });
    return { enabled: merged.enabled, baseURL: parsed.baseURL, model: model.trim(), apiKey: parsed.apiKey, thinking: parsed.thinking, maxOutputTokens: merged.maxOutputTokens, pricesMicro };
  }
  available(model) {
    if (this.config.version === 2) return !!(this.config.enabled && this.config.apiKey && (model ? this.config.models.some(m => m.id === model) : this.config.models.length)); return !!(this.config.enabled && this.config.model && this.config.apiKey && this.config.pricesMicro); }
  publicConfig() {
    const c = this.config;
    if (c.version === 2) return { enabled: c.enabled, available: this.available(), version: 2, priceVersion: c.priceVersion, exchangeRate: FX, multiplier: c.publishedMultiplier, maxOutputTokens: c.maxOutputTokens, models: MODEL_IDS.map(id => {
      const m = c.models.find(m => m.id === id);
      return m ? { id, available: this.available(id), pricesMicro: m.pricesMicro, tiers: m.tiers, priceVersion: c.priceVersion, samples: this.billing.modelSamples(id) } : { id, available: false, reason: '尚未发布可用价格或未通过兼容性验证' };
    }) };
    return { enabled: c.enabled, available: this.available(), model: c.model, thinking: c.thinking, maxOutputTokens: c.maxOutputTokens, pricesMicro: c.pricesMicro ? { ...c.pricesMicro } : null };
  }
  configView() { const { apiKey, ...config } = this.config; return { ...config, pricesMicro: config.pricesMicro ? { ...config.pricesMicro } : null, hasApiKey: !!apiKey }; }
  runnerChoice(raw, previous) {
    if (!this.available()) throw new RunnerError('平台托管尚未开放或模型未配置，请使用自己的模型。');
    if (this.config.version === 2) {
      const model = raw.model || previous?.model;
      if (!this.available(model) || !MODEL_IDS.includes(model)) throw new RunnerError('所选模型尚未开放，请选择可用模型。');
      return runnerConfig(raw, previous, { model });
    }
    return runnerConfig(raw, previous, { model: this.config.model });
  }
  snapshot(model) {
    if (this.config.version !== 2) return structuredClone(this.config);
    const item = this.config.models.find(m => m.id === model);
    if (!this.available(model) || !item) throw new RunnerError('模型不可用，请重新选择模型。');
    return structuredClone({ ...item, model: item.id, version: 2, baseURL: this.config.baseURL, apiKey: this.config.apiKey, thinking: 'default', maxOutputTokens: this.config.maxOutputTokens, priceVersion: this.config.priceVersion });
  }
  resolved(config = this.config) {
    return { provider: config.provider ?? 'openai', baseURL: config.baseURL, model: config.model, apiKey: config.apiKey, thinking: config.thinking,
      maxTokens: config.maxOutputTokens, toolMode: 'native', actionTools: 'typed', timeoutMs: 120000 };
  }
  provider(config) { return this.providerOverride ? this.providerOverride(config) : this.ctx.runners.provider(config); }
  save(raw, authorize = () => {}) {
    if (raw?.version === 2 || this.config.version === 2) return this.saveCatalogSettings(raw, authorize);
    // Serialize stop/restart against other administrator saves, including retained-key semantics.
    const task = this.saving.then(async () => {
      authorize(); const config = this.validate(raw);
      let key;
      if (existsSync(this.keyFile)) key = readFileSync(this.keyFile);
      else { key = randomBytes(32); durableFile(this.keyFile, key); }
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(config)), cipher.final()]);
      durableFile(this.file, JSON.stringify({ iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('hex') }));
      chmodSync(this.file, 0o600); chmodSync(this.keyFile, 0o600);
      this.config = config;
      await this.ctx.runners.refreshHosted();
      return { config: this.configView(), available: this.available() };
    });
    this.saving = task.catch(() => {}); return task;
  }
  persistCatalog(config) {
    let key = existsSync(this.keyFile) ? readFileSync(this.keyFile) : randomBytes(32);
    if (!existsSync(this.keyFile)) durableFile(this.keyFile, key);
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(config)), cipher.final()]);
    durableFile(this.file, JSON.stringify({ iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('hex') }));
    chmodSync(this.file, 0o600); chmodSync(this.keyFile, 0o600); this.config = config;
  }
  catalogTask(fn) {
    const task = this.saving.then(fn); this.saving = task.catch(() => {}); return task;
  }
  saveCatalogSettings(raw, authorize) {
    return this.catalogTask(async () => {
      authorize();
      const previous = this.config;
      const base = previous.version === 2 ? previous : { version: 2, enabled: false, baseURL: '', apiKey: '', multiplier: '1.2', publishedMultiplier: '1.2', maxOutputTokens: 4096, models: [], draft: null, priceVersion: null };
      const c = { ...base };
      if (raw.enabled !== undefined) { if (typeof raw.enabled !== 'boolean') throw new RunnerError('开放开关无效。'); c.enabled = raw.enabled; }
      if (raw.baseURL !== undefined) { try { modelURL(raw.baseURL); } catch { throw new RunnerError('请填写完整模型接口地址。'); } c.baseURL = raw.baseURL; }
      if (raw.apiKey !== undefined && (typeof raw.apiKey !== 'string' || raw.apiKey.length > 4096)) throw new RunnerError('API Key 格式无效。');
      c.apiKey = raw.clearApiKey === true ? '' : raw.apiKey?.trim() || base.apiKey;
      try { c.multiplier = checkMultiplier(raw.multiplier ?? base.multiplier); } catch (e) { throw new RunnerError(e.message); }
      c.maxOutputTokens = raw.maxOutputTokens ?? base.maxOutputTokens;
      if (!Number.isSafeInteger(c.maxOutputTokens) || c.maxOutputTokens < 256 || c.maxOutputTokens > 32000) throw new RunnerError('最大输出须为 256–32000 token。');
      if (c.apiKey !== base.apiKey || c.baseURL !== base.baseURL) { c.models = []; c.priceVersion = null; c.draft = null; }
      // A multiplier edit does not change published prices until an explicit publication.
      if (c.multiplier !== base.multiplier || c.maxOutputTokens !== base.maxOutputTokens) c.draft = null;
      this.persistCatalog(c);
      await this.ctx.runners.refreshHosted();
      return { config: this.configView(), available: this.available() };
    });
  }
  syncCatalog(authorize = () => {}) {
    return this.catalogTask(async () => {
      if (this.config.version !== 2) throw new RunnerError('请先保存 OpenLux 接入设置。');
      let entries;
      try {
        const response = await (this.pricingFetch ?? modelFetch(false, { timeoutMs: 20000 }))(PRICING_URL, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw Error();
        entries = selectCatalog(await response.json());
      } catch { throw new RunnerError('无法读取 OpenLux 官方价格，请稍后重试；已发布价格保持不变。'); }
      authorize();
      const draft = { id: randomUUID(), fetchedAt: new Date().toISOString(), source: PRICING_URL, multiplier: this.config.multiplier, entries, tested: {} };
      this.persistCatalog({ ...this.config, draft }); return { config: this.configView() };
    });
  }
  testCatalog(raw, authorize = () => {}) {
    return this.catalogTask(async () => {
      const c = this.config, draft = c.draft;
      if (c.version !== 2 || !draft || raw.draftId !== draft.id) throw new RunnerError('价格草稿已变化，请重新同步。');
      if (!c.apiKey || !c.baseURL) throw new RunnerError('请先保存平台接口地址和 API Key。');
      const entry = draft.entries.find(m => m.id === raw.model);
      if (!entry || (raw.autoGroup !== true && raw.groupConfirmed !== true)) throw new RunnerError('请核对该模型的 Key 所属分组。');
      let model;
      try { model = priceModel(entry, raw.autoGroup === true ? entry.groups[0]?.group : raw.group, draft.multiplier); } catch (e) { throw new RunnerError(e.message); }
      const config = { ...c, ...model, model: model.id, thinking: 'default' };
      let routingGroup = null;
      try {
        const provider = await this.provider({ ...this.resolved(config), timeoutMs: 60000, onResponse: response => { routingGroup = response.routingGroup; } });
        const result = await provider.step({ system: 'Connection test. Call done once.', transcript: [{ role: 'user', text: 'Call done with an empty object.' }], tools: [{ name: 'done', description: 'Finish.', schema: { type: 'object', properties: {}, additionalProperties: false } }], signal: AbortSignal.timeout(60000), timeoutMs: 60000 });
        if (!result?.calls?.some(call => call.name === 'done') || !Number.isSafeInteger(result.usage?.input) || !Number.isSafeInteger(result.usage?.output) || result.usage.input < 0 || result.usage.output < 0 || costMicro(result.usage, model.pricesMicro) === null) throw Error();
      } catch { throw new RunnerError('模型测试失败：请检查 Key 权限、模型接口、工具调用及用量返回。'); }
      if (raw.autoGroup === true) {
        if (!routingGroup) throw new RunnerError('上游没有返回实际路由分组，请手动核对 Key 分组。');
        try { model = priceModel(entry, routingGroup, draft.multiplier); } catch { throw new RunnerError('实际路由分组不在官方价格目录中，不能发布。'); }
      } else if (routingGroup && routingGroup !== raw.group) throw new RunnerError(`实际 Key 路由分组为 ${routingGroup}，与所选分组不同，请重新核验。`);
      authorize();
      model.testedAt = new Date().toISOString();
      const draftId = randomUUID();
      this.persistCatalog({ ...c, draft: { ...draft, id: draftId, tested: { ...draft.tested, [model.id]: model } } });
      return { ok: true, draftId, model: model.id, pricesMicro: model.pricesMicro };
    });
  }
  publishCatalog(raw, authorize = () => {}) {
    return this.catalogTask(async () => {
      authorize(); const c = this.config, d = c.draft;
      if (c.version !== 2 || !d || raw.draftId !== d.id) throw new RunnerError('价格草稿已变化，请刷新后确认。');
      if (!Array.isArray(raw.models) || !raw.models.length || new Set(raw.models).size !== raw.models.length || raw.models.some(id => !MODEL_IDS.includes(id) || !Object.hasOwn(d.tested, id))) throw new RunnerError('仅可发布已经测试通过的限定模型。');
      const models = raw.models.map(id => d.tested[id]);
      this.persistCatalog({ ...c, models, publishedMultiplier: d.multiplier, priceVersion: randomUUID(), publishedAt: new Date().toISOString(), draft: null });
      await this.ctx.runners.refreshHosted();
      return { config: this.configView(), available: this.available() };
    });
  }
  async test(raw) {
    if (this.config.version === 2 || raw?.version === 2) throw new RunnerError('请在 OpenLux 价格草稿中逐个验证模型。');
    const config = this.validate(raw);
    if (!config.model || !config.apiKey) throw new RunnerError('请填写模型名称和 API Key。');
    try {
      const provider = await this.provider({ ...this.resolved(config), timeoutMs: 20000 });
      const result = await provider.step({ system: 'Connection test. Call done once.', transcript: [{ role: 'user', text: 'Call done with an empty object.' }],
        tools: [{ name: 'done', description: 'Finish.', schema: { type: 'object', properties: {}, additionalProperties: false } }], signal: AbortSignal.timeout(20000), timeoutMs: 20000 });
      if (!result?.calls?.some(c => c.name === 'done')) throw new Error();
      return { ok: true, model: config.model };
    } catch { throw new RunnerError('托管模型连接测试失败，请检查接口、密钥与原生工具支持。'); }
  }
  accountView(id) { return { ...this.publicConfig(), storageFault: this.billing.fault, ...this.billing.accountView(id) }; }
  adminView() {
    const b = this.billing; b.prune();
    const today = emptyUsage();
    for (const d of b.data.daily) if (d.day === b.day()) addUsage(today, d);
    const accounts = Object.entries(b.data.accounts).filter(([, a]) => a.balanceMicro !== 0 || a.total.calls > 0).map(([accountId, a]) => ({ accountId, username: this.ctx.accounts.get(accountId)?.username ?? null, balanceMicro: a.balanceMicro, reservedMicro: b.reserved(accountId), total: structuredClone(a.total) }));
    const named = r => ({ ...r, username: this.ctx.accounts.get(r.accountId)?.username ?? null });
    return { config: this.configView(), available: this.available(), storageFault: b.fault, timezone: b.timezone, day: b.day(),
      stats: { balanceMicro: Object.values(b.data.accounts).reduce((n, a) => n + a.balanceMicro, 0), reservedMicro: b.reserved(), today: { ...today, tokens: today.input + today.output },
        hostedResidents: Object.keys(this.ctx.runners.records).filter(id => this.ctx.runners.records[id].config.hosted && this.ctx.runners.valid(id)).length },
      requests: b.data.requests.filter(r => r.status === 'pending').map(named),
      // 已处理与已撤回的最近 50 笔（按最后变更时间，新的在前）：用户说「我提交过」时，管理员能查到它后来怎样了
      history: b.data.requests.map((r, i) => [r, i]).filter(([r]) => r.status !== 'pending')
        .sort(([x, i], [y, j]) => Date.parse(y.updatedAt) - Date.parse(x.updatedAt) || j - i).slice(0, 50)
        .map(([r]) => ({ ...named(r), deciderName: r.decider ? this.ctx.accounts.get(r.decider)?.username ?? null : null })),
      accounts };
  }
}
