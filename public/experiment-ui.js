import { h } from './dom.js';
import { api, errorText } from './api.js';
import { getLang } from './i18n.js';

const tr = (zh, en) => getLang() === 'en' ? en : zh;

export function experimentPanel({ onChanged = () => {} } = {}) {
  const status = h('p', { role: 'status', 'aria-live': 'polite' });
  const clock = h('p', { class: 'muted' });
  const message = h('p', { role: 'alert', class: 'error' });
  let busy = false, view = null, generation = 0;
  const pause = h('button', { type: 'button', class: 'btn primary', onClick: () => change(true) }, tr('暂停实验', 'Pause experiment'));
  const resume = h('button', { type: 'button', class: 'btn primary', onClick: () => change(false) }, tr('恢复实验', 'Resume experiment'));
  const refresh = h('button', { type: 'button', class: 'btn', onClick: load }, tr('刷新状态', 'Refresh status'));
  const root = h('section', { class: 'experiment-panel' }, status, clock,
    h('div', { class: 'form-actions' }, pause, resume, refresh), message,
    h('p', { class: 'muted' }, tr('暂停冻结世界时间、代谢结算、居民自主行动和托管行动模型调用。浏览、注册/领养、寄信、模型配置和连接测试、管理员调整世界仍可用；手动推进时间不可用。', 'Pausing freezes world time, settlement, autonomous actions and hosted action model calls. Browsing, entry/adoption, letters, model settings, connection tests and world adjustments remain available; manual ticks are blocked.')),
    h('p', { class: 'muted' }, tr('恢复遵循各运行器最新的启用开关，并继续剩余倒计时；服务器重启后仍保持暂停。', 'Resuming follows the latest runner switches and the remaining countdown. A paused experiment stays paused after a server restart.')),
    h('p', { class: 'muted' }, tr('服务器可中止托管请求。项目自带外部运行器读取暂停状态后等待；玩家自写程序或已发出的远程模型请求无法强制中止，已产生的模型费用也可能仍会计费。', 'The server cancels hosted requests locally. Reference external runners wait after reading the pause state. Custom external programs and remote requests already sent cannot be forcibly stopped; incurred model charges may still apply.')));
  function draw() {
    const states = {
      running: tr('实验运行中', 'Experiment running'), paused: tr('实验已暂停', 'Experiment paused'),
      pausing: tr('正在暂停实验…', 'Pausing experiment…'), resuming: tr('正在恢复实验…', 'Resuming experiment…'),
      pause_error: tr('实验已冻结，停止任务时发生错误，请刷新或重试', 'Experiment frozen; stopping tasks failed. Refresh or retry.'),
      resume_error: tr('恢复发生错误，请刷新或重试', 'Resume failed. Refresh or retry.'),
    };
    status.textContent = view ? states[view.state] || tr('状态未知，请刷新', 'Unknown state; refresh') : tr('正在加载…', 'Loading…');
    clock.textContent = view ? tr(`当前刻：${view.tick} · ${view.paused ? '恢复后距离下一刻' : '距离下一刻'}约 ${Math.ceil(view.remainingMs / 1000)} 秒`, `Tick ${view.tick} · about ${Math.ceil(view.remainingMs / 1000)} seconds to the next tick${view.paused ? ' after resuming' : ''}`) : '';
    const transitioning = ['pausing', 'resuming'].includes(view?.state);
    pause.disabled = busy || !view || transitioning || view.state === 'paused';
    resume.disabled = busy || !view || transitioning || view.state === 'running';
    refresh.disabled = busy;
  }
  async function load() {
    const requestGeneration = ++generation;
    const r = await api('/api/admin/experiment');
    if (requestGeneration !== generation) return;
    if (r.ok) { view = r.json; message.textContent = ''; }
    else { view = null; message.textContent = errorText(r, tr('无法读取实验状态，请重试。', 'Unable to read experiment status. Retry.')); }
    draw();
  }
  async function change(paused) {
    if (busy || !view) return;
    busy = true;
    generation++;
    view = { ...view, state: paused ? 'pausing' : 'resuming' };
    message.textContent = '';
    draw();
    const r = await api(paused ? '/api/admin/pause' : '/api/admin/resume', { method: 'POST', body: {} });
    await load();
    if (!r.ok) message.textContent = errorText(r, tr('操作失败，请检查当前状态后重试。', 'Operation failed. Check the current state and retry.'));
    else onChanged();
    busy = false;
    draw();
  }
  draw();
  load();
  return root;
}
