// 第七前提「三城」的微信端城市页：全岛有「全岛 / 北城 / 西城 / 东城」切换与城牌，切到一座城后取景、统计与事件只看那座城。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld } from '../src/e2/world.js';
import { publicState } from '../src/e2/engine/visibility.js';
import { publicMap } from '../src/e2/map/index.js';
import { minigame } from './wechat-minigame-helpers.js';

const hiddenPhysics = JSON.parse(readFileSync(new URL('./fixtures/p7-hidden-physics.json', import.meta.url), 'utf8'));

async function cityGame(focus = 'north', premise = 7) {
  const physics = premise === 7 ? hiddenPhysics : { ...hiddenPhysics, regrowth: { baseByZone: { wilds: 20, scrapyard: 15, solarfield: 10 }, thresholdByZone: { wilds: 30, scrapyard: 25, solarfield: 15 }, factorPermille: 500 } };
  const w = createWorld({ id: 'p7gesture', seed: 'p7gesture', premise, hiddenPhysics: physics });
  const { game: g } = minigame();
  g.entered = true; g.tab = 'city'; g.state = JSON.parse(JSON.stringify(publicState(w)));
  g.map = JSON.parse(JSON.stringify(publicMap(w))); g.wechatVerified = true; g.prefs.autoRefresh = false;
  if (premise === 7) await g.dispatch({ type: 'cityFocus', city: focus });
  g.invalidate(); g.render();
  return g;
}
const point = (area, x, y) => ({ clientX: area.x + x, clientY: area.y + y });
const touches = (...points) => ({ touches: points });

test('P7 城级双指缩放以指间中心为锚，拖动不滚页面，切城恢复取景', async () => {
  const g = await cityGame(), area = g.cityMapArea;
  assert.ok(area, '地图需要暴露可见触摸区域');
  const before = { ...g.cityMap.viewport }, offset = g.scroller().offset;
  const x = area.w / 2, y = area.h / 2;
  g.touchStart(touches(point(area, x - 30, y), point(area, x + 30, y)));
  g.touchMove(touches(point(area, x - 60, y), point(area, x + 60, y)));
  assert.equal(g.cityMap.view.zoom, 2);
  const zoomed = { ...g.cityMap.viewport };
  assert.ok(Math.abs((x - before.ox) / before.s - (x - zoomed.ox) / zoomed.s) < 1e-8);
  assert.ok(Math.abs((y - before.oy) / before.s - (y - zoomed.oy) / zoomed.s) < 1e-8);
  g.touchEnd(touches());
  g.touchStart(touches(point(area, x, y)));
  g.touchMove(touches(point(area, x + 20, y + 18)));
  assert.ok(g.cityMap.viewport.ox > zoomed.ox);
  assert.ok(g.cityMap.viewport.oy > zoomed.oy);
  g.touchEnd(touches());
  assert.equal(g.scroller().offset, offset);
  assert.equal(g.sheet, null, '手势结束不能误点地点');
  await g.dispatch({ type: 'cityFocus', city: 'west' });
  assert.equal(g.cityMap.view.zoom, 1);
  assert.equal(g.cityMap.view.x, 0);
  assert.ok(g.cityMap.hits.every(h => h.action.type !== 'sheet' || g.state.places.find(p => p.id === h.action.id).city === 'west'));
});

test('P7 手势限制倍率与边界，双指转单指不中断，取消后地点仍可点', async () => {
  const g = await cityGame(), area = g.cityMapArea, x = area.w / 2, y = area.h / 2;
  g.touchStart(touches(point(area, x - 10, y), point(area, x + 10, y)));
  g.touchMove(touches(point(area, x - 200, y), point(area, x + 200, y)));
  assert.equal(g.cityMap.view.zoom, 4);
  const before = { ...g.cityMap.viewport };
  g.touchEnd(touches(point(area, x, y)));
  g.touchMove(touches(point(area, x + 12, y + 12)));
  assert.ok(g.cityMap.viewport.ox > before.ox);
  g.touchMove(touches(point(area, x + 10000, y + 10000)));
  assert.ok(Math.abs(g.cityMap.view.x) < 1000 && Math.abs(g.cityMap.view.y) < 1000, '拖动应留在城的取景边界内');
  assert.ok(g.cityMap.hits.every(h => h.x >= 0 && h.y >= 0 && h.x + h.w <= area.w && h.y + h.h <= area.h));
  g.touchCancel();
  assert.equal(g.touch, null); assert.equal(g.pressed, null);
  assert.equal(g.scroller().dragging, false);
  await g.dispatch({ type: 'cityFocus', city: 'north' });
  const hit = g.cityMap.hits.find(h => h.action.type === 'sheet');
  assert.ok(hit);
  const a = g.cityMapArea, p = point(a, hit.x + hit.w / 2, hit.y + hit.h / 2);
  g.touchStart(touches(p)); g.touchEnd(touches());
  assert.equal(g.sheet?.kind, 'place');
  g.sheet = null;
  g.touchStart(touches(point(a, x - 60, y), point(a, x + 60, y)));
  g.touchMove(touches(point(a, x - 1, y), point(a, x + 1, y)));
  assert.equal(g.cityMap.view.zoom, 1);
  g.touchEnd(touches()); assert.equal(g.sheet, null);
});

test('全岛与 P6 不接管地图手势；地图外、弹窗中仍走页面触摸', async () => {
  for (const [premise, focus] of [[7, null], [6, null]]) {
    const g = await cityGame(focus, premise), area = g.cityMapArea;
    const p = point(area, area.w / 2, area.h / 2);
    g.touchStart(touches(p)); g.touchMove(touches({ ...p, clientY: p.clientY - 30 })); g.touchEnd(touches());
    assert.equal(g.cityMap.view.zoom, 1);
    assert.ok(g.scroller().offset > 0, '固定地图上的拖动仍滚动页面');
  }
  const g = await cityGame(), area = g.cityMapArea;
  g.touchStart(touches({ clientX: 8, clientY: area.y + 20 }));
  assert.ok(!g.touch.map); g.touchCancel();
  g.sheet = { kind: 'place', id: 'north-port' }; g.render();
  g.touchStart(touches(point(area, area.w / 2, area.h / 2)));
  assert.ok(!g.touch.map); g.touchCancel();
});

test('微信端城市页（第七前提）：全岛与单城都能画出来，切换城不报错', async () => {
  const w = createWorld({ id: 'p7wx', seed: 'p7wx', premise: 7, hiddenPhysics });
  const state = JSON.parse(JSON.stringify(publicState(w)));
  const map = JSON.parse(JSON.stringify(publicMap(w)));
  assert.equal(state.cities.length, 3);
  const c = minigame({ respond: () => structuredClone(state) });
  const g = c.game;
  g.entered = true; g.tab = 'city'; g.state = state; g.map = map; g.wechatVerified = true; g.prefs.autoRefresh = false;
  g.events = [{ seq: 1, tick: 3, day: 0, type: 'move', vis: 'public', place: 'east-port', city: 'east', data: { from: 'north-port', to: 'east-port' } }];
  g.invalidate(); g.render();
  assert.equal(g.cityFocus, null);
  const island = g.cityMap.hits.filter((h) => h.action && h.action.type === 'cityFocus').map((h) => h.action.city);
  assert.deepEqual([...island].sort(), ['east', 'north', 'west']); // 小游戏跑在另一个 VM 里，先转成本地数组再比
  await g.dispatch({ type: 'cityFocus', city: 'west' });
  assert.equal(g.cityFocus, 'west');
  g.invalidate(); g.render();
  assert.equal(g.cityMap.hits.filter((h) => h.action && h.action.type === 'cityFocus').length, 0);
  await g.dispatch({ type: 'cityFocus', city: null });
  assert.equal(g.cityFocus, null);
});
