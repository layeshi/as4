import { mountAnnouncements } from './announcements-ui.js';
const page = await mountAnnouncements({ header: document.getElementById('console-header'), head: document.getElementById('page-head'),
  message: document.getElementById('message'), content: document.getElementById('content'), id: new URLSearchParams(location.search).get('id') });
// 浏览器缓存返回时保留交互；重新读取，避免继续展示已撤下的公告。
window.addEventListener('pagehide', event => { if (!event.persisted) page.dispose(); });
window.addEventListener('pageshow', event => { if (event.persisted) page.load(); });
