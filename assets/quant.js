/* Deterministic quantitative research. No network, DOM, storage or trade execution. */
(function(root,factory){
  if(typeof module==="object"&&module.exports)module.exports=factory(require("./core.js"));
  else root.AurumQuant=factory(root.AurumCore);
})(typeof globalThis==="object"?globalThis:this,function(Core){
  "use strict";
  const horizons=[["1 周",7],["1 个月",30],["6 个月",180],["1 年",365],["3 年",1095]];
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
  const steps=days=>Math.max(1,Math.round(days*252/365));
  function fit(rows){
    const tail=rows.slice(-91),r=[];
    for(let i=1;i<tail.length;i++)r.push(Math.log(tail[i].close/tail[i-1].close));
    if(r.length<29)return null;
    const average=mean(r),variance=r.reduce((s,x)=>s+(x-average)**2,0)/(r.length-1);
    let ewma=variance;
    for(const x of r)ewma=.94*ewma+.06*x*x;
    return {sigma:Math.max(Math.sqrt(ewma),Math.sqrt(variance)*.75,1e-8),
      drift:clamp(mean(r.slice(-60))*.5,-.18/252,.18/252)};
  }
  function movement(fit,h,model){return model==="trend"?fit.drift*63*(1-Math.exp(-h/63)):0;}
  function select(errors){
    const last=errors.slice(-24);
    return last.length>=8&&mean(last.map(e=>e.trendError))<mean(last.map(e=>e.naiveError))*.98?"trend":"naive";
  }
  function multiplier(errors){
    if(errors.length<8)return null;
    const a=errors.slice(-40).map(e=>e.standardized).sort((a,b)=>a-b);
    return Math.max(.05,a[Math.min(a.length-1,Math.ceil((a.length+1)*.8)-1)]);
  }
  function evaluate(rows,days){
    const h=steps(days),errors=[],records=[];
    // Disjoint target blocks. At each origin only previously resolved errors may select or calibrate.
    for(let i=89;i+h<rows.length;i+=h){
      const f=fit(rows.slice(0,i+1)),start=rows[i].close,actual=rows[i+h].close;
      const selected=select(errors),width=multiplier(errors),scale=f.sigma*Math.sqrt(h);
      const center=start*Math.exp(movement(f,h,selected));
      const naiveError=Math.abs(start/actual-1)*100;
      const trendError=Math.abs(start*Math.exp(movement(f,h,"trend"))/actual-1)*100;
      const standardized=Math.abs(Math.log(actual/center))/scale;
      if(width!==null){
        const low=center*Math.exp(-width*scale),high=center*Math.exp(width*scale);
        records.push({origin:rows[i].time,target:rows[i+h].time,model:selected,center,actual,low,high,
          error:Math.abs(center/actual-1)*100,naiveError,hit:actual>=low&&actual<=high});
      }
      errors.push({naiveError,trendError,standardized});
    }
    return {days,steps:h,model:select(errors),multiplier:multiplier(errors),calibrationCount:Math.min(40,errors.length),
      count:records.length,mae:records.length?mean(records.map(x=>x.error)):NaN,
      naiveMae:records.length?mean(records.map(x=>x.naiveError)):NaN,
      coverage:records.length?mean(records.map(x=>Number(x.hit)))*100:NaN,records};
  }
  function profile(daily){
    const rows=Core.normalizePoints(daily),f=fit(rows);
    return {ready:!!f,count:rows.length,asOf:rows.at(-1)?.time,fit:f,
      evaluations:horizons.map(([,days])=>evaluate(rows,days))};
  }
  function at(price,days,p,scoreDelta=0){
    if(!(price>0)||!p?.ready)return null;
    if(days===0)return {center:price,low:price,high:price};
    const years=Math.max(0,days)/365,h=days*252/365;
    const result=p.evaluations.find(e=>e.days===days);
    // Intermediate chart points use the selected destination horizon, never a different fitted model.
    const source=result||p.evaluations.find(e=>e.days===30);
    const model=source?.model||"naive",width=source?.multiplier??1.2815515655;
    const shift=clamp(Core.numeric(scoreDelta,0)/100*.12,-.12,.12)*years;
    const center=price*Math.exp(movement(p.fit,h,model)+shift),spread=width*p.fit.sigma*Math.sqrt(h);
    return {center,low:center*Math.exp(-spread),high:center*Math.exp(spread)};
  }
  function path(price,days,p,delta=0){
    const destination=p.evaluations.find(e=>e.days===days)||p.evaluations.find(e=>e.days===30);
    const local={...p,evaluations:[{...destination,days:30}]};
    return Array.from({length:days+1},(_,i)=>at(price,i,local,delta));
  }
  function scenarioModel(price,p,scoreDelta=0){
    return {ready:price>0&&p.ready,vol:p.fit?.sigma,profile:p,scoreDelta,
      points:price>0&&p.ready?horizons.map(([label,days])=>{
        const value=at(price,days,p,scoreDelta);
        return {...value,label,days,stance:value.center>price*1.025?"偏强路径":value.center<price*.975?"偏弱路径":"平稳路径"};
      }):[]};
  }
  function stress(p,q,config,input,movePct=5){
    const o=Core.order(p,q,config,input);
    if(!o.valid||!(movePct>0&&movePct<=50))return null;
    const before=Core.portfolioStats(p,q.priceCnyGram).equity;
    const cash=p.cash+(o.side==="buy"?-o.total:o.total),grams=p.grams+(o.side==="buy"?o.grams:-o.grams);
    return [-movePct,0,movePct].map(change=>{
      const equity=cash+grams*q.priceCnyGram*(1+change/100);
      return {change,equity,delta:equity-before,returnPct:before>0?(equity/before-1)*100:0};
    });
  }
  function riskSize(p,q,config,input,budgetPct){
    const budget=Core.numeric(budgetPct),stop=Core.numeric(config.stopLoss);
    if(input.side!=="buy"||!(budget>=.1&&budget<=5&&stop>0&&stop<100))return null;
    const capacity=Core.orderCapacity(p,q,config,input),equity=Core.portfolioStats(p,q.priceCnyGram).equity;
    const budgetCny=equity*budget/100,net=1-Core.numeric(input.feePct)/100;
    const exit=q.priceCnyGram*(1-stop/100)*(1-Core.numeric(input.spreadPct)/200);
    function loss(grams){const o=Core.order(p,q,config,{...input,grams});const value=Core.money(grams*exit);return o.total-(value-Core.money(value*(1-net)));}
    let low=0,high=Math.round(capacity*100);
    if(!(equity>0)||!Number.isFinite(high)||!Number.isFinite(exit)||!(net>0))return null;
    while(low<high){const mid=low+Math.ceil((high-low)/2);if(loss(mid/100)<=budgetCny)low=mid;else high=mid-1;}
    return {grams:low/100,budgetCny,estimatedLoss:low?loss(low/100):0,stopPct:stop,
      limitedBy:low===Math.round(capacity*100)?"cash-or-order":"risk-budget"};
  }
  return {fit,profile,at,path,scenarioModel,stress,riskSize};
});
