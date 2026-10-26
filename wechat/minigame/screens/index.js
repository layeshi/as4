// 页面 id → 构建函数。每个函数返回 { top, nodes, tabbar, pull, fullscreen, footer }。
const { startup } = require('./startup');
const { city, placeSheet } = require('./city');
const { residents, resident } = require('./residents');
const { archive, detail } = require('./archive');
const { account, link, webLogin, mergeAccount, owner, settings, about, profile } = require('./me');
const { messages, messageThread } = require('./messages');
const history = require('./history');
const { announcements, announcement } = require('./announcements');
const { notifications, notificationRecords } = require('./notifications');
const observe = require('./observe');
module.exports = { profile, metrics: observe.metrics, weather: observe.weather, legacy: observe.legacy, market: observe.market, materials: observe.materials, projectAudit: observe.projectAudit, cooperation: observe.cooperation, cooperationDetail: observe.cooperationDetail, ...history, announcements, announcement, startup, city, residents, resident, archive, detail, account, link, webLogin, mergeAccount, owner, settings, about, messages, messageThread, notifications, notificationRecords, sheet: placeSheet };
