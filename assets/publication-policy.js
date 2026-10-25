(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.AurumPublication=factory();})(typeof globalThis==='object'?globalThis:this,function(){'use strict';
 function valid(p,method,now=Date.now()){
  if(p?.schema!==2||p.methodHash!==method||!Number.isFinite(Date.parse(p.generatedAt))||Date.parse(p.generatedAt)>now+300000||!(p.anchor>0)||!/^\d{4}-\d{2}-\d{2}$/.test(p.origin)||!p.inputs?.hash||!p.defaultProfile?.ready||!(p.defaultProfile.fit?.sigma>0))return false;
  if(![p.defaultProfile,p.system,p.baseline].every(profile=>Array.isArray(profile?.evaluations)&&[7,30,180,365,1095].every(days=>profile.evaluations.some(f=>f.days===days))))return false;
  for(const profile of [p.system,p.baseline])for(const f of profile.evaluations){if(![f.start,f.center,f.low,f.high].every(x=>Number.isFinite(x)&&x>0)||f.low>f.high)return false;if(f.distribution?.ready){const d=f.distribution;if(!(d.up>=0&&d.up<=1&&d.down>=0&&d.down<=1&&Math.abs(d.up+d.down-1)<1e-8&&d.count>=20&&d.quantiles?.length===5))return false;if(!d.quantiles.every((q,i,a)=>Number.isFinite(q.value)&&q.value>0&&q.level>0&&q.level<1&&(!i||q.value>=a[i-1].value&&q.level>a[i-1].level)))return false;}}
  return p.defaultProfile.evaluations.every(e=>Number.isFinite(e.move)&&e.steps>0);
 }
 function matches(p,{method,history,news,research},now=Date.now()){return valid(p,method,now)&&p.inputs.historyAsOf===history.generatedAt&&p.inputs.newsCheckedAt===(news.checkedAt||news.generatedAt)&&p.inputs.researchGeneratedAt===research.generatedAt;}
 return {valid,matches};
});
