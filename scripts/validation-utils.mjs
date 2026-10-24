export const mean=xs=>xs.reduce((s,x)=>s+x,0)/xs.length;
export function nonOverlap(records){let target='';return records.filter(r=>{if(r.origin<target)return false;target=r.target;return true;});}
export function phaseFor(origin,target,splits){return Object.keys(splits).find(k=>origin>=splits[k].start&&target<=splits[k].end)||null;}
export function metrics(records){if(!records.length)return {count:0};return {count:records.length,mape:mean(records.map(r=>r.error)),rmse:Math.sqrt(mean(records.map(r=>r.pctError**2))),bias:mean(records.map(r=>r.pctError)),
 naiveMape:mean(records.map(r=>r.naiveError)),direction:100*mean(records.map(r=>+r.directionHit)),coverage:100*mean(records.map(r=>+r.hit)),
 intervalScore:mean(records.map(r=>(r.high-r.low+10*Math.max(0,r.low-r.actual)+10*Math.max(0,r.actual-r.high))/r.actual*100))};}
export function summarize(records){const independent=nonOverlap(records);return {primary:metrics(independent),diagnostic:metrics(records),regimes:Object.fromEntries(['rising','falling','sideways'].map(k=>[k,metrics(independent.filter(r=>r.regime===k))])),years:Object.fromEntries([...new Set(independent.map(r=>r.origin.slice(0,4)))].map(y=>[y,metrics(independent.filter(r=>r.origin.startsWith(y)))]))};}
export function compare(a,b,improvement,g){const reasons=[];
 if(a.primary.count<g.minNonOverlappingPerPhase||b.primary.count<g.minNonOverlappingPerPhase)reasons.push('insufficient-independent-targets');
 if(!(a.primary.mape<=b.primary.mape*(1-improvement)))reasons.push('no-predeclared-mape-gain');
 if(!(a.primary.rmse<=b.primary.rmse*g.maxRmseRatio))reasons.push('rmse-regression');
 if(!(a.primary.direction-b.primary.direction>=g.minDirectionDelta))reasons.push('direction-regression');
 for(const k of ['rising','falling','sideways'])if(a.regimes[k].count>=g.minRegimeCount&&a.regimes[k].mape>b.regimes[k].mape*g.maxRegimeMapeRatio)reasons.push('regime-regression:'+k);
 return {pass:!reasons.length,reasons};}
