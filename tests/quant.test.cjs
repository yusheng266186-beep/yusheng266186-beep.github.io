const test=require('node:test'),assert=require('node:assert/strict'),Q=require('../assets/quant.js'),C=require('../assets/core.js');
function rows(count=440){let price=900;return Array.from({length:count},(_,i)=>{price*=Math.exp(.00035+Math.sin(i*1.71)*.009+Math.cos(i*.31)*.004);return {time:new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10),open:price,close:price,high:price+1,low:price-1};});}
const now=Date.now(),q={priceCnyGram:900,asOf:new Date(now).toISOString(),dataTier:'domestic-live'},cfg={maxPosition:100,stopLoss:4},input={side:'buy',grams:10,feePct:.035,spreadPct:.1};
test('walk-forward records use disjoint targets and are unchanged when future prices are appended',()=>{
 const first=Q.profile(rows(300)),later=Q.profile(rows(440));
 for(let j=0;j<2;j++){const a=first.evaluations[j].records,b=later.evaluations[j].records;assert.ok(a.length>0);assert.deepEqual(b.slice(0,a.length),a);for(let i=1;i<a.length;i++)assert.ok(a[i].origin>=a[i-1].target);assert.ok(a.every(r=>r.origin<r.target));}
 const changed=rows(440);for(let i=300;i<changed.length;i++)for(const k of ['open','high','low','close'])changed[i][k]*=10;
 assert.deepEqual(Q.profile(changed).evaluations[0].records.slice(0,first.evaluations[0].records.length),first.evaluations[0].records);
});
test('history audit reproduces actual errors and coverage rather than a target percentage',()=>{
 const e=Q.profile(rows()).evaluations[0];assert.ok(e.count>20);
 assert.equal(e.mae,e.records.reduce((s,r)=>s+Math.abs(r.center/r.actual-1)*100,0)/e.count);
 assert.equal(e.coverage,e.records.filter(r=>r.actual>=r.low&&r.actual<=r.high).length/e.count*100);
 assert.ok(e.coverage>=0&&e.coverage<=100);
});
test('insufficient samples never acquire a tested coverage and long horizons remain unverified',()=>{
 assert.equal(Q.profile(rows(29)).ready,false);
 const p=Q.profile(rows(100));assert.equal(p.evaluations[0].count,0);assert.ok(Number.isNaN(p.evaluations[0].coverage));
 const long=Q.profile(rows()).evaluations[4];assert.equal(long.count,0);assert.equal(long.multiplier,null);
});
test('scenario chart endpoints exactly match cards and manual shifts cannot change historical audit',()=>{
 const p=Q.profile(rows()),copy=JSON.stringify(p),m=Q.scenarioModel(900,p,0),manual=Q.scenarioModel(900,p,30);
 for(let i=0;i<m.points.length;i++){const f=m.points[i],path=Q.path(900,f.days,p,0);assert.deepEqual(path[0],{center:900,low:900,high:900});assert.deepEqual(path.at(-1),Q.at(900,f.days,p,0));assert.equal(f.low,path.at(-1).low);assert.ok(f.low<f.center&&f.center<f.high);assert.ok(manual.points[i].center>f.center);}
 assert.equal(JSON.stringify(p),copy);
});
test('EWMA responds to a recent volatility shock and constant prices remain finite',()=>{
 const quiet=rows(),shock=rows();for(let i=430;i<440;i++)for(const k of ['open','high','low','close'])shock[i][k]*=i%2?1.2:.8;
 assert.ok(Q.profile(shock).fit.sigma>Q.profile(quiet).fit.sigma);
 const flat=rows().map(r=>({...r,open:900,close:900,high:901,low:899}));assert.equal(Q.profile(flat).evaluations[0].model,'naive');assert.ok(Number.isFinite(Q.scenarioModel(900,Q.profile(flat),0).points[0].high));
});
test('stress marks the projected account, including spread and fees, without executing or mutating',()=>{
 const p=C.emptyPortfolio(),copy=JSON.stringify(p),o=C.order(p,q,cfg,input),r=Q.stress(p,q,cfg,input,10);
 assert.equal(r[1].equity,p.cash-o.total+10*900);assert.equal(r[0].equity,p.cash-o.total+10*810);assert.equal(r[2].equity,p.cash-o.total+10*990);
 assert.ok(r[1].delta<0);assert.equal(JSON.stringify(p),copy);
 const held=C.execute(p,q,cfg,input),sell={...input,side:'sell',grams:5};const stress=Q.stress(held,q,cfg,sell,10),sale=C.order(held,q,cfg,sell);
 assert.equal(stress[0].equity,held.cash+sale.total+5*810);assert.equal(Q.stress(p,q,cfg,{...input,grams:-1},5),null);
});
test('risk budget sizing includes round-trip costs and obeys cash and per-order limits',()=>{
 const p=C.emptyPortfolio(),s=Q.riskSize(p,q,cfg,input,.1);assert.ok(s.grams>0);assert.ok(s.estimatedLoss<=s.budgetCny);
 const o=C.order(p,q,cfg,{...input,grams:s.grams});assert.ok(o.valid);
 const extra=C.order(p,q,cfg,{...input,grams:s.grams+.01}),exit=C.order({...p,grams:s.grams+.01,avgCost:900},{...q,priceCnyGram:864},cfg,{...input,side:'sell',grams:s.grams+.01});
 assert.ok(extra.total-exit.total>s.budgetCny);
 const limited=Q.riskSize(p,q,{...cfg,maxPosition:1},input,5);assert.equal(limited.grams,C.orderCapacity(p,q,{...cfg,maxPosition:1},input));
 assert.equal(Q.riskSize(p,q,cfg,{...input,side:'sell'},1),null);assert.equal(Q.riskSize(p,q,cfg,input,6),null);
});
test('freshest valid quote wins regardless of response ordering and older fallbacks cannot roll it back',()=>{
 const older={...q,asOf:new Date(now-100000).toISOString(),source:'old',priceCnyGram:880},newer={...q,source:'new'};
 assert.equal(C.selectQuote([older,newer],null,now).quote.source,'new');assert.equal(C.selectQuote([newer,older],null,now).quote.source,'new');
 assert.equal(C.selectQuote([older],newer,now).retained,true);assert.equal(C.selectQuote([{...older,dataTier:'manual'}],null,now).quote,null);
 assert.equal(C.selectQuote([{...q,asOf:new Date(now+600000).toISOString()}],null,now).quote,null);
});
test('same-window source conflict blocks simulated orders, asynchronous comparisons do not',()=>{
 const other={...q,source:'second',priceCnyGram:950};const picked=C.selectQuote([q,other],null,now);
 assert.equal(picked.conflict,true);assert.equal(C.order(C.emptyPortfolio(),picked.quote,cfg,input,now).valid,false);
 assert.equal(C.selectQuote([q,{...other,asOf:new Date(now-3600000).toISOString()}],null,now).conflict,false);
 assert.equal(C.refreshDelay(60,3),480);assert.equal(C.refreshDelay(60,4),600);
});

test('unresolved source conflicts survive a single source refresh and a duplicate snapshot',()=>{
 const conflict={...q,source:'first',sourceUrl:'https://first.example/quote',sourceConflict:true};
 const single={...q,source:'first',sourceUrl:'https://first.example/quote',sourceConflict:false};
 assert.equal(C.selectQuote([single],conflict,now).conflict,true);
 assert.equal(C.selectQuote([single,{...single,dataTier:'snapshot'}],conflict,now).conflict,true);
 assert.equal(C.selectQuote([single,{...single,source:'second',sourceUrl:'https://second.example/quote'}],conflict,now).conflict,false);
 assert.equal(C.refreshDelay(3600,0),3600);assert.equal(C.refreshDelay(3600,4),3600);
});

test('provider availability is captured before display defaults, including legitimate zero activity',()=>{
 const missing=C.contractObserved({latest:900,previousClose:null,open:null,high:null,low:null,volume:null,turnover:null});
 assert.equal(missing.previous,false);assert.equal(missing.range,false);assert.equal(missing.volume,false);
 const normalized=C.normalizeQuote({...q,previousCnyGram:900,openCnyGram:900,highCnyGram:900,lowCnyGram:900,volume:0,turnover:0,observed:missing});
 assert.equal(normalized.observed.change,false);assert.equal(normalized.observed.volume,false);
 const zero=C.contractObserved({latest:900,volume:0,turnover:0,changePct:0});assert.equal(zero.volume,true);assert.equal(zero.change,true);
});

test('new simulated fills preserve the source price and exact fee/spread assumptions',()=>{
 const p=C.execute(C.emptyPortfolio(),{...q,source:'quote fixture'},cfg,input,now);
 assert.equal(p.trades[0].quoteSource,'quote fixture');assert.equal(p.trades[0].quotePriceCnyGram,900);
 assert.equal(p.trades[0].feePct,.035);assert.equal(p.trades[0].spreadPct,.1);
});
