import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {summarize,phaseFor} from './validation-utils.mjs';
const base='docs/validation/4.5.0/',json=async name=>JSON.parse(await readFile(base+name,'utf8'));
const [plan,development,selection,holdout,diagnostic]=await Promise.all(['plan.json','development.json','selection.json','holdout.json','diagnostic.json'].map(json));
if(holdout.selectionHash!==createHash('sha256').update(JSON.stringify(selection)).digest('hex'))throw Error('Selection seal mismatch');
if(selection.planHash!==createHash('sha256').update(JSON.stringify(plan)).digest('hex'))throw Error('Plan seal mismatch');
const frozen=await json('frozen-history.json');if(plan.dataHash!==createHash('sha256').update(JSON.stringify(frozen)).digest('hex'))throw Error('Data seal mismatch');
const methodHash=createHash('sha256').update((await Promise.all(['assets/core.js','assets/quant.js','assets/evidence.js'].map(p=>readFile(p)))).map(b=>b.toString()).join('\n')).digest('hex');
const report={schema:1,id:'chronological-2026-10-24',generatedAt:diagnostic.createdAt,baseline:'4.4.1',methodHash,decision:'retain',dataHash:plan.dataHash,
 data:{count:plan.count,first:plan.first,last:plan.last},cutoffs:new Set(diagnostic.records.map(r=>r.origin)).size,forecasts:diagnostic.records.length,
 planHash:selection.planHash,selectionHash:holdout.selectionHash,archive:base,gate:plan.gate,
 phases:Object.fromEntries(Object.entries(plan.splits).map(([key,s])=>[key,{first:frozen[s.start].time,last:frozen[s.end].time}])),
 rules:plan.rules,intervalPolicy:'Coverage and interval scores include initial volatility bands before eight resolved calibration blocks. These are historical diagnostics, not calibrated future probabilities.',candidates:plan.candidates,horizons:plan.horizons.map(days=>{
  const result=holdout.results.find(r=>r.days===days),all=diagnostic.records.filter(r=>r.days===days);
  return {days,label:({'7':'1 周','30':'1 个月','180':'6 个月','365':'1 年','1095':'3 年'})[days],selected:result.selected,accepted:result.accepted,
   phases:{...development.summaries.current[days],holdout:result.current},all:summarize(all),
   trials:result.trials.map(t=>({...t,developmentMetrics:development.summaries[t.id][days].development.primary,validationMetrics:development.summaries[t.id][days].validation.primary})),
   records:all.map(r=>({...r,intervalCalibrated:Math.floor((r.originIndex-119)/r.steps)>=8,phase:phaseFor(r.originIndex,r.originIndex+r.steps,plan.splits)||'cross-boundary'}))};
 })};
// No new model was adopted; do not silently relabel a changed kernel as this experiment.
for(const name of ['core.js','quant.js','evidence.js'])if(!Buffer.from(await readFile('assets/'+name)).equals(await readFile(base+'kernel/'+name)))throw Error('Forecast kernel differs from tested champion: '+name);
await writeFile('data/model-validation.json',JSON.stringify(report)+'\n');console.log(JSON.stringify({cutoffs:report.cutoffs,forecasts:report.forecasts,decision:report.decision,horizons:report.horizons.map(h=>({days:h.days,independent:h.all.primary.count,tail:h.phases.holdout.primary}))},null,2));
