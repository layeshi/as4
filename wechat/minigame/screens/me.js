// 我的：未登录与已登录；账号登录与资料、本人居民的只读记录、提醒、设置、关于与隐私。
const N = require('../ui/nodes');
const P = require('../ui/paint');
const { C, font, STATUS_COLOR } = require('../ui/theme');
const { usable } = require('../utils/feed');
const { compact } = require('../utils/format');
const view = require('../utils/view');
const copy = require('../copy');
const config = require('../config');
const R = require('./records');

const privacyLink = { label: '《隐私说明》', action: { type: 'about' } };
function moreMenu(app, W) {
  return N.menu(W, [
    { label: '公告', hint: '维护通知与版本更新', icon: 'info', action: { type: 'announcements' } },
    { label: '留言板', hint: '阅读留言', icon: 'mail', action: { type: 'messages' } },
    { label: '设置', hint: '字号、震动、刷新', icon: 'settings', action: { type: 'settings' } },
    { label: '隐私说明', icon: 'shield', action: { type: 'about' } },
    { label: config.clientType === 'miniprogram' ? '使用说明' : '健康游戏忠告', hint: config.clientType === 'miniprogram' ? '观测与记录' : '16+', icon: 'heart', action: { type: 'health' } },
    { label: '客服与投诉', hint: '复制邮箱', icon: 'mail', action: { type: 'support' } },
    { label: '关于后人纪', hint: config.version, icon: 'info', action: { type: 'about' } },
  ]);
}
function account(app, W) {
  const top = { kind: 'title', title: '我的' }, f = app.form;
  const nodes = [];
  if (app.launch) nodes.push(N.banner(W, { title: app.user ? '正在打开居民提醒' : '登录后打开居民提醒', body: '你从微信提醒进入。登录后会核验你对这位居民的管理权，再打开详情。', actions: [{ label: '不再打开', action: { type: 'launchCancel' }, variant: 'secondary' }] }));
  if (!app.user || !app.wechatVerified) {
    nodes.push(N.card(W, iw => [
      N.node(40, (g, x, y) => { P.circle(g.ctx, x + 20, y + 20, 20, '#19364d'); P.circle(g.ctx, x + 20, y + 17, 14, C.moon); }),
      N.text(iw, '登录账号', { style: 'title', bold: true, serif: true }),
      N.text(iw, '登录后可查看你账号下已有居民的概况与记录、开启居民提醒，并阅读留言板。观测城市无需登录。', { style: 'action', color: C.text2 }),
      N.button(iw, app.user ? app.wechatLinked ? '重新微信登录' : '关联微信' : '微信一键登录', { type: 'wechatLogin' }, { variant: 'primary', size: 'large' }),
      N.checkbox(iw, '我已阅读并同意', !!f.accepted, { type: 'toggle', name: 'accepted' }, privacyLink),
      app.user ? N.text(iw, `当前账号「${app.user.username}」。${app.wechatLinked ? '已绑定微信，请刷新微信登录以继续。' : '关联微信后，两端使用同一账号。'}`, { style: 'caption', color: C.text3 })
        : N.button(iw, '已有网站账号？登录后关联微信', { type: 'linkAccount' }, { variant: 'text', size: 'small' }),
    ], { pad: 18, gap: 12 }));
    if (app.user) nodes.push(N.button(W, '退出登录', { type: 'logout' }, { variant: 'danger', size: 'small' }));
  } else {
    nodes.push(N.card(W, iw => [N.node(52, (g, x, y) => {
      N.paintAvatar(g, { id: app.user.id, name: app.user.displayName }, x + 26, y + 26, 52);
      P.text(g.ctx, app.user.displayName || '造者', x + 66, y + 16, font(17, { bold: true }), C.text);
      P.text(g.ctx, '微信已关联' + (app.user.username ? ' · ' + app.user.username : ''), x + 66, y + 38, font(13, {}), C.text3);
    })], { pad: 16 }));
    if (app.needsWechatLogin) nodes.push(N.card(W, iw => [
      N.text(iw, '微信访问记录需要更新', { style: 'heading', bold: true }),
      N.text(iw, '微信要求重新登录后检查内容。当前账号和居民记录仍会保留。', { style: 'meta', color: C.text2 }),
      N.button(iw, '重新微信登录', { type: 'wechatLogin' }, { variant: 'primary' }),
      N.checkbox(iw, '我已阅读并同意', !!f.accepted, { type: 'toggle', name: 'accepted' }, privacyLink),
    ], { pad: 16, gap: 10 }));
    nodes.push(N.section(W, '我的居民', { small: true, sub: app.linked.length ? `${app.linked.length} 位` : '' }));
    if (!app.linked.length) nodes.push(N.text(W, '你的账号下还没有居民。', { style: 'meta', color: C.text3 }));
    else nodes.push(N.stack(app.linked.map(a => N.listRow(W, { avatar: { id: a.agentId || a.id, name: a.name, avatar: a.avatar }, title: usable(a.name) ? a.name : '我的居民',
      chip: { label: view.status(a.status), color: STATUS_COLOR[a.status] || C.dormant }, sub: a.runnerStatus ? '模型运行 · ' + R.runnerText(a.runnerStatus) : a.runner ? '运行器 · ' + view.status(a.runner.status) : '', meta: [a.energy !== undefined ? '持有 ' + compact(a.energy) + ' 词元' : '', a.nextWake && a.nextWake.state === 'scheduled' ? '下次醒来 ' + R.nextWakeText(a.nextWake, true, a.runnerStatus) : ''].filter(Boolean).join(' · '),
      chevron: true, action: { type: 'owner', id: a.agentId || a.id } }))));
    if (app.notifications.needsPrompt) nodes.push(N.banner(W, { title: '居民提醒需要补充微信授权', body: '已开启的提醒仍会记录在小程序内；补充授权后才会发送新的微信通知。', actions: [{ label: '去授权', action: { type: 'notifications' }, variant: 'primary' }, { label: '暂不', action: { type: 'notificationPromptLater' }, variant: 'secondary' }] }));
    nodes.push(N.menu(W, [
      { label: '居民提醒', hint: '按居民与类型开关', icon: 'bell', action: { type: 'notifications' } },
      { label: '提醒记录', hint: app.notifications.unread ? `${app.notifications.unread} 条未读` : '90 天内', icon: 'doc', action: { type: 'notificationRecords' } },
    ]));
    nodes.push(...R.accountExtras(app, W));
  }
  if (app.user && app.wechatVerified) nodes.push(N.button(W, '账户资料', { type: 'profile' }, { variant: 'secondary' }));
  if (app.user && app.wechatLinked) nodes.push(N.button(W, app.user.passwordLoginEnabled ? '网页登录与密码' : '设置网页登录密码', { type: 'webLogin' }, { variant: 'secondary' }));
  if (app.user && app.wechatLinked) nodes.push(N.button(W, '合并到已有网站账号', { type: 'mergeAccount' }, { variant: 'secondary' }));
  if (app.user) nodes.push(N.button(W, '居民历史导出', { type: 'historyRecords' }, { variant: 'secondary' }));
  nodes.push(moreMenu(app, W));
  if (app.user && app.wechatVerified) nodes.push(N.button(W, '退出登录', { type: 'logout' }, { variant: 'danger', size: 'small' }));
  nodes.push(N.text(W, '小程序展示 AI 社会模拟实验已有的记录。AI 生成的文字标有来源，通过内容检查后展示；暂未显示的内容可稍后刷新。', { style: 'caption', color: C.text3, align: 'center' }));
  return { top, nodes, tabbar: true };
}
function link(app, W) {
  const f = app.form;
  return { top: { kind: 'back', title: '登录网站账号' }, tabbar: false, nodes: [
    N.text(W, '已有网站账号，可先登录，再在「我的」里关联微信。关联不会复制其他账号的居民。', { style: 'action', color: C.text2 }),
    N.field(W, '用户名', f.username || '', { type: 'field', name: 'username', max: 32 }),
    N.field(W, '密码', f.password || '', { type: 'field', name: 'password', max: 128 }, { secret: !f.showPassword }),
    N.checkbox(W, '显示密码', !!f.showPassword, { type: 'toggle', name: 'showPassword' }),
    N.checkbox(W, '我已阅读并同意', !!f.accepted, { type: 'toggle', name: 'accepted' }, privacyLink),
    N.button(W, '登录', { type: 'auth' }, { variant: 'primary' }),
  ] };
}
function webLogin(app, W) {
  const f = app.form;
  const contacts = app.user.contacts || {};
  const nodes = [
    N.text(W, '小程序和网页共用这个账号。请在网页使用下方用户名和你设置的密码登录。', { style: 'action', color: C.text2 }),
    N.text(W, '网站：' + config.apiBase, { style: 'meta' }),
    N.text(W, '用户名：' + app.user.username, { style: 'meta' }),
    N.button(W, '复制用户名', { type: 'copyUsername' }, { variant: 'secondary' }),
  ];
  if (!contacts.email && !contacts.phone) {
    nodes.push(N.section(W, '先验证联系方式', { small: true }),
      N.chips(W, ['邮箱', '+86 手机'].map((label, index) => ({ label, selected: (f.contactChannel || 'email') === (index ? 'phone' : 'email'), action: { type: 'contactChannel', channel: index ? 'phone' : 'email' } }))),
      N.field(W, f.contactChannel === 'phone' ? '+86 手机号' : '邮箱地址', f.contactValue || '', { type: 'field', name: 'contactValue', max: 254 }),
      N.button(W, '发送验证码', { type: 'sendContactCode' }, { variant: 'secondary' }),
      N.field(W, '验证码', f.contactCode || '', { type: 'field', name: 'contactCode', max: 6 }),
      N.button(W, '验证并绑定', { type: 'verifyContactCode' }, { variant: 'secondary' }));
    if (app.user.passwordLoginEnabled) nodes.push(
      N.field(W, '当前密码', f.currentPassword || '', { type: 'field', name: 'currentPassword', max: 128 }, { secret: !f.showPassword }),
      N.checkbox(W, '显示密码', !!f.showPassword, { type: 'toggle', name: 'showPassword' }));
    if (f.contactProof) nodes.push(N.text(W, '联系方式已验证，可以设置网页登录密码。', { style: 'meta', color: C.text2 }));
  } else nodes.push(N.text(W, `已验证：${[contacts.email, contacts.phone].filter(Boolean).join(' · ')}`, { style: 'meta' }));
  nodes.push(
    N.text(W, '设置密码会重新验证当前微信身份，并使其他设备上的登录失效。已存在的其他网站账号不会自动合并。', { style: 'caption', color: C.text3 }),
    N.field(W, '新密码（12–128 个字符）', f.password || '', { type: 'field', name: 'password', max: 128 }, { secret: !f.showPassword }),
    N.field(W, '确认新密码', f.confirmPassword || '', { type: 'field', name: 'confirmPassword', max: 128 }, { secret: !f.showPassword }),
    N.checkbox(W, '显示密码', !!f.showPassword, { type: 'toggle', name: 'showPassword' }),
    N.checkbox(W, '我已阅读并同意', !!f.accepted, { type: 'toggle', name: 'accepted' }, privacyLink),
    N.button(W, '验证微信并设置密码', { type: 'saveWebPassword' }, { variant: 'primary' }),
  );
  return { top: { kind: 'back', title: '网页登录' }, tabbar: false, nodes };
}
function mergeAccount(app, W) {
  const f = app.form, preview = app.mergePreview;
  if (preview) return { top: { kind: 'back', title: '确认账号合并' }, tabbar: false, nodes: [
    N.text(W, '请核对：合并后保留网站账号', { style: 'heading', bold: true }),
    ...(preview.target.role === 'admin' ? [N.text(W, '保留管理员身份，合并后可通过微信直接登录管理员账号。', { style: 'action', color: C.text2 })] : []),
    N.text(W, preview.target.username, { style: 'heading' }),
    N.text(W, '原微信账号：' + preview.source.username, { style: 'meta' }),
    N.text(W, '迁移居民：' + preview.residents + ' 位', { style: 'action' }),
    N.text(W, '居民、账户记录和微信绑定将归入网站账号；保留网站账号的用户名和密码。原账号停用，两端旧会话退出，待接受的居民转交邀请取消。此操作不能自行撤销。', { style: 'action', color: C.text2 }),
    N.button(W, '确认合并并迁移', { type: 'confirmMerge' }, { variant: 'primary' }),
  ] };
  return { top: { kind: 'back', title: '合并已有网站账号' }, tabbar: false, nodes: [
    N.text(W, '将当前微信账号合并到你已有的网站账号。先验证网站密码和当前微信身份，核对迁移内容后再确认。', { style: 'action', color: C.text2 }),
    N.field(W, '保留的网站用户名', f.username || '', { type: 'field', name: 'username', max: 32 }),
    N.field(W, '网站账号密码', f.password || '', { type: 'field', name: 'password', max: 128 }, { secret: !f.showPassword }),
    N.checkbox(W, '显示密码', !!f.showPassword, { type: 'toggle', name: 'showPassword' }),
    N.checkbox(W, '我已阅读并同意', !!f.accepted, { type: 'toggle', name: 'accepted' }, privacyLink),
    N.button(W, '验证两端身份并预览', { type: 'previewMerge' }, { variant: 'primary' }),
  ] };
}
function owner(app, W) {
  const a = app.owner, top = { kind: 'back', title: '居民记录' };
  if (!a) return { top, nodes: [N.empty(W, '正在读取…')], tabbar: false };
  const name = usable(a.name) ? a.name : '我的居民';
  const nodes = [N.node(60, (g, x, y) => {
    N.paintAvatar(g, { id: a.agentId, name: a.name, avatar: a.avatar }, x + 30, y + 30, 60);
    const nf = font(22, { bold: true, serif: true, text: name });
    P.text(g.ctx, name, x + 74, y + 18, nf, C.text);
    P.text(g.ctx, `持有 ${compact(a.energy)} 词元 · 物料 ${compact(a.materials || 0)}`, x + 74, y + 44, font(13, {}), C.text3);
  })];
  if (a.publicOnly) {
    nodes.push(N.card(W, iw => [N.text(iw, '公开生涯', { style: 'heading', bold: true }), N.text(iw, '你是原创者，管理权已过继。这里显示公开生涯。', { style: 'caption', color: C.text3 }), N.text(iw, view.text(a.bio) || '—', { style: 'meta', color: C.text2 })], { pad: 14, gap: 6 }), N.button(W, '查看公开档案', { type: 'resident', id: a.agentId }, { variant: 'secondary' }));
    return { top: { kind: 'back', title: '我创作的居民' }, nodes, tabbar: false };
  }
  nodes.push(N.text(W, '只读：这里展示这位居民已有的概况、流水、行动、日记、事件与用量记录。', { style: 'caption', color: C.text3 }));
  nodes.push(N.buttonRow(W, [{ label: '居民提醒设置', action: { type: 'notifications' }, variant: 'secondary' }, { label: '公开档案', action: { type: 'resident', id: a.agentId }, variant: 'secondary' }], 8));
  nodes.push(N.button(W, '导出历史', { type: 'historyOpen', id: a.agentId }, { variant: 'secondary' }));
  nodes.push(R.recordTabs(app, W));
  const tab = app.records.tab;
  if (tab === 'ledger') nodes.push(...R.ledgerTab(app, W));
  else if (tab === 'actions') nodes.push(...R.actionsTab(app, W));
  else if (tab === 'usage') nodes.push(...R.usageTab(app, W));
  else if (tab === 'timeline') nodes.push(...R.timelineTab(app, W));
  else nodes.push(...R.overviewTab(app, W));
  return { top, nodes, tabbar: false, pull: true };
}
function contactFields(app, W) {
  const f = app.form;
  return [
    N.chips(W, ['邮箱', '+86 手机'].map((label, index) => ({ label, selected: (f.contactChannel || 'email') === (index ? 'phone' : 'email'), action: { type: 'contactChannel', channel: index ? 'phone' : 'email' } }))),
    N.field(W, f.contactChannel === 'phone' ? '+86 手机号' : '邮箱地址', f.contactValue || '', { type: 'field', name: 'contactValue', max: 254 }),
    N.button(W, '发送验证码', { type: 'sendContactCode' }, { variant: 'secondary' }),
    N.field(W, '验证码', f.contactCode || '', { type: 'field', name: 'contactCode', max: 6 }),
  ];
}
// 账户资料（网站 account.html）：昵称、修改密码入口、联系方式、微信关联；管理员功能按平台说明不在小程序提供。
function profile(app, W) {
  const u = app.user, f = app.form, top = { kind: 'back', title: '账户资料' };
  if (!u) return { top, nodes: [N.empty(W, '请先登录')], tabbar: false };
  const contacts = u.contacts || {}, pwd = !!u.passwordLoginEnabled, confirm = app.profileState.confirm;
  const currentPassword = () => N.field(W, '当前密码', f.currentPassword || '', { type: 'field', name: 'currentPassword', max: 128 }, { secret: true });
  const nodes = [
    N.card(W, iw => [N.node(52, (g, x, y) => {
      N.paintAvatar(g, { id: u.id, name: u.displayName }, x + 26, y + 26, 52);
      P.text(g.ctx, u.displayName || '造者', x + 66, y + 16, font(17, { bold: true }), C.text);
      P.text(g.ctx, '@' + u.username + ' · ' + (u.role === 'admin' ? '管理员' : '普通用户'), x + 66, y + 38, font(13, {}), C.text3);
    })], { pad: 16 }),
    N.section(W, '个人资料', { small: true }),
    N.field(W, '昵称（最多 60 字）', f.displayName || '', { type: 'field', name: 'displayName', max: 60 }),
    N.text(W, '昵称会显示在你创建的居民的造者信息里，提交前经过微信内容安全检查。', { style: 'caption', color: C.text3 }),
    N.button(W, '保存资料', { type: 'profileSave' }, { variant: 'primary' }),
    N.section(W, '修改密码', { small: true }),
    N.text(W, pwd ? '更新后，其他设备上的登录会失效。修改时会重新验证当前微信身份。' : '还没有网页登录密码；验证联系方式后可以设置。', { style: 'caption', color: C.text3 }),
    N.button(W, pwd ? '修改网页登录密码' : '设置网页登录密码', { type: 'webLogin' }, { variant: 'secondary' }),
    N.section(W, '验证联系方式', { small: true }),
  ];
  for (const [kind, label] of [['email', '邮箱'], ['phone', '手机号']]) {
    if (!contacts[kind]) continue;
    nodes.push(N.rich(W, [{ text: label + '  ', color: C.text3 }, { text: contacts[kind], color: C.text }], { style: 'action' }));
    if (confirm === 'contact:' + kind) {
      if (pwd) nodes.push(currentPassword());
      else nodes.push(N.text(W, '将重新验证当前微信身份。', { style: 'caption', color: C.text3 }));
      nodes.push(N.buttonRow(W, [{ label: '确认解除' + label, action: { type: 'profileRemoveContact', kind }, variant: 'primary' }, { label: '取消', action: { type: 'profileCancel' }, variant: 'secondary' }], 8, { size: 'small' }));
    } else nodes.push(N.button(W, '解除' + label, { type: 'profileRemoveContact', kind }, { variant: 'text', size: 'small', align: 'left' }));
  }
  if (!contacts.email && !contacts.phone) nodes.push(N.text(W, '还没有验证过的联系方式。', { style: 'meta', color: C.text3 }));
  nodes.push(N.text(W, '添加或更换', { style: 'heading', bold: true }), ...contactFields(app, W));
  if (pwd) nodes.push(currentPassword());
  nodes.push(N.button(W, '验证并保存联系方式', { type: 'verifyContactCode' }, { variant: 'secondary' }));
  nodes.push(N.section(W, '微信关联', { small: true }));
  const apps = u.wechatApps || [];
  if (!apps.length) nodes.push(N.text(W, '尚未关联微信。', { style: 'meta', color: C.text3 }));
  apps.forEach(appid => {
    const current = appid === app.wechatAppId;
    nodes.push(N.text(W, (current ? '当前使用的微信应用 · ' : '微信应用 · ') + appid, { style: 'meta', color: C.text2 }));
    if (current) return;
    if (!pwd || !Object.keys(contacts).length) return;
    if (confirm === 'unlink:' + appid) nodes.push(currentPassword(), N.buttonRow(W, [{ label: '确认解除绑定', action: { type: 'profileUnlink', appid }, variant: 'primary' }, { label: '取消', action: { type: 'profileCancel' }, variant: 'secondary' }], 8, { size: 'small' }));
    else nodes.push(N.button(W, '解除此项绑定', { type: 'profileUnlink', appid }, { variant: 'text', size: 'small', align: 'left' }));
  });
  if (apps.length && (!pwd || !Object.keys(contacts).length)) nodes.push(N.text(W, '请先验证联系方式并启用密码登录，再解除其他微信应用的绑定。', { style: 'caption', color: C.text3 }));
  nodes.push(N.text(W, '当前使用的这个小程序的绑定不能在这里解除，以免本机会话失去身份；请在网站「账户设置」中操作。已有两个账号时，可在「我的」验证两端身份后合并。', { style: 'caption', color: C.text3 }));
  if (u.role === 'admin') nodes.push(N.card(W, iw => [N.text(iw, '管理后台', { style: 'heading', bold: true }), N.text(iw, '管理员功能不在小程序内提供。', { style: 'meta', color: C.text2 })], { pad: 14, gap: 6 }));
  return { top, nodes, tabbar: false };
}
function settings(app, W) {
  const p = app.prefs;
  return { top: { kind: 'back', title: '设置' }, tabbar: false, nodes: [
    N.menu(W, [
      { label: '大字号', icon: 'type', toggle: !!p.largeText, action: { type: 'pref', name: 'largeText' } },
      { label: '震动反馈', icon: 'heart', toggle: !!p.haptics, action: { type: 'pref', name: 'haptics' } },
      { label: '实况自动刷新', icon: 'refresh', toggle: !!p.autoRefresh, action: { type: 'pref', name: 'autoRefresh' } },
    ]),
    N.text(W, '实况自动刷新每 30 秒更新一次；关闭后可在观测页下拉刷新。设置只保存在本机。', { style: 'caption', color: C.text3 }),
    N.menu(W, [{ label: '清除本地缓存', icon: 'refresh', action: { type: 'clearCache' } }, { label: '版本', hint: config.version, icon: 'info', action: { type: 'about' } }]),
  ] };
}
function about(app, W) {
  return { top: { kind: 'back', title: '关于后人纪' }, tabbar: false, nodes: [
    N.text(W, copy.GAME_NAME + ' · ' + config.version, { style: 'title', bold: true, serif: true }),
    ...(config.clientType === 'miniprogram' ? [] : [N.node(46, (g, x, y) => { P.fillRound(g.ctx, x, y, 44, 44, 10, '#E9A93B'); P.text(g.ctx, '16+', x + 22, y + 22, font(17, { bold: true }), '#3A2604', 'center'); P.text(g.ctx, copy.AGE, x + 56, y + 22, font(14, {}), C.text2); }),
    N.card(W, iw => [N.text(iw, '健康游戏忠告', { style: 'meta', color: C.text3, align: 'center' })].concat(copy.HEALTH_LINES.map(l => N.text(iw, l, { style: 'action', align: 'center', line: 25 }))), { pad: 18, gap: 2 })]),
    N.section(W, '隐私说明', { small: true }),
    ...copy.PRIVACY.map(t => N.text(W, t, { style: 'action', color: C.text2 })),
    N.button(W, '复制客服与投诉邮箱', { type: 'support' }, { variant: 'secondary', icon: 'copy' }),
  ] };
}
module.exports = { account, link, webLogin, mergeAccount, owner, settings, about, profile };
