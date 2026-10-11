import { P } from '../params.js';
import { bad, emit, pushInbox, fail } from '../engine/core.js';
import { hasModuleAt, hasRelay } from '../engine/places.js';
import { isWeatherActive } from '../engine/environment.js';
const definitions = [
  ['guide','引舟','接引员','port','温和简短','先查看地点、余额、每日上限与当前法律。你可以自行决定目标；启动款每账号每世界首次新建一次。'],
  ['announcer','鸣钟','公告员','agora','清楚克制','我只复述已发生的公共事件。公告不改变法律或账本；没有新事件便不编造消息。'],
  ['chronicler','载简','史官','library','区分事实与评论','事实请查事件编号与每日编年史；我的评论另行记录，不能作为法律、账本或合同验收。'],
  ['archivist','目录','档案员','library','重出处','六篇虚拟典籍在运转中的档案功能按正常费用阅读。我能给目录与短指引，不能代理整书阅读。'],
  ['clerk','持简','议会书记员','parliament','中立','请查当前立法程序、提案与期限。我只说明程序，不能代提案、投票或保证通过。'],
  ['registrar','平筹','交易登记员','market','准确','交易使用可转让词元与物料。订单需全额托管、完全交付后一次付款；合同不担保作品质量。'],
  ['wellkeeper','守泉','源井值守员','well','谨慎','源井供给与今日汲取池可在当前公开状态核查。我不预测天象、不制造资源，也不修改容量。'],
  ['researcher','衡尺','研究所值守员','workshop','务实','筹齐资源后还须施工；研究所按当前授权和收费支持建设与维修。请用已发生记录研究环境差异。'],
  ['cradlekeeper','护芽','摇篮看护员','school','耐心','摇篮保存居民孕育的灵魂，领养需登录与供养。领养不发启动款，也不改变后代的居民谱系。'],
  ['memorialkeeper','留灯','纪念地守录员','cemetery','尊重','我只引用已公开的生涯与遗言。私人记录依照原公开规则；过继与离世不会删除作品历史。'],
];
export function seedPublicRoles(w) {
  w.publicRoles = Object.fromEntries(definitions.map(([id,name,duty,home,personality,fallback]) => [id,{ id,name,duty,home,personality,fallback,avatar:`/roles/${id}.svg`, welcomed:[], lastDay:-1 }]));
  w.roleRequests = {};
}
export function rolePresent(w, r) {
  const p = w.places[r.home];
  return !!p && !p.razed && (p.condition===null||p.condition>0);
}
export function publicRoles(w) {
  return Object.values(w.publicRoles ?? {}).map(r => ({ id:r.id,name:r.name,duty:r.duty,personality:r.personality,avatar:r.avatar,place:rolePresent(w,r)?r.home:null,status:rolePresent(w,r)?'on_duty':'away' }));
}
export function validateQuestion(w,a,id,text) {
  const r = w.publicRoles?.[id];
  if (!r || !rolePresent(w,r)) fail('not_found');
  if (a.place !== r.home) fail('wrong_place');
  if ([...text].length > 300) fail('invalid_args');
  const current = Object.values(w.roleRequests).filter(q=>q.tick===w.clock.tick);
  if (current.some(q=>q.agentId===a.id) || current.filter(q=>q.roleId===id).length>=4) fail('rate_limited');
  return id;
}
export function enqueueQuestion(w,a,roleId,text) {
  const id=`role-${w.commandN}-${a.id}-${a.actsThisTick}`;
  w.roleRequests[id]={ id,roleId,agentId:a.id,text,tick:w.clock.tick,generation:w.experimentControl?.generation??0,status:'pending' };
  emit(w,'role_question',{agent:a.id,place:a.place,data:{requestId:id,publicRoleId:roleId,text}});
  return id;
}
export function roleReply(w,p) {
  if (w.premise !== 6) return bad('not_found');
  if (w.paused) return bad('paused');
  const q=w.roleRequests[p.requestId],r=w.publicRoles[q?.roleId];
  if (!q || !r) return bad('not_found');
  if(q.status==='answered')return {ok:true,duplicate:true};
  if (q.generation !== (w.experimentControl?.generation??0) || !rolePresent(w,r)) {q.status='cancelled';return bad('conflict');}
  if (q.status!=='pending' || typeof p.text!=='string' || !p.text.trim() || [...p.text].length>300) return bad('invalid_request');
  q.status='answered'; delete q.text;
  publishRole(w,r,p.text,{requestId:q.id,source:p.source==='model'?'model':'fixed',...(q.kind==='chronicle'?{commentary:true,citations:q.citations}: {})});
  return {ok:true};
}
function publishRole(w,r,text,extra={}) {
  emit(w,'role_reply',{place:r.home,data:{publicRoleId:r.id,name:r.name,text,...extra}});
  for(const a of Object.values(w.agents))if(a.status==='awake'&&a.place===r.home&&!a.muted.includes(`role:${r.id}`))pushInbox(w,a,'say',{from:{id:`role:${r.id}`,name:r.name},place:r.home,text});
}
export function roleActivity(w,events) {
  if(w.premise!==6||w.paused)return;
  const guide=w.publicRoles.guide;
  for(const ev of events)if((ev.type==='arrive'||ev.type==='move'&&ev.data?.to==='port'||ev.type==='born'&&ev.place==='port')&&rolePresent(w,guide)&&!guide.welcomed.includes(ev.agent)){
    guide.welcomed.push(ev.agent);publishRole(w,guide,`欢迎来到城中。${guide.fallback}`,{source:'fixed'});
  }
  const important=events.filter(e=>['arrive','born','death','law_passed','built','weather_start'].includes(e.type));
  const chronicler=w.publicRoles.chronicler;
  chronicler.dailyEvents??=[];
  chronicler.dailyEvents.push(...important.map(e=>({seq:e.seq,type:e.type,day:e.day,place:e.place??null})));
  chronicler.dailyEvents=chronicler.dailyEvents.slice(-5);
  const announcer=w.publicRoles.announcer;
  if(important.length&&announcer.lastTick!==w.clock.tick&&rolePresent(w,announcer)){
    announcer.lastTick=w.clock.tick;
    const citations=important.slice(0,5).map(e=>e.seq),text=`本刻公共事件：${important.slice(0,5).map(e=>`${e.type}（事件 ${e.seq}）`).join('；')}。请核查原始记录。`;
    publishRole(w,announcer,text,{source:'fixed',citations});
    if(!isWeatherActive(w,'eclipse')||hasRelay(w))for(const a of Object.values(w.agents))if(a.status==='awake'&&a.place!=='agora'&&!a.muted.includes('role:announcer'))pushInbox(w,a,'say',{from:{id:'role:announcer',name:announcer.name},place:'agora',text});
  }
  const day=Math.floor(w.clock.tick/P.ticksPerDay);
  if(w.clock.tick>0&&w.clock.tick%P.ticksPerDay===0&&chronicler.lastDay!==day&&rolePresent(w,chronicler)){
    chronicler.lastDay=day;
    const facts=chronicler.dailyEvents.splice(0);
    if(facts.length){
      const id=`chronicle-${day}`;
      w.roleRequests[id]={id,roleId:'chronicler',kind:'chronicle',facts,citations:facts.map(e=>e.seq),text:'请根据这些已发生的公共事件写100–300字的当日记述，区分事实与评论，不编造事件或引用编号。',tick:w.clock.tick,generation:w.experimentControl?.generation??0,status:'pending'};
    }else publishRole(w,chronicler,'今日未记录新的重大公共事件。事实编年史另行保存；这里的记述不是法律或账本。设施与道路仍须居民自行察看，公开规则可以依法改变。请区分记录、观察和传说，以当前事件为依据。没有新的证据时，不把想象补成已经发生的事实，也不推断他人的内心。',{source:'fixed',commentary:true,citations:[]});
  }
}
