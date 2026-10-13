// 居民（与公共角色）的模型配置表单：平台托管 DeepSeek，或自己的模型接口。
import { h } from './dom.js';
import { btn, field, form, say } from './console-ui.js';

/**
 * previous：已保存的配置；save(config, dailyCap)；testConnection(config) 不给就没有「测试连接」；
 * hosted：账号的托管信息（GET /api/account/hosted），null 表示不提供托管选项（公共角色）。
 * withCap：同时填每日游戏词元上限（只有接受过继时需要）。
 */
export function modelForm(previous,save,label='保存模型配置',testConnection,hosted=null,{withCap=false}={}){
  const p=previous??{},isHosted=()=>mode?.value==='hosted';
  const mode=hosted===null?null:h('select',{name:'modelSource'},h('option',{value:'hosted',disabled:!hosted.available},'平台托管 DeepSeek（从我的余额扣费）'),h('option',{value:'own'},'我自己的模型'));
  if(mode)mode.value=p.hosted?'hosted':'own';
  const own=h('div',{class:'model-own'},h('label',{class:'field'},h('span',null,'模型接口'),h('select',{name:'provider'},[['openai','OpenAI兼容'],['openai-responses','Responses'],['anthropic','Anthropic'],['mock','模拟模型']].map(([v,l])=>h('option',{value:v,selected:(p.provider??'openai')===v},l)))),field('接口地址','baseURL',p.baseURL??''),field('模型名称','model',p.model??''),field(p.hasApiKey?'供应商 API Key（留空保留）':'供应商 API Key','apiKey','','password',{autocomplete:'off'}));
  const hostedLabel=h('p',{class:'hosted-label'},`平台托管 · ${hosted?.model||p.model||'DeepSeek'}`);
  const config=b=>isHosted()?{hosted:true}:{provider:b.provider,baseURL:b.baseURL,model:b.model,apiKey:b.apiKey,toolMode:'native',actionTools:'typed'};
  const f=form([mode?h('label',{class:'field'},h('span',null,'模型来源'),mode):null,hosted&&!hosted.available?h('p',{class:'muted'},hosted.error??'平台托管暂未开放，可改用自己的模型。'):null,hostedLabel,own,withCap?field('每日游戏词元上限','dailyCap',880000,'number',{min:0,max:50000000}):null],label,b=>save(config(b),withCap?Number(b.dailyCap):undefined));
  const test=testConnection?btn('测试连接（会调用模型）',async()=>{if(isHosted())return;await testConnection(config(Object.fromEntries(new FormData(f))));say('模型连接测试成功。');}):null;
  if(test)f.querySelector('.form-actions').append(test);
  function update(){own.hidden=!!isHosted();hostedLabel.hidden=!isHosted();if(test)test.hidden=!!isHosted();for(const input of own.querySelectorAll('input,select'))input.disabled=!!isHosted();}
  mode?.addEventListener('change',update);update();return f;
}
