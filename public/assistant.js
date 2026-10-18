import { mountAssistant } from './assistant-ui.js';
import { getLang } from './i18n.js';
document.documentElement.lang = getLang();
await mountAssistant();
