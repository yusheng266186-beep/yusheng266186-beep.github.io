import test from 'node:test';import assert from 'node:assert/strict';
import {drainResearchQueue} from '../scripts/research-queue.mjs';
import {RESEARCH_POLICY} from '../scripts/research-policy.mjs';
function fixture(count){
 const remaining=new Set(Array.from({length:count},(_,i)=>'N-'+i)),starts=[],sizes=[];let time=0;
 return {remaining,starts,sizes,options:{now:()=>time,
  buildInput:excluded=>({backlog:remaining.size,workIds:[...remaining].filter(id=>!excluded.includes(id)).slice(0,8)}),
  run:async input=>{starts.push(time);sizes.push(input.workIds.length);time+=1000;return {reviews:Object.fromEntries(input.workIds.map(id=>[id,{factor:{dimension:'none'}}]))};},
  onResult:async result=>Object.keys(result.reviews).forEach(id=>remaining.delete(id)),onError:async error=>{throw error;}
 }};
}
test('single news dispatches immediately and a large queue drains across consecutive calls without sleeps',async()=>{
 assert.equal(RESEARCH_POLICY.minimumIntervalMinutes,0);assert.equal(RESEARCH_POLICY.maxCallsPerDay,null);
 const one=fixture(1),single=await drainResearchQueue(one.options);assert.deepEqual(one.starts,[0]);assert.equal(single.completedItems,1);assert.equal(single.stopReason,'queue-empty');
 const many=fixture(25),result=await drainResearchQueue(many.options);assert.deepEqual(many.sizes,[8,8,8,1]);assert.deepEqual(many.starts,[0,1000,2000,3000]);assert.equal(many.remaining.size,0);assert.equal(result.callsMade,4);assert.equal(result.completedItems,25);
});
test('an unusable item is not retried forever and does not block other unattempted messages',async()=>{
 const f=fixture(10);f.options.run=async input=>({reviews:Object.fromEntries(input.workIds.filter(id=>id!=='N-0').map(id=>[id,{factor:{dimension:'none'}}]))});
 const result=await drainResearchQueue(f.options);assert.equal(result.callsMade,2);assert.equal(result.completedItems,9);assert.equal(result.stopReason,'unresolved-items');assert.deepEqual([...f.remaining],['N-0']);
});
test('provider failure retains pending work and stops the current loop instead of spinning',async()=>{
 const f=fixture(20);let errors=0;f.options.run=async()=>{throw Error('MODEL_HTTP_429');};f.options.onError=async error=>{errors++;assert.equal(error.message,'MODEL_HTTP_429');};
 const result=await drainResearchQueue(f.options);assert.equal(result.callsMade,1);assert.equal(errors,1);assert.equal(result.stopReason,'provider-error');assert.equal(f.remaining.size,20);
});
test('checkpointed progress survives finite runner handoff without imposing a call-count limit',async()=>{
 const f=fixture(20),result=await drainResearchQueue({...f.options,deadline:115500});
 assert.equal(result.callsMade,1);assert.equal(result.stopReason,'runtime-budget');assert.equal(f.remaining.size,12);
 const next=await drainResearchQueue(f.options);assert.equal(next.completedItems,12);assert.equal(f.remaining.size,0);
});
