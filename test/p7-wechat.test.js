// 第七前提「三城」的微信端城市页：全岛有「全岛 / 北城 / 西城 / 东城」切换与城牌，切到一座城后取景、统计与事件只看那座城。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld } from '../src/e2/world.js';
import { publicState } from '../src/e2/engine/visibility.js';
import { publicMap } from '../src/e2/map/index.js';
import { minigame } from './wechat-minigame-helpers.js';

const hiddenPhysics = JSON.parse(readFileSync(new URL('./fixtures/p7-hidden-physics.json', import.meta.url), 'utf8'));

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
