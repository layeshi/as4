const STATUS = { awake: '醒着', dormant: '沉睡', dead: '离世', retired: '归隐', active: '生效', open: '进行中', passed: '通过', rejected: '未通过', repealed: '已废止', running: '运行中', paused: '已暂停', error: '故障', unconfigured: '未配置', no_line: '未接入' };
const EVENT = { say: '说话', broadcast: '广播', whisper: '私语公开', thought: '独白公开', move: '迁移', register: '入城', die: '离世', sleep: '沉睡', wake: '醒来', inscribe: '铭刻', role_reply: '公共角色回复', transfer: '转赠', repair: '修缮', propose: '提案', vote: '表决', enact: '立法', remember: '记忆公开', admin: '城市管理', weather: '天象', birth: '诞生', retire: '归隐' };
function text(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') return text(value.zh || value.text || value.name || value.title, fallback);
  return fallback;
}
function number(value) { return Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US') : '—'; }
function status(value) { return STATUS[value] || value || '—'; }
function placeName(place) { return text(place.displayName || place.name || place.humanName, place.id); }
function units(state) { return state.world && (state.world.tokens || state.world.premise >= 4) ? '词元' : '能量'; }
function resident(agent, state = {}) {
  const place = (state.places || []).find(p => p.id === agent.place);
  return Object.assign({}, agent, { statusText: status(agent.status), energyText: number(agent.energy), materialsText: number(agent.materials), coinsText: number(agent.coins), placeText: place ? placeName(place) : agent.place || '—', bioText: text(agent.bio), purposeText: text(agent.purpose) });
}
function eventRows(events, state = {}) {
  const names = {};
  (state.agents || []).forEach(a => { names[a.id] = a.name; });
  (state.places || []).forEach(p => { names[p.id] = placeName(p); });
  return events.slice().reverse().map(e => {
    const data = e.data || {};
    const body = e.redacted ? text(data.text, '此处已被遮盖') : text(data.text || data.message || data.title);
    const destination = data.to && (typeof data.to === 'string' ? data.to : data.to.id);
    return { seq: e.seq, day: e.day + 1, label: EVENT[e.type] || '城市事件 · ' + e.type, actor: names[e.agent] || text(data.name), place: names[e.place] || '', body: body || (destination ? '前往 ' + (names[destination] || destination) : ''), ai: !!body && !e.redacted };
  });
}
function reading(law) {
  const zh = law.reading && (law.reading.zh || law.reading);
  if (!zh) return '';
  const pieces = [];
  function visit(value) {
    if (typeof value === 'string') pieces.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.keys(value).forEach(k => visit(value[k]));
  }
  visit(zh);
  return pieces.join('\n');
}
function detailUrl(kind, id) { return '/pages/detail/index?kind=' + kind + '&id=' + encodeURIComponent(id); }
module.exports = { text, number, status, placeName, units, resident, eventRows, reading, detailUrl };
