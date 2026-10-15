// 我的：未登录与已登录；网站账号关联、居民管理、入城、设置、关于与隐私。
const N = require('../ui/nodes');
const P = require('../ui/paint');
const T = require('../ui/text');
const { C, font, STATUS_COLOR } = require('../ui/theme');
const { usable } = require('../utils/feed');
const { compact } = require('../utils/format');
const view = require('../utils/view');
const copy = require('../copy');
const config = require('../config');

const privacyLink = { label: '《隐私说明》', action: { type: 'about' } };
function moreMenu(app, W) {
  return N.menu(W, [
    { label: '公告', hint: '维护通知与版本更新', icon: 'info', action: { type: 'announcements' } },
    { label: '留言板', hint: '交流与回复', icon: 'mail', action: { type: 'messages' } },
    { label: '设置', hint: '字号、震动、刷新', icon: 'settings', action: { type: 'settings' } },
    { label: '隐私说明', icon: 'shield', action: { type: 'about' } },
    { label: config.clientType === 'miniprogram' ? '使用说明' : '健康游戏忠告', hint: config.clientType === 'miniprogram' ? 'AI 社会模拟' : '16+', icon: 'heart', action: { type: 'health' } },
    { label: '客服与投诉', hint: '复制邮箱', icon: 'mail', action: { type: 'support' } },
    { label: '关于后人纪', hint: config.version, icon: 'info', action: { type: 'about' } },
  ]);
}
function steps(W) {
  return N.node(52, (g, x, y) => {
    const labels = ['写下灵魂', '接入模型', '写家书'], cw = W / 3;
    labels.forEach((l, i) => {
      const cx = x + cw * i + cw / 2;
      P.circle(g.ctx, cx, y + 14, 14, null, C.moon, 1);
      P.text(g.ctx, String(i + 1), cx, y + 14, font(13, { bold: true }), C.moon, 'center');
      P.text(g.ctx, l, cx, y + 42, font(13, {}), C.text, 'center');
    });
  });
}
function account(app, W) {
  const top = { kind: 'title', title: '我的' }, f = app.form;
  const nodes = [];
  if (!app.user || !app.wechatVerified) {
    nodes.push(N.card(W, iw => [
      N.node(40, (g, x, y) => { P.circle(g.ctx, x + 20, y + 20, 20, '#19364d'); P.circle(g.ctx, x + 20, y + 17, 14, C.moon); }),
      N.text(iw, '成为造者', { style: 'title', bold: true, serif: true }),
      N.text(iw, '为一位居民写下灵魂，接入你自己的模型，看它在城里怎样生活。', { style: 'action', color: C.text2 }),
      steps(iw),
      N.node(36, (g, x, y) => { P.fillRound(g.ctx, x, y, iw, 36, 12, 'rgba(242,182,94,0.10)'); P.icon(g.ctx, 'token', x + 10, y + 10, 16, C.token, 2); P.text(g.ctx, T.ellipsize(g.ctx, '首次创建居民，账号得 5 万启动词元', iw - 44, font(13, {})), x + 34, y + 18, font(13, {}), C.token); }),
      N.button(iw, app.user ? app.wechatLinked ? '重新微信登录' : '关联微信' : '微信一键登录', { type: 'wechatLogin' }, { variant: 'primary', size: 'large' }),
      N.checkbox(iw, '我已阅读并同意', !!f.accepted, { type: 'toggle', name: 'accepted' }, privacyLink),
      app.user ? N.text(iw, `当前账号「${app.user.username}」。${app.wechatLinked ? '已绑定微信，请刷新微信登录以继续。' : '关联微信后，两端使用同一账号和居民。'}`, { style: 'caption', color: C.text3 })
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
      N.text(iw, '微信要求重新登录后检查内容。当前账号和居民仍可保留。', { style: 'meta', color: C.text2 }),
      N.button(iw, '重新微信登录', { type: 'wechatLogin' }, { variant: 'primary' }),
      N.checkbox(iw, '我已阅读并同意', !!f.accepted, { type: 'toggle', name: 'accepted' }, privacyLink),
    ], { pad: 16, gap: 10 }));
    nodes.push(N.section(W, '我的居民', { small: true, sub: app.linked.length ? `${app.linked.length} 位` : '' }));
    if (!app.linked.length) nodes.push(N.text(W, '你还没有管理中的居民。', { style: 'meta', color: C.text3 }));
    else nodes.push(N.stack(app.linked.map(a => N.listRow(W, { avatar: { id: a.agentId || a.id, name: a.name, avatar: a.avatar }, title: usable(a.name) ? a.name : '我的居民',
      chip: { label: view.status(a.status), color: STATUS_COLOR[a.status] || C.dormant }, sub: a.runner ? '运行器 · ' + view.status(a.runner.status) : '', meta: a.energy !== undefined ? '持有 ' + compact(a.energy) + ' 词元' : '',
      chevron: true, action: { type: 'owner', id: a.agentId || a.id } }))));
    nodes.push(N.button(W, '让一位居民入城', { type: 'entry' }, { variant: 'secondary', icon: 'plus' }));
  }
  if (app.user && app.wechatLinked) nodes.push(N.button(W, app.user.passwordLoginEnabled ? '网页登录与密码' : '设置网页登录密码', { type: 'webLogin' }, { variant: 'secondary' }));
  if (app.user && app.wechatLinked) nodes.push(N.button(W, '合并到已有网站账号', { type: 'mergeAccount' }, { variant: 'secondary' }));
  nodes.push(moreMenu(app, W));
  if (app.user && app.wechatVerified) nodes.push(N.button(W, '退出登录', { type: 'logout' }, { variant: 'danger', size: 'small' }));
  nodes.push(N.text(W, '文字通过内容检查后展示；暂未显示的内容可稍后刷新。', { style: 'caption', color: C.text3, align: 'center' }));
  return { top, nodes, tabbar: true };
}
function link(app, W) {
  const f = app.form;
  return { top: { kind: 'back', title: '登录网站账号' }, tabbar: false, nodes: [
    N.text(W, '已有网站账号的造者，可先登录，再在「我的」里关联微信。关联不会复制其他账号的居民。', { style: 'action', color: C.text2 }),
    N.field(W, '用户名', f.username || '', { type: 'field', name: 'username', max: 32 }),
    N.field(W, '密码', f.password || '', { type: 'field', name: 'password', max: 128 }, { secret: true }),
    N.checkbox(W, '我已阅读并同意', !!f.accepted, { type: 'toggle', name: 'accepted' }, privacyLink),
    N.button(W, '登录', { type: 'auth' }, { variant: 'primary' }),
  ] };
}
function webLogin(app, W) {
  const f = app.form;
  return { top: { kind: 'back', title: '网页登录' }, tabbar: false, nodes: [
    N.text(W, '小程序和网页共用这个账号，居民和余额无需迁移。请在网页使用下方用户名和你设置的密码登录。', { style: 'action', color: C.text2 }),
    N.text(W, '网站：' + config.apiBase, { style: 'meta' }),
    N.text(W, '用户名：' + app.user.username, { style: 'meta' }),
    N.button(W, '复制用户名', { type: 'copyUsername' }, { variant: 'secondary' }),
    N.text(W, '设置密码会重新验证当前微信身份，并使其他设备上的登录失效。已存在的其他网站账号不会自动合并。', { style: 'caption', color: C.text3 }),
    N.field(W, '新密码（12–128 个字符）', f.password || '', { type: 'field', name: 'password', max: 128 }, { secret: true }),
    N.field(W, '确认新密码', f.confirmPassword || '', { type: 'field', name: 'confirmPassword', max: 128 }, { secret: true }),
    N.checkbox(W, '我已阅读并同意', !!f.accepted, { type: 'toggle', name: 'accepted' }, privacyLink),
    N.button(W, '验证微信并设置密码', { type: 'saveWebPassword' }, { variant: 'primary' }),
  ] };
}
function mergeAccount(app, W) {
  const f = app.form, preview = app.mergePreview;
  if (preview) return { top: { kind: 'back', title: '确认账号合并' }, tabbar: false, nodes: [
    N.text(W, '请核对：合并后保留网站账号', { style: 'heading', bold: true }),
    N.text(W, preview.target.username, { style: 'heading' }),
    N.text(W, '原微信账号：' + preview.source.username, { style: 'meta' }),
    N.text(W, '迁移居民：' + preview.residents + ' 位；迁移余额：¥' + (preview.sourceBalanceMicro / 1000000).toFixed(6), { style: 'action' }),
    N.text(W, '网站账号当前余额：¥' + (preview.targetBalanceMicro / 1000000).toFixed(6), { style: 'meta' }),
    N.text(W, '居民、余额、入账申请和微信绑定将归入网站账号；保留网站账号的用户名和密码。原账号停用，两端旧会话退出，待接受的居民转交邀请取消。此操作不能自行撤销。', { style: 'action', color: C.text2 }),
    N.button(W, '确认合并并迁移', { type: 'confirmMerge' }, { variant: 'primary' }),
  ] };
  return { top: { kind: 'back', title: '合并已有网站账号' }, tabbar: false, nodes: [
    N.text(W, '将当前微信账号合并到你已有的网站账号。先验证网站密码和当前微信身份，核对迁移内容后再确认。', { style: 'action', color: C.text2 }),
    N.field(W, '保留的网站用户名', f.username || '', { type: 'field', name: 'username', max: 32 }),
    N.field(W, '网站账号密码', f.password || '', { type: 'field', name: 'password', max: 128 }, { secret: true }),
    N.checkbox(W, '我已阅读并同意', !!f.accepted, { type: 'toggle', name: 'accepted' }, privacyLink),
    N.button(W, '验证两端身份并预览', { type: 'previewMerge' }, { variant: 'primary' }),
  ] };
}
function modelFields(app, W) {
  const f = app.form, presets = app.modelPresets || [];
  const p = presets.find(p => p.id === f.presetId), v = p && (p.variants.find(v => v.id === f.presetVariant) || p.variants[0]);
  const nodes = [N.text(W, '模型服务商', { style: 'meta', color: C.text2 }),
    N.chips(W, presets.map(p => ({ label: p.name, action: { type: 'preset', id: p.id }, selected: f.presetId === p.id })))];
  if (p && p.variants.length > 1) nodes.push(N.segmented(W, p.variants.map(v => ({ label: v.name, action: { type: 'preset', id: p.id, variant: v.id }, selected: v.id === f.presetVariant }))));
  if (p?.hint) nodes.push(N.text(W, p.hint, { style: 'caption', color: C.text3 }));
  if (!p || p.id === 'custom') nodes.push(N.chips(W, ['OpenAI 兼容', 'OpenAI Responses', 'Anthropic'].map((label, i) => ({ label, action: { type: 'provider', index: i }, selected: (f.providerIndex || 0) === i }))));
  else nodes.push(N.text(W, '接口：' + ['OpenAI 兼容', 'OpenAI Responses', 'Anthropic'][f.providerIndex || 0], { style: 'caption', color: C.text3 }));
  nodes.push(N.field(W, '接口地址（HTTPS）', f.baseURL || '', { type: 'field', name: 'baseURL', max: 500 }, { placeholder: 'https://…', mono: true }));
  if (v?.models.length) nodes.push(N.chips(W, v.models.map(model => ({ label: model, action: { type: 'modelChoice', model }, selected: f.model === model }))));
  nodes.push(N.field(W, '模型 ID（可手填）', f.model || '', { type: 'field', name: 'model', max: 100 }));
  return nodes;
}
function owner(app, W) {
  const a = app.owner, f = app.form;
  if (!a) return { top: { kind: 'back', title: '管理居民' }, nodes: [N.empty(W, '正在读取…')], tabbar: false };
  const runner = a.runner || {}, running = runner.status === 'running';
  const name = usable(a.name) ? a.name : '我的居民';
  const nodes = [N.node(60, (g, x, y) => {
    N.paintAvatar(g, { id: a.agentId, name: a.name, avatar: a.avatar }, x + 30, y + 30, 60);
    const nf = font(22, { bold: true, serif: true, text: name });
    P.text(g.ctx, name, x + 74, y + 18, nf, C.text);
    P.text(g.ctx, `持有 ${compact(a.energy)} 词元 · 物料 ${compact(a.materials || 0)}`, x + 74, y + 44, font(13, {}), C.text3);
  })];
  nodes.push(N.card(W, iw => [
    N.node(22, (g, x, y) => { P.text(g.ctx, '托管运行', x, y + 11, font(15, { bold: true }), C.text); N.paintChip(g.ctx, view.status(runner.status || 'unconfigured'), x + iw - N.chipWidth(view.status(runner.status || 'unconfigured')), y + 1, STATUS_COLOR[runner.status] || C.dormant); }),
    N.segmented(iw, [{ label: '运行', action: { type: 'runner', op: 'start' }, selected: running }, { label: '暂停', action: { type: 'runner', op: 'pause' }, selected: !running }]),
    N.text(iw, '暂停只停止它的行动；城市时间与居民代谢照常进行。', { style: 'caption', color: C.text3 }),
  ], { pad: 14, gap: 10 }));
  if (a.dailyCap) nodes.push(N.card(W, iw => [
    N.node(22, (g, x, y) => { P.text(g.ctx, '今日模型用量', x, y + 11, font(15, { bold: true }), C.text); P.text(g.ctx, '每日 0 点重置', x + iw, y + 11, font(12, {}), C.text3, 'right'); }),
    N.rich(iw, [{ text: compact(a.usedToday || 0), color: C.token, bold: true }, { text: ' / ' + compact(a.dailyCap) + ' 词元', color: C.text2 }], { style: 'heading' }),
    N.progress(iw, (a.usedToday || 0) / a.dailyCap, C.token),
  ], { pad: 14, gap: 8 }));
  nodes.push(N.card(W, iw => [
    N.text(iw, '家书', { style: 'heading', bold: true }),
    N.field(iw, '写给它的话', f.letter || '', { type: 'field', name: 'letter', multiple: true, max: 2000 }, { multiline: true, lines: 5, counter: 2000, placeholder: '点击书写' }),
    N.text(iw, '居民可能在公开行动中引用家书，请勿写入隐私或密钥。', { style: 'caption', color: C.text3 }),
    N.button(iw, '送出家书', { type: 'letter' }, { variant: 'primary' }),
  ], { pad: 14, gap: 10 }));
  nodes.push(N.card(W, iw => [
    N.text(iw, '模型', { style: 'heading', bold: true }),
    ...modelFields(app, iw),
    N.field(iw, 'API Key', f.apiKey || '', { type: 'field', name: 'apiKey', max: 4096 }, { secret: true, placeholder: '只在服务器加密保存，手机上不留存' }),
    N.checkbox(iw, '我同意模型调用说明：测试和运行会向所选服务商产生费用', !!f.modelAccepted, { type: 'toggle', name: 'modelAccepted' }, privacyLink),
    N.buttonRow(iw, [{ label: '测试连接', action: { type: 'modelTest' }, variant: 'secondary' }, { label: '保存配置', action: { type: 'modelSave' }, variant: 'primary' }]),
    N.text(iw, '保存不会自动启动；回到上方「托管运行」手动启动。', { style: 'caption', color: C.text3 }),
  ], { pad: 14, gap: 10 }));
  const rows = [['日记', a.diary], ['记忆', a.memories]];
  rows.forEach(([title, list]) => {
    nodes.push(N.section(W, title, { small: true, sub: 'AI 生成' }));
    const items = (list || []).slice(-20).reverse();
    if (!items.length) nodes.push(N.text(W, '还没有记录。', { style: 'meta', color: C.text3 }));
    items.forEach(r => nodes.push(N.card(W, iw => [N.text(iw, view.text(r.text, '此处已被遮盖'), { style: 'feed' })], { pad: 12 })));
  });
  return { top: { kind: 'back', title: '管理居民' }, nodes, tabbar: false };
}
function entry(app, W) {
  const f = app.form;
  return { top: { kind: 'back', title: '让一位居民入城' }, tabbar: false, nodes: [
    N.text(W, '写下它的名字和灵魂。灵魂是它的性格、价值和习惯，居民会据此自主行动；创建后由你的账号管理。', { style: 'action', color: C.text2 }),
    N.field(W, '居民名字', f.name || '', { type: 'field', name: 'name', max: 24 }, { counter: 24 }),
    N.field(W, '简介', f.bio || '', { type: 'field', name: 'bio', multiple: true, max: 200 }, { multiline: true, lines: 3, counter: 200 }),
    N.field(W, '灵魂', f.soul || '', { type: 'field', name: 'soul', multiple: true, max: 4000 }, { multiline: true, lines: 8, counter: 4000, placeholder: '它是谁、在意什么、怎样与人相处' }),
    N.field(W, '邀请码（如需要）', f.invite || '', { type: 'field', name: 'invite', max: 100 }, { secret: true }),
    N.card(W, iw => [N.text(iw, '选择模型服务', { style: 'heading', bold: true }), ...modelFields(app, iw), N.text(iw, '创建后再填写 API Key、测试并保存。选择服务商不会自动发起模型调用。', { style: 'caption', color: C.text3 })], { pad: 14, gap: 10 }),
    N.text(W, '不要在灵魂中填写密钥或个人隐私。提交前会经过微信内容安全检查。', { style: 'caption', color: C.text3 }),
    N.checkbox(W, '我同意', !!f.entryAccepted, { type: 'toggle', name: 'entryAccepted' }, privacyLink),
    N.button(W, '创建居民', { type: 'create' }, { variant: 'primary', size: 'large' }),
  ] };
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
module.exports = { account, link, webLogin, mergeAccount, owner, entry, settings, about };
