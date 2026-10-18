import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
test('entity panel shows dated evidence, empty state and safe resident content, never live values',async()=>{
 const {renderPlaceEntities}=await import('../public/entity-ui.js');
 const dom=installFakeDom();
 try {
  const data={capacity:2,occupied:1,available:1,total:1,omitted:0,items:[{id:'en1',name:'<script>小圃</script>',definition:'ed1',definitionName:'盐滩植物',creator:'a1',status:'active',values:{secret:987654},observationsDropped:2,observations:[{id:'eo1',observer:'a2',tick:12,day:1,values:{water:55}}]}]};
  const panel=renderPlaceEntities(data,'zh',id=>id==='a2'?'同行':id);dom.root.append(panel);
  assert.match(panel.textContent,/盐滩植物/);assert.match(panel.textContent,/55/);assert.match(panel.textContent,/历史观测/);assert.match(panel.textContent,/同行/);
  assert.doesNotMatch(panel.textContent,/987654|secret/);assert.equal(panel.querySelector('script'),null);assert.equal(panel.querySelector('input'),null);assert.equal(panel.querySelector('button'),null);
  assert.match(renderPlaceEntities({...data,items:[]},'en').textContent,/No entities/);
 }finally{dom.restore();}
});
