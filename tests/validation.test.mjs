import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import Quant from '../assets/quant.js';
import {phaseFor,nonOverlap,metrics,compare,summarize} from '../scripts/validation-utils.mjs';
const root=new URL('../docs/validation/4.5.0/',import.meta.url),read=name=>JSON.parse(fs.readFileSync(new URL(name,root),'utf8'));
test('chronological validation purges labels crossing a split and does not count overlapping targets twice',()=>{
 const splits={development:{start:100,end:200},validation:{start:201,end:300}};
 assert.equal(phaseFor(180,201,splits),null);assert.equal(phaseFor(201,220,splits),'validation');assert.equal(phaseFor(99,120,splits),null);
 assert.deepEqual(nonOverlap([{origin:'2020-01-01',target:'2020-02-01'},{origin:'2020-01-20',target:'2020-02-20'},{origin:'2020-02-01',target:'2020-03-01'}]).map(r=>r.origin),['2020-01-01','2020-02-01']);
});
test('reported metrics and candidate gates reproduce sealed records, including rejected improvements',()=>{
 const d=read('development.json'),p=read('plan.json'),s=read('selection.json');
 for(const h of s.horizons)for(const trial of h.trials)for(const phase of ['development','validation']){
  assert.deepEqual(summarize(d.records.filter(r=>r.candidate===trial.id&&r.days===h.days&&r.phase===phase)),d.summaries[trial.id][h.days][phase]);
  assert.deepEqual(compare(d.summaries[trial.id][h.days][phase],d.summaries.current[h.days][phase],p.gate[phase+'Improvement'],p.gate),trial[phase]);
 }
 const m=metrics([{error:2,pctError:-2,naiveError:3,directionHit:true,hit:false,low:90,high:95,actual:100}]);assert.equal(m.mape,2);assert.equal(m.rmse,2);assert.equal(m.bias,-2);assert.ok(Math.abs(m.intervalScore-55)<1e-10);
});
test('changing all prices after several historical origins cannot change their predictions, across short and long horizons',()=>{
 const rows=read('frozen-history.json'),report=JSON.parse(fs.readFileSync(new URL('../data/model-validation.json',import.meta.url),'utf8'));
 for(const i of [315,840,1491]){
  const future=rows.map((r,j)=>j>i?{...r,open:r.open*1.8,high:r.high*1.8,low:r.low*1.8,close:r.close*1.8}:r);
  for(const days of [7,30,180,365,1095]){
   const a=Quant.replay(rows,rows[i].time,days),b=Quant.replay(future,rows[i].time,days);for(const key of ['center','low','high','evidenceCount','trainCount'])assert.equal(a[key],b[key]);
   const archived=report.horizons.find(h=>h.days===days).records.find(r=>r.originIndex===i);if(archived)for(const key of ['center','low','high','actual'])assert.equal(a[key],archived[key]);
  }
 }
});
