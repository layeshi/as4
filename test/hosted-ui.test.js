import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.js';

const dom=installFakeDom(),saved={fetch:globalThis.fetch,window:globalThis.window,location:globalThis.location,FormData:globalThis.FormData};
const nodes=Object.fromEntries(['content','message','world','account','refresh'].map(id=>[id,document.createElement('div')]));
for(const node of Object.values(nodes))dom.root.append(node);
document.querySelector=selector=>nodes[selector.slice(1)];
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
const {microYuan,yuanMicro,hostedArea,modelForm,adminHosted,nextWakeText}=await import('../public/residents.js');
after(()=>{dom.restore();Object.assign(globalThis,saved);});
const buttons=(root,label)=>root.querySelectorAll('button').filter(b=>b.textContent===label);
const input=(root,name)=>root.querySelector(`[name="${name}"]`);
const fire=async(node,type)=>{assert.ok(node,`missing ${type} target`);for(const fn of node.listeners[type]??[])await fn({preventDefault(){},currentTarget:node,target:node});};
const submit=async(form,values={})=>{for(const [name,value]of Object.entries(values))input(form,name).value=value;await fire(form,'submit');};
const formFor=(root,label)=>root.querySelectorAll('form').find(f=>buttons(f,label).length);
const posts=()=>requests.filter(r=>r.method==='POST');
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
test('账户区：余额、价格、规则、收款码、记录与居民扣费',async()=>{
  start(()=>reply({qr:{wechat:'/api/public/support/qr/wechat',alipay:'/api/public/support/qr/alipay'}}));
  const area=await hostedArea({username:'localuser'},account(),async()=>{});
  assert.match(area.textContent,/账号余额¥12.3457在途预留¥0.1000/);assert.match(area.textContent,/输入未命中缓存2.000000输入命中缓存0.200000输出3.000000/);
  for(const text of ['deepseek-chat','4096','不加价','不是游戏内词元','不能提现','不能转让','退款由管理员','@localuser','手动入账','待处理','最近30个现实日','Asia/Shanghai','a1','¥0.3000','退款'])assert.ok(area.textContent.includes(text),text);
  assert.equal(area.querySelector('a').getAttribute('href'),'/support.html');assert.equal(area.querySelectorAll('img').length,2);
  assert.ok(formFor(area,'提交入账申请'));
});
test('账户区：关闭、无收款码、故障及接口错误均不提供购买表单',async()=>{
  for(const data of [account({enabled:false,available:false,pricesMicro:null}),account({storageFault:true})]){
    start();const area=await hostedArea({username:'u'},data);assert.equal(formFor(area,'提交入账申请'),undefined);assert.equal(requests.length,0);assert.match(area.textContent,/暂未开放|账本暂不可用/);
  }
  start(()=>reply({qr:{}}));let area=await hostedArea({username:'u'},account());assert.match(area.textContent,/购买暂未开放/);assert.equal(formFor(area,'提交入账申请'),undefined);
  start(()=>reply({error:{message:'收款服务故障'}},500));area=await hostedArea({username:'u'},account());assert.match(area.textContent,/收款服务故障/);assert.equal(formFor(area,'提交入账申请'),undefined);
});
test('账户区：申请精确金额、每次新编号、撤回 pending 与错误反馈',async()=>{
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
test('模型表单：托管隐藏自有字段和测试，保存 hosted；切换自有模型完整保存',async()=>{
  const saves=[],tests=[];const f=modelForm({provider:'openai',model:'own-model',baseURL:'https://example.invalid'},(...args)=>saves.push(args),'保存',c=>tests.push(c),account());
  input(f,'apiKey').value='own-key';input(f,'modelSource').value='hosted';await fire(input(f,'modelSource'),'change');
  assert.equal(input(f,'apiKey').disabled,true);assert.equal(input(f,'apiKey').parentNode.parentNode.hidden,true);assert.equal(buttons(f,'测试连接（会调用模型）')[0].hidden,true);
  await submit(f);assert.deepEqual(saves[0],[{hosted:true},880000]);
  input(f,'modelSource').value='own';await fire(input(f,'modelSource'),'change');await submit(f);
  assert.deepEqual(saves[1],[{provider:'openai',baseURL:'https://example.invalid',model:'own-model',apiKey:'own-key',toolMode:'native',actionTools:'typed'},880000]);
  assert.equal(input(f,'apiKey').disabled,false);assert.equal(buttons(f,'测试连接（会调用模型）')[0].hidden,false);
  await fire(buttons(f,'测试连接（会调用模型）')[0],'click');assert.deepEqual(tests,[saves[1][0]]);
});
test('模型表单：已有托管预选，关闭说明及公共角色模型保持独立',()=>{
  const f=modelForm({hosted:true,model:'old-model'},()=>{},undefined,undefined,account());assert.equal(input(f,'modelSource').value,'hosted');assert.match(f.textContent,/平台托管 · deepseek-chat/);
  const closed=modelForm(null,()=>{},undefined,undefined,account({available:false}));assert.equal(input(closed,'modelSource').children[0].disabled,true);assert.match(closed.textContent,/平台托管暂未开放/);
  const publicRole=modelForm({},()=>{},undefined,undefined,null);assert.equal(input(publicRole,'modelSource'),null);
});
test('管理面板：入账、拒绝、调整、配置和测试提交精确金额并刷新',async()=>{
  start(req=>reply(req.method==='GET'?admin():req.url.endsWith('/test')?{ok:true,model:'deepseek-chat'}:{}));
  const modal=await adminHosted(),root=modal.body;
  assert.match(root.textContent,/今日扣费¥0.3000/);assert.match(root.textContent,/账号余额与累计用量/);
  let f=formFor(root,'确认入账');assert.equal(input(f,'credit').value,'1.230000');await submit(f,{credit:'1.000001',note:'实收'});
  assert.deepEqual(posts().at(-1).body,{creditMicro:1000001,note:'实收'});assert.equal(posts().at(-1).url,'/api/admin/hosted/requests/req1/approve');
  await submit(formFor(root,'确认拒绝'),{note:'未查到付款'});assert.equal(posts().at(-1).url,'/api/admin/hosted/requests/req1/reject');assert.deepEqual(posts().at(-1).body,{note:'未查到付款'});
  await submit(formFor(root,'调整余额'),{username:'localuser',amount:'-0.30',note:'线下退款'});assert.deepEqual(posts().at(-1).body,{username:'localuser',amountMicro:-300000,note:'线下退款'});assert.equal(posts().at(-1).url,'/api/admin/hosted/adjust');
  f=formFor(root,'保存托管配置');input(f,'enabled').checked=false;input(f,'clearApiKey').checked=true;
  await submit(f,{miss:'0.1',hit:'0.000001',output:'0.2',maxOutputTokens:'8192',thinking:'enabled'});
  assert.equal(posts().at(-1).url,'/api/admin/hosted/config');assert.deepEqual(posts().at(-1).body,{enabled:false,baseURL:'https://api.deepseek.com',model:'deepseek-chat',apiKey:'',clearApiKey:true,thinking:'enabled',maxOutputTokens:8192,pricesMicro:{miss:100000,hit:1,output:200000}});
  await fire(buttons(root,'测试连接')[0],'click');assert.equal(posts().at(-1).url,'/api/admin/hosted/test');assert.match(root.textContent,/模型连接测试成功/);
  assert.equal(requests.filter(r=>r.method==='GET').length,6,'初次及每次操作后都刷新');
  for(const req of posts())assert.equal(req.headers['X-Houren-Request'],'1');modal.close();
});
test('管理面板：拒绝/调整必填原因、非零调整、正数入账、单价校验与后端错误',async()=>{
  start(req=>reply(req.method==='GET'?admin():{}));const modal=await adminHosted(),root=modal.body;
  await submit(formFor(root,'确认拒绝'),{note:' '});await submit(formFor(root,'调整余额'),{username:'localuser',amount:'0',note:'理由'});await submit(formFor(root,'确认入账'),{credit:'0'});
  await submit(formFor(root,'调整余额'),{amount:'1',note:''});await submit(formFor(root,'保存托管配置'),{miss:'0.0000001'});assert.equal(posts().length,0);
  route=req=>req.method==='GET'?reply(admin()):reply({error:{message:'账本写入失败'}},503);
  const f=formFor(root,'调整余额');await submit(f,{amount:'-0.2',note:'退款'});assert.match(f.textContent,/账本写入失败/);assert.equal(buttons(f,'调整余额')[0].disabled,false);modal.close();
});
test('管理面板：账本故障阻止入账调整，读取与测试错误可见',async()=>{
  start(req=>req.method==='GET'?reply(admin({storageFault:true})):reply({error:{message:'连接测试失败'}},400));const modal=await adminHosted();
  assert.equal(buttons(modal.body,'确认入账')[0].disabled,true);assert.equal(buttons(modal.body,'调整余额')[0].disabled,true);
  await fire(buttons(modal.body,'测试连接')[0],'click');assert.match(modal.body.textContent,/连接测试失败/);modal.close();
  start(()=>reply({error:{message:'需要管理员权限'}},403));const denied=await adminHosted();assert.match(denied.body.textContent,/需要管理员权限/);denied.close();
});
test('列表整合：账户区、管理员入口及过继接受使用托管配置',async()=>{
  const base=req=>{
    if(req.method==='POST')return reply({});
    const data={'/api/public/state':{world:{premise:6,cityName:'城市',id:'w',day:0},cradle:[]},'/api/account':{user:{username:'localuser',role:'admin'}},'/api/account/worlds':{archives:[]},'/api/account/hosted':account(),'/api/public/support':{qr:{}},'/api/account/residents':{managed:[],created:[],startupAvailable:false},'/api/account/transfers':{transfers:[{id:'tr1',name:'居民',direction:'incoming',status:'pending',expiresAt:pending.createdAt}]}};
    return reply(data[req.url]??{});
  };
  start(base);await fire(nodes.refresh,'click'); // refresh listener starts load asynchronously
  for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.match(nodes.content.textContent,/账号余额¥12.3457/);assert.ok(buttons(nodes.content,'管理托管配置与余额').length);
  const f=formFor(nodes.content,'接受并配置模型');input(f,'modelSource').value='hosted';await fire(input(f,'modelSource'),'change');await submit(f,{dailyCap:'12345'});
  const req=posts().find(r=>r.url==='/api/account/transfers/tr1/accept');assert.deepEqual(req.body.config,{hosted:true});assert.equal(req.body.dailyCap,12345);assert.ok(req.body.requestId);
});
test('居民模型运行：只显示本居民扣费，并通过 runner save 提交托管配置',async()=>{
  const resident={id:'a1',name:'青禾',status:'awake',bio:'居民',place:'广场'};
  const data={resident,overview:{energy:10,basic:0,materials:0,dailyCap:100,usedToday:0,escrow:{},assets:{totalTransferable:10,materialEscrow:0},runner:{status:'hosted_balance_low',config:{hosted:true,model:'deepseek-chat'}}},usage:{timezone:'Asia/Shanghai',total:{calls:1,input:10,output:2,failed:0,unreported:0},days:[],recent:[]},statistics:{}};
  start(req=>{
    if(req.method==='POST')return reply({});
    const result={'/api/public/state':{world:{premise:6,cityName:'城市',id:'w',day:0}},'/api/account':{user:{username:'localuser'}},'/api/account/worlds':{archives:[]},'/api/account/hosted':account({usage:{...usage,residents:[...usage.residents,{...total,residentId:'a2'}]}}),'/api/account/residents/a1':data};
    return reply(result[req.url]??{});
  });
  location.href='http://localhost/residents.html?resident=a1';
  try{
    await fire(nodes.refresh,'click');for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
    await fire(buttons(nodes.content,'模型运行')[0],'click');assert.match(nodes.content.textContent,/最近30个现实日托管扣费/);assert.match(nodes.content.textContent,/¥0.3000/);assert.match(nodes.content.textContent,/托管余额不足/);
    const chargeSection=nodes.content.querySelectorAll('section').find(s=>s.textContent.startsWith('最近30个现实日托管扣费'));assert.doesNotMatch(chargeSection.textContent,/a2/);
    const f=formFor(nodes.content,'保存模型配置');assert.equal(input(f,'modelSource').value,'hosted');await submit(f);
    const req=posts().find(r=>r.url==='/api/account/residents/a1/runner');assert.deepEqual(req.body,{op:'save',config:{hosted:true}});
  }finally{location.href='http://localhost/residents.html';}
});
test('托管醒来状态有解释；CSS仅修复账户摘要后的按钮行；支持页有额度入口',()=>{
  assert.match(nextWakeText({state:'hosted_balance_low'}),/补足后下个作息时刻自动重试/);assert.match(nextWakeText({state:'hosted_unavailable'}),/平台托管暂停/);
  assert.match(nextWakeText({state:'scheduled',at:null,blockedBy:['hosted_balance_low'],day:1,tickOfDay:2,every:3}),/托管余额不足/);
  const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');assert.match(css,/\.account-modal \.account-summary \+ \.form-actions\s*\{[^}]*flex-wrap: wrap/);assert.match(css,/\.account-modal \.account-summary \+ \.form-actions > \.btn\s*\{[^}]*white-space: nowrap/);
  assert.match(readFileSync(new URL('../public/support.html',import.meta.url),'utf8'),/居民的管理者可前往<a href="\/residents.html">我的居民<\/a>.*官方成本价/);
});
