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
