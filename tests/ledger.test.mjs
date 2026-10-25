import test from 'node:test';import assert from 'node:assert/strict';import {updateLedger} from '../scripts/ledger-utils.mjs';
const daily=Array.from({length:20},(_,i)=>({time:`2026-10-${String(i+1).padStart(2,'0')}`,close:100+i,observedAt:`2026-10-${String(i+1).padStart(2,'0')}T08:00:00Z`})),forecasts=[{days:7,center:110,low:95,high:120}],input={daily:daily.slice(0,10),forecasts,now:'2026-10-10T09:00:00Z',version:'test',methodHash:'hash',inputHash:'inputs',historyAsOf:'2026-10-10T08:00:00Z'};
test('daily published forecasts freeze version, inputs and predictions rather than recalculating them',()=>{
 const first=updateLedger({},input),next=updateLedger(first,{...input,forecasts:[{...forecasts[0],center:999}],now:'2026-10-10T10:00:00Z'});
 assert.equal(next.entries.length,1);assert.deepEqual(next.entries[0],first.entries[0]);assert.equal(first.entries[0].forecasts[0].center,110);
});
test('results appear only after a closed future target and are not rewritten by later price revisions',()=>{
 const first=updateLedger({},input),copy=JSON.stringify(first),out=updateLedger(first,{...input,daily,forecasts:[],now:'2026-10-20T09:00:00Z'});
 const result=out.entries[0].forecasts[0].result;assert.equal(result.target,'2026-10-15');assert.equal(result.actual,114);assert.equal(JSON.stringify(first),copy);
 const revised=daily.map(r=>({...r,close:r.close*2})),again=updateLedger(out,{...input,daily:revised,forecasts:[],now:'2026-10-21T09:00:00Z'});
 assert.deepEqual(again.entries[0].forecasts[0].result,result);
 const tooEarly=updateLedger(first,{...input,daily:daily.slice(0,14),forecasts:[],now:'2026-10-14T09:00:00Z'});assert.equal(tooEarly.entries[0].forecasts[0].result,undefined);
});
test('interface releases share algorithm outcomes while a changed algorithm starts a distinct immutable forecast',()=>{
 const first=updateLedger({},input),later=updateLedger(first,{...input,version:'new-interface',forecasts:[{...forecasts[0],center:999}]});
 assert.equal(later.entries.length,1);assert.deepEqual(later.entries[0],first.entries[0]);assert.equal(later.methodHash,'hash');assert.equal(later.version,'new-interface');
 const changed=updateLedger(later,{...input,version:'new-interface',methodHash:'changed-algorithm'});assert.equal(changed.entries.length,2);assert.notEqual(changed.entries[0].id,changed.entries[1].id);assert.deepEqual(changed.entries[0],first.entries[0]);
});

test('shadow forecasts freeze independently and mature without changing original predictions',()=>{
 const daily=Array.from({length:12},(_,i)=>({time:'2026-10-'+String(i+1).padStart(2,'0'),close:100+i,observedAt:'2026-10-20T00:00:00Z'}));
 const firstDaily=daily.slice(0,3),forecasts=[{days:7,center:103,low:90,high:120}],shadowForecasts=[{model:'adaptive',days:7,center:104,low:91,high:121}];
 const first=updateLedger({entries:[]},{daily:firstDaily,forecasts,shadowForecasts,now:'2026-10-03T16:00:00+08:00',version:'v',methodHash:'shadow-test',inputHash:'a',historyAsOf:'2026-10-03T16:00:00+08:00'});
 const result=updateLedger(first,{daily,forecasts:[],shadowForecasts:[],now:'2026-10-21T00:00:00Z',version:'v',methodHash:'shadow-test',inputHash:'b',historyAsOf:'2026-10-20T00:00:00Z'});
 assert.equal(first.entries[0].shadowForecasts[0].result,undefined);assert.equal(result.entries[0].shadowForecasts[0].center,104);assert.equal(result.entries[0].shadowForecasts[0].result.actual,107);assert.equal(result.entries[0].forecasts[0].center,103);
});

test('published probabilities and quantiles remain frozen and acquire proper scores only after maturity',()=>{const shadowForecasts=[{...forecasts[0],model:'system-price',up:.7,quantiles:[{level:.1,value:95},{level:.5,value:110},{level:.9,value:120}],calibrationCount:30,regime:'trend',mode:'strict'}],a=updateLedger({entries:[]},{...input,shadowForecasts}),later=updateLedger(a,{...input,daily,now:'2026-10-21T00:00:00Z',historyAsOf:'2026-10-20T00:00:00Z',shadowForecasts:[{...shadowForecasts[0],up:.2}]});const f=later.entries[0].shadowForecasts[0];assert.equal(f.up,.7);assert.ok(Math.abs(f.result.brier-.09)<1e-12);assert.ok(f.result.pinball>=0);assert.deepEqual(f.quantiles,shadowForecasts[0].quantiles);});
