/* Semantic news -> bounded, time-aware forecast parameters. No network or LLM arithmetic. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.AurumNewsFactors=factory();})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const version='news-factors-1',dims=['rates','fx','risk','inflation','flows','demand','supply','liquidity'],labels={rates:'利率政策',fx:'汇率传导',risk:'避险与地缘',inflation:'通胀预期',flows:'黄金资金流',demand:'实物与央行需求',supply:'黄金供给',liquidity:'流动性冲击'},clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 const halfLife={impulse:18,days:48,weeks:120},strength={weak:.25,moderate:.55,strong:1},novelty={new:1,ongoing:.5,priced_in:0,unknown:.2},status={reported:1,statement:.45,proposal:.25,conditional:.2,background:.1};
 function hash(x){const s=JSON.stringify(x);let a=2166136261;for(let i=0;i<s.length;i++)a=Math.imul(a^s.charCodeAt(i),16777619);return (a>>>0).toString(16).padStart(8,'0');}
 function context(snapshot,cutoff=Date.now(),drivers=[]){
  const time=typeof cutoff==='number'?cutoff:Date.parse(cutoff),eligible=snapshot?.schema===1&&snapshot.version===version&&Date.parse(snapshot.generatedAt)<=time;
  if(!eligible)return {version,ready:false,events:[],features:[],uncertainty:0,reason:'当时尚无可用的 AI 新闻参数，不倒填后来的判断'};
  const groups=new Map(),active=(snapshot.events||[]).filter(e=>dims.includes(e.dimension)&&Number.isFinite(e.knownAt?Date.parse(e.knownAt):NaN)&&Date.parse(e.knownAt)<=time&&Date.parse(e.publishedAt)<=time&&time-Date.parse(e.publishedAt)<=168*36e5);
  for(const e of active){const age=Math.max(0,(time-Date.parse(e.publishedAt))/36e5),fresh=Math.exp(-Math.LN2*age/(halfLife[e.duration]||48)),weight=(strength[e.intensity]||0)*(novelty[e.novelty]??0)*(status[e.status]||0)*(e.relevance==='direct'?1:.65)*clamp(e.sourceWeight||.5,0,1)*fresh;
   const sign=e.effect==='support'?1:e.effect==='pressure'?-1:0,conflict=e.disputed?.5:1,row={...e,ageHours:age,weight,value:sign*weight*conflict,uncertainty:(sign?0:.5)*weight+(e.disputed?.5*weight:0)};
   const key=e.cluster,old=groups.get(key);if(!old||Math.abs(row.value)+row.uncertainty>Math.abs(old.value)+old.uncertainty)groups.set(key,row);
  }
  const events=[...groups.values()],mapping={rates:['realRates','nominal2y','yieldCurve'],fx:['cny','usd'],risk:['risk'],inflation:['inflation'],flows:['positioning'],liquidity:['risk']};
  const features=dims.map(d=>{const rows=events.filter(e=>e.dimension===d),up=Math.max(0,...rows.map(e=>e.value)),down=Math.max(0,...rows.map(e=>-e.value)),overlap=drivers.some(f=>(mapping[d]||[]).includes(f.id)),discount=overlap?.5:1;return {dimension:d,label:labels[d],value:clamp((up-down)*discount,-1,1),support:up,pressure:down,conflict:Math.min(up,down),overlapDiscount:discount,count:rows.length,evidenceIds:[...new Set(rows.map(e=>e.id))]};});
  return {version,ready:true,generatedAt:snapshot.generatedAt,inputKey:snapshot.inputKey,model:snapshot.model,features,events,active:events.filter(e=>e.value).length,uncertainty:clamp(events.reduce((s,e)=>s+e.uncertainty,0)/3+features.reduce((s,f)=>s+f.conflict,0)/3,0,1),calibration:snapshot.calibration||{},coverage:snapshot.coverage};
 }
 function movement(ctx,h,sigma){
  if(!ctx?.ready||!(h>0)||!(sigma>0))return {move:0,extraSpread:0,components:[],status:'inactive'};
  // Prespecified weak prior, not claimed as a learned news-to-return coefficient.
  const gain=.004*(1-Math.exp(-h/3))*Math.exp(-Math.max(0,h-10)/42),limit=Math.min(.012,sigma*Math.sqrt(h)*.35),coefficient=gain;
  const components=ctx.features.map(f=>({dimension:f.dimension,label:f.label,value:f.value,move:f.value*coefficient,evidenceIds:f.evidenceIds,overlapDiscount:f.overlapDiscount})),total=components.reduce((s,f)=>s+f.move,0),scale=Math.abs(total)>limit?limit/Math.abs(total):1;
  return {move:clamp(total,-limit,limit),extraSpread:Math.min(.01,sigma*Math.sqrt(h)*.15)*ctx.uncertainty,components:components.map(f=>({...f,move:f.move*scale})),limit,status:'bounded-prior',coefficient,notice:'方向分不是概率；初始系数为有界先验，尚无足够真实前瞻样本证明提升准确率'};
 }
 return {version,dims,labels,hash,context,movement};
});
