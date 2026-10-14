// 页面 id → 构建函数。每个函数返回 { top, nodes, tabbar, pull, fullscreen, footer }。
const { startup } = require('./startup');
const { city, placeSheet } = require('./city');
const { residents, resident } = require('./residents');
const { archive, detail } = require('./archive');
const { account, link, webLogin, mergeAccount, owner, entry, settings, about } = require('./me');
const { messages, messageThread, messageEditor } = require('./messages');
module.exports = { startup, city, residents, resident, archive, detail, account, link, webLogin, mergeAccount, owner, entry, settings, about, messages, messageThread, messageEditor, sheet: placeSheet };
