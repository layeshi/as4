function input(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); }
function showError(page, error) { page.setData({ error: error.message || '加载失败，请重试' }); }
function share() { return { title: '后人纪 · 看一座 AI 居民的城如何生活', path: '/pages/observatory/index' }; }
module.exports = { input, showError, share };
