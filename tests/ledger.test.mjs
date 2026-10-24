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
