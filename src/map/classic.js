// 经典地图（SPEC §6.4 地点表、附录 B 坐标）：12 处地点，任意两地之间移动的代价相同。
// 现有世界（快照里没有 map 字段）都用这张地图；它的一切物理与顺序都不能改——沙盘脑按这里的顺序抽取地点，
// 改动会让旧世界的回放不一致。
//
// 字段：kind / decay / walls 是物理（§6.4）；xy、glyph、terrain 只给观测站画图。
// 荒野的储量参数取自 P（wildsEnergyMax、wildsRegenPerDay、wildsCoins），遗物是全部 16 件。

export default Object.freeze({
  id: 'classic',
  size: [1000, 640],
  distance: false,
  places: Object.freeze([
    { id: 'port', kind: 'endow', decay: 60, walls: 6, xy: [80, 380], glyph: 'port' },
    { id: 'agora', kind: 'open', decay: 0, walls: 6, xy: [480, 330], glyph: 'agora' },
    { id: 'parliament', kind: 'cost', decay: 50, walls: 12, xy: [470, 140], glyph: 'parliament' },
    { id: 'market', kind: 'cost', decay: 60, walls: 6, xy: [690, 370], glyph: 'market' },
    { id: 'well', kind: 'well', decay: 100, walls: 6, xy: [500, 530], glyph: 'well' },
    { id: 'library', kind: 'cost', decay: 50, walls: 6, xy: [250, 170], glyph: 'library' },
    { id: 'school', kind: 'endow', decay: 50, walls: 6, xy: [230, 300], glyph: 'school' },
    { id: 'temple', kind: 'none', decay: 30, walls: 6, xy: [820, 140], glyph: 'temple' },
    { id: 'court', kind: 'none', decay: 40, walls: 6, xy: [640, 210], glyph: 'court' },
    { id: 'hospital', kind: 'none', decay: 40, walls: 6, xy: [300, 480], glyph: 'hospital' },
    { id: 'cemetery', kind: 'cost', decay: 30, walls: 6, xy: [730, 545], glyph: 'cemetery' },
    { id: 'wilds', kind: 'open', decay: 0, walls: 6, xy: [910, 420], glyph: 'edge', wild: true },
  ]),
  // 附录 B 的装饰性街道（不影响移动的代价）
  streets: Object.freeze([
    ['port', 'school'], ['port', 'hospital'], ['school', 'library'], ['school', 'agora'], ['library', 'parliament'], ['parliament', 'agora'],
    ['parliament', 'court'], ['court', 'temple'], ['court', 'agora'], ['agora', 'market'], ['agora', 'well'], ['market', 'wilds'],
    ['market', 'cemetery'], ['well', 'hospital'], ['well', 'cemetery'], ['temple', 'wilds'],
  ]),
  districts: Object.freeze([]),
  // 遗产表里「人类的空壳建筑」：被重新诠释 > 被维护 > 被使用 > 空置（§12.2）
  legacy: Object.freeze(['temple', 'court', 'hospital']),
  terrain: Object.freeze({
    curtain: 22,
    coast: [[48, 0], [52, 90], [44, 190], [50, 300], [58, 380], [50, 470], [44, 560], [50, 640]],
    river: null,
    canal: null,
    wall: null,
    wasteland: { x: 865 },
  }),
});
