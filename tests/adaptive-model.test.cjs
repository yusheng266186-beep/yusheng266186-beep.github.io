const test=require('node:test'),assert=require('node:assert/strict'),A=require('../assets/adaptive-model.js'),R=require('../assets/research-engine.js'),L=require('../assets/quant.js');
function rows(n=360){let p=500;return Array.from({length:n},(_,i)=>{p*=Math.exp(.0006+Math.sin(i*1.7)*.009);return{time:new Date(Date.UTC(2024,0,i+1)).toISOString().slice(0,10),open:p*.999,high:p*1.006,low:p*.995,close:p,volume:100+20*Math.sin(i),volumeSource:'same-provider'};});}
test('challenger forecasts at past cutoffs survive future price perturbations',()=>{
 const data=rows(360),date=data[260].time,changed=data.map((r,i)=>i>260?{...r,open:r.open*9,high:r.high*9,low:r.low*9,close:r.close*9,volume:r.volume*4}:r);
 for(const days of [7,30,180,365,1095])for(const model of ['adaptive','boosted']){const a=R.replay(data,date,days,{},model),b=R.replay(changed,date,days,{},model);assert.equal(a.center,b.center);assert.equal(a.low,b.low);assert.equal(a.high,b.high);}
});
test('adaptive audit origins reproduce exactly through the separate replay path',()=>{
 const data=rows(400),p=A.profile(data);
 for(const e of p.evaluations.slice(0,2))for(const record of e.records.slice(-2)){const r=R.replay(data,record.origin,e.days,{},'adaptive');assert.ok(Math.abs(r.center-record.center)<1e-8);assert.ok(Math.abs(r.low-record.low)<1e-8);assert.ok(Math.abs(r.high-record.high)<1e-8);}
});
test('unknown, late and sparse external factors cannot acquire fitted coefficients',()=>{
 const data=rows(300),date=data[260].time,factor={id:'oil',signal:1,weight:0,value:100,observedAt:date+'T00:00:00Z',availableAt:'2099-01-01T00:00:00Z'},evidence={snapshots:[{capturedAt:factor.availableAt,factors:[factor]}]};
 const a=A.profile(data),b=A.profile(data,evidence);assert.deepEqual(a.evaluations.map(e=>e.move),b.evaluations.map(e=>e.move));assert.ok(b.evaluations.every(e=>e.externalTrained===0));
 assert.equal(A.vectors(data,evidence)[260][19],null);
});
test('expert weights use only resolved losses, remain finite and keep a persistence expert',()=>{
 assert.deepEqual(A.weights([]),[.4,.3,.3]);const resolved=Array.from({length:15},()=>({actual:0,moves:[0,.4,.8],scale:.02})),w=A.weights(resolved);assert.ok(w[0]>w[1]);assert.ok(w.every(v=>v>0&&Number.isFinite(v)));assert.ok(Math.abs(w.reduce((s,v)=>s+v,0)-1)<1e-12);
});
test('shadow profiles never replace the deployed forecast and flat prices stay flat',()=>{
 const data=rows(300),p=R.profile(data),legacy=L.profile(data);assert.deepEqual(p.evaluations,legacy.evaluations);assert.ok(p.research);
 const flat=data.map(r=>({...r,open:500,high:500,low:500,close:500,volume:100}));assert.ok(A.profile(flat).evaluations.every(e=>e.move===0));
 const endpoint=L.at(data.at(-1).close,30,p.research);assert.deepEqual(endpoint,L.path(data.at(-1).close,30,p.research).at(-1));
});
