export const NOTIFICATION_TYPES = Object.freeze({
  death: '居民离世', diary: '新日记', runner_stopped: '托管异常停机', balance_low: '托管余额不足',
});
// Operators must select business-matching templates in the actual app console.
// No guessed template IDs or provider defaults: an empty configuration is inbox-only.
export function notificationTemplates(value = {}) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new Error('WECHAT_NOTIFICATION_TEMPLATES must be JSON'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid notification templates');
  const result = {};
  for (const [kind, t] of Object.entries(value)) {
    if (!Object.hasOwn(NOTIFICATION_TYPES, kind) || !t || !/^[\w-]{10,128}$/.test(t.templateId || '') ||
        !/^wx[a-f0-9]{16}$/.test(t.appid || '') || !t.fields || typeof t.fields !== 'object') throw new Error('Invalid notification template');
    const fields = Object.entries(t.fields);
    if (!fields.length || fields.some(([key, source]) => !/^(thing|time|character_string)\d+$/.test(key) || !['name', 'kind', 'time'].includes(source))) throw new Error('Invalid notification template fields');
    if (t.state && !['developer', 'trial', 'formal'].includes(t.state)) throw new Error('Invalid notification environment');
    result[kind] = { appid: t.appid, templateId: t.templateId, fields: { ...t.fields }, state: t.state || 'formal' };
  }
  return result;
}
export function notificationData(template, { name, kind, createdAt }) {
  const time = new Date(createdAt + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  const values = { name, kind: NOTIFICATION_TYPES[kind], time };
  return Object.fromEntries(Object.entries(template.fields).map(([key, source]) => [key, {
    value: key.startsWith('thing') ? Array.from(String(values[source])).slice(0, 20).join('') : String(values[source]),
  }]));
}
