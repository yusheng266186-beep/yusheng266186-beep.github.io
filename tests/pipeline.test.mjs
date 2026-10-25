import test from 'node:test';import assert from 'node:assert/strict';
import {fetchText} from '../scripts/fetch-utils.mjs';import {historyDue,buildHealth} from '../scripts/pipeline-utils.mjs';
test('transient transport and server failures retry; forbidden sources do not loop',async()=>{
 let count=0;const text=await fetchText('https://example.test',{fetchImpl:async()=>++count<3?{ok:false,status:503}:{ok:true,text:async()=>'fresh'},sleep:async()=>{}});assert.equal(text,'fresh');assert.equal(count,3);
 count=0;await assert.rejects(fetchText('https://example.test',{fetchImpl:async()=>{count++;return {ok:false,status:403};},sleep:async()=>{}}),/403/);assert.equal(count,1);
 count=0;await assert.rejects(fetchText('https://example.test',{fetchImpl:async()=>{count++;throw Error('offline');},sleep:async()=>{}}),/offline/);assert.equal(count,3);
});
test('history capture notices a missing close after the exchange day and avoids rapid retry loops',()=>{
 const before='2026-10-23T07:00:00Z',after='2026-10-23T08:10:00Z',history={generatedAt:'2026-10-23T06:00:00Z',daily:[{time:'2026-10-22'}]};
 assert.equal(historyDue(history,{},before),false);assert.equal(historyDue(history,{},after),true);
 assert.equal(historyDue(history,{stages:{history:{checkedAt:'2026-10-23T08:00:00Z'}}},after),false);
 assert.equal(historyDue(history,{},before,true),true);assert.equal(historyDue(history,{},'2026-10-24T02:00:00Z'),true);
});
test('collector receipt exposes total and partial outages, preserving success times and failure streaks',()=>{
 const now='2026-10-24T02:00:00Z',old={stages:{news:{lastSuccessAt:'2026-10-23T20:00:00Z',failureStreak:1}}},input={news:{sourceStatus:[{ok:true},{ok:false}],items:[]},research:{status:[{ok:true}]},history:{daily:[{time:'2026-10-23'}]}};
 const failed=['news','factors','quote'].map(key=>({key,status:'failed',checkedAt:now}));const health=buildHealth(old,failed,now,input);assert.equal(health.status,'failed');assert.equal(health.stages.news.failureStreak,2);assert.equal(health.stages.news.lastSuccessAt,old.stages.news.lastSuccessAt);
 const partial=buildHealth(old,failed.map(x=>x.key==='quote'?{...x,status:'ok'}:x),now,input);assert.equal(partial.status,'partial');assert.equal(partial.news.available,1);assert.equal(partial.news.total,2);
 const recovered=buildHealth(health,failed.map(x=>({...x,status:'ok'})),now,{...input,news:{sourceStatus:[{ok:true},{ok:true}],items:[]}});assert.equal(recovered.status,'ok');assert.equal(recovered.stages.news.failureStreak,0);assert.equal(recovered.stages.news.lastSuccessAt,now);
});
test('a successful script cannot hide failed channels; quote checks and market times stay separate',()=>{
 const now='2026-10-25T16:00:00Z',asOf='2026-10-23T18:29:55Z',attempts=['news','factors','quote'].map(key=>({key,status:'ok',checkedAt:now}));
 const h=buildHealth({},attempts,now,{market:{asOf,checkedAt:now,sourceHealth:[{ok:true},{ok:false}]},news:{sourceStatus:[{ok:false}]},research:{status:[{ok:true}]}});
 assert.equal(h.status,'partial');assert.deepEqual(h.issues,['news-sources','quote-sources']);assert.equal(h.quote.asOf,asOf);assert.equal(h.quote.checkedAt,now);assert.equal(h.quote.available,1);
});
