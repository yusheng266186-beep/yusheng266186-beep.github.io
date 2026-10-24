import test from 'node:test';import assert from 'node:assert/strict';import {mergeFeedResults} from '../scripts/news-utils.mjs';
const now='2026-10-23T10:00:00Z',old={source:'A',url:'https://a.test/old',title:'old',publishedAt:'2026-10-20T00:00:00Z'},fresh={source:'B',url:'https://b.test/new',title:'new',publishedAt:'2026-10-23T00:00:00Z'};
test('a failed feed retains its previous stories while healthy feeds update',()=>{const out=mergeFeedResults({items:[old]},[{status:'rejected'},{status:'fulfilled',value:[fresh]}],['A','B'],now);assert.equal(out.items.length,2);assert.deepEqual(out.failedSources,['A']);assert.equal(out.items[0].title,'new')});
test('total outage fails without producing an empty replacement',()=>assert.throws(()=>mergeFeedResults({items:[old]},[{status:'rejected'},{status:'fulfilled',value:[]}],['A','B'],now),/All official feeds failed/));
test('undated or future articles cannot be presented as current news',()=>assert.throws(()=>mergeFeedResults({},[{status:'fulfilled',value:[{...fresh,publishedAt:null},{...fresh,publishedAt:'2027-01-01'}]}],['B'],now),/All official feeds failed/));
test('revisions preserve first-seen versions instead of rewriting past content',()=>{
 const first=mergeFeedResults({},[{status:'fulfilled',value:[fresh]}],['B'],now);
 const later=mergeFeedResults(first,[{status:'fulfilled',value:[{...fresh,title:'updated'}]}],['B'],'2026-10-24T00:00:00Z');
 assert.equal(later.items[0].firstSeenAt,now);assert.equal(later.items[0].versions[0].title,'new');assert.equal(later.items[0].versions[1].title,'updated');assert.equal(later.items[0].versions[1].firstSeenAt,'2026-10-24T00:00:00Z');
});
