const api = require('./utils/api');
App({
  onLaunch() { api.restoreSession(); },
  // 造者密钥只在本次小程序进程中保留。
  globalData: { ownerKey: '', ownerAgent: null }
});
