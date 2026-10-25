const test=require('node:test'),assert=require('node:assert/strict'),E=require('../assets/evidence.js');
const now='2026-10-24T00:00:00Z',event={id:'a',title:'Federal Reserve lowered the target range for the federal funds rate',summary:'',source:'Fed',url:'https://example.test/fed',publishedAt:'2026-10-23T12:00:00Z',firstSeenAt:'2026-10-23T13:00:00Z'};
test('ambiguous inflation, risk, conditional decisions and negation do not become bullish events',()=>{
 for(const title of ['Inflation risks and lower operating costs','The committee may cut interest rates','The bank did not lower the target range','预计央行降息'])assert.equal(E.classifyNews({title}).score,0,title);
 assert.ok(E.classifyNews(event).score>0);assert.ok(E.classifyNews({title:'The committee raised the target range for the federal funds rate'}).score<0);
});
test('first-seen gating, cross-source title dedupe, decay and expiry control event influence',()=>{
 const a=E.context({news:[event]},now),duplicate=E.context({news:[event,{...event,source:'Other'}]},now);
 assert.equal(a.newsValue,duplicate.newsValue);assert.ok(a.newsValue>0);
 assert.equal(E.context({news:[{...event,firstSeenAt:'2026-10-25T00:00:00Z'}]},now).newsValue,0);
 assert.equal(E.context({news:[event]},'2026-11-01T00:00:00Z').newsValue,0);
 assert.ok(E.context({news:[event]},'2026-10-25T00:00:00Z').newsValue<a.newsValue);
});
test('revised news is visible only after that version was first observed',()=>{
 const updated={...event,versions:[{...event},{...event,title:'The committee raised the target range for the federal funds rate',firstSeenAt:'2026-10-25T00:00:00Z'}]};
 assert.ok(E.context({news:[updated]},now).newsValue>0);assert.ok(E.context({news:[updated]},'2026-10-25T01:00:00Z').newsValue<0);
});
test('market snapshots cannot backfill future observations or survive stale expiry; overlay stays bounded',()=>{
 const factor={id:'cny',signal:1,weight:1,observedAt:'2026-10-23T23:59:59Z',availableAt:now},data={snapshots:[{capturedAt:now,factors:[factor]}]};
 assert.equal(E.context(data,'2026-10-23T00:00:00Z').drivers.length,0);assert.equal(E.context(data,now).drivers.length,1);
 assert.equal(E.context(data,'2026-11-01T00:00:00Z').drivers.length,0);
 for(const h of [0,1,5,21,126,756])assert.ok(Math.abs(E.movement({score:100},h,10))<=.04);
});

test('monitor-only channels remain available to feature training without forcing a directional prior',()=>{
 const data={snapshots:[{capturedAt:now,factors:[{id:'oil',value:100,signal:1,weight:0,observedAt:'2026-10-23T00:00:00Z',availableAt:now}]}]};
 const c=E.context(data,now);assert.equal(c.drivers.length,0);assert.equal(c.observations.length,1);assert.equal(c.marketValue,0);
});
test('correlated rate indicators share a group budget instead of multiplying exposure',()=>{
 const f={signal:1,weight:1,observedAt:'2026-10-23T00:00:00Z',availableAt:now,group:'rates'};
 const a=E.context({snapshots:[{capturedAt:now,factors:[{...f,id:'realRates'}]}]},now),b=E.context({snapshots:[{capturedAt:now,factors:[{...f,id:'realRates'},{...f,id:'nominal2y'}]}]},now);assert.equal(a.marketValue,b.marketValue);
});
