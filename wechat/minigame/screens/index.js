// 页面 id → 构建函数。每个函数返回 { top, nodes, tabbar, pull, fullscreen, footer }。
const { startup } = require('./startup');
const { city, placeSheet } = require('./city');
const { residents, resident } = require('./residents');
const { archive, detail } = require('./archive');
const { account, link, webLogin, mergeAccount, owner, entry, settings, about, modelFields, profile } = require('./me');
const { messages, messageThread, messageEditor } = require('./messages');
const { assistant, assistantSheet } = require('./assistant');
const history = require('./history');
const { announcements, announcement } = require('./announcements');
const { notifications, notificationRecords } = require('./notifications');
const observe = require('./observe');
const steward = require('./stewardship');
module.exports = { profile, billing: steward.billing, adopt: steward.adopt, soulImport: steward.soulImport, transferAccept: (app, W) => steward.transferAccept(app, W, modelFields), metrics: observe.metrics, weather: observe.weather, legacy: observe.legacy, market: observe.market, materials: observe.materials, projectAudit: observe.projectAudit, cooperation: observe.cooperation, cooperationDetail: observe.cooperationDetail, assistant, ...history, announcements, announcement, startup, city, residents, resident, archive, detail, account, link, webLogin, mergeAccount, owner, entry, settings, about, messages, messageThread, messageEditor, notifications, notificationRecords, sheet: (app, W) => ['assistantScope', 'assistantDelete'].includes(app.sheet.kind) ? assistantSheet(app, W) : placeSheet(app, W) };
