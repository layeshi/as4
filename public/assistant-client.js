// No conversation text or verification credentials are written to browser storage.
export function questionScope(fields) {
  const scope = { mode: fields.mode || 'public' };
  for (const key of ['agentId', 'lawId', 'city', 'branchId']) if (fields[key]) scope[key] = fields[key];
  for (const key of ['fromDay', 'toDay']) if (fields[key] !== '' && fields[key] != null) {
    const day = Number(fields[key]);
    if (!Number.isSafeInteger(day) || day < 1) throw Error('世界日期须为正整数 / Enter a positive world day');
    scope[key] = day - 1;
  }
  if (scope.fromDay > scope.toDay) throw Error('起止日期顺序无效 / Invalid date range');
  return scope;
}
export async function assistantRequest(path, { method = 'GET', body, keys = {} } = {}) {
  const headers = {};
  if (method !== 'GET') headers['X-Houren-Request'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (keys.adminKey) headers['X-Admin-Key'] = keys.adminKey;
  if (keys.ownerKey) headers['X-Owner-Key'] = keys.ownerKey;
  const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(method === 'POST' && path === '/api/assistant/questions' ? 65000 : 15000) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(Error(data.error?.message || data.error?.code || '请求失败 / Request failed'), { status: response.status, code: data.error?.code, resetAt: data.error?.resetAt || data.resetAt });
  return data;
}
export class AssistantClient {
  constructor(request = assistantRequest) { this.request = request; this.version = 0; this.owner = null; this.reset(); }
  reset() { this.version++; this.keys = {}; this.conversation = null; this.source = null; this.status = null; this.questionId = null; this.lastQuestion = null; }
  account(id) { if (id !== this.owner) { this.reset(); this.owner = id; } }
  // 带上本页内存里的密钥：旧世界私人对话的标题也要凭密钥复核后才显示。
  async statusRead() { const v = this.version; const data = await this.request('/api/assistant/status', { keys: this.keys }); if (v === this.version) this.status = data; return data; }
  async open(id) {
    const v = ++this.version; this.source = null;
    try { const data = await this.request('/api/assistant/conversations/' + encodeURIComponent(id), { keys: this.keys }); if (v === this.version) this.conversation = data.conversation; }
    catch (error) { if (v === this.version) { this.conversation = null; this.source = null; this.lastQuestion = null; } throw error; }
  }
  async ask(text, scope) {
    const v = this.version;
    this.lastQuestion = { text, scope };
    const data = await this.request('/api/assistant/questions', { method: 'POST', body: { text, scope, ...(this.conversation ? { conversationId: this.conversation.id } : {}) }, keys: this.keys });
    if (v !== this.version) return;
    this.questionId = data.questionId;
    await this.open(data.conversationId);
  }
  get active() { return this.conversation?.messages?.some(m => ['generating', 'pending'].includes(m.status)); }
  async cancel() {
    const m = this.conversation?.messages?.findLast(m => m.status === 'generating');
    const id = m?.questionId || this.questionId || m?.id;
    if (id) await this.request('/api/assistant/questions/' + encodeURIComponent(id) + '/cancel', { method: 'POST', body: {}, keys: this.keys });
  }
  async remove(id) { this.version++; this.conversation = null; this.source = null; this.lastQuestion = null; this.questionId = null; await this.request('/api/assistant/conversations/' + encodeURIComponent(id), { method: 'DELETE', body: {}, keys: this.keys }); }
  async readSource(id) {
    if (!this.conversation) return;
    const v = this.version; this.source = null;
    try { const data = await this.request('/api/assistant/conversations/' + encodeURIComponent(this.conversation.id) + '/sources/' + encodeURIComponent(id), { keys: this.keys }); if (v === this.version) this.source = data.source; }
    catch (error) { if (v === this.version) { this.conversation = null; this.source = null; this.lastQuestion = null; } throw error; }
  }
}
