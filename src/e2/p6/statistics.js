import { residentRecord, assetPosition, residentFlow } from './journal.js';
import { P } from '../params.js';
const balances = a => ({energy:a.energy,basic:a.basic,materials:a.materials});
export function beforeResidents(w) {
  return Object.fromEntries(Object.values(w.agents).map(a=>[a.id,{...balances(a),assets:assetPosition(w,a)}]));
}
export function recordResidents(w,before,cmd,result,events) {
  if(w.premise!==6)return;
  const day=Math.floor(w.clock.tick/P.ticksPerDay);
  for(const a of Object.values(w.agents)) {
    const initial=before[a.id]??{energy:0,basic:0,materials:0};
    const st=residentRecord(w,a.id);
    const d=st.days[day]??={day,opening:initial,closing:initial,changes:{energy:0,basic:0,materials:0},actions:0};
    const after=balances(a),delta=Object.fromEntries(Object.keys(after).map(k=>[k,after[k]-initial[k]]));
    if(Object.values(delta).some(n=>n!==0)){
      st.ledger.push({commandN:w.commandN,tick:w.clock.tick,day,kind:cmd.type,op:cmd.payload?.op??null,delta,balance:after,events:events.filter(e=>e.agent===a.id||e.data?.to===a.id||e.data?.from===a.id).map(e=>e.seq)});
      for(const k of Object.keys(delta))d.changes[k]+=delta[k];
    }
    d.closing=after;d.assets=assetPosition(w,a);
    for(const e of events)if(e.agent===a.id||e.data?.actor===a.id||e.data?.provider===a.id||e.data?.requester===a.id){
      const data=e.data??{}, achievements=st.achievements;
      if(['repair','construction_observed'].includes(e.type)){
        if(e.type==='repair')achievements.repairedBp=(achievements.repairedBp??0)+Math.max(0,(data.to??0)-(data.from??0));
        else achievements.constructionWork=(achievements.constructionWork??0)+(data.workAdded??0);
      }
      if(e.type==='order_accepted')achievements.ordersAccepted=(achievements.ordersAccepted??0)+1;
      if(e.type==='order_settled'){const key=e.data.provider===a.id?'ordersProvided_'+data.status:'ordersRequested_'+data.status;achievements[key]=(achievements[key]??0)+1;}
      if(['draw','explore'].includes(e.type)&&data.outcome!=='relic')residentFlow(w,a.id,'income',e.type,'energy',e.type==='draw'?data.amount:data.outcome==='energy'?data.amount:0);
    }
    if(cmd.type==='act'&&cmd.payload?.agentId===a.id&&result.results&&!result.replayed){
      for(const r of result.results){st.actions.attempted++;st.actions[r.ok?'succeeded':'failed']++;d.actions++;
        const t=st.actions.types[r.type]??={attempted:0,succeeded:0,failed:0};t.attempted++;t[r.ok?'succeeded':'failed']++;
        if(r.ok)residentFlow(w,a.id,'expense','action:'+r.type,'energy',r.cost);
        if(!r.ok)st.actions.errors[r.error.code]=(st.actions.errors[r.error.code]??0)+1;
      }
    }
  }
}
