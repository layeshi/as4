// Telemetry is a separate trust boundary: never copy model or upstream text into it.
import { ACTION_ORDER as LEGACY_ACTIONS } from './lore/actions.js';
import { ACTION_ORDER_P2 } from './e2/lore/actions.js';
const ACTIONS = new Set([...LEGACY_ACTIONS, ...ACTION_ORDER_P2]);
const ERRORS = new Set(('already already_city auth budget_exhausted capacity cooldown cost_unproven disabled_by_weather empty_new_article exiled forbidden fuel gated insufficient insufficient_coins insufficient_energy internal invalid_args invalid_request landmark limit_reached lot_taken memory_full moderated name_taken no_module no_such_article no_such_version not_active not_allowed not_citizen not_city_owned not_eligible not_found not_in_scope not_member not_ownable not_owner not_steward not_visible nothing_left out_of_range overflow div0 type pool_exhausted proof_breach protected quota_exceeded rule_invalid target_gone text_too_long unknown_op vars_full wall_full wrong_place').split(' '));
const FINISH = new Set(['stop', 'end', 'queued', 'in_progress', 'length', 'tool_calls', 'function_call', 'end_turn', 'max_tokens', 'stop_sequence', 'refusal', 'content_filter', 'tool_use', 'pause_turn', 'incomplete', 'completed', 'unknown']);
const KINDS = new Set(['timeout', 'network', 'http', 'auth', 'rate_limit', 'invalid_response', 'unknown']);
export const safeActionType = value => ACTIONS.has(value) ? value : 'other';
export const safeErrorCode = value => ERRORS.has(value) ? value : 'other';
export const safeFinishReason = value => FINISH.has(value) ? value : 'unknown';
export const boundedCount = (value, max = 1e9) => Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), max) : null;
const httpStatus = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
// Values from upstream responses are untrusted; persist only bounded protocol fields.
const UPSTREAM_TYPES = new Set(('authentication authorization invalid_api_key insufficient_credits insufficient_quota rate_limit_exceeded rate_limited server server_error overloaded provider_overloaded upstream_timeout provider_timeout timeout invalid_request bad_request context_length_exceeded max_tokens_exceeded token_limit_exceeded string_too_long model_not_found no_available_provider content_policy_violation moderation internal_server_error permission_denied payment_required provider_unavailable invalid_prompt not_found precondition_failed payload_too_large unprocessable refusal invalid_image image_too_large image_too_small unsupported_image_format image_not_found image_download_failed unmapped').split(' '));
const PROVIDER_CODES = new Set([...UPSTREAM_TYPES, 'invalid_prompt', 'invalid_image', 'invalid_request_error', 'image_content_policy_violation']);
const PHASES = new Set(['request', 'decode', 'shape', 'response']);
export function safeProviderFailureDetails(error = {}) {
  return {
    ...(KINDS.has(error?.errorKind) ? { errorKind: error.errorKind } : {}),
    ...(UPSTREAM_TYPES.has(error?.upstreamErrorType) ? { upstreamErrorType: error.upstreamErrorType } : {}),
    ...(httpStatus(error?.providerCode) || PROVIDER_CODES.has(error?.providerCode) ? { providerCode: error.providerCode } : {}),
    ...(PHASES.has(error?.phase) ? { phase: error.phase } : {}),
  };
}
export function classifyProviderError(error) {
  const status = httpStatus(error?.status);
  let errorKind = status === 401 || status === 403 ? 'auth' : status === 429 ? 'rate_limit' : status ? 'http' : 'unknown';
  const code = error?.code || error?.cause?.code;
  if (!status && (error?.timeout === true || error?.name === 'TimeoutError' || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(code))) errorKind = 'timeout';
  else if (!status && ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET'].includes(code)) errorKind = 'network';
  // A 2xx HTTP status can still carry a provider business failure. Do not invent an HTTP status.
  if (!status || status < 300) {
    const details = safeProviderFailureDetails(error);
    const type = details.upstreamErrorType || details.providerCode;
    if (details.errorKind) errorKind = details.errorKind;
    else if (['rate_limit_exceeded', 'rate_limited', 429].includes(type)) errorKind = 'rate_limit';
    else if (['authentication', 'authorization', 'permission_denied', 'invalid_api_key', 401, 403].includes(type)) errorKind = 'auth';
    else if (['upstream_timeout', 'provider_timeout', 'timeout', 408].includes(type)) errorKind = 'timeout';
    else if (type !== undefined) errorKind = 'http';
    else if (status && status < 300) errorKind = 'unknown';
  }
  return { ...safeProviderFailureDetails(error), errorKind, ...(status ? { status } : {}) };
}
export function providerErrorLabel(error) {
  const { errorKind, status } = classifyProviderError(error);
  return status ? `${errorKind} HTTP ${status}` : errorKind;
}
export function safeCallMetadata(meta = {}, reportedUsage = false) {
  const failure = meta.ok === false;
  const classified = failure ? classifyProviderError(meta.error) : {};
  const toolCallCount = boundedCount(meta.toolCallCount, 1000);
  return {
    reportedUsage: reportedUsage === true,
    ...(failure ? { ...classified, ...(KINDS.has(meta.errorKind) ? { errorKind: meta.errorKind } : {}) } : {}),
    ...(meta.finishReason !== undefined ? { finishReason: safeFinishReason(meta.finishReason) } : {}),
    ...(toolCallCount !== null ? { toolCallCount } : {}),
  };
}
export function cleanPersistedMetadata(call = {}) {
  return {
    ...safeProviderFailureDetails(call),
    ...(httpStatus(call.status) ? { status: call.status } : {}),
    ...(typeof call.reportedUsage === 'boolean' ? { reportedUsage: call.reportedUsage } : {}),
    ...(call.errorKind !== undefined ? { errorKind: KINDS.has(call.errorKind) ? call.errorKind : 'unknown' } : {}),
    ...(call.finishReason !== undefined ? { finishReason: safeFinishReason(call.finishReason) } : {}),
    ...(boundedCount(call.toolCallCount, 1000) !== null ? { toolCallCount: boundedCount(call.toolCallCount, 1000) } : {}),
  };
}
/** Old callers and persisted shapes remain unchanged until metadata is enriched. */
export const hasDiagnosticMetadata = (meta = {}) => meta.finishReason !== undefined || meta.toolCallCount !== undefined || meta.errorKind !== undefined || meta.error?.errorKind !== undefined || meta.error?.timeout === true || PHASES.has(meta.error?.phase) || UPSTREAM_TYPES.has(meta.error?.upstreamErrorType);

/** Only known categories and bounded counts cross the persistence boundary. */
export function cleanDiagnostics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const cleanMap = (map, allowed) => Object.fromEntries(Object.entries(map && typeof map === 'object' && !Array.isArray(map) ? map : {}).filter(([key, count]) => allowed.has(key) && boundedCount(count) !== null).map(([key, count]) => [key, boundedCount(count)]));
  return {
    calls: boundedCount(value.calls) ?? 0, failed: boundedCount(value.failed) ?? 0,
    errorKinds: cleanMap(value.errorKinds, KINDS), finishReasons: cleanMap(value.finishReasons, FINISH),
    toolCallCount: boundedCount(value.toolCallCount) ?? 0, unknownUsage: boundedCount(value.unknownUsage) ?? 0,
  };
}

export function addCallDiagnostics(bucket, meta, reportedUsage) {
  if (!hasDiagnosticMetadata(meta)) return;
  const d = cleanDiagnostics(bucket.diagnostics) || cleanDiagnostics({});
  const increment = (into, key, n = 1) => { into[key] = Math.min(1e9, (into[key] || 0) + n); };
  const safe = safeCallMetadata(meta, reportedUsage);
  increment(d, 'calls');
  if (meta.ok === false) { increment(d, 'failed'); increment(d.errorKinds, safe.errorKind); }
  if (safe.finishReason !== undefined) increment(d.finishReasons, safe.finishReason);
  increment(d, 'toolCallCount', safe.toolCallCount || 0);
  if (!safe.reportedUsage) increment(d, 'unknownUsage');
  bucket.diagnostics = d;
}

/** Legacy string log adapter; exact grammars keep arbitrary suffixes out. */
export function safeRuntimeLog(message, level = 'info') {
  const m = typeof message === 'string' ? message : '';
  if (/^\s*独白/.test(m)) return null;
  const action = /^\s*([✓✗])\s+([a-z][a-z0-9_]*)(?:（−(\d+)）|\s+([a-z][a-z0-9_]*))?$/.exec(m);
  if (action) return `  ${action[1]} ${safeActionType(action[2])}${action[1] === '✗' ? ` ${safeErrorCode(action[4])}` : action[3] ? `（−${action[3]}）` : ''}`;
  if (/^模型用时 \d+(?:\.\d+)? s(?: · 输入 \d+ · 输出 \d+ token(?: · 思考 \d+)?)?(?: · stop=[a-z_]+)?$/.test(m)) {
    return m.replace(/stop=([a-z_]+)/, (_, reason) => `stop=${safeFinishReason(reason)}`);
  }
  if (/^(?:本刻不行动。|本刻不调用模型（预算 \/ 匀速 \/ 暂停）。|城中的时间静止了，等待。|模型拒绝了这一轮请求；本刻不行动。|认证失败。停止该 agent。)$/.test(m)) return m;
  if (/^提供者出错：(timeout|network|http|auth|rate_limit|invalid_response|unknown)(?: HTTP [1-5]\d\d)?；(?:本刻不行动|这次醒来到此为止)。$/.test(m)) return m;
  if (/^(timeout|network|http|auth|rate_limit|invalid_response|unknown)(?: HTTP [1-5]\d\d)? 停止该 agent。$/.test(m)) return m;
  return level === 'info' ? null : '运行告警（正文已省略）';
}
