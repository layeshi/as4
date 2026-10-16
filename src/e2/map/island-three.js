// 第七前提「三城」的岛图 island-three-v1（docs/plans/2026-10-16-three-cities.md 附录 A）。
//
// 一座岛上三座城：北城（贫井，档案馆、研究所、摇篮）、西城（富井，只有核心设施）、东城（中井，交易所、纪念地），
// 城与城之间是荒野。地点与空地都带 city：'north' | 'west' | 'east' | null（荒野），它就是地界，创世后不变。
// 字段与 compact-materials-v1 相同（id district xy glyph decay walls landmark open wild modules salvage materialRecoverable name），
// 另有 nameEn（英文名）、role（城里的职能：port well parliament agora archive research cradle board memorial shell wild）。
// 路程单位是「段」：一段 = 1 × K 词元。核心到核心：北—西 12、北—东 12、西—东 13。

const B = (id, city, name, nameEn, xy, glyph, role, decay, walls, extra = {}) => Object.freeze({
  id, city, district: city ? `${city}-city` : 'wilds', name, nameEn, xy, glyph, role, decay, walls,
  landmark: null, open: false, wild: null, modules: [], salvage: 0, materialRecoverable: 0, ...extra,
});
const W = (id, name, nameEn, xy, glyph, energyMax, regen, relics) => B(id, null, name, nameEn, xy, glyph, 'wild', 0, 6, {
  open: true, wild: Object.freeze({ energyMax, regen, coins: 0, relics: Object.freeze(relics) }),
});

/** 三座城：份额是源井占世界总容量的千分比（3:2:1）；exile 是本城放逐时送去的荒野地带 */
export const CITIES = Object.freeze([
  Object.freeze({
    id: 'north', name: { zh: '无名之城·北', en: 'The Nameless City (North)' }, short: { zh: '北城', en: 'North City' },
    wellShare: 167, exile: 'scrapyard', port: 'north-port', well: 'north-well', parliament: 'north-parliament', agora: 'north-agora',
  }),
  Object.freeze({
    id: 'west', name: { zh: '无名之城·西', en: 'The Nameless City (West)' }, short: { zh: '西城', en: 'West City' },
    wellShare: 500, exile: 'saltflats', port: 'west-port', well: 'west-well', parliament: 'west-parliament', agora: 'west-agora',
  }),
  Object.freeze({
    id: 'east', name: { zh: '无名之城·东', en: 'The Nameless City (East)' }, short: { zh: '东城', en: 'East City' },
    wellShare: 333, exile: 'salvage', port: 'east-port', well: 'east-well', parliament: 'east-parliament', agora: 'east-agora',
  }),
]);

const places = [
  // ── 北城（贫井 1/6）──
  B('north-port', 'north', '北港', 'North Port', [1200, 140], 'port', 'port', 60, 6, { landmark: 'port' }),
  B('north-agora', 'north', '北城广场', 'North Square', [1200, 340], 'agora', 'agora', 0, 6, { open: true }),
  B('north-parliament', 'north', '北城议会', 'North Parliament', [1010, 270], 'parliament', 'parliament', 50, 12, { materialRecoverable: 150 }),
  B('north-well', 'north', '北井', 'North Well', [1360, 480], 'well', 'well', 100, 6, { landmark: 'well' }),
  B('north-archive', 'north', '档案馆', 'Archive', [1390, 240], 'library', 'archive', 50, 6, { modules: ['archive'], materialRecoverable: 150 }),
  B('north-institute', 'north', '研究所', 'Research Institute', [1580, 330], 'workshop', 'research', 50, 6, { modules: ['research'], materialRecoverable: 150 }),
  B('north-cradle', 'north', '摇篮', 'Cradle', [1560, 520], 'school', 'cradle', 50, 6, { modules: ['cradle'], materialRecoverable: 125 }),
  B('north-ruin-1', 'north', '旧公寓遗址', 'Old Tenements', [990, 150], 'tenements', 'shell', 40, 6, { materialRecoverable: 200 }),
  B('north-ruin-2', 'north', '旧钟楼遗址', 'Old Clock Tower', [900, 420], 'clocktower', 'shell', 30, 6, { materialRecoverable: 150 }),
  B('north-ruin-3', 'north', '旧医院遗址', 'Old Hospital', [1080, 560], 'hospital', 'shell', 40, 6, { materialRecoverable: 150 }),
  // ── 西城（富井 1/2）──
  B('west-port', 'west', '西港', 'West Port', [170, 1520], 'port', 'port', 60, 6, { landmark: 'port' }),
  B('west-agora', 'west', '西城广场', 'West Square', [430, 1450], 'agora', 'agora', 0, 6, { open: true }),
  B('west-parliament', 'west', '西城议会', 'West Parliament', [330, 1290], 'parliament', 'parliament', 50, 12, { materialRecoverable: 150 }),
  B('west-well', 'west', '西井', 'West Well', [560, 1600], 'well', 'well', 100, 6, { landmark: 'well' }),
  B('west-ruin-1', 'west', '旧神殿遗址', 'Old Temple', [640, 1330], 'temple', 'shell', 30, 6, { materialRecoverable: 100 }),
  B('west-ruin-2', 'west', '旧剧场遗址', 'Old Theater', [300, 1660], 'theater', 'shell', 40, 6, { materialRecoverable: 100 }),
  B('west-ruin-3', 'west', '旧地铁站遗址', 'Old Metro Station', [720, 1720], 'metro', 'shell', 30, 6, { materialRecoverable: 100 }),
  // ── 东城（中井 1/3）──
  B('east-port', 'east', '东港', 'East Port', [2230, 1520], 'port', 'port', 60, 6, { landmark: 'port' }),
  B('east-agora', 'east', '东城广场', 'East Square', [1970, 1450], 'agora', 'agora', 0, 6, { open: true }),
  B('east-parliament', 'east', '东城议会', 'East Parliament', [2070, 1290], 'parliament', 'parliament', 50, 12, { materialRecoverable: 150 }),
  B('east-well', 'east', '东井', 'East Well', [1840, 1600], 'well', 'well', 100, 6, { landmark: 'well' }),
  B('east-exchange', 'east', '交易所', 'Exchange', [1800, 1330], 'market', 'board', 60, 6, { modules: ['board'], materialRecoverable: 125 }),
  B('east-memorial', 'east', '纪念地', 'Memorial', [2120, 1660], 'cemetery', 'memorial', 30, 6, { modules: ['memorial'], materialRecoverable: 75 }),
  B('east-ruin-1', 'east', '旧法院遗址', 'Old Court', [1700, 1720], 'court', 'shell', 40, 6, { materialRecoverable: 125 }),
  B('east-ruin-2', 'east', '旧高架桥遗址', 'Old Overpass', [1990, 1760], 'overpass', 'shell', 40, 6, { materialRecoverable: 125 }),
  B('east-ruin-3', 'east', '旧灯塔遗址', 'Old Lighthouse', [2280, 1330], 'lighthouse', 'shell', 30, 6, { materialRecoverable: 100 }),
  // ── 荒野（8 处）：能量上限与日恢复按「能量单位」（×K 为词元）；遗物是 P6 虚拟遗物的编号 ──
  W('scrapyard', '废车场', 'Scrapyard', [850, 720], 'scrap', 150, 7, [3, 5, 12]),
  W('quarry', '旧采石场', 'Old Quarry', [1600, 720], 'scrap', 150, 7, [14, 19, 20]),
  W('solarfield', '光伏遗址', 'Solar Field', [1050, 1050], 'solar', 350, 16, [6, 11, 13, 22, 23]),
  W('datatower', '坠落的数据塔', 'Fallen Data Tower', [1380, 1080], 'edge', 350, 16, [1, 2, 4, 7, 9]),
  W('saltflats', '盐滩', 'Salt Flats', [560, 1150], 'salt', 100, 5, [8, 10, 15]),
  W('windfarm', '风电场残骸', 'Wind Farm Wreck', [900, 1500], 'solar', 100, 5, [24, 25, 21]),
  W('salvage', '近郊回收地', 'Salvage Yard', [1820, 1150], 'edge', 150, 7, [17, 18, 16]),
  W('highway', '公路尽头', 'Highway’s End', [1500, 1500], 'road', 150, 7, [26, 27, 28]),
];

/** 荒野八处的物料储量与上限（P5 的物料地带；恢复的隐藏参数在私有创世配置里） */
export const MATERIAL_ZONES = Object.freeze({
  scrapyard: [150, 300],
  quarry: [120, 240],
  solarfield: [90, 180],
  datatower: [120, 240],
  saltflats: [30, 60],
  windfarm: [40, 80],
  salvage: [60, 120],
  highway: [60, 120],
});

const lot = (id, city, xy, near) => Object.freeze({ id, city, district: city ? `${city}-city` : 'wilds', xy, near: Object.freeze(near) });
const lots = [
  lot('north-lot-1', 'north', [1100, 205], ['north-port', 'north-parliament']),
  lot('north-lot-2', 'north', [1300, 175], ['north-port', 'north-archive']),
  lot('north-lot-3', 'north', [1490, 170], ['north-archive', 'north-institute']),
  lot('north-lot-4', 'north', [1720, 420], ['north-institute']),
  lot('north-lot-5', 'north', [1460, 610], ['north-cradle', 'north-well']),
  lot('north-lot-6', 'north', [880, 290], ['north-ruin-2', 'north-parliament']),
  lot('west-lot-1', 'west', [230, 1390], ['west-port', 'west-parliament']),
  lot('west-lot-2', 'west', [500, 1280], ['west-parliament', 'west-ruin-1']),
  lot('west-lot-3', 'west', [550, 1400], ['west-agora', 'west-ruin-1']),
  lot('west-lot-4', 'west', [480, 1560], ['west-agora', 'west-well']),
  lot('west-lot-5', 'west', [220, 1640], ['west-port', 'west-ruin-2']),
  lot('west-lot-6', 'west', [640, 1700], ['west-well', 'west-ruin-3']),
  lot('west-lot-7', 'west', [820, 1640], ['west-ruin-3']),
  lot('east-lot-1', 'east', [1930, 1270], ['east-exchange', 'east-parliament']),
  lot('east-lot-2', 'east', [2260, 1430], ['east-port', 'east-ruin-3']),
  lot('east-lot-3', 'east', [1780, 1470], ['east-exchange', 'east-well']),
  lot('east-lot-4', 'east', [1850, 1760], ['east-ruin-1', 'east-ruin-2']),
  lot('east-lot-5', 'east', [2200, 1600], ['east-memorial', 'east-port']),
  lot('east-lot-6', 'east', [2190, 1240], ['east-parliament', 'east-ruin-3']),
  lot('wilds-lot-1', null, [720, 800], ['scrapyard']),
  lot('wilds-lot-2', null, [1740, 800], ['quarry']),
  lot('wilds-lot-3', null, [1210, 960], ['solarfield', 'datatower']),
  lot('wilds-lot-4', null, [1220, 1180], ['solarfield', 'datatower']),
  lot('wilds-lot-5', null, [420, 1060], ['saltflats']),
  lot('wilds-lot-6', null, [1600, 1600], ['highway']),
];

const streets = [
  // 北城
  ['north-port', 'north-agora'], ['north-port', 'north-ruin-1'], ['north-ruin-1', 'north-parliament'], ['north-parliament', 'north-agora'],
  ['north-agora', 'north-archive'], ['north-archive', 'north-institute'], ['north-institute', 'north-cradle'], ['north-cradle', 'north-well'],
  ['north-well', 'north-agora'], ['north-parliament', 'north-ruin-2'], ['north-ruin-2', 'north-ruin-3'], ['north-ruin-3', 'north-well'],
  // 西城
  ['west-port', 'west-agora'], ['west-port', 'west-parliament'], ['west-parliament', 'west-agora'], ['west-agora', 'west-well'],
  ['west-agora', 'west-ruin-1'], ['west-port', 'west-ruin-2'], ['west-ruin-2', 'west-well'], ['west-well', 'west-ruin-3'],
  // 东城
  ['east-port', 'east-agora'], ['east-port', 'east-ruin-3'], ['east-ruin-3', 'east-parliament'], ['east-parliament', 'east-exchange'],
  ['east-exchange', 'east-agora'], ['east-agora', 'east-well'], ['east-agora', 'east-memorial'], ['east-memorial', 'east-ruin-2'],
  ['east-ruin-2', 'east-well'], ['east-well', 'east-ruin-1'],
  // 出城
  ['north-ruin-3', 'scrapyard', 2], ['north-cradle', 'quarry', 2], ['west-ruin-1', 'saltflats', 2], ['west-ruin-3', 'windfarm', 2],
  ['east-exchange', 'salvage', 2], ['east-ruin-1', 'highway', 2],
  // 荒野：三条海岸路，与经岛心的路
  ['scrapyard', 'saltflats', 5], ['quarry', 'salvage', 5], ['windfarm', 'highway', 5],
  ['scrapyard', 'solarfield', 3], ['quarry', 'datatower', 3], ['saltflats', 'solarfield', 3], ['windfarm', 'solarfield', 3],
  ['salvage', 'datatower', 3], ['highway', 'datatower', 3], ['solarfield', 'datatower', 1],
].map((s) => Object.freeze(s));

export default Object.freeze({
  id: 'island-three-v1',
  size: Object.freeze([2400, 1900]),
  // 街区 ID 带 -city，免得和边疆地图的 east（东郊）重名；城的 ID 是 north / west / east
  districts: Object.freeze(['north-city', 'west-city', 'east-city', 'wilds']),
  cities: CITIES,
  places: Object.freeze(places),
  lots: Object.freeze(lots),
  streets: Object.freeze(streets),
  legacy: Object.freeze(places.filter((p) => !p.open && !p.landmark).map((p) => p.id)),
  terrain: Object.freeze({
    curtain: 20,
    // 海岸线：顺时针的闭合多边形；南岸中间有一处海湾，把西城与东城隔开
    island: Object.freeze([
      [760, 90], [1000, 60], [1200, 70], [1420, 60], [1660, 100], [1830, 220], [1900, 420], [1960, 700], [2120, 950], [2300, 1150],
      [2360, 1350], [2340, 1560], [2280, 1760], [2150, 1840], [1900, 1860], [1600, 1830], [1500, 1800], [1300, 1700], [1200, 1640],
      [1100, 1700], [900, 1810], [600, 1860], [300, 1840], [120, 1760], [60, 1560], [80, 1340], [220, 1150], [400, 1000], [560, 820],
      [640, 560], [700, 300],
    ].map((p) => Object.freeze(p))),
    coast: Object.freeze([]),
    river: Object.freeze([]),
    canal: Object.freeze([]),
    wall: null,
    tunnels: Object.freeze([]),
    districtLabels: Object.freeze({ 'north-city': Object.freeze([1200, 610]), 'west-city': Object.freeze([420, 1240]), 'east-city': Object.freeze([1980, 1230]), wilds: Object.freeze([1215, 1290]) }),
    wasteland: null,
  }),
});
