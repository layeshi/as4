import { P } from '../params.js';
export function residentRecord(w,id) {
  return w.residentStats[id] ??= {
    sinceTick:w.clock.tick,days:{},actions:{attempted:0,succeeded:0,failed:0,errors:{},types:{}},ledger:[],
    flows:[],totals:{},thinking:{reread:0,read:0,write:0},achievements:{},
  };
}
// Economic categories record actual amounts, independently of free balance.
// Escrow movements and refunds are distinct from income and final expenditure.
export function residentFlow(w,id,kind,reason,resource,amount) {
  if(w.premise!==6||!Number.isSafeInteger(amount)||amount<=0||!w.agents[id])return;
  const st=residentRecord(w,id),key=`${resource}:${kind}:${reason}`;
  st.totals[key]=(st.totals[key]??0)+amount;
  st.flows.push({commandN:w.commandN,tick:w.clock.tick,day:Math.floor(w.clock.tick/P.ticksPerDay),kind,reason,resource,amount});
}
export function projectEscrow(w,id) {
  const out={energy:0,materials:0};
  for(const j of Object.values(w.projects))if(j.status==='open')for(const c of j.contributions??[])for(const k of ['energy','materials']){
    const list=c.refunds?.[k]??[{beneficiary:c.beneficiary,amount:c[k]-c[k==='energy'?'spentEnergy':'spentMaterials']}];
    for(const h of list)if(h.beneficiary.kind==='agent'&&h.beneficiary.id===id)out[k]+=h.amount;
  }
  return out;
}
export function assetPosition(w,a) {
  const projects=projectEscrow(w,a.id);
  const trades=Object.values(w.offers).filter(o=>o.status==='open'&&o.from===a.id);
  const escrow={trades:trades.reduce((n,o)=>n+o.give.energy,0),orders:Object.values(w.orders).filter(o=>o.requester===a.id&&['open','offered','active'].includes(o.status)).reduce((n,o)=>n+o.escrow,0),projects:projects.energy,pacts:Object.values(w.pacts).filter(p=>p.status==='open').reduce((n,p)=>n+(p.consents?.[a.id]?.paid??0),0)};
  const claims=Object.values(w.materialClaims).filter(c=>c.beneficiary.kind==='agent'&&c.beneficiary.id===a.id).reduce((n,c)=>n+c.amount,0);
  const materialEscrow=projects.materials+trades.reduce((n,o)=>n+(o.give.materials??0),0)+claims;
  return {escrow,materialEscrow,totalMaterials:a.materials+materialEscrow,totalTransferable:a.energy+Object.values(escrow).reduce((n,x)=>n+x,0)};
}
