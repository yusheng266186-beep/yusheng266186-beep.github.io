import test from 'node:test';import assert from 'node:assert/strict';import {mergeFeedResults,failedFeedSnapshot,goldRelevant} from '../scripts/news-utils.mjs';
const now='2026-10-23T10:00:00Z',old={source:'A',url:'https://a.test/old',title:'old',publishedAt:'2026-10-20T00:00:00Z'},fresh={source:'B',url:'https://b.test/new',title:'new',publishedAt:'2026-10-23T00:00:00Z'};
test('a failed feed retains its previous stories while healthy feeds update',()=>{const out=mergeFeedResults({items:[old]},[{status:'rejected'},{status:'fulfilled',value:[fresh]}],['A','B'],now);assert.equal(out.items.length,2);assert.deepEqual(out.failedSources,['A']);assert.equal(out.items[0].title,'new')});
test('total outage fails without producing an empty replacement',()=>assert.throws(()=>mergeFeedResults({items:[old]},[{status:'rejected'},{status:'fulfilled',value:[]}],['A','B'],now),/All official feeds failed/));
test('undated or future articles cannot be presented as current news',()=>assert.throws(()=>mergeFeedResults({},[{status:'fulfilled',value:[{...fresh,publishedAt:null},{...fresh,publishedAt:'2027-01-01'}]}],['B'],now),/All official feeds failed/));
test('revisions preserve first-seen versions instead of rewriting past content',()=>{
 const first=mergeFeedResults({},[{status:'fulfilled',value:[fresh]}],['B'],now);
 const later=mergeFeedResults(first,[{status:'fulfilled',value:[{...fresh,title:'updated'}]}],['B'],'2026-10-24T00:00:00Z');
 assert.equal(later.items[0].firstSeenAt,now);assert.equal(later.items[0].versions[0].title,'new');assert.equal(later.items[0].versions[1].title,'updated');assert.equal(later.items[0].versions[1].firstSeenAt,'2026-10-24T00:00:00Z');
});
test('a valid source without matching headlines is healthy; total outage records its attempt without forging freshness',()=>{
 const out=mergeFeedResults({items:[old]},[{status:'fulfilled',value:{validFeed:true,items:[]}}],['A'],now);assert.equal(out.failedSources.length,0);assert.equal(out.items.length,1);assert.equal(out.sourceStatus[0].received,0);
 const previous={generatedAt:'2026-10-22T00:00:00Z',items:[old],sourceStatus:[{source:'A',lastSuccessAt:'2026-10-22T00:00:00Z',failureStreak:2}]};
 const failed=failedFeedSnapshot(previous,[{status:'rejected',reason:Error('403')}],['A'],now);assert.equal(failed.generatedAt,previous.generatedAt);assert.equal(failed.checkedAt,now);assert.deepEqual(failed.items,previous.items);assert.equal(failed.sourceStatus[0].failureStreak,3);assert.match(failed.sourceStatus[0].error,/403/);
});
test('gold relevance does not mistake dollar amounts, Goldman or awards for gold news',()=>{
 assert.equal(goldRelevant({title:'AI lab wins funding',summary:'The lab receives 134 million dollars'}),false);
 assert.equal(goldRelevant({title:'英国设立生物安全实验室',summary:'投资1.34亿美元，与科技企业合作'}),false);
 assert.equal(goldRelevant({title:'Goldman wins technology award'}),false);
 for(const title of ['金价下跌，美元指数走强','Gold rises as Treasury yields fall','CFTC: funds cut gold positions','央行货币政策发布'])assert.equal(goldRelevant({title}),true);
});
