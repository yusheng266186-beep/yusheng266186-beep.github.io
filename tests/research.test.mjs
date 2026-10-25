import test from 'node:test';import assert from 'node:assert/strict';import {parseEcb,parseTreasury,parseVix,mergeSnapshots,buildFactors} from '../scripts/research-utils.mjs';
test('official factor parsers reject missing values and preserve dated observations',()=>{
 const fx=parseEcb('<Cube time="2026-10-22"><Cube currency="USD" rate="1.2"/><Cube currency="CNY" rate="8.4"/></Cube>')[0];assert.equal(fx.date,'2026-10-22');assert.ok(Math.abs(fx.cny-7)<1e-12);assert.equal(fx.usd,1/1.2);
 assert.equal(parseTreasury('<m:properties><d:NEW_DATE>2026-10-22T00:00:00</d:NEW_DATE><d:TC_10YEAR>2.5</d:TC_10YEAR></m:properties>')[0].value,2.5);
 assert.equal(parseTreasury('<m:properties><d:NEW_DATE>2026-10-22</d:NEW_DATE></m:properties>').length,0);
 assert.equal(parseVix('DATE,OPEN,HIGH,LOW,CLOSE\n10/22/2026,1,2,1,20')[0].value,20);
});
test('partial source failures retain previous observations with original availability; stable values do not grow archive',()=>{
 const now='2026-10-24T00:00:00Z',factor={id:'cny',value:7,change:1,observedAt:'2026-10-22T23:59:59Z',availableAt:'2026-10-23T01:00:00Z'},old={snapshots:[{capturedAt:factor.availableAt,factors:[factor]}]};
 assert.equal(mergeSnapshots(old,[],[{ok:false}],now).snapshots.length,1);
 assert.equal(mergeSnapshots(old,[{...factor,availableAt:now}],[],now).snapshots.length,1);
 const out=mergeSnapshots(old,[{...factor,id:'risk',value:20}],[],now);assert.equal(out.snapshots.at(-1).factors.length,2);assert.equal(out.snapshots.at(-1).factors[0].availableAt,factor.availableAt);
 const future=buildFactors({id:'cboe',url:'https://cboe.test',rows:[{date:'2026-10-23',value:20},{date:'2099-01-01',value:30}]},now);assert.equal(future[0].change,0);
});
test('date-only market observations become usable when actually first collected, without waiting for midnight',()=>{
 const now='2026-10-23T14:15:00Z',f=buildFactors({id:'cboe',url:'https://cboe.test',rows:[{date:'2026-10-22',value:18},{date:'2026-10-23',value:20}]},now)[0];
 assert.equal(f.availableAt,now);assert.equal(f.timePrecision,'date-only');assert.ok(Date.parse(f.observedAt)<Date.parse(now));
});

test('new official channels distinguish dates, contracts and missing values',async()=>{
 const {parseNominal,parseOil,parsePositioning,inflationFactor}=await import('../scripts/research-utils.mjs');
 const nominal=parseNominal('<m:properties><d:NEW_DATE>2026-10-22</d:NEW_DATE><d:BC_2YEAR>3.5</d:BC_2YEAR><d:BC_10YEAR>4</d:BC_10YEAR></m:properties>');assert.equal(nominal[0].two,3.5);
 assert.equal(parseNominal('<m:properties><d:NEW_DATE>2026-10-22</d:NEW_DATE><d:BC_10YEAR>4</d:BC_10YEAR></m:properties>').length,0);
 assert.deepEqual(parseOil('observation_date,DCOILWTICO\n2026-10-20,100\n2026-10-21,\n2026-10-22,.'),[{date:'2026-10-20',value:100}]);
 const row='"GOLD - COMMODITY EXCHANGE INC.",261020,2026-10-20,088691,CMX,01,088,400000,100,100,100,100,100,120000,20000';const parsed=parsePositioning(row);assert.equal(parsed[0].value,.25);assert.equal(parsePositioning(row.replace('"GOLD -','"MICRO GOLD -')).length,0);
 assert.equal(inflationFactor({rows:nominal,url:'official'},{rows:[{date:'2026-10-21',value:2}]},'2026-10-24T00:00:00Z').length,0);
});
test('a different channel refresh does not rewrite first availability of unchanged values',()=>{
 const at='2026-10-23T00:00:00Z',f={id:'cny',value:7,change:1,observedAt:at,availableAt:at},old={snapshots:[{capturedAt:at,factors:[f]}]};
 const changed={id:'risk',value:22,change:2,observedAt:at,availableAt:'2026-10-24T00:00:00Z'},out=mergeSnapshots(old,[{...f,availableAt:changed.availableAt},changed],[],changed.availableAt);
 assert.equal(out.snapshots.at(-1).factors.find(x=>x.id==='cny').availableAt,at);
});
