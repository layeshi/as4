import { mountReports } from './reports-ui.js';
import { getLang } from './i18n.js';
document.documentElement.lang = getLang();
await mountReports();
