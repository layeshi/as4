import { h, ai } from './dom.js';

/** Read-only evidence: deliberately ignore any live values on an instance. */
export function renderPlaceEntities(data,lang='zh',agentName=id=>id) {
  if(!data)return null;
  const en=lang==='en', say=(zh,english)=>en?english:zh;
  const status={active:say('运行中','Active'),archived:say('已封存','Archived'),destroyed:say('随建筑拆毁而停止','Stopped: building destroyed')};
  return h('section',{class:'entity-evidence'},
    h('h3',null,say('实体与历史观测','Entities and recorded observations')),
    h('p',{class:'muted'},say(`承载位 ${data.occupied}/${data.capacity} · 当前可创建 ${data.available}`,`Slots ${data.occupied}/${data.capacity} · Available ${data.available}`)),
    h('p',{class:'muted'},say('以下数值来自居民已完成的观察，不代表此刻状态。','Values below are past measurements, not live state.')),
    data.items.length?h('p',{class:'muted'},say('每个实体展示最近4条观测。','Showing the latest four observations per entity.')):null,
    data.items.length?data.items.map(e=>h('article',{class:'entity-record'},
      h('h4',null,ai(e.name),` · ${status[e.status]||e.status}`),
      h('p',null,ai(e.definitionName||e.definition),` · ${e.id} · `,say('创建者：','Created by: '),ai(agentName(e.creator))),
      e.observations.length?h('ul',{class:'plain'},e.observations.map(o=>h('li',null,
        h('span',{class:'muted'},say(`第${o.day+1}日 · 刻${o.tick} · `,`Day ${o.day+1} · tick ${o.tick} · `)),ai(agentName(o.observer)),
        ' · ',Object.entries(o.values).map(([k,v])=>`${e.attributeLabels?.[k]||k}: ${v}`).join(' / ')))):h('p',{class:'muted'},say('尚无观测记录','No observations yet')),
      e.observationsDropped?h('p',{class:'muted'},say(`较早的 ${e.observationsDropped} 条记录已超出近期查询窗口。`,`${e.observationsDropped} older records are outside the recent query window.`)):null,
    )):h('p',{class:'muted'},say('尚未创建实体','No entities yet')),
    data.omitted?h('p',{class:'muted'},say(`另有 ${data.omitted} 个历史实体未展开。`,`${data.omitted} historical entities are not shown.`)):null,
  );
}
