import { mountHistory } from './history-ui.js';
import { getLang } from './i18n.js';
document.documentElement.lang = getLang();
await mountHistory();
