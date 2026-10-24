/* Deterministic quantitative research. No network, DOM, storage or trade execution. */
(function(root,factory){
  if(typeof module==="object"&&module.exports)module.exports=factory(require("./core.js"),require("./evidence.js"));
  else root.AurumQuant=factory(root.AurumCore,root.AurumEvidence);
})(typeof globalThis==="object"?globalThis:this,function(Core,Evidence){
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
  function features(rows,i){
    const price=rows[i].close,ret=n=>Math.log(price/rows[i-n].close),tail=rows.slice(i-19,i+1).map(r=>r.close);
    const window=rows.slice(i-19,i+1),volumes=window.map(r=>r.volume),consistent=window.every(r=>r.volumeSource&&r.volumeSource===window[0].volumeSource);
    const volume=consistent&&volumes.every(v=>Number.isFinite(v)&&v>0)?Math.log(volumes.at(-1)/mean(volumes)):0;
    return [ret(5),ret(20),ret(60),Math.log(price/mean(tail)),Math.log(price/Math.max(...rows.slice(i-59,i+1).map(r=>r.close))),volume];
  }
  function solve(a,b){
    const n=b.length,m=a.map((row,i)=>row.slice().concat(b[i]));
    for(let k=0;k<n;k++){
      let pivot=k;for(let j=k+1;j<n;j++)if(Math.abs(m[j][k])>Math.abs(m[pivot][k]))pivot=j;
      [m[k],m[pivot]]=[m[pivot],m[k]];if(Math.abs(m[k][k])<1e-12)return Array(n).fill(0);
      const div=m[k][k];for(let j=k;j<=n;j++)m[k][j]/=div;
      for(let i=0;i<n;i++)if(i!==k){const scale=m[i][k];for(let j=k;j<=n;j++)m[i][j]-=scale*m[k][j];}
    }
    return m.map(row=>row[n]);
  }
  function train(rows,h){
    const target=Math.min(63,h),last=rows.length-1,samples=[];
    for(let i=Math.max(60,last-504);i+target<=last;i++)samples.push({x:features(rows,i),y:Math.log(rows[i+target].close/rows[i].close),w:Math.exp(-Math.LN2*(last-i-target)/126)});
    const f=fit(rows);if(!f)return {model:"unavailable",move:0,trainCount:0,contributions:[]};
    const trend=f.drift*63*(1-Math.exp(-h/63));
    if(samples.length<40)return {model:"trend",move:trend,trainCount:samples.length,contributions:[{label:"收缩趋势",move:trend}]};
    const dimensions=samples[0].x.length,weight=samples.reduce((s,r)=>s+r.w,0),mu=Array.from({length:dimensions},(_,j)=>samples.reduce((s,r)=>s+r.w*r.x[j],0)/weight);
    const sd=mu.map((m,j)=>Math.max(1e-5,Math.sqrt(samples.reduce((s,r)=>s+r.w*(r.x[j]-m)**2,0)/weight)));
    const a=Array.from({length:dimensions+1},()=>Array(dimensions+1).fill(0)),b=Array(dimensions+1).fill(0);
    for(const row of samples){const x=[1,...row.x.map((v,j)=>clamp((v-mu[j])/sd[j],-4,4))];for(let i=0;i<=dimensions;i++){b[i]+=row.w*x[i]*row.y;for(let j=0;j<=dimensions;j++)a[i][j]+=row.w*x[i]*x[j];}}
    // Fixed ridge penalty, predeclared rather than tuned on the holdout window.
    for(let j=0;j<=dimensions;j++)a[j][j]+=j===0?5:20;
    const beta=solve(a,b),x=features(rows,last).map((v,j)=>clamp((v-mu[j])/sd[j],-4,4));
    const extrapolation=h>63?1+.35*Math.log(h/63):1;
    const ridge=(beta[0]+x.reduce((s,v,j)=>s+v*beta[j+1],0))*extrapolation;
    const limit=Math.min(.45,Math.max(.005,2*f.sigma*Math.sqrt(h))),raw=.7*ridge+.3*trend,move=clamp(raw,-limit,limit);
    const scale=Math.abs(raw)>1e-12?move/raw:1;
    const labels=["历史平均收益","5 日动量","20 日动量","60 日趋势","均线偏离","高点回撤","成交量相对活跃度"];
    return {model:"ensemble",move,trainCount:samples.length,contributions:[{label:labels[0],move:.7*beta[0]*extrapolation*scale},...x.map((v,j)=>({label:labels[j+1],move:.7*v*beta[j+1]*extrapolation*scale})),{label:"衰减趋势",move:.3*trend*scale}]};
  }
  function multiplier(errors){
    if(errors.length<8)return null;
    const a=errors.slice(-40).map(e=>e.standardized).sort((a,b)=>a-b);
    return Math.max(.05,a[Math.min(a.length-1,Math.ceil((a.length+1)*.8)-1)]);
  }
  function reliability(errors){
    const recent=errors.slice(-24);if(recent.length<8)return .5;
    const model=mean(recent.map(e=>e.modelError)),baseline=mean(recent.map(e=>e.naiveError));
    return model>1e-10?clamp((baseline/model)**2,.15,1):1;
  }
  function evaluate(rows,days,evidence){
    const h=steps(days),errors=[],records=[];
    // Disjoint target blocks. At each origin only previously resolved errors may select or calibrate.
    for(let i=119;i+h<rows.length;i+=h){
      const f=fit(rows.slice(0,i+1)),start=rows[i].close,actual=rows[i+h].close;
      const trained=train(rows.slice(0,i+1),h),shrink=reliability(errors),width=multiplier(errors),scale=f.sigma*Math.sqrt(h);
      const context=Evidence.context(evidence,rows[i].time+"T15:30:00+08:00"),overlay=Evidence.movement(context,h,f.sigma);
      const center=start*Math.exp(trained.move*shrink+overlay);
      const naiveError=Math.abs(start/actual-1)*100;
      const standardized=Math.abs(Math.log(actual/center))/scale;
      if(width!==null){
        const low=center*Math.exp(-width*scale),high=center*Math.exp(width*scale);
        records.push({origin:rows[i].time,target:rows[i+h].time,model:trained.model,center,actual,low,high,start,
          error:Math.abs(center/actual-1)*100,naiveError,hit:actual>=low&&actual<=high,
          directionHit:Math.sign(center-start)===Math.sign(actual-start),evidenceCount:context.active});
      }
      errors.push({naiveError,standardized,modelError:Math.abs(start*Math.exp(trained.move)/actual-1)*100});
    }
    const trained=train(rows,h),shrink=reliability(errors),recent=records.slice(-20);
    return {days,steps:h,...trained,move:trained.move*shrink,shrink,contributions:trained.contributions.map(c=>({...c,move:c.move*shrink})),multiplier:multiplier(errors),calibrationCount:Math.min(40,errors.length),
      count:records.length,mae:records.length?mean(records.map(x=>x.error)):NaN,
      naiveMae:records.length?mean(records.map(x=>x.naiveError)):NaN,
      direction:records.length?mean(records.map(x=>Number(x.directionHit)))*100:NaN,
      augmentedCount:records.filter(r=>r.evidenceCount>0).length,
      recentCount:recent.length,recentMae:recent.length?mean(recent.map(r=>r.error)):NaN,recentNaiveMae:recent.length?mean(recent.map(r=>r.naiveError)):NaN,
      coverage:records.length?mean(records.map(x=>Number(x.hit)))*100:NaN,records};
  }
  function profile(daily,evidence={}){
    const rows=Core.normalizePoints(daily),f=fit(rows);
    return {ready:!!f,count:rows.length,asOf:rows.at(-1)?.time,fit:f,
      evidence,evaluations:horizons.map(([,days])=>evaluate(rows,days,evidence))};
  }
  function at(price,days,p,scoreDelta=0){
    if(!(price>0)||!p?.ready)return null;
    if(days===0)return {center:price,low:price,high:price};
    const years=Math.max(0,days)/365,h=days*252/365;
    const result=p.evaluations.find(e=>e.days===days);
    // Intermediate chart points use the selected destination horizon, never a different fitted model.
    const source=result||p.evaluations.find(e=>e.days===30);
    const width=source?.multiplier??1.2815515655;
    const shift=clamp(Core.numeric(scoreDelta,0)/100*.12,-.12,.12)*years;
    const ratio=source?Math.min(1,h/source.steps):0,base=(source?.move||0)*ratio;
    const overlay=Evidence.movement(p.context,h,p.fit.sigma);
    const center=price*Math.exp(base+overlay+shift),spread=width*p.fit.sigma*Math.sqrt(h);
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
  function replay(daily,date,days,evidence={}){
    const rows=Core.normalizePoints(daily),origin=rows.findLastIndex(r=>r.time<=date);
    if(origin<119)return {ready:false,reason:"至少需要 120 条已结束日线作为训练与检验起点。"};
    const past=rows.slice(0,origin+1),p=profile(past,evidence),context=Evidence.context(evidence,rows[origin].time+"T15:30:00+08:00");
    p.context=context;const forecast=at(rows[origin].close,days,p),target=rows[origin+steps(days)],actual=target?.close;
    return {ready:true,origin:rows[origin].time,start:rows[origin].close,target:target?.time||null,...forecast,actual,
      error:actual?Math.abs(forecast.center/actual-1)*100:null,baselineError:actual?Math.abs(rows[origin].close/actual-1)*100:null,
      directionHit:actual?Math.sign(forecast.center-rows[origin].close)===Math.sign(actual-rows[origin].close):null,
      evidenceCount:context.active,trainCount:past.length};
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
  return {fit,profile,at,path,scenarioModel,replay,stress,riskSize};
});
