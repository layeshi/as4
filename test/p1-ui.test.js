import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import e2 from '../src/e2/facade.js';
import { renderCradle, renderLaws2 } from '../public/e2-tabs.js';
import { renderWeather } from '../public/tabs2.js';
import { setLang, describeEvent } from '../public/i18n.js';

test('P1 acceptance 3: sixteen bodies, six voting choices, premise physics and backstage event text', () => {
  const dom=installFakeDom();
  try {
    const w=e2.createWorld({seed:'ui-p1',premise:1,shellSlots:16});
    const state=e2.publicState(w);
    for(const lang of ['zh','en']) {
      setLang(lang);const lore=e2.publicLore(lang);const ctx={S:{state,events:[]},lore,agentName:(id)=>id,placeName:(id)=>id,groupName:(id)=>id,openAgent(){},openPlace(){}};
      const cradle=document.createElement('div');dom.root.append(cradle);renderCradle(ctx,cradle);
      assert.equal(cradle.querySelectorAll('table.p1-bodies tr').length,17);assert.ok(cradle.textContent.includes('b16'));assert.ok(!cradle.textContent.includes('model'));
      const weather=document.createElement('div');dom.root.append(weather);renderWeather(ctx,weather);assert.equal(weather.querySelectorAll('button').length,6);
      const laws=document.createElement('div');dom.root.append(laws);renderLaws2(ctx,laws);assert.ok(laws.textContent.includes(lore.physicsP1.natural.items[3]));
      const event=describeEvent({type:'backstage',data:{kind:'code'}});assert.equal(event.template,lang==='zh'?'幕后有东西变了：这座城运转的方式，可能与昨天不同。':'Something changed backstage: the way this city works may not be the same as yesterday.');
    }
  } finally {setLang('zh');dom.restore();}
});
