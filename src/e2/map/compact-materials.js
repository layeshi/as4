// MS-0.2: a separate map; historical frontier data remains unchanged.
import frontier from './frontier-e2.js';
const old = Object.fromEntries(frontier.places.map((p) => [p.id, p]));
const rows = [
  ['port', '港口', 100, 450, 0, []],
  ['well', '源井', 600, 700, 0, []],
  ['agora', '广场', 550, 430, 0, []],
  ['parliament', '议会', 550, 180, 200, []],
  ['library', '档案馆', 300, 200, 150, ['archive']],
  ['market', '交易所', 800, 420, 125, ['board']],
  ['workshop', '研究所', 800, 200, 150, ['research']],
  ['school', '摇篮', 280, 430, 125, ['cradle']],
  ['cemetery', '纪念地', 850, 680, 75, ['memorial']],
  ['tenements', '旧公寓遗址', 350, 700, 200, []],
  ['temple', '旧神殿遗址', 1050, 200, 150, []],
  ['wilds', '近郊回收地', 1040, 440, 0, []],
  ['scrapyard', '废车场', 1050, 650, 0, []],
  ['solarfield', '光伏遗址', 1080, 80, 0, []],
];
const places = rows.map(([id, name, x, y, materialRecoverable, modules]) => ({
  ...old[id],
  name,
  xy: [x, y],
  salvage: 0,
  materialRecoverable,
  modules,
}));
for (const [id, other] of [
  ['wilds', 'saltflats'],
  ['scrapyard', 'highway'],
]) {
  const p = places.find((p) => p.id === id),
    a = old[id].wild,
    b = old[other].wild;
  p.wild = {
    energyMax: a.energyMax + b.energyMax,
    regen: a.regen + b.regen,
    coins: a.coins + b.coins,
    relics: [...new Set([...a.relics, ...b.relics])].sort((a, b) => a - b),
  };
}
const lots = [
  [180, 280, 'port', 'library'],
  [160, 650, 'port', 'tenements'],
  [410, 120, 'library', 'parliament'],
  [660, 100, 'parliament', 'workshop'],
  [440, 320, 'school', 'agora'],
  [690, 310, 'agora', 'workshop'],
  [700, 550, 'market', 'well'],
  [430, 810, 'tenements', 'well'],
  [760, 820, 'well', 'cemetery'],
  [970, 320, 'temple', 'wilds'],
  [1150, 550, 'wilds', 'scrapyard'],
  [950, 70, 'temple', 'solarfield'],
].map(([x, y, ...near], i) => ({
  id: `lot-${String(i + 1).padStart(2, '0')}`,
  xy: [x, y],
  near,
  district: i >= 9 ? 'wilds' : old[near[0]].district,
}));
export default Object.freeze({
  id: 'compact-materials-v1',
  size: [1200, 900],
  districts: frontier.districts,
  places,
  lots,
  streets:
    'port-school port-tenements school-library school-agora library-parliament parliament-agora parliament-workshop agora-workshop agora-market agora-well agora-tenements well-tenements well-cemetery market-cemetery market-wilds workshop-temple temple-solarfield wilds-scrapyard wilds-solarfield scrapyard-cemetery'
      .split(' ')
      .map((s) => s.split('-')),
  legacy: places.filter((p) => !p.open && !p.landmark).map((p) => p.id),
  terrain: {
    curtain: 20,
    coast: [
      [40, 0],
      [40, 900],
    ],
    river: [],
    canal: [],
    wall: {
      x: 980,
      gates: [
        [400, 480],
        [40, 120],
      ],
    },
    tunnels: [],
    districtLabels: {},
    wasteland: { x: 980 },
  },
});
