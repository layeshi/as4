import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { durableFile } from '../durable-file.js';
import { runnerConfig, RunnerError } from '../runner/manager.js';
import { modelURL } from '../runner/endpoint.js';
import { BillingStore, emptyUsage, addUsage, reservationMicro } from './billing.js';

const defaults = () => ({ enabled: false, baseURL: 'https://api.deepseek.com', model: '', apiKey: '', thinking: 'default', maxOutputTokens: 4096, pricesMicro: null });
export class HostedService {
  constructor(ctx, { now = Date.now, provider } = {}) {
    this.ctx = ctx; this.providerOverride = provider;
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
  available() { return !!(this.config.enabled && this.config.model && this.config.apiKey && this.config.pricesMicro); }
  publicConfig() {
    const c = this.config;
    return { enabled: c.enabled, available: this.available(), model: c.model, thinking: c.thinking, maxOutputTokens: c.maxOutputTokens, pricesMicro: c.pricesMicro ? { ...c.pricesMicro } : null };
  }
  configView() { const { apiKey, ...config } = this.config; return { ...config, pricesMicro: config.pricesMicro ? { ...config.pricesMicro } : null, hasApiKey: !!apiKey }; }
  runnerChoice(raw, previous) {
    if (!this.available()) throw new RunnerError('平台托管尚未开放或模型未配置，请使用自己的模型。');
    return runnerConfig(raw, previous, { model: this.config.model });
  }
  resolved(config = this.config) {
    return { provider: 'openai', baseURL: config.baseURL, model: config.model, apiKey: config.apiKey, thinking: config.thinking,
      maxTokens: config.maxOutputTokens, toolMode: 'native', actionTools: 'typed', timeoutMs: 120000 };
  }
  provider(config) { return this.providerOverride ? this.providerOverride(config) : this.ctx.runners.provider(config); }
  save(raw, authorize = () => {}) {
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
  async test(raw) {
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
