// 我的居民 → 居民提醒（按居民、按类型开关与微信授权）与提醒记录。不展示微信内部标识或模板编号。
const N = require('../ui/nodes');
const { C } = require('../ui/theme');
const { usable } = require('../utils/feed');
const view = require('../utils/view');
// 北京时间，记录行内只留月日与时分。
function shortTime(ms) {
  const date = new Date(Number(ms) + 8 * 60 * 60 * 1000), pad = v => String(v).padStart(2, '0');
  return Number.isFinite(date.getTime()) ? `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}` : '—';
}
const { DELIVERY } = require('../notifications');

const privacyLink = { label: '《隐私说明》', action: { type: 'about' } };
const nameOf = a => usable(a?.name) ? a.name : '我的居民';
function login(W, title) {
  return { top: { kind: 'back', title }, tabbar: false, nodes: [N.empty(W, '登录后管理居民提醒', '提醒只发给居民当前的管理者。请先在「我的」中微信登录。'), N.button(W, '前往我的并登录', { type: 'tab', tab: 'account' }, { variant: 'primary' })] };
}
const OUTCOME = {
  accepted: ['已授权微信提醒', '每次同意只对应有限次数的微信通知，用完后可回到这里再次授权。'],
  partial: ['部分微信提醒已授权', '未同意的类型只在小程序内记录，可稍后再授权。'],
  rejected: ['你未同意本次微信提醒', '不会再自动弹出授权；已开启的提醒照常在小程序内记录，需要时可再次授权。'],
  banned: ['微信提醒已在微信中关闭', '如需接收，可在小程序右上角「···」→ 设置 → 通知管理中重新开启，再回到这里授权。'],
  switchOff: ['小程序通知已关闭', '可在小程序右上角「···」→ 设置中打开通知，再回到这里授权。'],
  failed: ['微信授权未完成', '可以稍后再试；已开启的提醒照常在小程序内记录。'],
  unavailable: ['微信通知暂不可用', '这些提醒暂时只在小程序内记录。'],
};
function wechatCard(app, W) {
  const n = app.notifications, s = n.summary, a = n.auth, f = app.form;
  return N.card(W, iw => {
    const rows = [N.text(iw, '微信通知', { style: 'heading', bold: true })];
    const outcome = OUTCOME[n.outcome];
    if (!n.wechatAvailable) {
      rows.push(N.text(iw, '当前没有可用的微信提醒模板，暂时无法发送微信通知。开启的提醒仍会记录在小程序内，可随时在「提醒记录」查看。', { style: 'meta', color: C.text2 }));
      return rows;
    }
    // 服务端依据当前微信会话或已保存的有效绑定判断；不要求先重新登录。
    if (!s.bindingReady) {
      rows.push(N.text(iw, '当前没有可用的微信身份，无法授权微信通知。请用微信登录本小程序并关联当前账号；在此之前，开启的提醒只在小程序内记录。', { style: 'meta', color: C.text2 }),
        N.button(iw, app.wechatLinked ? '重新微信登录' : '微信登录并关联', { type: 'wechatLogin' }, { variant: 'primary' }),
        N.checkbox(iw, '我已阅读并同意', !!f.accepted, { type: 'toggle', name: 'accepted' }, privacyLink));
      return rows;
    }
    if (outcome) rows.push(N.text(iw, outcome[0], { style: 'action', bold: true, color: ['accepted', 'partial'].includes(n.outcome) ? C.awake : C.token }), N.text(iw, outcome[1], { style: 'meta', color: C.text2 }));
    if (a.stage === 'ready' || a.stage === 'requesting') {
      rows.push(N.text(iw, '已准备好本次授权。点击下方按钮后，微信会列出可授权的提醒，由你逐项选择。', { style: 'meta', color: C.text2 }),
        N.buttonRow(iw, [{ label: '暂不授权', action: { type: 'notificationSkip' }, variant: 'secondary' }, { label: '授权微信提醒', action: { type: 'notificationAuthorize' }, variant: 'primary' }], 10));
    } else if (a.stage === 'submitting') rows.push(N.text(iw, '正在保存授权结果…', { style: 'meta', color: C.text3 }));
    else if (!n.wanted().length) rows.push(N.text(iw, '先在下方为居民开启提醒；带“微信”标记的类型可再授权微信通知。', { style: 'meta', color: C.text2 }));
    else {
      const more = a.done.length > 0 && !!n.nextBatch();
      if (!outcome) rows.push(N.text(iw, s.needsAuthorization ? '有已开启的提醒还没有可用的微信授权。补充授权后才会发送新的微信通知，此前漏发的不会补发。' : '已开启的提醒可授权微信通知；未授权时只在小程序内记录。', { style: 'meta', color: C.text2 }));
      rows.push(N.button(iw, more ? '继续授权其余提醒' : n.outcome ? '再次授权微信提醒' : '开启微信通知', { type: 'notificationPrepare', restart: !more }, { variant: more || !n.outcome ? 'primary' : 'secondary' }));
    }
    rows.push(N.text(iw, '微信通知按次授权，不承诺永久推送；只显示居民名称、提醒类型和发生时间。日记正文、余额和错误详情需在小程序内登录后查看。', { style: 'caption', color: C.text3 }));
    return rows;
  }, { pad: 14, gap: 10 });
}
function residentCard(app, W, resident) {
  const n = app.notifications, id = resident.agentId || resident.id, on = n.subscribed(id);
  return N.card(W, iw => [
    N.section(iw, nameOf(resident), { small: true, sub: view.status(resident.status), link: on.length ? { label: '全部关闭', action: { type: 'notificationAllOff', agentId: id } } : null }),
    N.menu(iw, n.types().map(t => ({ label: t.label + (t.available ? ' · 微信' : ' · 仅小程序内'), toggle: on.includes(t.key), action: { type: 'notificationToggle', agentId: id, key: t.key } }))),
  ], { pad: 14, gap: 10 });
}
function notifications(app, W) {
  const title = '居民提醒';
  if (!app.user) return login(W, title);
  const n = app.notifications, nodes = [];
  nodes.push(N.text(W, '按居民、按类型开启，默认全部关闭。只提醒开启之后的新动态，不补发历史；退出登录不会取消已开启的提醒。', { style: 'meta', color: C.text2 }));
  nodes.push(N.menu(W, [{ label: '提醒记录', hint: n.unread ? `${n.unread} 条未读` : '90 天内', icon: 'bell', action: { type: 'notificationRecords' } }]));
  if (n.error) nodes.push(N.banner(W, { title: '无法读取提醒设置', body: n.error, actions: [{ label: '重试', action: { type: 'notificationRefresh' }, variant: 'secondary' }] }));
  if (!n.summary) {
    if (!n.error) nodes.push(N.empty(W, '正在读取提醒设置…'));
    return { top: { kind: 'back', title }, nodes, tabbar: false, pull: true };
  }
  nodes.push(wechatCard(app, W));
  nodes.push(N.section(W, '我的居民', { small: true, sub: app.linked.length ? `${app.linked.length} 位` : '' }));
  if (!app.linked.length) nodes.push(N.empty(W, '还没有管理中的居民', '新创建、领养或过继得到的居民，需要在这里主动开启提醒。'));
  for (const resident of app.linked) nodes.push(residentCard(app, W, resident));
  nodes.push(N.card(W, iw => [N.text(iw, '提醒时机', { style: 'action', bold: true })].concat(n.types().map(t => N.text(iw, `${t.label}：${t.timing}`, { style: 'meta', color: C.text2 }))), { pad: 14, gap: 6 }));
  nodes.push(N.text(W, '同一次故障只提醒一次，恢复后再次发生才会重新提醒。居民过继后，原管理者不再收到它的提醒。', { style: 'caption', color: C.text3 }));
  return { top: { kind: 'back', title }, nodes, tabbar: false, pull: true };
}
function recordRow(app, W, r) {
  const n = app.notifications, resident = app.linked.find(a => (a.agentId || a.id) === r.agentId);
  const kind = n.label(r.kind), title = usable(r.title) ? r.title : kind;
  const count = r.kind === 'diary' && r.count > 1 ? `新增 ${r.count} 篇` : r.count > 1 ? `共 ${r.count} 次` : '';
  const delivery = r.kind === 'diary' && r.delivery === 'pending' ? '20:00 汇总发送微信' : DELIVERY[r.delivery] || DELIVERY.unknown;
  return N.listRow(W, { avatar: { id: r.agentId, name: resident ? nameOf(resident) : kind }, title, chip: r.readAt ? null : { label: '未读', color: C.token },
    sub: [resident ? nameOf(resident) : '', kind, count].filter(Boolean).join(' · '), meta: shortTime(r.createdAt) + ' · ' + delivery, chevron: true, action: { type: 'notificationOpen', id: r.id } });
}
function notificationRecords(app, W) {
  const title = '提醒记录';
  if (!app.user) return login(W, title);
  const n = app.notifications, nodes = [N.text(W, '保留最近 90 天。点开会重新验证你对居民的管理权，再显示详情。', { style: 'meta', color: C.text2 }),
    N.section(W, '最近提醒', { small: true, sub: n.unread ? `${n.unread} 条未读` : '', link: n.unread ? { label: '全部已读', action: { type: 'notificationReadAll' } } : { label: '刷新', action: { type: 'notificationRefresh' } } })];
  if (n.recordsError) nodes.push(N.banner(W, { title: '无法读取提醒记录', body: n.recordsError, actions: [{ label: '重试', action: { type: 'notificationRefresh' }, variant: 'secondary' }] }));
  if (n.recordsLoading && !n.records.length) nodes.push(N.text(W, '正在加载提醒记录…', { style: 'meta', color: C.text3 }));
  if (n.recordsLoaded && !n.records.length) nodes.push(N.empty(W, '还没有提醒', '开启居民提醒后，新的动态会记录在这里。'));
  if (n.records.length) nodes.push(N.stack(n.records.map(r => recordRow(app, W, r))));
  if (n.hasMore) nodes.push(N.button(W, n.recordsLoading ? '正在加载…' : '加载更早的提醒', { type: 'notificationRecordsMore' }, { variant: 'secondary' }));
  return { top: { kind: 'back', title }, nodes, tabbar: false, pull: true };
}
module.exports = { notifications, notificationRecords };
