import test from 'node:test';import assert from 'node:assert/strict';import {collectQuotes,parseOfficialReference} from '../scripts/quote-collector.mjs';
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

test('official date-only pages never invent a quote clock or previous close',async()=>{
 const html='<h1>上海黄金交易所2026年10月23日延时行情</h1><table><tr><td>Au99.99</td><td>900</td><td>910</td><td>890</td><td>905</td></tr></table>';
 const reference=parseOfficialReference(html);assert.equal(reference.asOf,null);assert.equal(reference.previousCnyGram,null);assert.equal(reference.changePct,null);assert.equal(reference.timePrecision,'date-only');
 const r=await collectQuotes({providers:[['public',async()=>quote('public')],['official',async()=>reference]],now});
 assert.equal(r.quote.source,'public');assert.equal(r.quote.validation,undefined);assert.equal(r.references.length,1);assert.equal(r.sourceHealth[1].kind,'reference');
 await assert.rejects(collectQuotes({providers:[['official',async()=>reference]],previous:quote('saved'),now}),/All domestic/);
});
test('future and malformed official reference dates cannot become fallback quotes',async()=>{
 const reference={priceCnyGram:900,referenceDate:'2026-10-26',asOf:null,timePrecision:'date-only'};
 await assert.rejects(collectQuotes({providers:[['future',async()=>reference]],now}),/All domestic/);
 await assert.rejects(collectQuotes({providers:[['bad',async()=>({...reference,referenceDate:'2026-02-30'})]],now}),/All domestic/);
 assert.throws(()=>parseOfficialReference('<table></table>'),/no reference date/);
});

test('a reference for tomorrow is rejected even inside the quote clock tolerance',async()=>{
 const edge=Date.parse('2026-10-23T15:59:00Z'),reference={priceCnyGram:900,referenceDate:'2026-10-24',asOf:null,timePrecision:'date-only'};
 const r=await collectQuotes({providers:[['public',async()=>({...quote('public'),asOf:new Date(edge).toISOString()})],['future-day',async()=>reference]],now:edge});
 assert.equal(r.references.length,0);assert.equal(r.sourceHealth[1].ok,false);
});
