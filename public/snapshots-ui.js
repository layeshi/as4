import { h, clear } from './dom.js';
import { getLang } from './i18n.js';
import { api, errorText } from './api.js';
import { openModal } from './modals.js';

const tr = (zh, en) => getLang() === 'en' ? en : zh;
const button = (label, run) => h('button', { type: 'button', class: 'btn', onClick: run }, label);
const size = (bytes) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const moment = (s) => tr(`第 ${s.day + 1} 日 · 已推进 ${s.tick} 刻`, `Day ${s.day + 1} · ${s.tick} ticks elapsed`);

export async function openSnapshots() {
  const modal = openModal(tr('世界快照', 'World snapshots'), 'wide');
  let page = 1, generation = 0;
  const note = h('input', { name: 'label', type: 'text', maxlength: 120, placeholder: tr('例如：第一天结算后', 'For example: after day one') });
  const save = h('button', { type: 'submit', class: 'btn primary' }, tr('保存当前快照', 'Save current snapshot'));
  const message = h('p', { class: 'account-message', role: 'status', 'aria-live': 'polite' });
  const form = h('form', { class: 'form account-form' },
    h('label', { class: 'field' }, h('span', null, tr('备注（可选，最多 120 字）', 'Note (optional, up to 120 characters)')), note),
    h('div', { class: 'form-actions' }, save), message);
  const list = h('div', { class: 'account-list' });
  const pages = h('div', { class: 'form-actions' });
  modal.body.append(
    h('p', { class: 'muted' }, tr('保存当前纪元、居民状态与历史日志，城市继续运行。每次保存都会保留一份独立存档。', 'Save the current era, residents and history while the city keeps running. Each save keeps a separate archive.')),
    h('p', { class: 'muted' }, tr('存档包含居民的私有灵魂与记忆，仅管理员可下载。人类账号与托管模型配置需单独备份。', 'Archives include private souls and memories and are available only to administrators. Back up human accounts and hosted model configuration separately.')),
    form, h('div', { class: 'account-toolbar' }, h('h3', null, tr('已保存的快照', 'Saved snapshots')), button(tr('刷新列表', 'Refresh list'), load)), list, pages);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    note.disabled = true;
    message.className = 'account-message';
    message.textContent = tr('正在保存…', 'Saving…');
    try {
      const r = await api('/api/admin/snapshots', { method: 'POST', body: { label: note.value } });
      if (!r.ok) {
        message.className = 'account-message error';
        message.textContent = errorText(r, tr('保存失败，请重试。', 'Save failed. Please retry.'));
        return;
      }
      message.textContent = tr(`快照已保存：${moment(r.json.snapshot)}。`, `Snapshot saved: ${moment(r.json.snapshot)}.`);
      note.value = '';
      page = 1;
      await load();
    } finally { save.disabled = false; note.disabled = false; }
  });

  async function download(snapshot, btn, status) {
    if (btn.disabled) return;
    btn.disabled = true;
    status.textContent = tr('正在下载…', 'Downloading…');
    try {
      const r = await fetch(`/api/admin/snapshots/${encodeURIComponent(snapshot.id)}/download`, { cache: 'no-store' });
      if (!r.ok) {
        const json = await r.json().catch(() => null);
        throw new Error(errorText({ json }, tr('下载失败，请重试。', 'Download failed. Please retry.')));
      }
      const url = URL.createObjectURL(await r.blob());
      const link = h('a', { href: url, download: `houren-snapshot-${snapshot.id}.json.gz` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      status.textContent = tr('下载已开始。', 'Download started.');
    } catch (e) {
      status.textContent = e.message || tr('下载失败，请重试。', 'Download failed. Please retry.');
    } finally { btn.disabled = false; }
  }

  async function load() {
    const version = ++generation;
    clear(list).append(h('p', null, tr('正在加载…', 'Loading…')));
    clear(pages);
    const r = await api(`/api/admin/snapshots?page=${page}`);
    if (version !== generation) return;
    clear(list);
    if (!r.ok) {
      list.append(h('p', { class: 'error', role: 'alert' }, errorText(r, tr('无法加载快照。', 'Unable to load snapshots.'))), button(tr('重试', 'Retry'), load));
      return;
    }
    if (!r.json.snapshots.length) list.append(h('p', { class: 'empty' }, tr('还没有保存快照。', 'No snapshots saved yet.')));
    for (const s of r.json.snapshots) {
      const status = h('small', { role: 'status', 'aria-live': 'polite' });
      const btn = button(tr('下载', 'Download'), () => download(s, btn, status));
      list.append(h('article', { class: 'card account-row snapshot-row' },
        h('div', null, h('strong', null, s.label || tr('世界快照', 'World snapshot')),
          h('p', { class: 'muted' }, new Date(s.createdAt).toLocaleString(getLang() === 'en' ? 'en-US' : 'zh-CN')),
          h('small', { class: 'muted' }, `${moment(s)} · ${size(s.bytes)}`)),
        h('div', { class: 'snapshot-download' }, btn, status)));
    }
    const prev = button(tr('上一页', 'Previous'), () => { page--; load(); }); prev.disabled = page <= 1;
    const next = button(tr('下一页', 'Next'), () => { page++; load(); }); next.disabled = page * r.json.pageSize >= r.json.total;
    pages.append(prev, h('span', { class: 'muted' }, tr(`第 ${page} 页 · 共 ${r.json.total} 份`, `Page ${page} · ${r.json.total} snapshots`)), next);
  }
  await load();
}
