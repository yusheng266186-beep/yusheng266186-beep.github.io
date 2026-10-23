const test=require('node:test'),assert=require('node:assert/strict'),C=require('../assets/core.js');
const now=Date.parse('2026-10-23T08:00:00Z');
const quote={priceCnyGram:900,previousCnyGram:890,openCnyGram:890,highCnyGram:910,lowCnyGram:880,asOf:'2026-10-23T07:45:00Z',dataTier:'domestic-live'};
const cfg={purity:1,productPremium:0,maxPosition:100};
const input={side:'buy',grams:1,feePct:.035,spreadPct:.1};
const daily=Array.from({length:100},(_,i)=>{let c=700+i*.5+Math.sin(i)*3;return {time:new Date(Date.UTC(2026,5,1+i)).toISOString().slice(0,10),open:c,close:c,low:c-2,high:c+2}});
test('a successful fetch cannot make stale market data live',()=>{assert.equal(C.quoteState({...quote,asOf:'2026-09-30T07:45:00Z',fetchedAt:new Date(now).toISOString()},now).key,'stale');assert.equal(C.normalizeQuote({priceCnyGram:900},now).asOf,null);assert.equal(C.ageHours('2026-12-01T00:00:00Z',now),Infinity)});
test('empty and malformed prices are not valid quotes',()=>{for(const p of [null,'',false,-2,'bad'])assert.equal(C.quoteState(C.normalizeQuote({priceCnyGram:p},now),now).key,'missing')});
test('missing FX time and asynchronous instruments disable premium comparison',()=>{const raw={...quote,usdCny:7.1,internationalReference:{priceUsdOz:4000,asOf:quote.asOf}};assert.ok(Number.isNaN(C.normalizeQuote(raw,now).domesticPremiumPct));raw.fxAsOf=quote.asOf;assert.ok(Number.isFinite(C.normalizeQuote(raw,now).domesticPremiumPct));raw.internationalReference.asOf='2026-10-21T00:00:00Z';assert.ok(Number.isNaN(C.normalizeQuote(raw,now).domesticPremiumPct))});
test('history rejects invalid OHLC and dates, sorts and deduplicates',()=>{let a=daily[0],b=daily[1];const out=C.normalizePoints([b,a,{...a,close:a.close+1},{...b,time:'2026-02-30'},{...b,time:'2026-10-21',high:0},{...b,time:'2026-10-22',close:null}]);assert.equal(out.length,2);assert.equal(out[0].close,a.close+1)});
test('same-day references leave recorded close values and window calculations unchanged',()=>{const h=[{time:'2026-10-22',open:890,close:890,high:900,low:880},{time:'2026-10-23',open:890,close:899,high:910,low:880}];const before=C.historyWindow(h,20);const reference=C.quoteReference(quote,h[1].time,now);assert.equal(reference.price,900);assert.equal(h[1].close,899);assert.deepEqual(C.historyWindow(h,20),before)});
test('scenario endpoints match cards and widen over time without invented confidence',()=>{const m=C.scenarioModel(900,daily,0);assert.equal(m.ready,true);for(const f of m.points){const p=C.scenarioAt(900,f.days,m.vol,m.drift);assert.equal(f.high,p.high);assert.ok(f.low>0);assert.ok(!('confidence' in f))}assert.ok(m.points[4].high/m.points[4].low>m.points[3].high/m.points[3].low);assert.deepEqual(C.scenarioAt(900,0,m.vol,m.drift),{center:900,low:900,high:900})});
test('insufficient history produces no forecast or fake volatility',()=>{assert.equal(C.scenarioModel(900,daily.slice(0,9),0).ready,false);assert.ok(Number.isNaN(C.volatility([])))});
test('historical practice needs explicit consent and keeps quote provenance',()=>{const q={...quote,asOf:'2026-09-30T07:45:00Z'};assert.throws(()=>C.execute(C.emptyPortfolio(),q,cfg,input,now),/行情时效/);const p=C.execute(C.emptyPortfolio(),q,cfg,{...input,historical:true},now);assert.equal(p.trades[0].quoteAsOf,q.asOf);assert.equal(p.trades[0].dataMode,'historical-practice')});
test('buy and sell cash flow includes actual cents fees and sell proceeds',()=>{let p=C.emptyPortfolio(),o=C.order(p,quote,cfg,input,now);assert.equal(o.fee,.32);assert.equal(o.total,900.77);p=C.execute(p,quote,cfg,input,now);assert.equal(p.cash,99099.23);assert.equal(p.avgCost,900.77);const sale=C.order(p,quote,cfg,{...input,side:'sell'},now);assert.equal(sale.total,899.24);p=C.execute(p,quote,cfg,{...input,side:'sell'},now+1);assert.equal(p.grams,0);assert.equal(p.avgCost,0);assert.equal(p.cash,99998.47);assert.equal(p.realized,-1.53);assert.equal(p.totalFees,.63)});
test('partial sale retains the remaining average cost',()=>{let p=C.execute(C.emptyPortfolio(),quote,cfg,{...input,grams:2},now);const cost=p.avgCost;p=C.execute(p,quote,cfg,{...input,side:'sell',grams:.5},now+1);assert.equal(p.grams,1.5);assert.equal(p.avgCost,cost)});
test('invalid sizes, excessive fees and overselling are rejected',()=>{for(const grams of [-1,0,Infinity,'bad',.001])assert.equal(C.order(C.emptyPortfolio(),quote,cfg,{...input,grams},now).valid,false);assert.equal(C.order(C.emptyPortfolio(),quote,cfg,{...input,feePct:-1},now).valid,false);assert.equal(C.order(C.emptyPortfolio(),quote,cfg,{...input,spreadPct:11},now).valid,false);assert.equal(C.order(C.emptyPortfolio(),quote,cfg,{...input,side:'sell'},now).valid,false)});
test('cash and per-order position limits include fees',()=>{assert.equal(C.order(C.emptyPortfolio(),quote,{...cfg,maxPosition:1},{...input,grams:2},now).valid,false);assert.equal(C.order({...C.emptyPortfolio(),cash:100},quote,cfg,input,now).valid,false)});
test('restored accounts validate holdings, records and scalar values',()=>{assert.deepEqual(C.validatePortfolio(C.emptyPortfolio()),C.emptyPortfolio());assert.throws(()=>C.validatePortfolio({...C.emptyPortfolio(),grams:1}),/成本/);assert.throws(()=>C.validatePortfolio({...C.emptyPortfolio(),cash:'not-money'}),/金额/);assert.throws(()=>C.validatePortfolio({...C.emptyPortfolio(),trades:[{}]}),/明细/)});
test('CSV export escapes formulas, quotes, and multiline notes',()=>{assert.equal(C.csvCell('=HYPERLINK("bad")'),'"\'=HYPERLINK(""bad"")"');assert.equal(C.csvCell('line\none'),'"line\none"');assert.equal(C.csvCell(-12),'"-12"')});
test('history windows measure observed closes and chronological drawdown without changing the source',()=>{
  const rows=[100,120,90,110].map((close,i)=>({time:'2026-10-'+(20+i),open:close,close,high:close+1,low:close-1}));
  const copy=JSON.stringify(rows),view=C.historyWindow(rows,4);
  assert.ok(Math.abs(view.changePct-10)<1e-10);assert.equal(view.maxDrawdownPct,25);
  assert.equal(view.minClose,90);assert.equal(view.maxClose,120);assert.equal(JSON.stringify(rows),copy);
  assert.equal(C.historyWindow(rows,2).maxDrawdownPct,0);assert.ok(Number.isNaN(C.historyWindow([],20).changePct));
  assert.ok(Number.isNaN(C.historyWindow(rows.slice(0,1),20).maxDrawdownPct));
});
test('a reference quote is separate from recorded closes and rejects manual, stale, or earlier inputs',()=>{
  const q={...quote,source:'test'};
  assert.equal(C.quoteReference(q,'2026-10-23',now).price,900);
  assert.equal(C.quoteReference({...q,dataTier:'manual'},'2026-10-23',now),null);
  assert.equal(C.quoteReference({...q,asOf:'2026-10-20T08:00:00Z'},'2026-10-23',now),null);
  assert.equal(C.quoteReference(q,'2026-10-24',now),null);
});
test('retail purity estimates cannot alter AU9999 order prices, account marking, or proceeds',()=>{
  const base=C.order(C.emptyPortfolio(),quote,cfg,input,now),retail={...cfg,purity:.75,productPremium:45};
  assert.equal(C.order(C.emptyPortfolio(),quote,retail,input,now).total,base.total);
  const p=C.execute(C.emptyPortfolio(),quote,retail,input,now);
  assert.equal(p.trades[0].instrument,'AU9999');assert.equal(C.portfolioStats(p,quote.priceCnyGram).marketValue,900);
  assert.equal(C.order(p,quote,retail,{...input,side:'sell'},now).total,C.order(p,quote,cfg,{...input,side:'sell'},now).total);
});
test('maximum quantities obey both cash and per-order limits after cent rounding',()=>{
  for(const price of [900,.11,1234.567]) {
    const q={...quote,priceCnyGram:price},c={...cfg,maxPosition:15},p=C.emptyPortfolio();
    const grams=C.orderCapacity(p,q,c,input),order=C.order(p,q,c,{...input,grams},now);
    assert.equal(order.valid,true);assert.equal(C.order(p,q,c,{...input,grams:grams+.01},now).valid,false);
  }
  assert.equal(C.orderCapacity({...C.emptyPortfolio(),grams:1.23},quote,cfg,{side:'sell'}),1.23);
  assert.equal(C.orderCapacity(C.emptyPortfolio(),quote,cfg,{...input,feePct:-1}),0);
});
test('unknown market fields stay unknown across normalization and legitimate zero volume remains observed',()=>{
  const q=C.normalizeQuote({priceCnyGram:900,asOf:quote.asOf},now),again=C.normalizeQuote(q,now);
  for(const key of ['previous','open','range','change','changeAmount','volume','turnover'])assert.equal(again.observed[key],false);
  assert.equal(C.normalizeQuote({...quote,volume:0},now).observed.volume,true);
});
