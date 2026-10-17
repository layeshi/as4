// 平台托管 DeepSeek 的用户侧：金额换算、余额与充值页的内容、居民的托管扣费表。
// 金额在接口里一律是整数微元（1 元 = 1,000,000 微元），只在显示和录入时换成「元」。

import { h } from './dom.js';
import { api, errorText } from './api.js';
import { btn, field, form, section, card, table, metrics, request } from './console-ui.js';

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
export const money=n=>`¥${microYuan(n??0)}`;
export const priceLabels=[['miss','输入未命中缓存'],['hit','输入命中缓存'],['output','输出']];
export const catalogPriceLabels=[...priceLabels,['write','缓存写入（5分钟）'],['writeHour','缓存写入（1小时）']];
export const timeText=value=>value?new Date(value).toLocaleString():'—';
export const moneyField=(label,name,value='',extra={})=>field(label,name,value,'text',{inputmode:'decimal',required:true,...extra});
export const noteField=(label='说明（最多200字）',required=false)=>field(label,'note','','text',{maxlength:200,required});
export function checkedNote(value,required=false){const note=(value??'').trim();if((required&&!note)||[...note].length>200)throw Error('请填写不超过200字的说明');return note;}
const requestStatus={pending:'待处理',approved:'已入账',rejected:'已拒绝',cancelled:'已撤回'};
export const requestChip=status=>h('span',{class:`chip req-${status}`},requestStatus[status]??status);

/** 最近 30 个现实日的托管扣费；id 只看一位居民，names 把居民编号换成名字 */
export function hostedCharges(usage,id,names={}){
  const rows=(usage?.residents??[]).filter(r=>!id||r.residentId===id);
  return section('最近30个现实日托管扣费',h('p',{class:'muted'},`${usage?.from??'—'} 至 ${usage?.through??'—'} · ${usage?.timezone??'—'}。仅统计当前管理账号发起的调用。`),table(['居民','调用','输入 token','缓存命中 token','输出 token','费用'],rows.map(r=>[names[r.residentId]??r.residentId,r.calls,r.input,r.cacheRead,r.output,money(r.costMicro)])), table(['日期','模型','价格版本','计费依据','调用','按预留结算','费用'],(usage?.details??[]).filter(r=>!id||r.residentId===id).map(r=>[r.day,r.basis?.model??'旧版单模型',r.basis?.priceVersion??'旧版',r.basis ? h('details',null,h('summary',null,r.basis.settlement==='reservation'?'全额预留':'实际用量'),h('p',null,`汇率 ${r.basis.exchangeRate} × 倍率 ${r.basis.multiplier}`),table(['项目','当次档位人民币单价 / 百万 token'],catalogPriceLabels.map(([k,label])=>[label,(r.basis.appliedPricesMicro??r.basis.pricesMicro)?.[k] == null ? '不适用' : microYuan((r.basis.appliedPricesMicro??r.basis.pricesMicro)[k],6)]))) : '旧版记录',r.calls,r.estimatedCalls??0,money(r.costMicro)])));
}

/** 余额与充值页的内容：余额、购买额度（收款码 + 入账申请）、计费规则、申请与流水、居民扣费 */
export async function hostedArea(user,data,reload,names={}){
  const area=h('div',{class:'billing-area'});
  if(data.error){area.append(h('p',{class:'error'},data.error));return area;}
  area.append(metrics([['账号余额',money(data.balanceMicro)],['在途预留',money(data.reservedMicro)],['可用模型',data.models ? data.models.filter(m=>m.available).length : data.model||'尚未配置'],['单次最大输出 token',data.maxOutputTokens??'尚未配置']]));
  if(data.storageFault)area.append(h('p',{class:'callout bad'},'托管账本暂不可用，购买与调用已暂停，请联系管理员。'));
  const buy=card('购买额度',null);
  if(!data.available)buy.append(h('p',{class:'muted'},'平台托管暂未开放'));
  else if(!data.storageFault){
    const support=await api('/api/public/support');
    if(!support.ok)buy.append(h('p',{class:'error'},errorText(support,'无法读取收款码，请刷新重试。')));
    else{
      const codes=['wechat','alipay'].filter(kind=>support.json.qr?.[kind]);
      if(!codes.length)buy.append(h('p',{class:'muted'},'尚未配置收款码，购买暂未开放。'));
      else buy.append(h('ol',{class:'steps'},
        h('li',null,h('strong',null,'扫码付款'),h('div',{class:'support-grid compact'},codes.map(kind=>{
          const caption=kind==='wechat'?'微信付款':'支付宝付款',image=h('img',{class:'support-qr-image',src:support.json.qr[kind],alt:caption+'收款码'}),qr=h('figure',{class:'support-qr-card'},image,h('figcaption',null,caption));
          image.addEventListener('error',()=>{image.hidden=true;qr.append(h('p',{class:'error'},'收款码暂不可用，请刷新重试。'));});return qr;
        }))),
        h('li',null,h('strong',null,'备注用户名'),h('p',null,'付款备注请填写自己的用户名：',h('strong',{class:'mono-tag'},`@${user.username}`),'。')),
        h('li',null,h('strong',null,'提交入账申请'),h('p',{class:'muted'},'管理员核对后手动入账，可能需要等待。每次1–5,000元，最多两位小数；同时最多5个待处理申请，每小时最多提交10次。'),
          form([moneyField('已付款金额（元）','amount'),noteField('付款说明（时间、方式等，最多200字）')],'提交入账申请',async b=>{await request('/api/account/hosted/requests',{amountMicro:yuanMicro(b.amount,{decimals:2,min:1000000,max:5000000000}),note:checkedNote(b.note),requestId:crypto.randomUUID()});await reload();}))));
    }
  }
  const rules=card('计费规则',null,
    data.version === 2 ? table(['模型','输入单价起','输出单价起'],data.models.filter(m=>m.available).map(m=>[m.id,microYuan(m.pricesMicro.miss,6),microYuan(m.pricesMicro.output,6)])) : table(['项目','元 / 百万 token'],priceLabels.map(([key,label])=>[label,data.pricesMicro?microYuan(data.pricesMicro[key],6):'尚未配置'])),
    h('ul',{class:'rule-list'},
      h('li',null,'按 OpenLux 对应分组美元价格 × 7 × 平台倍率计费（初始倍率1.2，以发布单价为准）。买到的是模型调用，不是游戏内词元，不增加词元、物料或名额，也不带来游戏内优势。'),
      h('li',null,'余额由本账号选择平台托管的居民共用，只能支付托管模型调用，不能提现、不能转让；退款由管理员线下处理。'),
      h('li',null,'调用前预留费用，结束后结算并释放；缺少上游用量时扣全额预留。余额不足时暂停调用，居民仍照常生活与消耗；补足后下个作息时刻自动恢复。')),
    h('a',{href:'/support.html'},'查看非营利声明'));
  area.append(h('div',{class:'card-grid billing-grid'},buy,rules));
  area.append(card('我的入账申请（最近20条）',null,table(['申请金额','状态','实际入账','付款说明','管理员说明','申请时间','更新时间','处理 / 撤回时间','操作'],(data.requests??[]).map(r=>[money(r.amountMicro),requestChip(r.status),money(r.creditMicro),r.note||'—',r.adminNote||'—',timeText(r.createdAt),timeText(r.updatedAt),timeText(r.decidedAt??r.cancelledAt),r.status==='pending'?btn('撤回',async()=>{await request(`/api/account/hosted/requests/${encodeURIComponent(r.id)}/cancel`,{});await reload();}):'—']))),
    card('最近充值与调整（最近50条）',null,table(['时间','类型','金额','说明'],(data.ledger??[]).map(e=>[timeText(e.at),e.kind==='credit'?'充值':'调整',money(e.amountMicro),e.note||'—']))),
    h('div',{class:'card-panel'},hostedCharges(data.usage,null,names)));
  return area;
}
