import test from 'node:test';import assert from 'node:assert/strict';import {collectQuotes} from '../scripts/quote-collector.mjs';
const now=Date.parse('2026-10-23T08:00:00Z');
const quote=(source,offset=0,price=900,tier='domestic-live')=>({source,priceCnyGram:price,asOf:new Date(now+offset).toISOString(),dataTier:tier,delay:'fixture'});
test('all source requests start concurrently and selection uses timestamps, not response order',async()=>{
 let started=0,release;const gate=new Promise(r=>release=r);
 const provider=(q)=>async()=>{started++;if(started===3)release();await gate;return q;};
 const r=await collectQuotes({providers:[['first',provider(quote('first',-300000))],['second',provider(quote('second'))],['official',provider(quote('official',-600000,900,'official-delayed'))]],previous:null,now});
 assert.equal(started,3);assert.equal(r.quote.source,'second');assert.equal(r.sourceHealth.filter(s=>s.ok).length,3);assert.equal(r.quote.validation,undefined);
});
test('partial failures retain a healthy source and all failures reject instead of forging freshness',async()=>{
 const fail=async()=>{throw Error('provider offline');};
 const r=await collectQuotes({providers:[['bad',fail],['good',async()=>quote('good')]],now});assert.equal(r.quote.source,'good');assert.equal(r.sourceHealth[0].ok,false);
 await assert.rejects(collectQuotes({providers:[['bad',fail]],previous:quote('previous'),now}),/All domestic/);
 const expired=async()=>quote('expired',-97*3600000);await assert.rejects(collectQuotes({providers:[['expired',expired]],now}),/All domestic/);
});
test('same-window official comparison preserves its actual timestamp and conflicts do not replace a newer price',async()=>{
 const r=await collectQuotes({providers:[['public',async()=>quote('public')],['official',async()=>quote('official',-60000,850,'official-delayed')]],now});
 assert.equal(r.quote.source,'public');assert.equal(r.quote.priceCnyGram,900);assert.equal(r.quote.sourceConflict,true);assert.equal(r.quote.validation.officialAsOf,new Date(now-60000).toISOString());
});
test('old source responses never replace a newer saved snapshot',async()=>{
 const previous=quote('saved');const r=await collectQuotes({providers:[['older',async()=>quote('older',-600000)]],previous,now});
 assert.equal(r.retained,true);assert.equal(r.quote.asOf,previous.asOf);assert.equal(r.quote.source,'saved');
});
