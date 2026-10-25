import test from 'node:test';import assert from 'node:assert/strict';
import {runUpdateWindow,recoveryDecision,dataPaths} from '../scripts/update-service.mjs';
import {actionsApi} from '../scripts/actions-api.mjs';
test('finite windows publish immediately, keep five-minute cadence and hand off exactly once',async()=>{
 let clock=0,handoffs=0;const starts=[],next=[];
 const result=await runUpdateWindow({rounds:3,now:()=>clock,sleep:async ms=>{clock+=ms;},cycle:async p=>{starts.push(clock);next.push(p.nextAttemptAt);clock+=12000;return {status:'partial'};},handoff:async()=>{handoffs++;}});
 assert.deepEqual(starts,[0,300000,600000]);assert.equal(handoffs,1);assert.equal(result.length,3);assert.equal(next[0],new Date(300000).toISOString());
});
test('repeated failures get a finite restart, never a rapid successor loop',async()=>{
 let clock=0,calls=0,handoffs=0;const result=await runUpdateWindow({now:()=>clock,sleep:async ms=>{clock+=ms;},cycle:async()=>{calls++;throw Error('upstream unavailable');},handoff:async()=>{handoffs++;}});
 assert.equal(calls,2);assert.equal(clock,300000);assert.equal(handoffs,1);assert.ok(result.every(x=>!x.ok));
 clock=0;await runUpdateWindow({rounds:1,now:()=>clock,sleep:async ms=>{clock+=ms;},cycle:async()=>{throw Error('offline');},handoff:async()=>{}});assert.equal(clock,300000);
});
test('one-off repairs do not start the service; code updates hand off without running stale collectors',async()=>{
 let handed=0;await runUpdateWindow({rounds:1,continueService:false,cycle:async()=>({}),sleep:async()=>{},handoff:async()=>handed++});assert.equal(handed,0);
 const r=await runUpdateWindow({cycle:async()=>({restart:true}),sleep:async()=>{},handoff:async()=>handed++});assert.equal(r.length,1);assert.equal(handed,1);
 await assert.rejects(runUpdateWindow({rounds:100}),/Invalid update/);
});
test('watchdog separates closed-market prices from collection freshness and respects active windows',()=>{
 const now=Date.parse('2026-10-26T00:00:00Z'),fresh={generatedAt:new Date(now-60000).toISOString(),quote:{asOf:'2026-10-23T18:29:55Z'},status:'partial'};
 assert.equal(recoveryDecision({now,health:fresh}).recover,false);
 const stale={...fresh,generatedAt:new Date(now-3600000).toISOString()};assert.equal(recoveryDecision({now,health:stale}).recover,true);
 const run={id:9,head_branch:'main',status:'in_progress',created_at:new Date(now-60000).toISOString()};assert.equal(recoveryDecision({now,health:stale,runs:[run]}).recover,false);
 const stuck={...run,created_at:new Date(now-30*60000).toISOString()};assert.deepEqual(recoveryDecision({now,health:stale,runs:[stuck]}).cancel,[9]);
 assert.deepEqual(recoveryDecision({now,health:stale,runs:[{...stuck,status:'queued'}]}).cancel,[9]);
 assert.equal(recoveryDecision({now,health:fresh,force:true}).recover,true);assert.equal(recoveryDecision({now,health:fresh,failedEvent:true}).recover,true);
 assert.equal(recoveryDecision({now,health:{}}).recover,true);
});
test('publication path list excludes temporary, nested and unrelated files',()=>assert.deepEqual(dataPaths(['news.json','embedded-data.js','analysis-ai-usage.json','news.json.tmp','../index.html','.env','x/y.json']),['data/news.json','data/embedded-data.js','data/analysis-ai-usage.json']));
test('Actions dispatch retries transient failures but not authorization errors; tokens never enter errors',async()=>{
 const oldRepo=process.env.GITHUB_REPOSITORY,oldToken=process.env.GH_TOKEN;process.env.GITHUB_REPOSITORY='owner/repo';process.env.GH_TOKEN='isolated-test-token';
 try{let calls=0;await actionsApi('actions/workflows/pages.yml/dispatches',{method:'POST',body:{ref:'main'},sleep:async()=>{},fetchImpl:async(_url,options)=>{calls++;assert.equal(JSON.parse(options.body).ref,'main');return calls===1?{ok:false,status:503}:{ok:true,status:204};}});assert.equal(calls,2);
  calls=0;await assert.rejects(actionsApi('x',{sleep:async()=>{},fetchImpl:async()=>{calls++;return {ok:false,status:403};}}),error=>error.message==='GitHub Actions API HTTP 403'&&!error.message.includes(process.env.GH_TOKEN));assert.equal(calls,1);
 }finally{if(oldRepo===undefined)delete process.env.GITHUB_REPOSITORY;else process.env.GITHUB_REPOSITORY=oldRepo;if(oldToken===undefined)delete process.env.GH_TOKEN;else process.env.GH_TOKEN=oldToken;}
});
