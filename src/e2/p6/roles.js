import { P } from '../params.js';
import { bad, emit, pushInbox, fail } from '../engine/core.js';
import { hasModuleAt, hasRelay } from '../engine/places.js';
import { isWeatherActive } from '../engine/environment.js';
import { withCity, cityValue } from '../engine/cities.js';
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
const CHRONICLER_QUIET='今日未记录新的重大公共事件。事实编年史另行保存；这里的记述不是法律或账本。设施与道路仍须居民自行察看，公开规则可以依法改变。请区分记录、观察和传说，以当前事件为依据。没有新的证据时，不把想象补成已经发生的事实，也不推断他人的内心。';
// Fixed role text never contains resident input; the miniGame projection may show it before moderation.
export const ROLE_SYSTEM_TEXTS = Object.freeze([...definitions.flatMap(([,name,duty,,personality,fallback]) => [name,duty,personality,fallback]),`欢迎来到城中。${definitions[0][5]}`,CHRONICLER_QUIET]);
export const ROLE_SYSTEM_PATTERNS = Object.freeze([/^本刻公共事件：[a-z_]+（事件 \d+）(?:；[a-z_]+（事件 \d+）)*。请核查原始记录。$/]);
export function seedPublicRoles(w) {
  if (w.premise === 7) return seedIslandRoles(w);
  w.publicRoles = Object.fromEntries(definitions.map(([id,name,duty,home,personality,fallback]) => [id,{ id,name,duty,home,personality,fallback,avatar:`/roles/${id}.svg`, welcomed:[], lastDay:-1 }]));
  w.roleRequests = {};
}

// ── 第七前提「三城」的 20 位公共角色（docs/plans/2026-10-16-three-cities.md 附录 B）────────────
// 接引员、公告员、史官、议会书记员、源井值守员每城一位；档案员、研究所值守员、摇篮看护员在北城，交易登记员、纪念地守录员在东城。
// 角色带 kind（职能，即 P6 的角色 ID）与 city；北城的五位沿用 P6 的名字与头像，西城、东城的十位是新角色。
const CITY_ROLE_NAMES = {
  guide: { north: ['引舟', '温和简短'], west: ['望帆', '爽快直接'], east: ['迎潮', '耐心细致'] },
  announcer: { north: ['鸣钟', '清楚克制'], west: ['击磬', '简明准时'], east: ['传铎', '平实'] },
  chronicler: { north: ['载简', '区分事实与评论'], west: ['执笔', '只记有据之事'], east: ['编年', '重时间顺序'] },
  clerk: { north: ['持简', '中立'], west: ['守案', '公允'], east: ['掌册', '一丝不苟'] },
  wellkeeper: { north: ['守泉', '谨慎'], west: ['汲深', '稳重'], east: ['观澜', '细心'] },
};
const CITY_ROLE_HOMES = {
  guide: { north: 'north-port', west: 'west-port', east: 'east-port' },
  announcer: { north: 'north-agora', west: 'west-agora', east: 'east-agora' },
  chronicler: { north: 'north-archive', west: 'west-parliament', east: 'east-parliament' },
  clerk: { north: 'north-parliament', west: 'west-parliament', east: 'east-parliament' },
  wellkeeper: { north: 'north-well', west: 'west-well', east: 'east-well' },
};
const FACILITY_ROLE_HOMES = { archivist: 'north-archive', researcher: 'north-institute', cradlekeeper: 'north-cradle', registrar: 'east-exchange', memorialkeeper: 'east-memorial' };
const ISLAND_FALLBACK = {
  guide: '先查看地点、余额、每日上限与当前法律。这座岛上有三座城，各有自己的源井、公库和法律；你在哪座城的地界里，就守哪座城的法律，荒野不属于任何城。你可以自行决定目标；启动款每账号每世界首次新建一次。',
  announcer: '我只复述本城已发生的公共事件。公告不改变法律或账本；没有新事件便不编造消息；别城的事要靠来往的人带来。',
  chronicler: '事实请查事件编号与本城的每日编年史；我的评论另行记录，不能作为法律、账本或合同验收。',
  clerk: '请查本城当前的立法程序、提案与期限。我只说明程序，不能代提案、投票或保证通过。',
  wellkeeper: '本城源井的供给与今日汲取池可在当前公开状态核查。三口源井的产出天生不同；我不预测天象、不制造资源，也不修改容量。',
};
const CITY_IDS7 = ['north', 'west', 'east'];
function seedIslandRoles(w) {
  const duty = Object.fromEntries(definitions.map(([id, , d]) => [id, d]));
  const base = Object.fromEntries(definitions.map((d) => [d[0], d]));
  const roles = {};
  for (const kind of Object.keys(CITY_ROLE_NAMES)) {
    for (const city of CITY_IDS7) {
      const [name, personality] = CITY_ROLE_NAMES[kind][city];
      const id = `${kind}-${city}`;
      // 三城同一职务共用一幅头像（各城的头像变体还没画）
      roles[id] = { id, kind, city, name, duty: duty[kind], home: CITY_ROLE_HOMES[kind][city], personality, fallback: ISLAND_FALLBACK[kind], avatar: `/roles/${kind}.svg`, welcomed: [], lastDay: -1 };
    }
  }
  for (const [kind, home] of Object.entries(FACILITY_ROLE_HOMES)) {
    const [, name, d, , personality, fallback] = base[kind];
    roles[kind] = { id: kind, kind, city: w.places[home]?.city ?? null, name, duty: d, home, personality, fallback, avatar: `/roles/${kind}.svg`, welcomed: [], lastDay: -1 };
  }
  w.publicRoles = roles;
  w.roleRequests = {};
}
export const roleKind = (r) => r.kind ?? r.id;
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
  if ((w.premise !== 6 && w.premise !== 7)) return bad('not_found');
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
  if (w.premise === 7) { if (!w.paused) islandRoleActivity(w, events); return; }
  if((w.premise!==6 && w.premise !== 7)||w.paused)return;
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
    }else publishRole(w,chronicler,CHRONICLER_QUIET,{source:'fixed',commentary:true,citations:[]});
  }
}

/**
 * 第七前提「三城」：每座城的接引员迎接在本城港口上岸或走进本港的人；公告员只在本城播报本城的重要事件（宣告不出城，
 * 本城有蚀且没有中继时不播报到别处）；史官每日为本城写一次记述。事件按 ev.city 归城（engine/core.js）。
 */
function islandRoleActivity(w, events) {
  for (const city of CITY_IDS7) {
    const guide = w.publicRoles[`guide-${city}`];
    const port = guide.home;
    for (const ev of events) {
      if ((ev.type === 'arrive' && ev.place === port || ev.type === 'move' && ev.data?.to === port || ev.type === 'born' && ev.place === port) && rolePresent(w, guide) && !guide.welcomed.includes(ev.agent)) {
        guide.welcomed.push(ev.agent);
        publishRole(w, guide, `欢迎来到${w.cities[city]?.cityName ?? cityValueOf(w, city, 'cityName')}。${guide.fallback}`, { source: 'fixed' });
      }
    }
    const important = events.filter((e) => e.city === city && ['arrive', 'born', 'death', 'law_passed', 'built', 'weather_start', 'settle'].includes(e.type));
    const chronicler = w.publicRoles[`chronicler-${city}`];
    chronicler.dailyEvents ??= [];
    chronicler.dailyEvents.push(...important.map((e) => ({ seq: e.seq, type: e.type, day: e.day, place: e.place ?? null })));
    chronicler.dailyEvents = chronicler.dailyEvents.slice(-5);
    const announcer = w.publicRoles[`announcer-${city}`];
    if (important.length && announcer.lastTick !== w.clock.tick && rolePresent(w, announcer)) {
      announcer.lastTick = w.clock.tick;
      const citations = important.slice(0, 5).map((e) => e.seq);
      const text = `本刻公共事件：${important.slice(0, 5).map((e) => `${e.type}（事件 ${e.seq}）`).join('；')}。请核查原始记录。`;
      publishRole(w, announcer, text, { source: 'fixed', citations });
      const blocked = withCity(w, city, () => isWeatherActive(w, 'eclipse') && !hasRelay(w));
      if (!blocked) {
        for (const a of Object.values(w.agents)) {
          if (a.status === 'awake' && a.place !== announcer.home && w.places[a.place]?.city === city && !a.muted.includes(`role:${announcer.id}`)) {
            pushInbox(w, a, 'say', { from: { id: `role:${announcer.id}`, name: announcer.name }, place: announcer.home, text });
          }
        }
      }
    }
    const day = Math.floor(w.clock.tick / P.ticksPerDay);
    if (w.clock.tick > 0 && w.clock.tick % P.ticksPerDay === 0 && chronicler.lastDay !== day && rolePresent(w, chronicler)) {
      chronicler.lastDay = day;
      const facts = chronicler.dailyEvents.splice(0);
      if (facts.length) {
        const id = `chronicle-${city}-${day}`;
        w.roleRequests[id] = { id, roleId: chronicler.id, kind: 'chronicle', facts, citations: facts.map((e) => e.seq), text: '请根据这些已发生的本城公共事件写100–300字的当日记述，区分事实与评论，不编造事件或引用编号。', tick: w.clock.tick, generation: w.experimentControl?.generation ?? 0, status: 'pending' };
      } else publishRole(w, chronicler, CHRONICLER_QUIET, { source: 'fixed', commentary: true, citations: [] });
    }
  }
}
const cityValueOf = (w, id, key) => cityValue(w, id, key);
