import { h, clear } from './dom.js';
import { getLang } from './i18n.js';
import { api, errorText } from './api.js';
import { openModal } from './modals.js';
import { button, field, form, request, password, identity, refreshAccount, roleName } from './accounts.js';
// 管理后台的三块：服务器状态、用户管理、打赏收款码。每块返回一个根节点，由 admin.js 挂到内容区；
// 根节点离开页面后，定时刷新随之停止。
const tr = (zh, en) => getLang() === 'en' ? en : zh;

export function serverStatusPanel() {
  const root = h('div', { class: 'server-status' });
  const values = h('div', null, h('p', { class: 'muted' }, tr('正在加载…', 'Loading…')));
  const error = h('p', { class: 'error', role: 'alert' });
  root.append(values, error);
  const bytes = (value, rate = false) => {
    if (value === null) return tr('采样中…', 'Sampling…');
    const units = rate ? ['B/s', 'KiB/s', 'MiB/s', 'GiB/s'] : ['B', 'KiB', 'MiB', 'GiB'];
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
  };
  const duration = seconds => {
    if (seconds === null) return tr('不可用', 'Unavailable');
    const days = Math.floor(seconds / 86400), hours = Math.floor(seconds / 3600) % 24, minutes = Math.floor(seconds / 60) % 60;
    return tr(`${days} 天 ${hours} 小时 ${minutes} 分 ${Math.floor(seconds) % 60} 秒`, `${days}d ${hours}h ${minutes}m ${Math.floor(seconds) % 60}s`);
  };
  const row = (label, value) => h('p', null, h('strong', null, `${label} · `), value);
  // 计算资源：只有新服务返回 compute。数字缺失、为 null 或不合理时一律显示「未知」；服务器给的字符串只当文字显示。
  const unknown = () => tr('未知', 'Unknown');
  const known = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const count = v => known(v) ? String(Math.round(v * 100) / 100) : unknown();
  const size = v => known(v) ? bytes(v) : unknown();
  const pair = (a, b, format = count) => `${format(a)} / ${format(b)}`;
  const named = (value, names) => typeof value !== 'string' || !value ? unknown() : Object.hasOwn(names, value) ? names[value] : value;
  const object = v => v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  const computeCard = c => {
    const queue = object(c.queue) || {}, cache = object(c.cache) || {};
    const rate = known(cache.hits) && known(cache.misses) && cache.hits + cache.misses > 0 ? ` (${(cache.hits / (cache.hits + cache.misses) * 100).toFixed(1)}%)` : '';
    return h('article', { class: 'card-panel' }, h('h3', null, tr('计算资源', 'Compute resources')),
      row(tr('执行模式', 'Execution mode'), named(c.mode, { worker: tr('独立工作线程', 'Worker thread'), inline: tr('主线程内联', 'Inline on main thread') })),
      row(tr('有效 CPU / 计算槽位', 'Effective CPU / compute slots'), pair(c.cpu, c.slots)),
      row(tr('服务内存预算 / 有效上限', 'Service memory budget / effective limit'), pair(c.budget, c.memory, size)),
      row(tr('已预留 / 进程 RSS', 'Reserved / process RSS'), pair(c.reservedBytes, c.rssBytes, size)),
      row(tr('缓存占用 / 上限', 'Cache used / limit'), `${pair(cache.bytes, cache.limitBytes ?? c.cacheBytes, size)} · ${tr('条目', 'entries')} ${count(cache.entries)}`),
      row(tr('缓存命中 / 未命中', 'Cache hits / misses'), `${pair(cache.hits, cache.misses)}${rate}`),
      row(tr('世界队列 / 运行中', 'World queue / running'), pair(queue.world, c.worldActive)),
      row(tr('后台队列 / 运行中', 'Background queue / running'), pair(queue.background, c.backgroundActive)),
      row(tr('实际世界堆上限', 'Actual world heap limit'), size(c.worldHeapLimitBytes)),
      row(tr('主线程实际堆上限', 'Actual main thread heap limit'), size(c.mainHeapLimitBytes)),
      row(tr('后台线程实际堆上限', 'Actual background thread heap limits'), !Array.isArray(c.backgroundHeapLimitBytes) ? unknown()
        : c.backgroundHeapLimitBytes.length ? c.backgroundHeapLimitBytes.map(size).join(tr('、', ', ')) : tr('尚未启动', 'Not started yet')),
      row(tr('内存降载', 'Memory load shedding'), c.pressure === null ? tr('正常', 'Normal') : named(c.pressure, { memory: tr('内存降载中：已清空缓存，新计算暂缓', 'Shedding load (memory): cache cleared, new work deferred') })),
      row(tr('探测来源', 'Detection source'), named(c.constraintSource, { cgroup: tr('cgroup 限额', 'cgroup limits'), system: tr('系统总量（未检测到 cgroup）', 'System totals (no cgroup detected)'), 'system; job limits unknown': tr('系统总量（作业限额未知）', 'System totals (job limits unknown)') })));
  };
  async function refresh() {
    if (!root.isConnected) return;
    const r = await api('/api/admin/server-status');
    if (!root.isConnected) return;
    if (!r.ok) error.textContent = errorText(r, tr('刷新失败，请稍后重试。', 'Refresh failed. Please try again.'));
    else {
      error.textContent = '';
      const { cpu, memory, network, uptime, users, sampledAt, compute } = r.json;
      clear(values).append(
        h('div', { class: 'card-grid' },
          h('article', { class: 'card-panel' }, h('h3', null, tr('服务器负载', 'Server load')),
            row('CPU', `${cpu.busyPercent === null ? tr('采样中…', 'Sampling…') : `${cpu.busyPercent.toFixed(1)}%`} · ${cpu.cores} ${tr('核', 'cores')}`),
            row(tr('平均负载（1 / 5 / 15 分钟）', 'Load average (1 / 5 / 15 min)'), cpu.loadavg.map(n => n.toFixed(2)).join(' / ')),
            row(tr('内存', 'Memory'), `${bytes(memory.usedBytes)} / ${bytes(memory.totalBytes)} (${memory.usedPercent.toFixed(1)}%)`),
            row(tr('服务进程 RSS', 'Server process RSS'), bytes(memory.rss)),
            row(tr('网络', 'Network'), network.available ? `↓ ${tr('接收', 'Receive')} ${bytes(network.receiveBytesPerSecond, true)} · ↑ ${tr('发送', 'Transmit')} ${bytes(network.transmitBytesPerSecond, true)}` : tr('不可用', 'Unavailable')),
            row(tr('系统运行时间', 'System uptime'), duration(uptime.systemSeconds)),
            row(tr('服务进程运行时间', 'Server process uptime'), duration(uptime.processSeconds))),
          h('article', { class: 'card-panel' }, h('h3', null, tr('注册用户', 'Registered users')),
            row(tr('总数', 'Total'), String(users.total)),
            row(tr('启用 / 停用', 'Active / Disabled'), `${users.active} / ${users.disabled}`),
            row(tr('管理员', 'Administrators'), String(users.admins)),
            row(tr('已关联微信', 'WeChat-linked'), String(users.wechatLinked)),
            row(tr('最近 24 小时 / 7 天注册', 'Created in the last 24 hours / 7 days'), `${users.createdLast24Hours} / ${users.createdLast7Days}`)),
          object(compute) && computeCard(compute)),
        h('p', { class: 'muted' }, `${tr('采样时间', 'Sample time')} · ${new Date(sampledAt).toLocaleString(getLang() === 'en' ? 'en-US' : 'zh-CN')} · ${tr('每 10 秒刷新', 'Refreshes every 10 seconds')}`),
      );
    }
    // 离开这一块后，下一次定时检查即结束；不再发送请求，也不启动重叠刷新。
    if (root.isConnected) setTimeout(refresh, 10000);
  }
  queueMicrotask(refresh); // 等根节点挂上页面再读
  return root;
}

export function usersPanel() {
  const root = h('div', { class: 'users-panel' });
  let page = 1, query = '', generation = 0;
  const search = h('input', { type: 'search', maxlength: 100, placeholder: tr('搜索用户名或昵称', 'Search username or display name'), 'aria-label': tr('搜索用户', 'Search users') });
  const list = h('div', { class: 'account-list' });
  const pages = h('div', { class: 'form-actions pager' });
  const searchForm = h('form', { class: 'account-search' }, search, h('button', { type: 'submit', class: 'btn' }, tr('搜索', 'Search')));
  searchForm.addEventListener('submit', (e) => { e.preventDefault(); query = search.value; page = 1; load(); });
  root.append(h('p', { class: 'muted' }, tr('停用、角色变更和密码重置会结束该用户的登录会话。至少保留一个启用的管理员。', 'Disabling an account, changing its role or resetting its password ends its sessions. At least one active administrator must remain.')), h('div', { class: 'account-toolbar' }, searchForm, button(tr('创建用户', 'Create user'), () => editUser(null, load), true)), list, pages);
  async function load() {
    const version = ++generation;
    clear(list).append(h('p', null, tr('正在加载…', 'Loading…')));
    clear(pages);
    const r = await api(`/api/admin/users?q=${encodeURIComponent(query)}&page=${page}`);
    if (version !== generation) return;
    clear(list);
    if (!r.ok) { list.append(h('p', { class: 'error', role: 'alert' }, errorText(r, tr('加载失败。', 'Unable to load.'))), button(tr('重试', 'Retry'), load)); return; }
    if (!r.json.users.length) list.append(h('p', { class: 'empty' }, tr('没有匹配的用户。', 'No matching users.')));
    for (const u of r.json.users) list.append(h('article', { class: 'card account-row' }, h('div', null, h('strong', null, u.displayName), h('p', { class: 'muted' }, `@${u.username} · ${roleName(u)} · ${u.status === 'active' ? tr('启用', 'Active') : tr('停用', 'Disabled')}`), h('small', { class: 'muted' }, `${tr('注册于', 'Joined')} ${new Date(u.createdAt).toLocaleDateString(getLang() === 'en' ? 'en-US' : 'zh-CN')}`)), button(tr('编辑', 'Edit'), () => editUser(u, load))));
    const prev = button(tr('上一页', 'Previous'), () => { page--; load(); }); prev.disabled = page <= 1;
    const next = button(tr('下一页', 'Next'), () => { page++; load(); }); next.disabled = page * r.json.pageSize >= r.json.total;
    pages.append(prev, h('span', { class: 'muted' }, tr(`第 ${page} 页 · 共 ${r.json.total} 人`, `Page ${page} · ${r.json.total} users`)), next);
  }
  load();
  return root;
}
function editUser(user, reload) {
  const modal = openModal(user ? tr('编辑用户', 'Edit user') : tr('创建用户', 'Create user'));
  const fields = user ? [h('p', { class: 'muted' }, `@${user.username}`), field(tr('昵称', 'Display name'), 'displayName', 'text', user.displayName, { maxlength: 60 })] : identity();
  const role = h('select', { name: 'role' }, h('option', { value: 'user' }, tr('普通用户', 'User')), h('option', { value: 'admin' }, tr('管理员', 'Administrator')));
  role.value = user?.role || 'user';
  fields.push(h('label', { class: 'field' }, h('span', null, tr('角色', 'Role')), role));
  if (user) {
    const status = h('select', { name: 'status' }, h('option', { value: 'active' }, tr('启用', 'Active')), h('option', { value: 'disabled' }, tr('停用', 'Disabled')));
    status.value = user.status;
    fields.push(h('label', { class: 'field' }, h('span', null, tr('账号状态', 'Account status')), status));
  }
  fields.push(password('password', user ? tr('重置密码（留空则不修改）', 'Reset password (leave blank to keep)') : tr('初始密码（12–128 位）', 'Initial password (12–128 characters)'), !user));
  modal.body.append(form(fields, tr('保存', 'Save'), async (body) => {
    if (user && !body.password) delete body.password;
    const r = await request(user ? `/api/admin/users/${user.id}` : '/api/admin/users', body, user ? 'PATCH' : 'POST');
    if (r.ok) { await refreshAccount(); modal.close(); reload(); }
    return r;
  }));
}

export function supportQrPanel() {
  const root = h('div', { class: 'support-admin' });
  const grid = h('div', { class: 'support-grid' });
  const message = h('p', { role: 'status', 'aria-live': 'polite', class: 'account-message' });
  const slots = [], controls = [];
  let busy = false;
  async function refresh() {
    const r = await api('/api/public/support');
    if (!r.ok) throw Error(errorText(r, tr('无法读取收款码。', 'Unable to load QR codes.')));
    for (const { kind, caption, preview, remove } of slots) {
      preview.replaceChildren(r.json.qr[kind]
        ? h('img', { class: 'support-qr-image', src: r.json.qr[kind], alt: caption, onError: () => preview.replaceChildren(h('p', { class: 'error' }, tr('预览加载失败，请刷新。', 'Preview failed to load. Please refresh.'))) })
        : h('p', { class: 'muted' }, tr('未设置', 'Not set')));
      remove.dataset.configured = String(!!r.json.qr[kind]);
    }
  }
  async function run(action, success = '') {
    if (busy) return;
    busy = true;
    for (const control of controls) control.disabled = true;
    message.className = 'account-message';
    message.textContent = tr('正在处理…', 'Working…');
    try { await action(); message.textContent = success; }
    catch (e) { message.className = 'account-message error'; message.textContent = e.message || tr('请求失败，请重试。', 'Request failed. Please retry.'); }
    finally {
      busy = false;
      for (const control of controls) control.disabled = false;
      for (const { remove } of slots) remove.disabled = remove.dataset.configured !== 'true';
    }
  }
  for (const [kind, caption] of [['wechat', tr('微信收款码', 'WeChat QR code')], ['alipay', tr('支付宝收款码', 'Alipay QR code')]]) {
    const preview = h('div', { class: 'support-qr-preview' });
    const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
    const path = `/api/admin/support/qr/${kind}`;
    const upload = button(tr('上传', 'Upload'), () => run(async () => {
      const image = file.files[0];
      if (!image) throw Error(tr('请先选择图片。', 'Choose an image first.'));
      if (image.size > 2 * 1024 * 1024) throw Error(tr('图片不能超过2 MiB。', 'Image must be at most 2 MiB.'));
      const r = await fetch(path, { method: 'POST', headers: { 'X-Houren-Request': '1', 'Content-Type': image.type || 'application/octet-stream' }, body: image });
      let json = null;
      try { json = await r.json(); } catch { /* Use the fallback message for non-JSON errors. */ }
      if (!r.ok) throw Error(errorText({ json }, tr('上传失败，请重试。', 'Upload failed. Please retry.')));
      file.value = '';
      await refresh();
    }, tr('收款码已更新。', 'QR code updated.')), true);
    const remove = button(tr('移除', 'Remove'), () => run(async () => {
      const r = await request(path, {}, 'DELETE');
      if (!r.ok) throw Error(errorText(r, tr('移除失败，请重试。', 'Removal failed. Please retry.')));
      await refresh();
    }, tr('收款码已移除。', 'QR code removed.')));
    slots.push({ kind, caption, preview, remove });
    controls.push(file, upload, remove);
    grid.append(h('section', { class: 'support-qr-card' }, h('h3', null, caption), preview,
      h('label', { class: 'field' }, h('span', null, tr('选择图片', 'Choose image')), file), h('div', { class: 'form-actions' }, upload, remove)));
  }
  const reload = button(tr('刷新预览', 'Refresh previews'), () => run(refresh));
  controls.push(reload);
  root.append(h('p', { class: 'muted' }, tr('仅用于展示，不提供任何游戏内回报。支持静态 JPEG、PNG、WebP，最多2 MiB、16MP。', 'For display only; they bring no in-world reward. Static JPEG, PNG or WebP, up to 2 MiB and 16 MP.')), grid, message, reload);
  run(refresh);
  return root;
}
