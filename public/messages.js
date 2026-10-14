import { mountMessageBoard } from './messages-ui.js';

await mountMessageBoard({
  header: document.getElementById('console-header'), head: document.getElementById('page-head'),
  message: document.getElementById('message'), content: document.getElementById('content'),
});
