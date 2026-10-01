// SPEC-E2 附录 B：第二纪的地图数据（frontier-e2）。
//
// 在边疆地图（SPEC-M1 附录 C）的基础上：地点、街道、地形、荒野五地带的储量与遗物都不变（这里是复制过来的静态数据，
// 两代各自独立）；增加的是 B.1 的地标 / 空地 / 初始模块 / 残料，以及 B.2 的 26 个空地块。
//
// 地点的字段：
//   id district xy glyph       位置与画法
//   decay walls                每日衰败（基点）与墙位
//   landmark                   'well' | 'port' | null：地标，不能拆
//   open                       空地：广场与荒野五地带，没有完好度、不能装模块
//   wild                       荒野地带的储量参数 { energyMax, regen, coins, relics }，其余为 null；荒野地带可以探索
//   modules                    人类建筑原有的模块（inherent，残料为 0）
//   salvage                    人类建筑的残料（拆尽即成遗址）
// streets：[a, b, 代价?]，代价缺省为 1。空地块 lots：{ id, district, xy, near }，near 是相邻的地点（站在那里才能发起开辟）。
// 地点的顺序按街区排列：它就是感知与公开数据里人类地点的顺序。

const P = (id, district, xy, glyph, decay, walls, extra = {}) => ({
  id, district, xy, glyph, decay, walls, landmark: null, open: false, wild: null, modules: [], salvage: 0, ...extra,
});

export default Object.freeze({
  id: 'frontier',
  size: [1800, 1000],
  districts: Object.freeze(['harbor', 'oldtown', 'commons', 'waterworks', 'east', 'wilds']),
  places: Object.freeze([
    // 港区
    P('port', 'harbor', [262, 585], 'port', 60, 6, { landmark: 'port' }),
    P('lighthouse', 'harbor', [178, 388], 'lighthouse', 30, 6, { salvage: 150 }),
    // 旧城
    P('school', 'oldtown', [405, 410], 'school', 50, 6, { modules: ['cradle'], salvage: 250 }),
    P('library', 'oldtown', [420, 160], 'library', 50, 6, { modules: ['archive'], salvage: 300 }),
    P('clocktower', 'oldtown', [560, 280], 'clocktower', 30, 6, { salvage: 200 }),
    P('parliament', 'oldtown', [690, 120], 'parliament', 50, 12, { salvage: 400 }),
    P('court', 'oldtown', [905, 235], 'court', 40, 6, { salvage: 250 }),
    // 市井
    P('agora', 'commons', [690, 470], 'agora', 0, 6, { open: true }),
    P('market', 'commons', [975, 560], 'market', 60, 6, { modules: ['board'], salvage: 250 }),
    P('theater', 'commons', [545, 640], 'theater', 40, 6, { salvage: 300 }),
    P('overpass', 'commons', [815, 610], 'overpass', 40, 6, { salvage: 200 }),
    P('tenements', 'commons', [905, 745], 'tenements', 40, 6, { salvage: 400 }),
    // 水脉
    P('well', 'waterworks', [715, 850], 'well', 100, 6, { landmark: 'well' }),
    P('hospital', 'waterworks', [420, 790], 'hospital', 40, 6, { salvage: 350 }),
    P('cemetery', 'waterworks', [1065, 885], 'cemetery', 30, 6, { modules: ['memorial'], salvage: 150 }),
    P('metro', 'waterworks', [565, 925], 'metro', 30, 6, { salvage: 250 }),
    // 东郊
    P('temple', 'east', [1085, 120], 'temple', 30, 6, { salvage: 300 }),
    P('workshop', 'east', [1075, 380], 'workshop', 50, 6, { salvage: 300 }),
    // 城外荒野：空地，可以探索
    P('wilds', 'wilds', [1310, 640], 'edge', 0, 6, { open: true, wild: { energyMax: 400, regen: 20, coins: 100, relics: [1, 2, 4, 7, 9, 17, 18] } }),
    P('scrapyard', 'wilds', [1470, 455], 'scrap', 0, 6, { open: true, wild: { energyMax: 250, regen: 10, coins: 250, relics: [3, 5, 12, 14, 19, 20, 21] } }),
    P('solarfield', 'wilds', [1455, 200], 'solar', 0, 6, { open: true, wild: { energyMax: 500, regen: 25, coins: 0, relics: [6, 11, 13, 22, 23] } }),
    P('saltflats', 'wilds', [1485, 860], 'salt', 0, 6, { open: true, wild: { energyMax: 150, regen: 5, coins: 50, relics: [8, 10, 15, 24, 25] } }),
    P('highway', 'wilds', [1680, 600], 'road', 0, 6, { open: true, wild: { energyMax: 200, regen: 10, coins: 100, relics: [16, 26, 27, 28] } }),
  ]),
  streets: Object.freeze([
    // 港区与旧城
    ['port', 'lighthouse'], ['port', 'school'], ['port', 'hospital'],
    ['school', 'library'], ['school', 'clocktower'], ['school', 'agora'], ['school', 'theater'],
    ['library', 'clocktower'], ['library', 'parliament'],
    ['clocktower', 'parliament'], ['clocktower', 'agora'],
    ['parliament', 'court'], ['parliament', 'agora'],
    ['court', 'temple'], ['court', 'agora'], ['court', 'workshop'],
    // 东郊与市井
    ['temple', 'workshop'], ['workshop', 'market'],
    ['agora', 'market'], ['agora', 'overpass'], ['agora', 'theater'], ['agora', 'well'],
    ['overpass', 'market'], ['overpass', 'tenements'],
    ['theater', 'hospital'], ['theater', 'well'],
    ['market', 'tenements'], ['market', 'cemetery'],
    // 水脉
    ['tenements', 'well'], ['tenements', 'cemetery'],
    ['well', 'hospital'], ['well', 'metro'], ['well', 'cemetery'],
    ['metro', 'hospital'], ['metro', 'cemetery'],
    // 城门与隧道
    ['market', 'wilds', 1], ['temple', 'solarfield', 2], ['metro', 'saltflats', 3],
    // 荒野
    ['wilds', 'scrapyard', 1], ['wilds', 'solarfield', 2], ['wilds', 'saltflats', 2],
    ['scrapyard', 'solarfield', 1], ['scrapyard', 'highway', 2], ['saltflats', 'highway', 2],
  ]),
  // 附录 B.2：空地块。wilds-* 在荒野里（在那里开辟的地点 is_wild 为真，但不可探索）
  lots: Object.freeze([
    { id: 'harbor-1', district: 'harbor', xy: [320, 480], near: ['port', 'school'] },
    { id: 'harbor-2', district: 'harbor', xy: [250, 700], near: ['port', 'hospital'] },
    { id: 'harbor-3', district: 'harbor', xy: [250, 260], near: ['lighthouse'] },
    { id: 'oldtown-1', district: 'oldtown', xy: [290, 140], near: ['library'] },
    { id: 'oldtown-2', district: 'oldtown', xy: [560, 150], near: ['library', 'clocktower', 'parliament'] },
    { id: 'oldtown-3', district: 'oldtown', xy: [740, 330], near: ['court', 'agora'] },
    { id: 'oldtown-4', district: 'oldtown', xy: [480, 330], near: ['school', 'clocktower'] },
    { id: 'commons-1', district: 'commons', xy: [620, 560], near: ['agora', 'theater'] },
    { id: 'commons-2', district: 'commons', xy: [700, 700], near: ['overpass', 'theater'] },
    { id: 'commons-3', district: 'commons', xy: [1060, 680], near: ['market', 'tenements'] },
    { id: 'commons-4', district: 'commons', xy: [890, 470], near: ['market', 'overpass'] },
    { id: 'waterworks-1', district: 'waterworks', xy: [290, 800], near: ['hospital'] },
    { id: 'waterworks-2', district: 'waterworks', xy: [890, 900], near: ['well', 'cemetery'] },
    { id: 'waterworks-3', district: 'waterworks', xy: [440, 950], near: ['metro', 'hospital'] },
    { id: 'east-1', district: 'east', xy: [1000, 230], near: ['court', 'temple', 'workshop'] },
    { id: 'east-2', district: 'east', xy: [1150, 270], near: ['temple', 'workshop'] },
    { id: 'east-3', district: 'east', xy: [1140, 500], near: ['workshop', 'market'] },
    { id: 'east-4', district: 'east', xy: [1130, 780], near: ['cemetery'] },
    { id: 'wilds-1', district: 'wilds', xy: [1300, 790], near: ['wilds'] },
    { id: 'wilds-2', district: 'wilds', xy: [1290, 480], near: ['wilds'] },
    { id: 'wilds-3', district: 'wilds', xy: [1590, 370], near: ['scrapyard'] },
    { id: 'wilds-4', district: 'wilds', xy: [1320, 160], near: ['solarfield'] },
    { id: 'wilds-5', district: 'wilds', xy: [1610, 150], near: ['solarfield'] },
    { id: 'wilds-6', district: 'wilds', xy: [1630, 910], near: ['saltflats'] },
    { id: 'wilds-7', district: 'wilds', xy: [1720, 770], near: ['highway'] },
    { id: 'wilds-8', district: 'wilds', xy: [1730, 440], near: ['highway', 'scrapyard'] },
  ]),
  // 人类的建筑（遗产表里「每一座，地标除外」）
  legacy: Object.freeze(['lighthouse', 'school', 'library', 'clocktower', 'parliament', 'court', 'market', 'theater', 'overpass', 'tenements', 'hospital', 'cemetery', 'metro', 'temple', 'workshop']),
  terrain: Object.freeze({
    curtain: 30,
    coast: [[150, 0], [162, 90], [138, 180], [150, 270], [196, 330], [226, 372], [214, 420], [178, 462], [160, 510], [204, 556],
      [212, 612], [176, 670], [150, 750], [168, 840], [142, 930], [152, 1000]],
    river: [[790, 0], [778, 90], [800, 190], [822, 300], [812, 420], [826, 520], [812, 610], [786, 720], [735, 820]],
    canal: [[695, 862], [600, 872], [480, 868], [360, 858], [250, 870], [150, 866]],
    wall: { x: 1185, gates: [[118, 168], [588, 632]] },
    tunnels: [['metro', 'saltflats']],
    // 街区名的位置（缺省放在街区左上方）
    districtLabels: { commons: [590, 548], waterworks: [196, 712] },
    wasteland: { x: 1185 },
  }),
});
