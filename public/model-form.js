// 居民（与公共角色）的模型配置表单：平台托管 DeepSeek，或自己的模型接口。
import { h } from './dom.js';
import { btn, field, form, say } from './console-ui.js';
import { table } from './console-ui.js';
import { microYuan, catalogPriceLabels as priceLabels } from './hosted-ui.js';
import { estimateHosted } from './hosted-estimate.js';

/**
 * previous：已保存的配置；save(config, dailyCap)；testConnection(config) 不给就没有「测试连接」；
 * hosted：账号的托管信息（GET /api/account/hosted），null 表示不提供托管选项（公共角色）。
 * withCap：同时填每日游戏词元上限（只有接受过继时需要）。
 */
export function modelForm(previous,save,label='保存模型配置',testConnection,hosted=null,{withCap=false,dailyCap=880000}={}){
  const p=previous??{},isHosted=()=>mode?.value==='hosted';
  const mode=hosted===null?null:h('select',{name:'modelSource'},h('option',{value:'hosted',disabled:!hosted.available},'平台托管 OpenLux（从我的余额扣费）'),h('option',{value:'own'},'我自己的模型'));
  if(mode)mode.value=p.hosted?'hosted':'own';
  const own=h('div',{class:'model-own'},h('label',{class:'field'},h('span',null,'模型接口'),h('select',{name:'provider'},[['openai','OpenAI兼容'],['openai-responses','Responses'],['anthropic','Anthropic'],['mock','模拟模型']].map(([v,l])=>h('option',{value:v,selected:(p.provider??'openai')===v},l)))),field('接口地址','baseURL',p.baseURL??''),field('模型名称','model',p.model??''),field(p.hasApiKey?'供应商 API Key（留空保留）':'供应商 API Key','apiKey','','password',{autocomplete:'off'}));
  const models = hosted?.models ?? (hosted?.model ? [{ id: hosted.model, available: hosted.available, pricesMicro: hosted.pricesMicro }] : []);
  const selection = h('select', { name: 'hostedModel' }, models.map(m => h('option', { value: m.id, disabled: !m.available }, `${m.id}${m.available ? ` · 输入 ¥${microYuan(m.pricesMicro.miss,6)} / 输出 ¥${microYuan(m.pricesMicro.output,6)}（元/百万 token 起）` : ' · 暂不可用'}`)));
  selection.value = models.some(m => m.id === p.model) ? p.model : (models.find(m => m.available)?.id ?? '');
  const priceView = h('div', { class: 'hosted-price-view', 'aria-live': 'polite' });
  const hostedLabel=h('div',{class:'hosted-label'},h('label',{class:'field'},h('span',null,'平台托管模型'),selection),priceView);
  const config=b=>isHosted()?{hosted:true,...(hosted?.version === 2 ? {model:selection.value} : {})}:{provider:b.provider,baseURL:b.baseURL,model:b.model,apiKey:b.apiKey,toolMode:'native',actionTools:'typed'};
  const f=form([mode?h('label',{class:'field'},h('span',null,'模型来源'),mode):null,hosted&&!hosted.available?h('p',{class:'muted'},hosted.error??'平台托管暂未开放，可改用自己的模型。'):null,hostedLabel,own,withCap?field('每日游戏词元上限','dailyCap',dailyCap,'number',{min:0,max:50000000}):null],label,b=>save(config(b),withCap?Number(b.dailyCap):undefined));
  const test=testConnection?btn('测试连接（会调用模型）',async()=>{if(isHosted())return;await testConnection(config(Object.fromEntries(new FormData(f))));say('模型连接测试成功。');}):null;
  if(test)f.querySelector('.form-actions').append(test);
  function update(){own.hidden=!!isHosted();hostedLabel.hidden=!isHosted();if(test)test.hidden=!!isHosted();for(const input of own.querySelectorAll('input,select'))input.disabled=!!isHosted();}
  function prices(){
    priceView.replaceChildren();
    const model = models.find(m => m.id === selection.value);
    if (!model?.available) { priceView.append(h('p',{class:'muted'},'该模型尚未开放，请选择其他模型。')); return; }
    const tiers = model.tiers ?? [{upTo:null, pricesMicro:model.pricesMicro}];
    priceView.append(table(['输入长度档位',...priceLabels.map(([,label])=>label)],tiers.map(t=>[t.upTo?`≤ ${t.upTo.toLocaleString()} token`:'全部',...priceLabels.map(([k])=>t.pricesMicro[k]==null?'不适用':`¥${microYuan(t.pricesMicro[k],6)}`)])),h('p',{class:'muted'},'单位：元 / 百万 token，已含汇率与平台倍率。阶梯按整次调用输入长度选档。'));
    const cap = Number(f.querySelector('[name="dailyCap"]')?.value ?? dailyCap), e = estimateHosted(model,cap);
    if (!e) { priceView.append(h('p',{class:'muted'},'请输入有效的每日游戏词元上限以查看估算。')); return; }
    priceView.append(h('p',{class:'hosted-estimate'},`按每日额度 ${cap.toLocaleString()} 用满估算：每日 ¥${microYuan(e.daily[0])}–¥${microYuan(e.daily[1])}；每月（30天）¥${microYuan(e.monthly[0])}–¥${microYuan(e.monthly[1])}`),h('details',{class:'estimate-assumptions'},h('summary',null,`${e.basis} · 查看计算假设`),h('p',{class:'muted'},e.assumptions)),h('p',{class:'muted'},'实际费用随活跃度、上下文和缓存变化，可能低于或超过区间；此估算不是扣费上限。缺少上游用量时按全额预留扣费。'));
  }
  selection.addEventListener('change',prices);
  f.querySelector('[name="dailyCap"]')?.addEventListener('input',prices);
  mode?.addEventListener('change',update);update();prices();return f;
}
