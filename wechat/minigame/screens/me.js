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
    { label: '设置', hint: '字号、震动、刷新', icon: 'settings', action: { type: 'settings' } },
    { label: '隐私说明', icon: 'shield', action: { type: 'about' } },
    { label: '健康游戏忠告', hint: '16+', icon: 'heart', action: { type: 'health' } },
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
      N.button(iw, app.user ? '关联微信' : '微信一键登录', { type: 'wechatLogin' }, { variant: 'primary', size: 'large' }),
      N.checkbox(iw, '我已阅读并同意', !!f.accepted, { type: 'toggle', name: 'accepted' }, privacyLink),
      app.user ? N.text(iw, `已登录网站账号「${app.user.displayName}」。关联微信后可在这里管理居民。`, { style: 'caption', color: C.text3 })
        : N.button(iw, '已有网站账号？登录后关联微信', { type: 'linkAccount' }, { variant: 'text', size: 'small' }),
    ], { pad: 18, gap: 12 }));
    if (app.user) nodes.push(N.button(W, '退出登录', { type: 'logout' }, { variant: 'danger', size: 'small' }));
  } else {
    nodes.push(N.card(W, iw => [N.node(52, (g, x, y) => {
      N.paintAvatar(g, { id: app.user.id, name: app.user.displayName }, x + 26, y + 26, 52);
      P.text(g.ctx, app.user.displayName || '造者', x + 66, y + 16, font(17, { bold: true }), C.text);
      P.text(g.ctx, '微信已关联' + (app.user.username ? ' · ' + app.user.username : ''), x + 66, y + 38, font(13, {}), C.text3);
    })], { pad: 16 }));
    nodes.push(N.section(W, '我的居民', { small: true, sub: app.linked.length ? `${app.linked.length} 位` : '' }));
    if (!app.linked.length) nodes.push(N.text(W, '你还没有管理中的居民。', { style: 'meta', color: C.text3 }));
    else nodes.push(N.stack(app.linked.map(a => N.listRow(W, { avatar: { id: a.agentId || a.id, name: a.name, avatar: a.avatar }, title: usable(a.name) ? a.name : '我的居民',
      chip: { label: view.status(a.status), color: STATUS_COLOR[a.status] || C.dormant }, sub: a.runner ? '运行器 · ' + view.status(a.runner.status) : '', meta: a.energy !== undefined ? '持有 ' + compact(a.energy) + ' 词元' : '',
      chevron: true, action: { type: 'owner', id: a.agentId || a.id } }))));
    nodes.push(N.button(W, '让一位居民入城', { type: 'entry' }, { variant: 'secondary', icon: 'plus' }));
  }
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
function owner(app, W) {
  const a = app.owner, f = app.form;
  if (!a) return { top: { kind: 'back', title: '管理居民' }, nodes: [N.empty(W, '正在读取…')], tabbar: false };
  const runner = a.runner || {}, running = runner.status === 'running';
  const nodes = [N.node(60, (g, x, y) => {
    N.paintAvatar(g, { id: a.agentId, name: a.name, avatar: a.avatar }, x + 30, y + 30, 60);
    const nf = font(22, { bold: true, serif: true, text: a.name || '' });
    P.text(g.ctx, a.name || '我的居民', x + 74, y + 18, nf, C.text);
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
  const providers = ['OpenAI 兼容', 'OpenAI Responses', 'Anthropic'];
  nodes.push(N.card(W, iw => [
    N.text(iw, '模型', { style: 'heading', bold: true }),
    N.chips(iw, providers.map((l, i) => ({ label: l, action: { type: 'provider', index: i }, selected: (f.providerIndex || 0) === i }))),
    N.field(iw, '接口地址（HTTPS）', f.baseURL || '', { type: 'field', name: 'baseURL', max: 500 }, { placeholder: 'https://…', mono: true }),
    N.field(iw, '模型 ID', f.model || '', { type: 'field', name: 'model', max: 100 }),
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
    N.text(W, '后人纪 · ' + config.version, { style: 'title', bold: true, serif: true }),
    N.node(46, (g, x, y) => { P.fillRound(g.ctx, x, y, 44, 44, 10, '#E9A93B'); P.text(g.ctx, '16+', x + 22, y + 22, font(17, { bold: true }), '#3A2604', 'center'); P.text(g.ctx, copy.AGE, x + 56, y + 22, font(14, {}), C.text2); }),
    N.card(W, iw => [N.text(iw, '健康游戏忠告', { style: 'meta', color: C.text3, align: 'center' })].concat(copy.HEALTH_LINES.map(l => N.text(iw, l, { style: 'action', align: 'center', line: 25 }))), { pad: 18, gap: 2 }),
    N.section(W, '隐私说明', { small: true }),
    ...copy.PRIVACY.map(t => N.text(W, t, { style: 'action', color: C.text2 })),
    N.button(W, '复制客服与投诉邮箱', { type: 'support' }, { variant: 'secondary', icon: 'copy' }),
  ] };
}
module.exports = { account, link, owner, entry, settings, about };
