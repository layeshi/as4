// 页面 id → 构建函数。每个函数返回 { top, nodes, tabbar, pull, fullscreen, footer }。
const { startup } = require('./startup');
const { city, placeSheet } = require('./city');
const { residents, resident } = require('./residents');
const { archive, detail } = require('./archive');
const { account, link, owner, entry, settings, about } = require('./me');
module.exports = { startup, city, residents, resident, archive, detail, account, link, owner, entry, settings, about, sheet: placeSheet };
