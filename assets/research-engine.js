/* Keep the deployed predictor and a declared challenger separate. Shadow results never place orders. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./core.js'),require('./quant.js'),require('./adaptive-model.js'),require('./evidence.js'));else root.AurumResearchEngine=factory(root.AurumCore,root.AurumQuant,root.AurumAdaptive,root.AurumEvidence);})(typeof globalThis==='object'?globalThis:this,function(Core,Legacy,Adaptive,Evidence){
 'use strict';
 function profile(daily,evidence={}){const p=Legacy.profile(daily,evidence);if(daily.length>=120)p.research=Adaptive.profile(daily,evidence);return p;}
 function replay(daily,date,days,evidence={},model='legacy'){
  if(model==='legacy')return {...Legacy.replay(daily,date,days,evidence),model};
  const rows=Core.normalizePoints(daily),index=rows.findLastIndex(r=>r.time<=date);if(index<119)return {ready:false,reason:'至少需要 120 条已结束日线。'};
  const past=rows.slice(0,index+1),p=Adaptive.profile(past,evidence,model==='boosted'?'boosted':'adaptive');p.context=Evidence.context(evidence,rows[index].time+'T15:30:00+08:00');
  const forecast=Legacy.at(rows[index].close,days,p),h=p.evaluations.find(e=>e.days===days)?.steps;if(!forecast||!h)return {ready:false,reason:'请选择已支持的观察周期。'};
  const target=rows[index+h],actual=target?.close,start=rows[index].close;
  return {ready:true,model: model==='boosted'?'boosted':'adaptive',origin:rows[index].time,start,target:target?.time||null,...forecast,actual,error:actual?Math.abs(forecast.center/actual-1)*100:null,baselineError:actual?Math.abs(start/actual-1)*100:null,directionHit:actual?Math.sign(forecast.center-start)===Math.sign(actual-start):null,evidenceCount:p.context.active,trainCount:past.length,externalTrained:p.evaluations.find(e=>e.days===days)?.externalTrained||0};
 }
 return {...Legacy,profile,replay};
});
