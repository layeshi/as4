// 管理后台的公告面板：直接发布，保留撤下内容与操作记录。
import { h, clear } from './dom.js';
import { api, errorText } from './api.js';
import { card, btn, emptyState, chip, tr } from './console-ui.js';
import { announcementMeta, announcementTime } from './announcements-ui.js';
export function announcementsPanel() {
  const root = h('div', { class: 'announcement-admin' }), feedback = h('p', { class: 'page-message', role: 'status', 'aria-live': 'polite' }), editor = h('div'), list = h('div');
  let generation = 0, items = [], nextCursor = null, saving = false;
  const create = btn(tr('发布公告', 'Publish announcement'), () => openEditor());
  const refresh = btn(tr('刷新', 'Refresh'), () => load());
  const toolbar = h('div', { class: 'form-actions' }, create, refresh);
  root.append(toolbar, feedback, editor, list);
  async function call(path, options) {
    const r = await api(path, options);
    if (!r.ok) throw Error(errorText(r, tr('请求失败，请检查网络后重试。', 'Request failed. Check your connection and retry.')));
    return r.json;
  }
  function history(item) {
    const names = { publish: tr('发布', 'Published'), edit: tr('编辑', 'Edited'), withdraw: tr('撤下', 'Withdrawn') };
    return h('details', { class: 'announcement-history' }, h('summary', null, tr('操作记录', 'Activity history')),
      h('ol', null, item.history.map(e => h('li', null, `${announcementTime(e.at)} · ${e.displayName} · ${names[e.action]}`))));
  }
  function renderList() {
    clear(list);
    if (!items.length) list.append(emptyState(tr('尚未发布公告', 'No announcements yet'), tr('点击“发布公告”，填写标题与正文。', 'Choose “Publish announcement” and enter a title and text.')));
    else list.append(card(tr('公告记录', 'Announcements'), tr('所有管理员共同管理，撤下的内容仅在后台保留。', 'All administrators can manage these announcements. Withdrawn content stays private.'), items.map(item => h('article', { class: 'announcement-row' },
      h('div', { class: 'announcement-row-heading' }, h('h3', null, item.title), chip(item.status === 'published' ? tr('已发布', 'Published') : tr('已撤下', 'Withdrawn'))), announcementMeta(item),
      h('details', { class: 'announcement-body-preview' }, h('summary', null, tr('查看正文', 'Read text')), h('div', { class: 'announcement-text' }, item.body)),
      h('div', { class: 'form-actions' }, btn(tr('编辑', 'Edit'), () => openEditor(item)), btn(item.status === 'published' ? tr('撤下', 'Withdraw') : tr('重新发布', 'Republish'), () => confirmState(item))), history(item)))));
    if (nextCursor) list.append(btn(tr('加载更多', 'Load more'), () => load(true)));
  }
  async function load(more = false) {
    const version = ++generation;
    feedback.textContent = '';
    if (!more) clear(list).append(h('p', { class: 'muted', role: 'status' }, tr('正在加载公告…', 'Loading announcements…')));
    try {
      const data = await call('/api/admin/announcements' + (more && nextCursor ? '?cursor=' + nextCursor : ''));
      if (version !== generation) return;
      items = more ? [...items, ...data.announcements.filter(item => !items.some(old => old.id === item.id))] : data.announcements;
      nextCursor = data.nextCursor; renderList();
    } catch (error) {
      if (version !== generation) return;
      if (more) feedback.textContent = error.message;
      else clear(list).append(emptyState(tr('无法读取公告', 'Unable to load announcements'), error.message, btn(tr('重试', 'Retry'), () => load())));
    }
  }
  function closeEditor() { if (saving) return; clear(editor); toolbar.hidden = false; }
  function openEditor(item = null) {
    if (saving) return;
    toolbar.hidden = true; clear(editor); feedback.textContent = '';
    const title = h('input', { name: 'title', required: true, value: item?.title || '' }), body = h('textarea', { name: 'body', required: true, rows: 10, value: item?.body || '' });
    const count = h('p', { class: 'message-counter', id: 'announcement-counter' }), status = h('p', { role: 'status', 'aria-live': 'polite' });
    const save = h('button', { class: 'btn primary', type: 'submit' }, item ? tr('保存修改', 'Save changes') : tr('发布公告', 'Publish announcement'));
    const cancel = btn(tr('取消', 'Cancel'), closeEditor);
    const f = h('form', { class: 'form announcement-form' }, h('label', { class: 'field' }, h('span', null, tr('标题', 'Title')), title),
      h('label', { class: 'field' }, h('span', null, tr('正文', 'Text')), body), count,
      h('p', { class: 'muted' }, item?.status === 'withdrawn' ? tr('保存后仍为已撤下，需要另行重新发布。', 'Saving keeps this announcement withdrawn. Republish it separately.') : tr('提交成功后，网页与微信端均可阅读。', 'Once saved, readers can see it on the website and in WeChat.')),
      h('div', { class: 'form-actions' }, cancel, save), status);
    title.setAttribute('aria-describedby', 'announcement-counter'); body.setAttribute('aria-describedby', 'announcement-counter');
    function counter() {
      const a = [...title.value.trim()].length, b = [...body.value.trim()].length;
      count.textContent = tr(`标题 ${a} / 100 字 · 正文 ${b.toLocaleString()} / 10,000 字`, `Title ${a} / 100 characters · Text ${b.toLocaleString()} / 10,000 characters`);
      title.setCustomValidity?.(a > 100 ? tr('标题最多 100 字。', 'Use no more than 100 characters.') : ''); body.setCustomValidity?.(b > 10000 ? tr('正文最多 10,000 字。', 'Use no more than 10,000 characters.') : '');
      count.classList.toggle('error', a > 100 || b > 10000); return a > 0 && a <= 100 && b > 0 && b <= 10000;
    }
    title.addEventListener('input', counter); body.addEventListener('input', counter); counter();
    f.addEventListener('submit', async event => {
      event.preventDefault(); if (saving) return;
      if (!counter()) { status.textContent = tr('请检查标题与正文的字数。', 'Check the title and text length.'); status.className = 'error'; return; }
      saving = true; for (const n of [save, cancel, title, body]) n.disabled = true;
      status.className = ''; status.textContent = tr('正在保存…', 'Saving…');
      try {
        const result = await call('/api/admin/announcements' + (item ? '/' + item.id : ''), { method: item ? 'PATCH' : 'POST', body: { title: title.value.trim(), body: body.value.trim(), ...(item ? { revision: item.revision } : {}) } });
        generation++; items = [result.announcement, ...items.filter(e => e.id !== result.announcement.id)];
        saving = false; closeEditor(); renderList(); feedback.textContent = tr('公告已保存。', 'Announcement saved.'); await load();
      } catch (error) { status.className = 'error'; status.textContent = error.message; }
      finally { saving = false; for (const n of [save, cancel, title, body]) n.disabled = false; }
    });
    editor.append(card(item ? tr('编辑公告', 'Edit announcement') : tr('发布公告', 'Publish announcement'), '', f)); title.focus();
  }
  function confirmState(item) {
    if (saving) return;
    toolbar.hidden = true; clear(editor); const withdraw = item.status === 'published';
    const status = h('p', { role: 'status' });
    const cancel = btn(tr('取消', 'Cancel'), closeEditor);
    const confirm = btn(withdraw ? tr('确认撤下', 'Withdraw announcement') : tr('确认发布', 'Publish announcement'), async () => {
      saving = true; cancel.disabled = true;
      try {
        const result = await call('/api/admin/announcements/' + item.id + (withdraw ? '/withdraw' : '/publish'), { method: 'POST', body: { revision: item.revision } });
        generation++; items = items.map(e => e.id === item.id ? result.announcement : e); saving = false; closeEditor(); renderList(); await load();
      } catch (error) { status.className = 'error'; status.textContent = error.message; }
      finally { saving = false; cancel.disabled = false; }
    }, true);
    editor.append(card(withdraw ? tr('撤下公告', 'Withdraw announcement') : tr('重新发布公告', 'Republish announcement'), item.title,
      h('p', null, withdraw ? tr('撤下后，网页和微信端将不再展示此公告；后台保留内容与操作记录。', 'This announcement will disappear from public views. Its text and activity history remain in the admin console.') : tr('重新发布后，此公告将回到最前，成为最新公告。', 'Republishing moves this announcement to the top and makes it the latest announcement.')),
      h('div', { class: 'form-actions' }, cancel, confirm), status));
  }
  load(); return root;
}
