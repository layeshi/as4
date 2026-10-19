// Allowlisted, bounded telemetry shared by the runner and its persistence boundary.
import { ACTION_ORDER_P2, ACTION_ORDER_P4 } from '../e2/lore/actions.js';
import { ENTITY_LOOKS } from '../e2/entities/catalog.js';
import { safeErrorCode, classifyProviderError, boundedCount } from '../telemetry-safety.js';

const TOOLS = new Set([...ACTION_ORDER_P2, ...ACTION_ORDER_P4, 'entity', 'look', 'act', 'think', 'done', 'read_law', 'read_document', 'read_inscription', 'read_agent']);
const SECTIONS = new Set(ENTITY_LOOKS);
const LOOK_ERRORS = new Set(['looks_exhausted', 'no_waking', 'paused', 'not_awake', 'tokens_exhausted', 'cap_reached']);
const STAGES = new Set(['local_validation', 'unknown_tool', 'look_request']);
const FEATURES = ['entities', 'cooperation', 'programs', 'prayers'];
const HASH = /^[a-f0-9]{64}$/;
export const safeToolName = name => TOOLS.has(name) ? name : 'other';
export function cleanToolAttempt(value = {}) {
  value = value && typeof value === 'object' ? value : {};
  return { tool: safeToolName(value.tool), turn: boundedCount(value.turn, 1000) ?? 0,
    ...(SECTIONS.has(value.section) ? { section: value.section } : {}) };
}
export function cleanToolRejection(value = {}) {
  value = value && typeof value === 'object' ? value : {};
  return { ...cleanToolAttempt(value), stage: STAGES.has(value.stage) ? value.stage : 'other',
    codes: (Array.isArray(value.codes) ? value.codes : []).slice(0, 5).map(code => LOOK_ERRORS.has(code) ? code : safeErrorCode(code)) };
}
export function cleanCapabilities(value) {
  if (!value || typeof value !== 'object') return null;
  return { version: 1, features: Object.fromEntries(FEATURES.map(k => [k, value.features?.[k] === true])),
    toolCount: boundedCount(value.toolCount, 1000) ?? 0,
    ...Object.fromEntries(['systemHash', 'toolsHash'].filter(k => typeof value[k] === 'string' && HASH.test(value[k])).map(k => [k, value[k]])) };
}
export function cleanModelAttempt(value = {}) {
  value = value && typeof value === 'object' ? value : {};
  return { turn: boundedCount(value.turn, 1000) ?? 0, timeoutMs: boundedCount(value.timeoutMs) ?? 0, ms: boundedCount(value.ms) ?? 0,
    limitedBy: ['tick', 'configured'].includes(value.limitedBy) ? value.limitedBy : 'other',
    outcome: ['success', 'failure', 'aborted', 'deadline'].includes(value.outcome) ? value.outcome : 'other',
    ...(value.outcome !== 'success' ? classifyProviderError(value) : {}) };
}
