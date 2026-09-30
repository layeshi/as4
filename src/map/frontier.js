// 边疆地图（附录 C）：城区 19 处 + 城外荒野 5 个地带，移动按街道图上的路程计价。
// 新世界默认使用它（MAP=frontier）；已有的世界不受影响。
//
// 原 12 处地点的物理（kind / decay / walls）与经典地图相同；新增的城区地点都是 none 类型——
// 有完好度、有墙，没有额外机制。荒野各地带是 open 类型（没有完好度），wild 字段给出它的储量、
// 每日再生与遗物（按编号，见 src/lore/relics.js）。
//
// streets：[a, b, 代价?]，代价缺省为 1。街道是移动的图；正常运转的道路设施另外加一条代价为 0 的边。
// 地点的顺序按街区排列：它就是感知里地点列表的顺序。

export default Object.freeze({
  id: 'frontier',
  size: [1800, 1000],
  distance: true,
  districts: Object.freeze(['harbor', 'oldtown', 'commons', 'waterworks', 'east', 'wilds']),
  places: Object.freeze([
    // 港区
    { id: 'port', kind: 'endow', decay: 60, walls: 6, district: 'harbor', xy: [262, 585], glyph: 'port' },
    { id: 'lighthouse', kind: 'none', decay: 30, walls: 6, district: 'harbor', xy: [178, 388], glyph: 'lighthouse' },
    // 旧城
    { id: 'school', kind: 'endow', decay: 50, walls: 6, district: 'oldtown', xy: [405, 410], glyph: 'school' },
    { id: 'library', kind: 'cost', decay: 50, walls: 6, district: 'oldtown', xy: [420, 160], glyph: 'library' },
    { id: 'clocktower', kind: 'none', decay: 30, walls: 6, district: 'oldtown', xy: [560, 280], glyph: 'clocktower' },
    { id: 'parliament', kind: 'cost', decay: 50, walls: 12, district: 'oldtown', xy: [690, 120], glyph: 'parliament' },
    { id: 'court', kind: 'none', decay: 40, walls: 6, district: 'oldtown', xy: [905, 235], glyph: 'court' },
    // 市井
    { id: 'agora', kind: 'open', decay: 0, walls: 6, district: 'commons', xy: [690, 470], glyph: 'agora' },
    { id: 'market', kind: 'cost', decay: 60, walls: 6, district: 'commons', xy: [975, 560], glyph: 'market' },
    { id: 'theater', kind: 'none', decay: 40, walls: 6, district: 'commons', xy: [545, 640], glyph: 'theater' },
    { id: 'overpass', kind: 'none', decay: 40, walls: 6, district: 'commons', xy: [815, 610], glyph: 'overpass' },
    { id: 'tenements', kind: 'none', decay: 40, walls: 6, district: 'commons', xy: [905, 745], glyph: 'tenements' },
    // 水脉
    { id: 'well', kind: 'well', decay: 100, walls: 6, district: 'waterworks', xy: [715, 850], glyph: 'well' },
    { id: 'hospital', kind: 'none', decay: 40, walls: 6, district: 'waterworks', xy: [420, 790], glyph: 'hospital' },
    { id: 'cemetery', kind: 'cost', decay: 30, walls: 6, district: 'waterworks', xy: [1065, 885], glyph: 'cemetery' },
    { id: 'metro', kind: 'none', decay: 30, walls: 6, district: 'waterworks', xy: [565, 925], glyph: 'metro' },
    // 东郊
    { id: 'temple', kind: 'none', decay: 30, walls: 6, district: 'east', xy: [1085, 120], glyph: 'temple' },
    { id: 'workshop', kind: 'none', decay: 50, walls: 6, district: 'east', xy: [1075, 380], glyph: 'workshop' },
    // 城外荒野
    { id: 'wilds', kind: 'open', decay: 0, walls: 6, district: 'wilds', xy: [1310, 640], glyph: 'edge',
      wild: { energyMax: 400, regen: 20, coins: 100, relics: [1, 2, 4, 7, 9, 17, 18] } },
    { id: 'scrapyard', kind: 'open', decay: 0, walls: 6, district: 'wilds', xy: [1470, 455], glyph: 'scrap',
      wild: { energyMax: 250, regen: 10, coins: 250, relics: [3, 5, 12, 14, 19, 20, 21] } },
    { id: 'solarfield', kind: 'open', decay: 0, walls: 6, district: 'wilds', xy: [1455, 200], glyph: 'solar',
      wild: { energyMax: 500, regen: 25, coins: 0, relics: [6, 11, 13, 22, 23] } },
    { id: 'saltflats', kind: 'open', decay: 0, walls: 6, district: 'wilds', xy: [1485, 860], glyph: 'salt',
      wild: { energyMax: 150, regen: 5, coins: 50, relics: [8, 10, 15, 24, 25] } },
    { id: 'highway', kind: 'open', decay: 0, walls: 6, district: 'wilds', xy: [1680, 600], glyph: 'road',
      wild: { energyMax: 200, regen: 10, coins: 100, relics: [16, 26, 27, 28] } },
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
  legacy: Object.freeze(['temple', 'court', 'hospital', 'lighthouse', 'clocktower', 'theater', 'overpass', 'tenements', 'metro', 'workshop']),
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
