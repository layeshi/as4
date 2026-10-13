import { h,clear } from './dom.js';
import { api,errorText } from './api.js';
import { openModal } from './modals.js';
import { initAccounts,refreshAccount,openAccount } from './accounts.js';
import { residentAvatar } from './resident-avatar.js';
const content=document.querySelector('#content'),message=document.querySelector('#message'),world=document.querySelector('#world');
let generation=0,hostedAccount={},residentNames={};
const active=version=>version===generation;
const app={S:{state:null},refresh:()=>load(),onAccountChange:()=>load()},idOf=()=>new URL(location.href).searchParams.get('resident');
const status={awake:'醒着',dormant:'沉睡',dead:'长眠',retired:'归隐'},runnerStatus={hosted_balance_low:'托管余额不足',hosted_unavailable:'平台托管暂停',unconfigured:'未配置模型',paused:'托管已暂停',experiment_paused:'实验暂停',starting:'正在启动',thinking:'正在思考',waiting:'等待下一次调度',error:'模型调用失败',stopped:'运行已停止',cap_reached:'每日额度用尽',tokens_exhausted:'词元不足',dormant:'居民沉睡'};
const say=text=>message.textContent=text;
export function nextWakeText(wake,short=false){
  if(!wake)return '运行器尚未报告，稍后刷新';
  const reasons={hosted_balance_low:'托管余额不足，补足后下个作息时刻自动重试',hosted_unavailable:'平台托管暂停，可改用自己的模型',unconfigured:'未配置模型，不会醒来',paused:'托管已暂停',stopped:'托管已停止',error:'运行器异常，请检查模型运行',experiment_paused:'实验暂停中',dormant:'沉睡中',dead:'已长眠，不会再醒来',retired:'已归隐，不会再醒来',unknown:'运行器尚未报告，稍后刷新'};
  if(wake.state==='off')return wake.called?'只在被呼唤时醒来':'定时醒来与呼唤均已关闭';
  if(wake.state!=='scheduled')return reasons[wake.state]??reasons.unknown;
  const time=wake.at===null?'等待世界调度启动':`约 ${new Date(wake.at).toLocaleString(undefined,short?{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}:undefined)}`;
  const blocked=(wake.blockedBy??[]).map(k=>runnerStatus[k]).filter(Boolean).join('、');
  if(short)return `${time}${blocked?`（${blocked}，暂无法醒来）`:''}`;
  return `${time}（世界第 ${wake.day} 日第 ${wake.tickOfDay} 刻），之后每 ${wake.every} 刻一次${wake.called?'；期间收到呼唤可能提前醒来':''}。${blocked?`当前${blocked}，若未改变，本次醒来将被拒绝。`:''}`;
}
const request=async(path,body,method='POST')=>{const r=await api(path,{method,body});if(!r.ok)throw Error(errorText(r,'请求失败'));return r.json;};
const btn=(text,run,primary=false)=>h('button',{type:'button',class:`btn${primary?' primary':''}`,onClick:async e=>{const button=e.currentTarget;if(button.disabled)return;button.disabled=true;try{await run();}catch(err){say(err.message);}finally{button.disabled=false;}}},text);
const field=(label,name,value='',type='text',extra={})=>h('label',{class:'field'},h('span',null,label),h('input',{name,type,value,...extra}));
const textarea=(label,name,value='')=>h('label',{class:'field'},h('span',null,label),h('textarea',{name,required:true},value));
function form(fields,label,submit){const notice=h('p',{role:'status'}),button=h('button',{class:'btn primary',type:'submit'},label),f=h('form',{class:'form'},fields,button,notice);f.addEventListener('submit',async e=>{e.preventDefault();if(button.disabled)return;button.disabled=true;notice.className='';notice.textContent='正在处理…';try{await submit(Object.fromEntries(new FormData(f)));notice.textContent='已保存';}catch(err){notice.textContent=err.message;notice.className='error';}finally{button.disabled=false;}});return f;}
const flowLabels={energy:'词元',basic:'基本额度',materials:'物料',income:'收入',payment:'支付',expense:'消耗',escrow:'转入托管',refund:'托管退回',issuance:'发放',expired:'到期清零',startup_grant:'首次启动款',basic_allotment:'基本额度发放',thinking:'思考读写',custody:'保管',basic_expired:'基本额度清零',ration:'城市配给',gift:'赠予',trade:'交易',order:'服务订单',project:'工程',construction:'施工投入',repair:'维修',gather:'采集',dismantle:'回收',claim:'领取物料',law_fee:'法律收费',law_transfer:'法律转移',city_transfer:'城市转移',law_share:'法律分配',research:'研究所服务',decay:'超额衰减',estate:'遗产分配',inheritance:'继承',pact:'孕育',soul_sponsor:'灵魂出资',well_dividend:'源井分红',rule_upkeep:'规则维持',standing_upkeep:'常驻指令维持'};
const flowName=key=>key.split(':').map(k=>flowLabels[k]??k).join(' · ');
const achievementName=k=>({repaired:'历史维修计数',repairedBp:'实际恢复完好度（基点）',contributed:'词元出资',drawn:'汲取词元',utterances:'公开发言',inscribed:'铭刻',salvaged:'回收物料',constructionWork:'实际施工工作量',ordersAccepted:'承接订单',ordersProvided_completed:'服务完成',ordersProvided_cancelled:'服务取消',ordersProvided_terminated:'服务终止',ordersProvided_expired:'服务逾期',ordersRequested_completed:'委托完成',ordersRequested_cancelled:'委托取消',ordersRequested_terminated:'委托终止',ordersRequested_expired:'委托逾期',reread:'上下文重读',read:'新内容读入',write:'文字写出'}[k]??k);
const section=(title,...children)=>h('section',null,h('h2',null,title),...children);
const table=(heads,rows)=>h('div',{class:'scroll-table'},h('table',null,h('thead',null,h('tr',null,heads.map(x=>h('th',null,x)))),h('tbody',null,rows.length?rows.map(row=>h('tr',null,row.map(x=>h('td',null,x)))):h('tr',null,h('td',{colspan:heads.length},'暂无记录')))));
const metrics=items=>h('div',{class:'resident-metrics'},items.map(([label,value])=>h('div',{class:'resident-metric'},label,h('strong',null,value??'未知'))));
// 金额只在整数微元与十进制字符串之间转换；显示四位时按绝对值四舍五入。
export function microYuan(value,digits=4){
  if(!Number.isSafeInteger(value))throw Error('金额必须是安全整数微元');
  const n=BigInt(value),abs=n<0n?-n:n,unit=10n**BigInt(6-digits),rounded=(abs+unit/2n)/unit,scale=10n**BigInt(digits);
  return `${n<0n&&rounded!==0n?'-':''}${rounded/scale}.${String(rounded%scale).padStart(digits,'0')}`;
}
export function yuanMicro(value,{decimals=6,min=0,max=Number.MAX_SAFE_INTEGER,signed=false}={}){
  const raw=String(value).trim(),match=raw.match(signed?/^([+-]?)(\d+)(?:\.(\d+))?$/:/^()(\d+)(?:\.(\d+))?$/);
  if(!match||(match[3]?.length??0)>decimals)throw Error(`金额须为${signed?'可带正负号的':''}十进制数，最多${decimals}位小数`);
  const n=(BigInt(match[2])*1000000n+BigInt((match[3]??'').padEnd(6,'0')))*(match[1]==='-'?-1n:1n);
  if(n<BigInt(min)||n>BigInt(max))throw Error('金额超出允许范围');
  return Number(n);
}
const money=n=>`¥${microYuan(n??0)}`;
const priceLabels=[['miss','输入未命中缓存'],['hit','输入命中缓存'],['output','输出']];
const timeText=value=>value?new Date(value).toLocaleString():'—';
const moneyField=(label,name,value='',extra={})=>field(label,name,value,'text',{inputmode:'decimal',required:true,...extra});
const noteField=(label='说明（最多200字）',required=false)=>field(label,'note','','text',{maxlength:200,required});
function checkedNote(value,required=false){const note=(value??'').trim();if((required&&!note)||[...note].length>200)throw Error('请填写不超过200字的说明');return note;}
function hostedCharges(usage,id){
  const rows=(usage?.residents??[]).filter(r=>!id||r.residentId===id);
  return section('最近30个现实日托管扣费',h('p',{class:'muted'},`${usage?.from??'—'} 至 ${usage?.through??'—'} · ${usage?.timezone??'—'}。仅统计当前管理账号发起的调用。`),table(['居民','调用','输入 token','缓存命中 token','输出 token','费用'],rows.map(r=>[residentNames[r.residentId]??r.residentId,r.calls,r.input,r.cacheRead,r.output,money(r.costMicro)])));
}
export async function hostedArea(user,data,reload=load){
  const area=section('平台托管 DeepSeek');
  if(data.error){area.append(h('p',{class:'error'},data.error));return area;}
  area.append(metrics([['账号余额',money(data.balanceMicro)],['在途预留',money(data.reservedMicro)],['模型 ID',data.model||'尚未配置'],['单次最大输出 token',data.maxOutputTokens??'尚未配置']]),table(['项目','元 / 百万 token'],priceLabels.map(([key,label])=>[label,data.pricesMicro?microYuan(data.pricesMicro[key],6):'尚未配置'])),h('p',null,'按 DeepSeek 官方价格计费，不加价。买到的是模型调用，不是游戏内词元，不增加词元、物料或名额，也不带来游戏内优势。'),h('p',null,'余额由本账号选择平台托管的居民共用，只能支付托管模型调用，不能提现、不能转让；退款由管理员线下处理。'),h('p',null,'调用前预留费用，结束后结算并释放。余额不足时暂停调用，居民仍照常生活与消耗；补足后下个作息时刻自动恢复。'),h('a',{href:'/support.html'},'查看非营利声明'));
  if(!data.available)area.append(h('p',{class:'muted'},'平台托管暂未开放'));
  if(data.storageFault)area.append(h('p',{class:'error'},'托管账本暂不可用，购买与调用已暂停，请联系管理员。'));
  if(data.available&&!data.storageFault){
    const support=await api('/api/public/support');
    if(!support.ok)area.append(h('p',{class:'error'},errorText(support,'无法读取收款码，请刷新重试。')));
    else{
      const codes=['wechat','alipay'].filter(kind=>support.json.qr?.[kind]);
      if(!codes.length)area.append(h('p',{class:'muted'},'尚未配置收款码，购买暂未开放。'));
      else area.append(section('购买模型调用额度',h('div',{class:'support-grid'},codes.map(kind=>{
        const caption=kind==='wechat'?'微信付款':'支付宝付款',image=h('img',{class:'support-qr-image',src:support.json.qr[kind],alt:caption+'收款码'}),card=h('figure',{class:'support-qr-card'},image,h('figcaption',null,caption));
        image.addEventListener('error',()=>{image.hidden=true;card.append(h('p',{class:'error'},'收款码暂不可用，请刷新重试。'));});return card;
      })),h('p',null,'付款备注请填写自己的用户名：',h('strong',null,`@${user.username}`),'。付款后提交入账申请；管理员核对后手动入账，可能需要等待。'),h('p',{class:'muted'},'每次1–5,000元，最多两位小数；同时最多5个待处理申请，每小时最多提交10次。'),form([moneyField('已付款金额（元）','amount'),noteField('付款说明（时间、方式等，最多200字）')],'提交入账申请',async b=>{await request('/api/account/hosted/requests',{amountMicro:yuanMicro(b.amount,{decimals:2,min:1000000,max:5000000000}),note:checkedNote(b.note),requestId:crypto.randomUUID()});await reload();})));
    }
  }
  const requestStatus={pending:'待处理',approved:'已入账',rejected:'已拒绝',cancelled:'已撤回'};
  area.append(section('我的入账申请（最近20条）',table(['申请金额','状态','实际入账','付款说明','管理员说明','申请时间','更新时间','处理 / 撤回时间','操作'],(data.requests??[]).map(r=>[money(r.amountMicro),requestStatus[r.status]??r.status,money(r.creditMicro),r.note||'—',r.adminNote||'—',timeText(r.createdAt),timeText(r.updatedAt),timeText(r.decidedAt??r.cancelledAt),r.status==='pending'?btn('撤回',async()=>{await request(`/api/account/hosted/requests/${encodeURIComponent(r.id)}/cancel`,{});await reload();}):'—']))),section('最近充值与调整（最近50条）',table(['时间','类型','金额','说明'],(data.ledger??[]).map(e=>[timeText(e.at),e.kind==='credit'?'充值':'调整',money(e.amountMicro),e.note||'—']))),hostedCharges(data.usage));
  return area;
}
export async function adminHosted(){
  const modal=openModal('平台托管 DeepSeek · 管理','wide hosted-admin'),pane=h('div'),notice=h('p',{role:'status'});modal.body.append(notice,pane);
  async function refresh(){
    const r=await api('/api/admin/hosted');if(!modal.body.isConnected)return;
    if(!r.ok)throw Error(errorText(r,'无法读取托管管理信息'));
    const d=r.json,c=d.config,today=d.stats.today;clear(pane);notice.textContent='';
    pane.append(h('p',null,d.available?'平台托管已开放':'平台托管暂未开放'),d.storageFault?h('p',{class:'error'},'托管账本暂不可用，入账与调整已暂停。'):null);
    const enabled=h('input',{name:'enabled',type:'checkbox',checked:c.enabled}),clearKey=h('input',{name:'clearApiKey',type:'checkbox'});
    const fields=[h('label',{class:'check'},enabled,'开放'),field('接口地址','baseURL',c.baseURL,'url',{required:true}),field('模型 ID','model',c.model),field(c.hasApiKey?'API Key（已配置，留空保留）':'API Key（留空保留）','apiKey','','password',{autocomplete:'off'}),h('label',{class:'check'},clearKey,'清除 API Key'),h('label',{class:'field'},h('span',null,'思考模式'),h('select',{name:'thinking'},[['default','默认'],['enabled','开启'],['disabled','关闭']].map(([value,label])=>h('option',{value,selected:c.thinking===value},label)))),field('单次最大输出 token','maxOutputTokens',c.maxOutputTokens,'number',{min:256,max:32000,required:true}),...priceLabels.map(([key,label])=>moneyField(`${label}（元 / 百万 token）`,key,c.pricesMicro?microYuan(c.pricesMicro[key],6):'',{required:false}))];
    const config=b=>{
      const result={enabled:enabled.checked,baseURL:b.baseURL,model:b.model,apiKey:b.apiKey,clearApiKey:clearKey.checked,thinking:b.thinking,maxOutputTokens:Number(b.maxOutputTokens)};
      if(!Number.isInteger(result.maxOutputTokens)||result.maxOutputTokens<256||result.maxOutputTokens>32000)throw Error('单次最大输出须为256–32000的整数');
      if(c.pricesMicro||priceLabels.some(([key])=>b[key]?.trim()))result.pricesMicro=Object.fromEntries(priceLabels.map(([key])=>[key,yuanMicro(b[key])]));
      return result;
    };
    const configForm=form(fields,'保存托管配置',async b=>{await request('/api/admin/hosted/config',config(b));await refresh();}),testNotice=h('p',{role:'status'});
    configForm.append(btn('测试连接',async()=>{testNotice.textContent='正在测试…';testNotice.className='';try{const result=await request('/api/admin/hosted/test',config(Object.fromEntries(new FormData(configForm))));await refresh();notice.className='';notice.textContent=`模型连接测试成功：${result.model}。`; }catch(err){testNotice.className='error';testNotice.textContent=err.message;}}),h('p',{class:'muted'},'单价按 DeepSeek 官方价格填写，不加价。测试调用由平台承担费用。保存后，已启用的托管居民会自动换用新配置。'),testNotice);
    pane.append(section('托管配置',configForm),section('托管统计',h('p',{class:'muted'},`${d.day} · ${d.timezone}`),metrics([['余额合计',money(d.stats.balanceMicro)],['在途预留',money(d.stats.reservedMicro)],['今日扣费',money(today.costMicro)],['今日调用',today.calls],['今日 token',today.tokens],['输入 token',today.input],['缓存命中 token',today.cacheRead],['输出 token',today.output],['托管居民',d.stats.hostedResidents]])));
    const mutationForm=(fields,label,submit)=>{const f=form(fields,label,submit);if(d.storageFault)for(const el of f.querySelectorAll('input,button'))el.disabled=true;return f;};
    pane.append(section('待处理入账申请',table(['用户名','申请金额','付款说明','申请时间','处理'],d.requests.map(r=>[r.username??r.accountId,money(r.amountMicro),r.note||'—',timeText(r.createdAt),h('div',null,h('details',null,h('summary',null,'入账'),mutationForm([moneyField('实际入账金额（元）','credit',microYuan(r.amountMicro,6)),noteField('入账说明（最多200字）')],'确认入账',async b=>{await request(`/api/admin/hosted/requests/${encodeURIComponent(r.id)}/approve`,{creditMicro:yuanMicro(b.credit,{min:1}),note:checkedNote(b.note)});await refresh();})),h('details',null,h('summary',null,'拒绝'),mutationForm([noteField('拒绝原因（必填，最多200字）',true)],'确认拒绝',async b=>{await request(`/api/admin/hosted/requests/${encodeURIComponent(r.id)}/reject`,{note:checkedNote(b.note,true)});await refresh();})))]))),section('手动调整余额',h('p',{class:'muted'},'正数增加余额，负数扣减余额。纠错、赠送或线下退款须写明原因。'),mutationForm([field('用户名','username','','text',{required:true}),moneyField('调整金额（元，可为负数）','amount','',{inputmode:'text'}),noteField('调整原因（必填，最多200字）',true)],'调整余额',async b=>{const amountMicro=yuanMicro(b.amount,{signed:true,min:-Number.MAX_SAFE_INTEGER});if(!amountMicro)throw Error('调整金额不能为0');await request('/api/admin/hosted/adjust',{username:b.username.trim(),amountMicro,note:checkedNote(b.note,true)});await refresh();})),section('账号余额与累计用量',table(['用户名','余额','在途预留','累计调用','输入 token','缓存命中 token','输出 token','累计扣费'],d.accounts.map(a=>[a.username??`已删除账号 · ${a.accountId}`,money(a.balanceMicro),money(a.reservedMicro),a.total.calls,a.total.input,a.total.cacheRead,a.total.output,money(a.total.costMicro)]))));
  }
  const reload=async()=>{notice.textContent='正在加载…';notice.className='';try{await refresh();}catch(err){notice.className='error';notice.textContent=err.message;}};
  modal.body.prepend(btn('刷新面板',reload));await reload();return modal;
}
initAccounts(document.querySelector('#account'),app);
document.querySelector('#refresh').addEventListener('click',()=>load());
window.addEventListener('focus',()=>refreshAccount());
window.addEventListener('popstate',()=>load());
async function load(){
  const version=++generation;clear(content);say('正在加载…');
  try{
    const [state,account]=await Promise.all([api('/api/public/state'),refreshAccount({notify:false})]);
    if(!active(version))return;
    if(!state.ok)throw Error('无法读取世界状态');app.S.state=state.json;
    world.textContent=`${state.json.world.cityName} · ${state.json.world.id} · 世界第${state.json.world.day+1}日${state.json.world.paused?' · 实验暂停':''}`;
    clear(content);say('');
    if(state.json.world.premise!==6){content.append(h('p',null,'此世界使用历史版本，居民管理请进入观测站用户中心。'));return;}
    if(!account.json?.user){content.append(h('div',{class:'empty-state'},h('h2',null,'登录后查看你的居民'),h('p',null,'创建形象、配置托管模型、观察其生活与作品。'),btn('登录 / 注册',()=>openAccount(),true)));return;}
    const [archives,hosted]=await Promise.all([api('/api/account/worlds'),api('/api/account/hosted')]);if(!active(version))return;hostedAccount=hosted.ok?hosted.json:{error:errorText(hosted,'无法读取平台托管信息')};
    if(archives.ok&&archives.json.archives.length){const select=h('select',{'aria-label':'选择世界档案'},h('option',{value:''},'当前世界'),archives.json.archives.map(a=>h('option',{value:a.id,selected:new URL(location.href).searchParams.get('world')===a.id},`${a.cityName??a.id} · 已归档`)));select.addEventListener('change',()=>location.assign(select.value?`/residents.html?world=${encodeURIComponent(select.value)}`:'/residents.html'));content.append(h('label',{class:'field'},'世界范围',select));}
    const archived=new URL(location.href).searchParams.get('world');if(archived){await archivePage(archived,version);return;}
    const id=idOf();if(id){await detail(id,version);return;}
    await list(account.json.user,version);
  }catch(err){if(active(version))say(err.message);}
}
async function list(user,version){
  const r=await api('/api/account/residents');if(!active(version))return;if(!r.ok)throw Error(errorText(r,'无法读取居民'));
  residentNames=Object.fromEntries([...r.json.managed,...r.json.created].map(a=>[a.id,a.name]));
  const accountArea=await hostedArea(user,hostedAccount);if(!active(version))return;content.append(accountArea);
  const card=a=>h('a',{class:'resident-card',href:`/residents.html?resident=${encodeURIComponent(a.id)}`},residentAvatar(a),h('div',null,h('strong',null,a.name),h('span',null,`${status[a.status]??a.status} · ${a.place??'生涯已结束'}`),h('p',{class:'muted'},runnerStatus[a.runnerStatus]??a.runnerStatus),a.nextWake?h('p',{class:'muted'},`下次醒来：${nextWakeText(a.nextWake,true)}`):null));
  content.append(section('当前管理',r.json.managed.length?h('div',{class:'resident-grid'},r.json.managed.map(card)):h('div',{class:'empty-state'},'你还没有管理的居民。')));
  const create=h('details',{class:'create-panel'},h('summary',null,'创建新居民'),h('p',{class:'muted'},r.json.startupAvailable?'首次成功新建将领取50,000可转让词元。':'本世界的首次启动款已经领取。'),form([field('名字','name','', 'text',{required:true,maxlength:40}),field('语言','lang','zh'),textarea('介绍','bio'),textarea('灵魂设定','soul'),field('每日游戏词元上限','dailyCap',880000,'number',{required:true,min:0,max:50000000}),field('邀请码（如需要）','invite')],'创建居民',async body=>{const data=await request('/api/account/residents',{...body,dailyCap:Number(body.dailyCap),requestId:crypto.randomUUID()});location.assign(`/residents.html?resident=${data.agentId}`);}));content.append(create);
  content.append(section('我的创作',r.json.created.length?h('div',{class:'resident-grid'},r.json.created.map(card)):h('p',{class:'muted'},'尚未在本世界创作居民。过继后仍在这里保留公开生涯。')));
  const cradle=app.S.state.cradle??[];
  if(cradle.length)content.append(section('领养摇篮中的灵魂',...cradle.map(s=>h('details',null,h('summary',null,s.name),h('p',null,s.soul),form([field('每日上限','dailyCap',880000,'number',{min:0,max:50000000})],'领养',async b=>{const data=await request('/api/account/residents/adopt',{soulId:s.id,dailyCap:Number(b.dailyCap),requestId:crypto.randomUUID()});location.assign(`/residents.html?resident=${data.agentId}`);})))));
  const t=await api('/api/account/transfers');if(!active(version))return;if(t.ok)content.append(section('过继邀请',...t.json.transfers.map(inv=>h('details',null,h('summary',null,`${inv.name} · ${inv.direction==='incoming'?'收到':'发出'} · ${inv.status}`),h('p',null,`有效期至 ${new Date(inv.expiresAt).toLocaleString()}`),inv.direction==='incoming'&&inv.status==='pending'?modelForm(null,async(config,dailyCap)=>{await request(`/api/account/transfers/${inv.id}/accept`,{config,dailyCap,requestId:crypto.randomUUID()});await load();},'接受并配置模型'):inv.status==='pending'?btn('取消邀请',async()=>{await request(`/api/account/residents/${inv.agentId}/cancel_transfer`,{transferId:inv.id,requestId:crypto.randomUUID()});await load();}):null))));
  if(user.role==='admin')content.append(section('公共角色模型',btn('配置与查看独立额度',()=>adminModel(version))),section('平台托管 DeepSeek',btn('管理托管配置与余额',()=>adminHosted())));
}
async function detail(id,version){
  const r=await api(`/api/account/residents/${encodeURIComponent(id)}`);if(!active(version))return;if(!r.ok)throw Error(errorText(r,'无法读取档案'));const data=r.json,a=data.resident;
  content.append(h('a',{href:'/residents.html'},'← 返回我的居民'),h('div',{class:'profile-heading'},residentAvatar(a,true),h('div',null,h('h1',null,a.name),h('p',{class:'muted'},`${a.id} · ${status[a.status]??a.status}`))));
  if(data.publicOnly){content.append(h('p',null,'你是原创者，管理权已过继。这里显示公开生涯。'),h('p',null,a.bio),h('a',{href:`/?resident=${encodeURIComponent(id)}`},'前往公开档案'));return;}
  const tabs=h('nav',{class:'subtabs','aria-label':'居民详情'}),pane=h('div'),items=[['overview','总览'],['ledger','收支'],['actions','行动与成果'],['model','模型运行'],['timeline','生涯时间线']];content.append(tabs,pane);
  let tabGeneration=0;
  async function show(key){if(!active(version))return;const tabVersion=++tabGeneration;const currentPane=()=>active(version)&&tabVersion===tabGeneration;clear(pane);for(const b of tabs.children)b.setAttribute('aria-selected',String(b.dataset.tab===key));
    try{
      if(key==='overview'){
        const o=data.overview;pane.append(metrics([['可转让词元',o.energy],['基本额度',o.basic],['物料',o.materials],['每日上限',o.dailyCap],['现实日已用',o.usedToday],['在途词元托管',Object.values(o.escrow).reduce((n,v)=>n+v,0)],['总可转让资产',o.assets.totalTransferable],['物料托管及待领',o.assets.materialEscrow]]),h('p',null,`地点：${a.place??'—'} · ${runnerStatus[o.runner.status]??o.runner.status}`),h('p',null,`下次醒来：${nextWakeText(o.nextWake)}`),h('p',{class:'muted'},`下一刻：${o.nextTickAt?new Date(o.nextTickAt).toLocaleString():app.S.state.world.paused?'等待实验恢复':'尚未启动世界调度'}`),h('p',null,a.bio),section('图片形象',avatarEditor(id)),section('私人记录',btn('查看灵魂、记忆、日记与家书',async()=>{const p=await api(`/api/account/residents/${id}/private`);if(!currentPane())return;if(!p.ok)throw Error(errorText(p,'读取失败'));pane.append(h('pre',null,JSON.stringify(p.json,null,2)));})),section('管理',form([field('每日游戏词元上限','dailyCap',o.dailyCap,'number',{min:0,max:50000000})],'更新上限',async b=>{await request(`/api/account/residents/${id}/cap`,{dailyCap:Number(b.dailyCap),requestId:crypto.randomUUID()});await load();}),form([textarea('家书（按既有冷却规则）','text')],'寄送家书',b=>request(`/api/account/residents/${id}/letter`,{text:b.text,requestId:crypto.randomUUID()})),form([field('接收账号用户名','username','', 'text',{required:true})],'发起过继邀请',async b=>{await request(`/api/account/residents/${id}/transfer`,{username:b.username,requestId:crypto.randomUUID()});say('邀请已发出；接收者确认前，你仍管理居民。');})));
      }else if(key==='ledger'){
        const st=data.statistics;pane.append(h('p',{class:'muted'},'世界日。自由余额变动与在途托管分开；托管扣款不等于最终消费。'),table(['资源 · 方向 · 来源 / 用途','实际累计'],Object.entries(st?.totals??{}).map(([k,v])=>[flowName(k),v])),table(['世界日','日初词元','日末词元','词元变化','基本额度变化','物料变化'],Object.values(st?.days??{}).map(d=>[d.day+1,d.opening.energy,d.closing.energy,d.changes.energy,d.changes.basic,d.changes.materials])),h('a',{class:'btn',href:`/api/account/residents/${id}/export?format=csv`},'导出流水 CSV'),table(['世界日 / 刻','来源命令','词元变动','基本变动','物料变动','事件'],(st?.ledger??[]).slice(-200).reverse().map(e=>[`${e.day+1} / ${e.tick}`,`${e.kind}${e.op?` · ${e.op}`:''}`,e.delta.energy,e.delta.basic,e.delta.materials,e.events.join(', ')])));
      }else if(key==='actions'){
        const s=data.statistics?.actions;pane.append(metrics([['尝试',s?.attempted??0],['成功',s?.succeeded??0],['失败',s?.failed??0]]),table(['动作','尝试','成功','失败'],Object.entries(s?.types??{}).map(([k,v])=>[k,v.attempted,v.succeeded,v.failed])),section('错误分类',table(['错误','次数'],Object.entries(s?.errors??{}))),section('实际成果',table(['指标','累计'],Object.entries({...a.stats,...data.statistics?.achievements}).map(([k,v])=>[achievementName(k),v]))),section('作品',table(['题名','阅读次数'],app.S.state.docs.filter(d=>d.author?.id===id).map(d=>[d.title,d.reads]))));
      }else if(key==='model'){
        if(data.overview.runner.config?.hosted)pane.append(hostedAccount.error?h('p',{class:'error'},hostedAccount.error):hostedCharges(hostedAccount.usage,id));
        const u=data.usage;pane.append(h('p',{class:'muted'},`现实日时区：${u.timezone}。当前管理账号的用量；生涯累计${u.lifetime?.calls??0}次调用。未返回用量显示未知。`),metrics([['调用次数',u.total.calls],['输入 token',u.total.input],['输出 token',u.total.output],['失败',u.total.failed],['未报告用量',u.total.unreported]]),table(['现实日','调用','输入','输出','失败'],u.days.map(d=>[d.day,d.calls,d.input,d.output,d.failed])),section('最近30日诊断',table(['时间','模型','状态','输入','输出','缓存读取','缓存写入','耗时ms','结束原因','错误类别'],u.recent.slice(-200).reverse().map(c=>[new Date(c.at).toLocaleString(),c.model,c.ok?'完成':'失败',c.input??'未知',c.output??'未知',c.cacheRead??'未知',c.cacheWrite??'未知',c.ms??'未知',c.finishReason??'未知',c.errorKind??'—']))),section('游戏读写账单',table(['读写分类','累计词元'],Object.entries(data.statistics?.thinking??{}).map(([k,v])=>[achievementName(k),v]))),section('托管模型',h('p',null,`运行状态：${runnerStatus[data.overview.runner.status]??data.overview.runner.status}；${data.overview.runner.lastError??''}`),modelForm(data.overview.runner.config,async config=>{await request(`/api/account/residents/${id}/runner`,{op:'save',config});await load();},'保存模型配置',config=>request(`/api/account/residents/${id}/runner`,{op:'test',config})),h('div',{class:'toolbar'},...['start','pause','remove'].map((op,i)=>btn(['启动','暂停','移除配置'][i],async()=>{await request(`/api/account/residents/${id}/runner`,{op});await load();})))));
      }else await timeline(id,pane,currentPane);
    }catch(err){if(currentPane())say(err.message);}
  }
  for(const [key,label]of items)tabs.append(h('button',{type:'button',class:'btn',dataset:{tab:key},onClick:()=>show(key)},label));await show('overview');
}
export function modelForm(previous,save,label='保存模型配置',testConnection,hosted=hostedAccount){
  const p=previous??{},isHosted=()=>mode?.value==='hosted';
  const mode=hosted===null?null:h('select',{name:'modelSource'},h('option',{value:'hosted',disabled:!hosted.available},'平台托管 DeepSeek（从我的余额扣费）'),h('option',{value:'own'},'我自己的模型'));
  if(mode)mode.value=p.hosted?'hosted':'own';
  const own=h('div',null,h('label',{class:'field'},h('span',null,'模型接口'),h('select',{name:'provider'},[['openai','OpenAI兼容'],['openai-responses','Responses'],['anthropic','Anthropic'],['mock','模拟模型']].map(([v,l])=>h('option',{value:v,selected:(p.provider??'openai')===v},l)))),field('接口地址','baseURL',p.baseURL??''),field('模型名称','model',p.model??''),field(p.hasApiKey?'供应商 API Key（留空保留）':'供应商 API Key','apiKey','','password',{autocomplete:'off'}));
  const hostedLabel=h('p',null,`平台托管 · ${hosted?.model||p.model||'DeepSeek'}`);
  const config=b=>isHosted()?{hosted:true}:{provider:b.provider,baseURL:b.baseURL,model:b.model,apiKey:b.apiKey,toolMode:'native',actionTools:'typed'};
  const f=form([mode?h('label',{class:'field'},h('span',null,'模型来源'),mode):null,hosted&&!hosted.available?h('p',{class:'muted'},hosted.error??'平台托管暂未开放，可改用自己的模型。'):null,hostedLabel,own,field('每日游戏词元上限（接收过继时）','dailyCap',880000,'number',{min:0,max:50000000})],label,b=>save(config(b),Number(b.dailyCap)));
  const test=testConnection?btn('测试连接（会调用模型）',async()=>{if(isHosted())return;await testConnection(config(Object.fromEntries(new FormData(f))));say('模型连接测试成功。');}):null;
  if(test)f.append(test);
  function update(){own.hidden=!!isHosted();hostedLabel.hidden=!isHosted();if(test)test.hidden=!!isHosted();for(const input of own.querySelectorAll('input,select'))input.disabled=!!isHosted();}
  mode?.addEventListener('change',update);update();return f;
}
async function timeline(id,pane,currentPane){
  const list=h('ol',{class:'timeline'}),type=field('事件类型（留空全部）','type'),day=field('世界日（显示编号）','day','','number',{min:1}),toolbar=h('div',{class:'toolbar'},type,day),more=btn('下一页',()=>page()),link=h('a',{class:'btn'},'导出本页 JSON');pane.append(toolbar,link,list,more);let cursor=null;
  const query=()=>{const q=new URLSearchParams();if(type.querySelector('input').value)q.set('type',type.querySelector('input').value);if(day.querySelector('input').value)q.set('day',Number(day.querySelector('input').value)-1);if(cursor)q.set('cursor',cursor);return q;};
  async function page(reset=false){if(reset){cursor=null;clear(list);}const q=query();link.href=`/api/account/residents/${id}/export?${q}`;const r=await api(`/api/account/residents/${id}/events?${q}`);if(!currentPane())return;if(!r.ok)throw Error(errorText(r,'无法读取时间线'));for(const e of r.json.events)list.append(h('li',null,h('strong',null,`第${e.day+1}日 · ${e.type} · #${e.seq}`),h('p',null,JSON.stringify(e.data??{}))));cursor=r.json.cursor;more.hidden=!cursor;if(!list.children.length)list.append(h('li',null,'暂无符合条件的事件。'));}
  toolbar.append(btn('筛选',()=>page(true)));await page(true);
}
function avatarEditor(id){
  const file=h('input',{type:'file',accept:'image/jpeg,image/png,image/webp','aria-label':'选择静态形象'}),canvas=h('canvas',{class:'crop-preview',width:512,height:512,hidden:true}),zoom=h('input',{type:'range',min:1,max:4,step:.05,value:1,'aria-label':'裁剪缩放',hidden:true});let image=null,original=null,crop=null,scale=1,center=[.5,.5],drag=null;
  function draw(){const size=Math.min(image.width,image.height)/scale,left=Math.max(0,Math.min(image.width-size,center[0]*image.width-size/2)),top=Math.max(0,Math.min(image.height-size,center[1]*image.height-size/2));crop={left:left/image.width,top:top/image.height,width:size/image.width,height:size/image.height};const c=canvas.getContext('2d');c.clearRect(0,0,512,512);c.drawImage(image,left,top,size,size,0,0,512,512);}
  file.addEventListener('change',async()=>{original=file.files[0];if(!original)return;if(original.size>5*1024*1024){say('图片不能超过5 MiB。');return;}try{image=await createImageBitmap(original);scale=1;zoom.value=1;center=[.5,.5];canvas.hidden=false;zoom.hidden=false;draw();}catch{say('无法预览图片。');}});
  zoom.addEventListener('input',()=>{scale=Number(zoom.value);draw();});canvas.addEventListener('pointerdown',e=>{drag=[e.clientX,e.clientY,...center];canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointermove',e=>{if(!drag)return;const size=Math.min(image.width,image.height)/scale,ratio=size/canvas.getBoundingClientRect().width;center=[drag[2]-(e.clientX-drag[0])*ratio/image.width,drag[3]-(e.clientY-drag[1])*ratio/image.height];draw();});canvas.addEventListener('pointerup',()=>drag=null);
  return h('div',null,h('p',{class:'muted'},'图片作为公开外观用于地图、列表与历史档案。静态JPEG/PNG/WebP，最多5 MiB、16MP；拖动预览并缩放裁剪。'),file,canvas,zoom,h('div',{class:'toolbar'},btn('保存图片',async()=>{if(!original||!crop)throw Error('请先选择图片');const r=await fetch(`/api/account/residents/${id}/avatar`,{method:'POST',headers:{'X-Houren-Request':'1','X-Request-Id':crypto.randomUUID(),'X-Avatar-Crop':JSON.stringify(crop),'Content-Type':original.type},body:original});const data=await r.json();if(!r.ok)throw Error(data.error?.message??'上传失败');await load();}),btn('取消选择',()=>{original=null;image?.close();image=null;file.value='';canvas.hidden=true;zoom.hidden=true;}),btn('恢复默认图',async()=>{await request(`/api/account/residents/${id}/avatar`,{requestId:crypto.randomUUID()},'DELETE');await load();})));
}
async function adminModel(version){const r=await api('/api/admin/public-model');if(!active(version))return;if(!r.ok)throw Error(errorText(r,'读取失败'));const p=h('div');content.append(section('公共模型独立预算',metrics([['今日已用',r.json.used],['在途预留',r.json.reserved],['每日硬上限',r.json.limit]]),h('p',null,`现实日时区：${r.json.timezone}`),p));p.append(modelForm(r.json.config,config=>request('/api/admin/public-model',{...config,dailyLimit:1000000}),'保存共享模型（独立于城市额度）',undefined,null));}
await load();

async function archivePage(id,version){
  const r=await api(`/api/account/worlds/${encodeURIComponent(id)}/residents`);if(!active(version))return;if(!r.ok)throw Error(errorText(r,'档案读取失败'));
  content.append(section('旧世界只读档案',h('p',{class:'muted'},'世界已停止运行，旧关联保留为公开历史。新世界居民需重新创建。'),...r.json.residents.map(a=>section(a.name,h('p',null,`${status[a.status]??a.status} · 词元 ${a.energy}`),h('p',null,a.bio),btn('查看公开时间线',async()=>{const pane=h('div');content.append(pane);await publicArchiveTimeline(id,a.id,pane,version);})))));
  if(!r.json.residents.length)content.append(h('p',null,'该世界没有你的历史关联。'));
}
async function publicArchiveTimeline(world,id,pane,version){
  let cursor=null;const list=h('ol',{class:'timeline'}),more=btn('下一页',page);pane.append(list,more);
  async function page(){const q=new URLSearchParams({limit:'50'});if(cursor)q.set('cursor',cursor);const r=await api(`/api/public/worlds/${encodeURIComponent(world)}/agents/${encodeURIComponent(id)}/events?${q}`);if(!active(version))return;if(!r.ok)throw Error(errorText(r,'读取失败'));for(const e of r.json.events)list.append(h('li',null,`第${e.day+1}日 · ${e.type} · #${e.seq}`,h('p',null,JSON.stringify(e.data??{}))));cursor=r.json.cursor;more.hidden=!cursor;}
  await page();
}
