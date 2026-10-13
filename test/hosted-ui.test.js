import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.js';

const dom=installFakeDom(),saved={fetch:globalThis.fetch,window:globalThis.window,location:globalThis.location,FormData:globalThis.FormData};
// residents.js 按编号取页面上的四块：顶栏、页头、提示行、内容
const nodes=Object.fromEntries(['console-header','page-head','message','content'].map(id=>[id,document.createElement('div')]));
for(const [id,node] of Object.entries(nodes)){dom.root.append(node);dom.register(id,node);}
globalThis.window={addEventListener(){}};
globalThis.location={href:'http://localhost/residents.html'};
// Fake DOM does not implement successful form controls or select.value itself.
globalThis.FormData=class{
  constructor(form){this.entries=form.querySelectorAll('input,select,textarea').filter(el=>!el.disabled&&el.getAttribute('name')&&(el.getAttribute('type')!=='checkbox'||el.checked)).map(el=>[el.getAttribute('name'),String(el.value??(el.tag==='select'?(el.children.find(o=>o.selected)??el.children[0])?.value:el.tag==='textarea'?el.textContent:'' )??'')]);}
  [Symbol.iterator](){return this.entries[Symbol.iterator]();}
};
const reply=(json,status=200)=>({ok:status>=200&&status<300,status,json:async()=>json});
let requests=[],route=()=>reply({});
globalThis.fetch=async(url,options={})=>{const req={url,method:options.method??'GET',body:options.body?JSON.parse(options.body):undefined,headers:options.headers};requests.push(req);return route(req);};
route=req=>reply(req.url==='/api/public/state'?{world:{premise:6,cityName:'城市',id:'w',day:0}}:{user:null});
const {microYuan,yuanMicro,hostedArea}=await import('../public/hosted-ui.js');
const {modelForm}=await import('../public/model-form.js');
const {hostedConfigPanel,hostedBillingPanel}=await import('../public/hosted-admin.js');
const {nextWakeText,load}=await import('../public/residents.js');
after(()=>{dom.restore();Object.assign(globalThis,saved);});
const buttons=(root,label)=>root.querySelectorAll('button').filter(b=>b.textContent===label);
const input=(root,name)=>root.querySelector(`[name="${name}"]`);
const fire=async(node,type)=>{assert.ok(node,`missing ${type} target`);for(const fn of node.listeners[type]??[])await fn({preventDefault(){},currentTarget:node,target:node});};
const submit=async(form,values={})=>{for(const [name,value]of Object.entries(values))input(form,name).value=value;await fire(form,'submit');};
const formFor=(root,label)=>root.querySelectorAll('form').find(f=>buttons(f,label).length);
const posts=()=>requests.filter(r=>r.method==='POST');
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
const mount=panel=>{dom.root.append(panel);return panel;};
const usage={timezone:'Asia/Shanghai',from:'2026-09-14',through:'2026-10-13',residents:[{residentId:'a1',calls:3,input:100,cacheRead:20,output:30,costMicro:300001}]};
const total={calls:3,input:100,cacheRead:20,output:30,costMicro:300001};
const pending={id:'req1',amountMicro:1230000,status:'pending',creditMicro:0,note:'微信',createdAt:'2026-10-13T01:00:00Z',updatedAt:'2026-10-13T01:00:00Z',adminNote:''};
const account=(extra={})=>({enabled:true,available:true,model:'deepseek-chat',thinking:'default',maxOutputTokens:4096,pricesMicro:{miss:2000000,hit:200000,output:3000000},balanceMicro:12345678,reservedMicro:100000,total,requests:[pending],ledger:[{at:pending.createdAt,kind:'adjustment',amountMicro:-200000,adminId:'admin1',note:'退款'}],usage,...extra});
const admin=(extra={})=>({config:{enabled:true,baseURL:'https://api.deepseek.com',model:'deepseek-chat',thinking:'default',maxOutputTokens:4096,pricesMicro:account().pricesMicro,hasApiKey:true},available:true,storageFault:false,timezone:'Asia/Shanghai',day:'2026-10-13',stats:{balanceMicro:12345678,reservedMicro:100000,today:{...total,tokens:130},hostedResidents:1},requests:[{...pending,username:'localuser'}],accounts:[{accountId:'u1',username:'localuser',balanceMicro:12345678,reservedMicro:100000,total}],...extra});
const start=(handler=()=>reply({}))=>{requests=[];route=handler;};

test('微元：整数四舍五入显示、精确小数与安全整数边界',()=>{
  assert.equal(microYuan(12345678),'12.3457');assert.equal(microYuan(-12345678),'-12.3457');
  assert.equal(microYuan(49),'0.0000');assert.equal(microYuan(50),'0.0001');assert.equal(microYuan(-1),'0.0000');
  assert.equal(microYuan(999999),'1.0000');assert.equal(microYuan(1,6),'0.000001');
  assert.equal(microYuan(Number.MAX_SAFE_INTEGER,6),'9007199254.740991');
  assert.equal(yuanMicro('0.1')+yuanMicro('0.2'),300000);assert.equal(microYuan(100000+200000),'0.3000');
  assert.equal(yuanMicro('9007199254.740991'),Number.MAX_SAFE_INTEGER);
  assert.equal(yuanMicro('-0.000001',{signed:true,min:-Number.MAX_SAFE_INTEGER}),-1);
  assert.equal(yuanMicro('+0.30',{signed:true}),300000);
  for(const value of ['0.30000000000000004','1e3','1.0000001','NaN','Infinity','-1','','1.','9007199254.740992'])assert.throws(()=>yuanMicro(value),undefined,value);
  assert.throws(()=>microYuan(0.1));
});
test('申请金额：最多两位小数，1–5000元边界',()=>{
  const parse=s=>yuanMicro(s,{decimals:2,min:1000000,max:5000000000});
  assert.equal(parse('1'),1000000);assert.equal(parse(' 1.10 '),1100000);assert.equal(parse('5000.00'),5000000000);
  for(const value of ['0.99','5000.01','1.001','1.000','-1','0.1','1,000',''])assert.throws(()=>parse(value));
});
test('余额与充值：余额、价格、规则、收款码、记录与居民扣费（名字替换编号）',async()=>{
  start(()=>reply({qr:{wechat:'/api/public/support/qr/wechat',alipay:'/api/public/support/qr/alipay'}}));
  const area=await hostedArea({username:'localuser'},account(),async()=>{},{a1:'青禾'});
  assert.match(area.textContent,/账号余额¥12.3457在途预留¥0.1000/);assert.match(area.textContent,/输入未命中缓存2.000000输入命中缓存0.200000输出3.000000/);
  for(const text of ['deepseek-chat','4096','不加价','不是游戏内词元','不能提现','不能转让','退款由管理员','@localuser','手动入账','待处理','最近30个现实日','Asia/Shanghai','青禾','¥0.3000','退款'])assert.ok(area.textContent.includes(text),text);
  assert.equal(area.querySelector('a').getAttribute('href'),'/support.html');assert.equal(area.querySelectorAll('img').length,2);
  assert.ok(formFor(area,'提交入账申请'));
  // 购买三步在一块卡片里，计费规则在另一块
  const cards=area.querySelectorAll('section').filter(s=>s.classList.contains('card-panel'));
  assert.ok(cards.find(s=>s.textContent.startsWith('购买额度')).textContent.includes('提交入账申请'));
  assert.ok(cards.find(s=>s.textContent.startsWith('计费规则')).textContent.includes('不加价'));
});
test('余额与充值：关闭、无收款码、故障及接口错误均不提供购买表单',async()=>{
  for(const data of [account({enabled:false,available:false,pricesMicro:null}),account({storageFault:true})]){
    start();const area=await hostedArea({username:'u'},data);assert.equal(formFor(area,'提交入账申请'),undefined);assert.equal(requests.length,0);assert.match(area.textContent,/暂未开放|账本暂不可用/);
  }
  start(()=>reply({qr:{}}));let area=await hostedArea({username:'u'},account());assert.match(area.textContent,/购买暂未开放/);assert.equal(formFor(area,'提交入账申请'),undefined);
  start(()=>reply({error:{message:'收款服务故障'}},500));area=await hostedArea({username:'u'},account());assert.match(area.textContent,/收款服务故障/);assert.equal(formFor(area,'提交入账申请'),undefined);
  area=await hostedArea({username:'u'},{error:'无法读取平台托管信息'});assert.match(area.textContent,/无法读取平台托管信息/);
});
test('余额与充值：申请精确金额、每次新编号、撤回 pending 与错误反馈',async()=>{
  let refreshed=0;start(req=>reply(req.method==='GET'?{qr:{wechat:'/api/public/support/qr/wechat'}}:{request:pending}));
  const area=await hostedArea({username:'localuser'},account({requests:[pending,{...pending,id:'req2',status:'approved'}]}),async()=>{refreshed++;});
  const f=formFor(area,'提交入账申请');await submit(f,{amount:'1.23',note:'微信付款'});await submit(f,{amount:'1.10',note:'支付宝付款'});
  assert.equal(posts()[0].body.amountMicro,1230000);assert.equal(posts()[1].body.amountMicro,1100000);assert.equal(posts()[0].body.note,'微信付款');
  assert.match(posts()[0].body.requestId,/^[\w:-]{1,128}$/);assert.notEqual(posts()[0].body.requestId,posts()[1].body.requestId);
  assert.equal(posts()[0].headers['X-Houren-Request'],'1');assert.equal(posts()[0].headers['Content-Type'],'application/json');
  assert.equal(buttons(area,'撤回').length,1);await fire(buttons(area,'撤回')[0],'click');assert.equal(posts()[2].url,'/api/account/hosted/requests/req1/cancel');assert.deepEqual(posts()[2].body,{});assert.equal(refreshed,3);
  await submit(f,{amount:'1.234'});assert.equal(posts().length,3);assert.match(f.textContent,/最多2位小数/);
  await submit(f,{amount:'1',note:'字'.repeat(201)});assert.equal(posts().length,3);
  route=()=>reply({error:{message:'待处理申请已达上限'}},429);await submit(f,{amount:'1',note:''});assert.match(f.textContent,/待处理申请已达上限/);
});
test('异步按钮：DOM 清空 currentTarget 后仍恢复按钮，重复点击不重复请求',async()=>{
  let finish;start(req=>req.method==='GET'?reply({qr:{}}):new Promise(resolve=>{finish=()=>resolve(reply({}));}));
  const area=await hostedArea({username:'u'},account(),async()=>{}),button=buttons(area,'撤回')[0],event={currentTarget:button};
  const pending=button.listeners.click[0](event);event.currentTarget=null;
  assert.equal(button.disabled,true);await fire(button,'click');assert.equal(posts().length,1);finish();await pending;assert.equal(button.disabled,false);
});
test('模型表单：托管隐藏自有字段和测试，保存 hosted；切换自有模型完整保存；只有接受过继时才填每日上限',async()=>{
  const saves=[],tests=[];const f=modelForm({provider:'openai',model:'own-model',baseURL:'https://example.invalid'},(...args)=>saves.push(args),'保存',c=>tests.push(c),account(),{withCap:true});
  input(f,'apiKey').value='own-key';input(f,'modelSource').value='hosted';await fire(input(f,'modelSource'),'change');
  assert.equal(input(f,'apiKey').disabled,true);assert.equal(input(f,'apiKey').parentNode.parentNode.hidden,true);assert.equal(buttons(f,'测试连接（会调用模型）')[0].hidden,true);
  await submit(f);assert.deepEqual(saves[0],[{hosted:true},880000]);
  input(f,'modelSource').value='own';await fire(input(f,'modelSource'),'change');await submit(f);
  assert.deepEqual(saves[1],[{provider:'openai',baseURL:'https://example.invalid',model:'own-model',apiKey:'own-key',toolMode:'native',actionTools:'typed'},880000]);
  assert.equal(input(f,'apiKey').disabled,false);assert.equal(buttons(f,'测试连接（会调用模型）')[0].hidden,false);
  await fire(buttons(f,'测试连接（会调用模型）')[0],'click');assert.deepEqual(tests,[saves[1][0]]);
  const plain=[],noCap=modelForm({hosted:true},(...args)=>plain.push(args),'保存模型配置',undefined,account());
  assert.equal(input(noCap,'dailyCap'),null,'居民的模型配置不显示每日上限');await submit(noCap);assert.deepEqual(plain[0],[{hosted:true},undefined]);
});
test('模型表单：已有托管预选，关闭说明及公共角色模型保持独立',()=>{
  const f=modelForm({hosted:true,model:'old-model'},()=>{},undefined,undefined,account());assert.equal(input(f,'modelSource').value,'hosted');assert.match(f.textContent,/平台托管 · deepseek-chat/);
  const closed=modelForm(null,()=>{},undefined,undefined,account({available:false}));assert.equal(input(closed,'modelSource').children[0].disabled,true);assert.match(closed.textContent,/平台托管暂未开放/);
  const publicRole=modelForm({},()=>{},undefined,undefined,null);assert.equal(input(publicRole,'modelSource'),null);
});
test('充值审核：入账、拒绝、调整提交精确金额并刷新，报告待处理数',async()=>{
  const seen=[];start(req=>reply(req.method==='GET'?admin():{}));
  const root=mount(hostedBillingPanel({onPending:n=>seen.push(n)}));await flush();
  assert.match(root.textContent,/账号余额与累计用量/);assert.match(root.textContent,/共 1 笔/);assert.doesNotMatch(root.textContent,/null/);assert.deepEqual(seen,[1]);
  const f=formFor(root,'确认入账');assert.equal(input(f,'credit').value,'1.230000');await submit(f,{credit:'1.000001',note:'实收'});
  assert.deepEqual(posts().at(-1).body,{creditMicro:1000001,note:'实收'});assert.equal(posts().at(-1).url,'/api/admin/hosted/requests/req1/approve');
  await submit(formFor(root,'确认拒绝'),{note:'未查到付款'});assert.equal(posts().at(-1).url,'/api/admin/hosted/requests/req1/reject');assert.deepEqual(posts().at(-1).body,{note:'未查到付款'});
  await submit(formFor(root,'调整余额'),{username:'localuser',amount:'-0.30',note:'线下退款'});assert.deepEqual(posts().at(-1).body,{username:'localuser',amountMicro:-300000,note:'线下退款'});assert.equal(posts().at(-1).url,'/api/admin/hosted/adjust');
  assert.equal(requests.filter(r=>r.method==='GET').length,4,'初次及每次操作后都刷新');
  for(const req of posts())assert.equal(req.headers['X-Houren-Request'],'1');root.remove();
});
test('充值审核：定时发现新申请——没在填写时自动显示，正在填写时只提示、保留已填内容，离开后停止检查',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let view=admin({requests:[]});const seen=[];start(req=>reply(req.method==='GET'?view:{}));
  const root=mount(hostedBillingPanel({onPending:n=>seen.push(n)}));await flush();
  assert.match(root.textContent,/没有待处理的申请/);
  view=admin();t.mock.timers.tick(30000);await flush();
  assert.match(root.textContent,/共 1 笔/);assert.ok(formFor(root,'确认入账'),'新申请不用手动刷新就出现');assert.deepEqual(seen,[0,1]);
  root.querySelectorAll('details')[0].open=true;input(formFor(root,'确认入账'),'credit').value='1.000001';
  view=admin({requests:[{...pending,username:'localuser'},{...pending,id:'req9',username:'other'}]});t.mock.timers.tick(30000);await flush();
  assert.equal(input(formFor(root,'确认入账'),'credit').value,'1.000001','正在填写的表单不被清空');assert.match(root.textContent,/有新的入账申请/);assert.deepEqual(seen,[0,1,2]);
  root.remove();const before=requests.length;t.mock.timers.tick(90000);await flush();assert.equal(requests.length,before,'离开后不再检查');
});
test('充值审核：列出最近处理与撤回的申请，管理员能核对用户说的那一笔',async()=>{
  const at='2026-10-13T02:00:00Z';
  start(req=>reply(req.method==='GET'?admin({history:[{...pending,id:'h1',status:'approved',creditMicro:1000000,decidedAt:at,updatedAt:at,adminNote:'已核对',decider:'admin1',username:'localuser',deciderName:'chief'},{...pending,id:'h2',status:'cancelled',cancelledAt:at,updatedAt:at,username:'other',deciderName:null}]}):{}));
  const root=mount(hostedBillingPanel());await flush();
  const section=root.querySelectorAll('section').find(s=>s.textContent.startsWith('最近处理的申请'));assert.ok(section);
  for(const text of ['已入账','已撤回','localuser','other','chief','已核对','¥1.0000'])assert.ok(section.textContent.includes(text),text);
  root.remove();
});
test('平台托管：配置与测试提交精确金额并刷新，今日统计不出现 null',async()=>{
  start(req=>reply(req.method==='GET'?admin():req.url.endsWith('/test')?{ok:true,model:'deepseek-chat'}:{}));
  const root=mount(hostedConfigPanel());await flush();
  assert.match(root.textContent,/今日扣费¥0.3000/);assert.match(root.textContent,/平台托管已开放/);assert.doesNotMatch(root.textContent,/null/);
  const f=formFor(root,'保存托管配置');input(f,'enabled').checked=false;input(f,'clearApiKey').checked=true;
  await submit(f,{miss:'0.1',hit:'0.000001',output:'0.2',maxOutputTokens:'8192',thinking:'enabled'});
  assert.equal(posts().at(-1).url,'/api/admin/hosted/config');assert.deepEqual(posts().at(-1).body,{enabled:false,baseURL:'https://api.deepseek.com',model:'deepseek-chat',apiKey:'',clearApiKey:true,thinking:'enabled',maxOutputTokens:8192,pricesMicro:{miss:100000,hit:1,output:200000}});
  await fire(buttons(root,'测试连接')[0],'click');assert.equal(posts().at(-1).url,'/api/admin/hosted/test');assert.match(root.textContent,/模型连接测试成功/);
  assert.equal(requests.filter(r=>r.method==='GET').length,3,'初次及每次操作后都刷新');
  for(const req of posts())assert.equal(req.headers['X-Houren-Request'],'1');root.remove();
});
test('充值审核与平台托管：必填原因、非零调整、正数入账、单价校验与后端错误',async()=>{
  start(req=>reply(req.method==='GET'?admin():{}));const billing=mount(hostedBillingPanel()),config=mount(hostedConfigPanel());await flush();
  await submit(formFor(billing,'确认拒绝'),{note:' '});await submit(formFor(billing,'调整余额'),{username:'localuser',amount:'0',note:'理由'});await submit(formFor(billing,'确认入账'),{credit:'0'});
  await submit(formFor(billing,'调整余额'),{amount:'1',note:''});await submit(formFor(config,'保存托管配置'),{miss:'0.0000001'});assert.equal(posts().length,0);
  route=req=>req.method==='GET'?reply(admin()):reply({error:{message:'账本写入失败'}},503);
  const f=formFor(billing,'调整余额');await submit(f,{amount:'-0.2',note:'退款'});assert.match(f.textContent,/账本写入失败/);assert.equal(buttons(f,'调整余额')[0].disabled,false);billing.remove();config.remove();
});
test('充值审核与平台托管：账本故障阻止入账调整，读取与测试错误可见',async()=>{
  start(req=>req.method==='GET'?reply(admin({storageFault:true})):reply({error:{message:'连接测试失败'}},400));
  const billing=mount(hostedBillingPanel()),config=mount(hostedConfigPanel());await flush();
  assert.equal(buttons(billing,'确认入账')[0].disabled,true);assert.equal(buttons(billing,'调整余额')[0].disabled,true);assert.match(billing.textContent,/账本暂不可用/);
  await fire(buttons(config,'测试连接')[0],'click');assert.match(config.textContent,/连接测试失败/);billing.remove();config.remove();
  start(()=>reply({error:{message:'需要管理员权限'}},403));const denied=mount(hostedBillingPanel());await flush();assert.match(denied.textContent,/需要管理员权限/);denied.remove();
});
test('我的居民列表：只放居民，余额只留一个数字块并链接余额页，没有管理入口；过继接受用托管配置并填上限',async()=>{
  const managed=[{id:'a1',name:'青禾',status:'awake',place:'port',runnerStatus:'hosted_balance_low',nextWake:{state:'scheduled',at:null,blockedBy:['hosted_balance_low']}},{id:'a2',name:'砺石',status:'dormant',place:'port',runnerStatus:'waiting',nextWake:{state:'dormant'}}];
  const base=req=>{
    if(req.method==='POST')return reply({});
    const data={'/api/public/state':{world:{premise:6,cityName:'无名之城',id:'p6-test',day:16},places:[{id:'port',displayName:{zh:'港口',en:'Port'}}],cradle:[]},'/api/account':{user:{id:'u1',username:'localuser',displayName:'本地',role:'admin'}},'/api/account/worlds':{archives:[{id:'p5-old',cityName:'旧城'}]},'/api/account/hosted':account(),'/api/public/support':{qr:{}},'/api/account/residents':{managed,created:[managed[0],{id:'a9',name:'旧作',status:'awake',place:'port'}],startupAvailable:false},'/api/account/transfers':{transfers:[{id:'tr1',name:'居民',direction:'incoming',status:'pending',expiresAt:pending.createdAt}]}};
    return reply(data[req.url]??{});
  };
  start(base);location.href='http://localhost/residents.html?world=p5-old'; // 旧链接里的世界参数也被忽略：只看当前世界
  try{await load();await flush();}finally{location.href='http://localhost/residents.html';}
  const head=nodes['page-head'].textContent;
  assert.match(head,/当前世界 · 第 17 日/);assert.doesNotMatch(head,/世界范围|无名之城|p6-test|旧城/);assert.equal(nodes['page-head'].querySelectorAll('select').length,0,'没有世界范围选项');
  assert.ok(!requests.some(r=>r.url.startsWith('/api/account/worlds')),'不再读取历史世界');
  const text=nodes.content.textContent;
  assert.match(text,/托管余额¥12.3457/);assert.ok(nodes.content.querySelectorAll('a').some(a=>a.getAttribute('href')==='/billing.html'));
  assert.match(text,/管理中2醒着1需要留意1/);assert.match(text,/青禾 因托管余额不足暂停了模型调用/);assert.match(text,/港口/);assert.doesNotMatch(text,/port/);
  assert.equal(formFor(nodes.content,'提交入账申请'),undefined,'购买在余额与充值页');
  for(const moved of ['我的入账申请','最近充值与调整','计费规则','管理托管配置与余额','公共角色模型','用户管理'])assert.doesNotMatch(text,new RegExp(moved),moved);
  const handed=nodes.content.querySelectorAll('section').find(s=>s.textContent.startsWith('已过继的创作'));assert.match(handed.textContent,/旧作/);assert.doesNotMatch(handed.textContent,/青禾/);
  assert.ok(buttons(nodes['page-head'],'＋ 创建居民').length);
  const f=formFor(nodes.content,'接受并配置模型');input(f,'modelSource').value='hosted';await fire(input(f,'modelSource'),'change');await submit(f,{dailyCap:'12345'});
  const req=posts().find(r=>r.url==='/api/account/transfers/tr1/accept');assert.deepEqual(req.body.config,{hosted:true});assert.equal(req.body.dailyCap,12345);assert.ok(req.body.requestId);
});
test('居民档案：总览只看状态，管理动作在「管理」，模型运行只显示本居民扣费并通过 runner save 提交托管配置',async()=>{
  const resident={id:'a1',name:'青禾',status:'awake',bio:'居民',place:'port',stats:{}};
  const data={resident,overview:{energy:10,basic:0,materials:0,dailyCap:100,usedToday:0,escrow:{},assets:{totalTransferable:10,materialEscrow:0},nextWake:{state:'hosted_balance_low'},runner:{status:'hosted_balance_low',config:{hosted:true,model:'deepseek-chat'}}},usage:{timezone:'Asia/Shanghai',total:{calls:1,input:10,output:2,failed:0,unreported:0},days:[],recent:[]},statistics:{}};
  start(req=>{
    if(req.method==='POST')return reply({});
    const result={'/api/public/state':{world:{premise:6,cityName:'城市',id:'w',day:0},places:[{id:'port',displayName:{zh:'港口'}}],docs:[]},'/api/account':{user:{id:'u1',username:'localuser'}},'/api/account/worlds':{archives:[]},'/api/account/hosted':account({usage:{...usage,residents:[...usage.residents,{...total,residentId:'a2'}]}}),'/api/account/residents/a1':data};
    return reply(result[req.url]??{});
  });
  location.href='http://localhost/residents.html?resident=a1';
  try{
    await load();await flush();
    assert.match(nodes['page-head'].textContent,/青禾/);assert.match(nodes['page-head'].textContent,/港口/);assert.ok(nodes['page-head'].querySelectorAll('a').some(a=>a.getAttribute('href')==='/residents.html'));
    assert.match(nodes.content.textContent,/托管余额不足，补足后下个作息时刻自动重试/);
    for(const label of ['更新上限','寄送家书','发起过继邀请'])assert.equal(formFor(nodes.content,label),undefined,`总览里没有「${label}」`);
    await fire(buttons(nodes.content,'管理')[0],'click');
    for(const label of ['更新上限','寄送家书','发起过继邀请'])assert.ok(formFor(nodes.content,label),`管理里有「${label}」`);
    await fire(buttons(nodes.content,'模型运行')[0],'click');assert.match(nodes.content.textContent,/最近30个现实日托管扣费/);assert.match(nodes.content.textContent,/¥0.3000/);assert.match(nodes.content.textContent,/托管余额不足/);
    const chargeSection=nodes.content.querySelectorAll('section').find(s=>s.textContent.startsWith('最近30个现实日托管扣费'));assert.doesNotMatch(chargeSection.textContent,/a2/);assert.match(chargeSection.textContent,/青禾/);
    const f=formFor(nodes.content,'保存模型配置');assert.equal(input(f,'modelSource').value,'hosted');assert.equal(input(f,'dailyCap'),null);await submit(f);
    const req=posts().find(r=>r.url==='/api/account/residents/a1/runner');assert.deepEqual(req.body,{op:'save',config:{hosted:true}});
  }finally{location.href='http://localhost/residents.html';}
});
test('托管醒来状态有解释；页面共用控制台样式；支持页的额度入口指向余额与充值',()=>{
  assert.match(nextWakeText({state:'hosted_balance_low'}),/补足后下个作息时刻自动重试/);assert.match(nextWakeText({state:'hosted_unavailable'}),/平台托管暂停/);
  assert.match(nextWakeText({state:'scheduled',at:null,blockedBy:['hosted_balance_low'],day:1,tickOfDay:2,every:3}),/托管余额不足/);
  const css=readFileSync(new URL('../public/console.css',import.meta.url),'utf8');for(const rule of ['.console-header','.admin-layout','.summary-row','.resident-grid'])assert.ok(css.includes(rule),rule);
  for(const page of ['residents','billing','account','admin']){const html=readFileSync(new URL(`../public/${page}.html`,import.meta.url),'utf8');assert.match(html,/<link rel="stylesheet" href="\/console.css">/,page);assert.match(html,/id="console-header"/,page);assert.match(html,new RegExp(`<script type="module" src="/${page}.js"></script>`),page);}
  assert.match(readFileSync(new URL('../public/support.html',import.meta.url),'utf8'),/居民的管理者可前往<a href="\/billing.html">余额与充值<\/a>.*官方成本价/);
});
