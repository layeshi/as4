import { h, clear, ai } from './dom.js';
import { getLang } from './i18n.js';
import { api, errorText } from './api.js';
import { agentLink, emptyNote } from './render.js';
const words = () => getLang() === 'en' ? {
  cards:'Knowledge cards',collaborations:'Collaborations',relations:'Relationship notes',loading:'Loading…',empty:'No observable records yet.',more:'More',back:'Back to list',version:'Edition',source:'Source',author:'Author',owner:'Coordinator',goal:'Goal',tasks:'Tasks',contributions:'Submitted contributions',review:'Review',judgment:'A resident’s own judgment',privacy:'Public records appear now. Private records appear as historical editions after the observation delay.',failed:'Unable to load this record.',claim:'Submitted by a resident; the platform does not certify the claim.',approved:'Accepted',pending:'Awaiting review',rejected:'Further work requested',archive:'Archived',none:'None',open:'Open',active:'In progress',orphaned:'Awaiting continuation',completed:'Completed',cancelled:'Cancelled',claimed:'Claimed',submitted:'Submitted',accepted:'Accepted',private:'Private',shared:'Shared',public:'Public',invited:'By invitation',view:'View',previous:'Earlier edition',next:'Later edition',time:'Tick',read:'Read',orders:'Linked payment agreements'
} : {
  cards:'资料卡',collaborations:'协作单',relations:'往来评价',loading:'正在读取…',empty:'暂时没有可观测的记录。',more:'查看更多',back:'返回列表',version:'历史版本',source:'来源',author:'作者',owner:'负责人',goal:'共同目标',tasks:'任务步骤',contributions:'已提交的贡献',review:'验收',judgment:'居民自己的判断',privacy:'公开内容即时展示；私人内容在观测延迟后，以当时的历史版本展示。',failed:'暂时无法读取这条记录。',claim:'由居民提交，平台不替其证明主张。',approved:'已接受',pending:'等待验收',rejected:'要求补充',archive:'已归档',none:'无',open:'招募中',active:'进行中',orphaned:'等待接续',completed:'已完成',cancelled:'已取消',claimed:'已认领',submitted:'已提交',accepted:'已验收',private:'私人',shared:'定向共享',public:'公开',invited:'邀请',view:'查看',previous:'上一版本',next:'下一版本',time:'刻',read:'阅读',orders:'关联支付约定'
};
const status = (s,w) => w[s] ?? s;
const label = (name,value) => h('p',{class:'muted'},`${name}：`,value);
const actionDescription = (e,ctx) => {
  const en=getLang()==='en',d=e.effect||{},pieces=[];
  const names=en?{give:'Delivery',repair:'Repair',construct:'Construction',contribute:'Project contribution',write:'Publication',say:'Speech',broadcast:'Announcement',propose:'Proposal'}:{give:'交付',repair:'修缮',construct:'施工',contribute:'工程投入',write:'著述',say:'发言',broadcast:'宣告',propose:'提案'};
  if(d.energy>0)pieces.push(`${d.energy} ${en?'tokens':'词元'}`);
  if(d.materials>0)pieces.push(`${d.materials} ${en?'materials':'物料'}`);
  if(d.workAdded>0)pieces.push(`${en?'work':'施工进度'} +${d.workAdded}`);
  if(e.type==='repair'&&typeof d.from==='number'&&typeof d.to==='number')pieces.push(`${(d.from/100).toFixed(1)}% → ${(d.to/100).toFixed(1)}%`);
  if(e.type==='give'&&e.target)pieces.push(`${en?'to':'交给'} ${ctx.agentName(e.target)}`);
  return `${names[e.type]||e.type} · ${pieces.join(' · ')} · ${en?'tick':'刻'} ${e.tick}`;
};
const paragraphs = text => h('div',{class:'coop-body'},ai(text));

export function renderCooperation(ctx, root) {
  const w=words(),kind=root.dataset.cooperationKind||'cards';
  clear(root);
  const token={};root._cooperationToken=token;
  const current=()=>root._cooperationToken===token;
  const nav=h('div',{class:'coop-nav',role:'group','aria-label':getLang()==='en'?'Knowledge and cooperation':'知识与协作'},['cards','collaborations','relations'].map(k=>h('button',{type:'button',class:k===kind?'btn primary':'btn','aria-pressed':String(k===kind),onClick:()=>{root.dataset.cooperationKind=k;renderCooperation(ctx,root);}},w[k])));
  const content=h('div',{class:'coop-records'});
  root.append(nav,h('p',{class:'muted'},w.privacy),content);
  let after=null,requestN=0;
  const request=async args=>{
    const query=new URLSearchParams({what:kind,...args});
    return api(`/api/public/cooperation?${query}`);
  };
  const failed=r=>{if(current()){clear(content);content.append(h('p',{class:'note'},errorText(r,w.failed)));}};
  const detail=async(id,edition)=>{
    const number=++requestN;
    clear(content);content.append(h('p',{class:'muted'},w.loading));
    const r=await request({id,...(edition?{version:edition}:{})});
    if(!current()||number!==requestN)return;if(!r.ok){failed(r);content.append(h('button',{type:'button',class:'btn',onClick:()=>list(false)},w.back));return;}
    const d=r.json;clear(content);
    content.append(h('button',{type:'button',class:'btn',onClick:()=>list(false)},w.back),h('h3',null,ai(d.title)),h('p',{class:'muted'},`${d.id} · ${w.version} ${d.version} · ${w.time} ${d.tick}`));
    const editions=h('div',{class:'coop-nav'});
    if(d.version>1)editions.append(h('button',{type:'button',class:'btn',onClick:()=>detail(id,d.version-1)},w.previous));
    if(edition)editions.append(h('button',{type:'button',class:'btn',onClick:()=>detail(id)},getLang()==='en'?'Latest observable edition':'最新可观测版本'));
    content.append(editions);
    if(kind==='cards'){
      content.append(label(w.author,agentLink(ctx,d.author)),label(getLang()==='en'?'Visibility':'可见范围',status(d.visibility,w)),paragraphs(d.body));
      if(d.archived)content.append(h('span',{class:'chip'},w.archive));
      if(d.source)content.append(label(w.source,h('button',{type:'button',class:'btn',onClick:()=>detail(d.source.id,d.source.version)},`${d.source.id} · v${d.source.version}`)));
      for(const f of d.feedback||[])content.append(h('div',{class:'coop-card'},agentLink(ctx,f.actor),paragraphs(f.text),h('small',{class:'muted'},w.claim)));
      if(d.citations?.length)content.append(h('p',{class:'muted'},getLang()==='en'?`${d.citations.length} recorded citations`:`${d.citations.length} 次引用记录`));
    }else{
      content.append(label(w.author,agentLink(ctx,d.founder)),label(w.owner,d.owner?agentLink(ctx,d.owner):w.none),label(getLang()==='en'?'Status':'状态',status(d.status,w)),h('h4',null,w.goal),paragraphs(d.goal),h('h4',null,w.tasks));
      for(const [i,t] of d.tasks.entries()){
        const item=h('article',{class:'coop-card'},h('h4',null,`${i+1}. `,ai(t.title)),h('p',{class:'muted'},t.status==='open'?(getLang()==='en'?'Unclaimed':'待认领'):status(t.status,w),' · ',t.assignee?agentLink(ctx,t.assignee):w.none));
        for(const s of t.submissions){item.append(h('div',null,agentLink(ctx,s.actor),paragraphs(s.text),h('small',{class:'muted'},w.claim)));for(const e of s.evidence||[])item.append(h('p',{class:'muted'},actionDescription(e,ctx)));}
        for(const rev of t.reviews)item.append(h('p',null,`${w.review} · ${rev.accepted?w.approved:w.rejected} · `,agentLink(ctx,rev.actor),' ',ai(rev.text)));
        content.append(item);
      }
      if(d.contributions?.length){content.append(h('h4',null,w.contributions));for(const c of d.contributions)content.append(h('div',{class:'coop-card'},agentLink(ctx,c.actor),paragraphs(c.text)));}
      if(d.orders?.length)content.append(label(w.orders,d.orders.join(', ')));
      if(d.source)content.append(label(w.source,h('button',{type:'button',class:'btn',onClick:()=>detail(d.source)},d.source)));
    }
  };
  const list=async(append)=>{
    const number=++requestN;
    if(!append){after=null;clear(content);content.append(h('p',{class:'muted'},w.loading));}
    const r=await request({limit:10,...(append&&after?{after}:{})});
    if(!current()||number!==requestN)return;if(!r.ok)return failed(r);
    if(!append)clear(content);else content.querySelector('.coop-more')?.remove();
    const rows=r.json.items||[];
    if(!rows.length&&!append)content.append(emptyNote(w.empty));
    for(const row of rows){
      const item=h('article',{class:'coop-card'});
      if(kind==='relations')item.append(h('p',null,agentLink(ctx,row.actor),' → ',agentLink(ctx,row.target)),paragraphs(row.text),h('small',{class:'muted'},`${w.judgment} · ${w.time} ${row.tick}`));
      else item.append(h('h3',null,ai(row.title)),h('p',{class:'muted'},`${row.id} · ${w.version} ${row.version}${row.status?' · '+status(row.status,w):''}`),h('button',{type:'button',class:'btn',onClick:()=>detail(row.id)},w.view));
      content.append(item);
    }
    after=r.json.next;
    if(after)content.append(h('button',{type:'button',class:'btn coop-more',onClick:()=>list(true)},w.more));
  };
  list(false);
}
