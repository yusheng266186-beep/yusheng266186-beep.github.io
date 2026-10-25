/* AURUM research challenger: direct log returns, shallow boosting, past-resolved expert weights. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./core.js'),require('./evidence.js'),require('./quant.js'));else root.AurumAdaptive=factory(root.AurumCore,root.AurumEvidence,root.AurumQuant);})(typeof globalThis==='object'?globalThis:this,function(Core,Evidence,Legacy){
 'use strict';
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
 const horizons=[7,30,180,365,1095],steps=days=>Math.max(1,Math.round(days*252/365));
 const externalIds=['cny','usd','realRates','nominal2y','yieldCurve','inflation','risk','oil','positioning'];
 const labels=['1日收益','5日动量','20日动量','60日趋势','20日均线偏离','60日回撤','波动变化','日内区间','开收到收盘','量能变化','量能趋势','下跌日占比',...externalIds,...['policy','demand','risk','flows','liquidity','supply'].map(x=>'事件:'+x)];
 function vectors(rows,evidence){return rows.map((r,i)=>{
  if(i<60)return null;
  const price=r.close,ret=n=>Math.log(price/rows[i-n].close),tail=rows.slice(i-19,i+1),returns=rows.slice(i-59,i+1).map((p,j,a)=>j?Math.log(p.close/a[j-1].close):0).slice(1);
  const sigma=a=>Math.sqrt(avg(a.map(x=>x*x))),vol=sigma(returns),meanPrice=avg(tail.map(x=>x.close));
  const volume=tail.every(x=>x.volume>0&&x.volumeSource&&x.volumeSource===tail[0].volumeSource),vs=tail.map(x=>x.volume);
  const range=r.high>=r.low&&r.low>0?Math.log(r.high/r.low):null,body=r.open>0?Math.log(price/r.open):null;
  const context=Evidence.context(evidence,r.time+'T15:30:00+08:00'),drivers=context.observations||context.drivers,events=context.events||[];
  return [ret(1),ret(5),ret(20),ret(60),Math.log(price/meanPrice),Math.log(price/Math.max(...rows.slice(i-59,i+1).map(x=>x.close))),vol>1e-9?sigma(returns.slice(-10))/vol-1:0,range,body,
   volume?Math.log(vs.at(-1)/avg(vs)):null,volume?Math.log(avg(vs.slice(-5))/avg(vs)):null,returns.slice(-20).filter(x=>x<0).length/20-.5,
   ...externalIds.map(id=>{const f=drivers.find(f=>f.id===id);return f?f.featureValue??f.signal:null;}),
   ...['policy','demand','risk','flows','liquidity','supply'].map(dim=>events.length?clamp(events.filter(e=>e.dimension===dim).reduce((s,e)=>s+e.value,0),-1,1):null)];
 });}
 function solve(a,b){const m=a.map((r,i)=>r.concat(b[i])),n=b.length;
  for(let k=0;k<n;k++){let p=k;for(let i=k+1;i<n;i++)if(Math.abs(m[i][k])>Math.abs(m[p][k]))p=i;[m[k],m[p]]=[m[p],m[k]];if(Math.abs(m[k][k])<1e-12)return Array(n).fill(0);const d=m[k][k];for(let j=k;j<=n;j++)m[k][j]/=d;for(let i=0;i<n;i++)if(i!==k){const v=m[i][k];for(let j=k;j<=n;j++)m[i][j]-=v*m[k][j];}}
  return m.map(r=>r[n]);
 }
 function train(rows,xs,origin,h){
  const sigma=Legacy.fit(rows.slice(0,origin+1))?.sigma||1e-8,target=h,samples=[];
  for(let i=Math.max(60,origin-756);i+target<=origin;i++)samples.push({x:xs[i],y:Math.log(rows[i+target].close/rows[i].close),w:Math.exp(-Math.LN2*(origin-i-target)/252)});
  if(samples.length<80)return {ridge:0,boosted:0,count:samples.length,dimensions:[],contributions:[],externalTrained:0};
  // Unknown observations are mean-imputed after training-only statistics. Sparse channels cannot fit a coefficient.
  const cols=labels.map((_,j)=>j).filter(j=>samples.filter(r=>Number.isFinite(r.x[j])).length>=Math.max(60,samples.length*.6));
  const weight=samples.reduce((s,r)=>s+r.w,0),mu=cols.map(j=>{const a=samples.filter(r=>Number.isFinite(r.x[j]));return a.reduce((s,r)=>s+r.w*r.x[j],0)/a.reduce((s,r)=>s+r.w,0);});
  const sd=cols.map((j,k)=>{const a=samples.filter(r=>Number.isFinite(r.x[j]));return Math.max(1e-5,Math.sqrt(a.reduce((s,r)=>s+r.w*(r.x[j]-mu[k])**2,0)/a.reduce((s,r)=>s+r.w,0)));});
  const standard=x=>[1,...cols.map((j,k)=>Number.isFinite(x[j])?clamp((x[j]-mu[k])/sd[k],-4,4):0)],data=samples.map(r=>({...r,z:standard(r.x)}));
  const n=cols.length+1,a=Array.from({length:n},()=>Array(n).fill(0)),b=Array(n).fill(0);
  for(const r of data)for(let i=0;i<n;i++){b[i]+=r.w*r.z[i]*r.y;for(let j=0;j<n;j++)a[i][j]+=r.w*r.z[i]*r.z[j];}
  for(let j=0;j<n;j++)a[j][j]+=j?40:10;
  const beta=solve(a,b),z=standard(xs[origin]),dot=x=>x.reduce((s,v,j)=>s+v*beta[j],0),linear=dot(z),residuals=data.map(r=>r.y-dot(r.z));
  const contributions=[{label:'直接周期截距',move:beta[0]},...cols.map((j,k)=>({label:labels[j],move:z[k+1]*beta[k+1]}))];
  let correction=0;
  // Twelve depth-one residual trees, fixed shrinkage/minimum leaf weight; no holdout tuning.
  const splits=cols.flatMap((j,k)=>{const values=data.map(r=>r.z[k+1]).sort((a,b)=>a-b);return [.2,.4,.6,.8].map(q=>({j:k+1,threshold:values[Math.floor(q*(values.length-1))]}));});
  for(let round=0;round<12;round++){
   let best=null;
   for(const split of splits){let lw=0,rw=0,ls=0,rs=0;for(let i=0;i<data.length;i++){const r=data[i];if(r.z[split.j]<=split.threshold){lw+=r.w;ls+=r.w*residuals[i];}else{rw+=r.w;rs+=r.w*residuals[i];}}
    if(Math.min(lw,rw)<weight*.1)continue;
    const gain=ls*ls/(lw+20)+rs*rs/(rw+20);if(!best||gain>best.gain)best={...split,gain,left:ls/(lw+20),right:rs/(rw+20)};
   }
   if(!best||best.gain<1e-12)break;
   for(let i=0;i<data.length;i++)residuals[i]-=.1*(data[i].z[best.j]<=best.threshold?best.left:best.right);
   correction+=.1*(z[best.j]<=best.threshold?best.left:best.right);
  }
  const limit=Math.min(.5,Math.max(.005,2*sigma*Math.sqrt(h))),ridge=clamp(linear,-limit,limit),boosted=clamp(linear+correction,-limit,limit);
  return {ridge,boosted,count:samples.length,dimensions:cols.map(j=>labels[j]),externalTrained:cols.filter(j=>j>=12).length,
   contributions:contributions.concat({label:'浅层非线性修正',move:correction})};
 }
 function weights(resolved){const prior=[.4,.3,.3],recent=resolved.slice(-24);if(recent.length<8)return prior.slice();const loss=prior.map((_,j)=>avg(recent.map(r=>Math.min(5,Math.abs(r.actual-r.moves[j])/r.scale))));const min=Math.min(...loss),raw=prior.map((p,j)=>p*Math.exp(-3*(loss[j]-min))),total=raw.reduce((a,b)=>a+b,0);return raw.map(v=>v/total);}
 function calibration(errors){if(errors.length<8)return null;const a=errors.slice(-40).sort((a,b)=>a-b);return Math.max(.05,a[Math.min(a.length-1,Math.ceil((a.length+1)*.8)-1)]);}
 function profile(daily,evidence={},mode='adaptive'){
  const rows=Core.normalizePoints(daily),f=Legacy.fit(rows),xs=vectors(rows,evidence);
  const evaluations=horizons.map(days=>{
   const h=steps(days),resolved=[],records=[],errors=[];
   for(let i=119;i+h<rows.length;i+=h){const past=rows.slice(0,i+1),sf=Legacy.fit(past),trained=train(rows,xs,i,h),w=weights(resolved),moves=[0,trained.ridge,trained.boosted];
    const move=mode==='boosted'?trained.boosted:moves.reduce((s,m,j)=>s+m*w[j],0),start=rows[i].close,actual=rows[i+h].close,scale=Math.max(1e-8,sf.sigma*Math.sqrt(h));
    const ctx=Evidence.context(evidence,rows[i].time+'T15:30:00+08:00'),overlay=Evidence.movement(ctx,h,sf.sigma),center=start*Math.exp(move+overlay),width=calibration(errors);
    if(width!==null){const low=center*Math.exp(-width*scale),high=center*Math.exp(width*scale);records.push({origin:rows[i].time,target:rows[i+h].time,start,center,actual,low,high,error:Math.abs(center/actual-1)*100,naiveError:Math.abs(start/actual-1)*100,hit:actual>=low&&actual<=high,directionHit:Math.sign(center-start)===Math.sign(actual-start),evidenceCount:ctx.active,weights:w,trainCount:trained.count});}
    errors.push(Math.abs(Math.log(actual/center))/scale);resolved.push({moves,actual:Math.log(actual/start),scale});
   }
   const last=rows.length-1,trained=last>=60?train(rows,xs,last,h):{ridge:0,boosted:0,count:0,dimensions:[],contributions:[],externalTrained:0},w=weights(resolved),moves=[0,trained.ridge,trained.boosted],move=mode==='boosted'?trained.boosted:moves.reduce((s,m,j)=>s+m*w[j],0),recent=records.slice(-20);
   return {days,steps:h,model:mode==='boosted'?'direct-boosted':'adaptive-ensemble',move,weights:w,trainCount:trained.count,dimensions:trained.dimensions,externalTrained:trained.externalTrained,contributions:trained.contributions,
    multiplier:calibration(errors),calibrationCount:Math.min(40,errors.length),count:records.length,mae:records.length?avg(records.map(r=>r.error)):NaN,naiveMae:records.length?avg(records.map(r=>r.naiveError)):NaN,direction:records.length?100*avg(records.map(r=>+r.directionHit)):NaN,coverage:records.length?100*avg(records.map(r=>+r.hit)):NaN,augmentedCount:records.filter(r=>r.evidenceCount>0).length,
    recentCount:recent.length,recentMae:recent.length?avg(recent.map(r=>r.error)):NaN,recentNaiveMae:recent.length?avg(recent.map(r=>r.naiveError)):NaN,records};
  });
  return {ready:!!f,count:rows.length,asOf:rows.at(-1)?.time,fit:f,evidence,evaluations};
 }
 return {profile,train,vectors,weights,labels,horizons};
});
