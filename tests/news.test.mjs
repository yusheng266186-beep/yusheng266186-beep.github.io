import test from 'node:test';import assert from 'node:assert/strict';import {mergeFeedResults,failedFeedSnapshot,goldRelevant,feedReceipt} from '../scripts/news-utils.mjs';
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
test('energy decisions, trade talks and summary-only geopolitical transmission are admitted for semantic review',()=>{
 for(const item of [
  {title:'OPEC+维持下月石油产量配额不变。'},
  {title:'OPEC holds oil output steady'},
  {title:'Brent crude oil prices fall after supply announcement'},
  {title:'加拿大不急于和美国达成贸易协定'},
  {title:'美伊谈判，最新消息'},
  {title:'海湾国家加紧斡旋',summary:'伊朗谈判代表就停火条件与斡旋方举行会谈。'},
  {title:'官员公布声明',summary:'Officials discuss Iran ceasefire talks.'},
  {title:'美股科技巨头财报触发市场暴跌'}
 ])assert.equal(goldRelevant(item),true,JSON.stringify(item));
 for(const item of [{title:'家用抽油烟机打折促销'},{title:'600487拟回购股份'},{title:'球队为奥运冠军庆功',summary:'赞助金额达数百万美元'}])assert.equal(goldRelevant(item),false,JSON.stringify(item));
});
test('ingestion changes and publication time stay separate from successful no-change polling',()=>{
 const first=mergeFeedResults({},[{status:'fulfilled',value:[fresh]}],['B'],now);
 assert.deepEqual(first.changes,{added:1,revised:0});assert.equal(first.lastChangeAt,now);
 const nextTime='2026-10-23T10:05:00Z',same=mergeFeedResults(first,[{status:'fulfilled',value:[fresh]}],['B'],nextTime);
 assert.deepEqual(same.changes,{added:0,revised:0});assert.equal(same.lastChangeAt,now);assert.equal(same.checkedAt,nextTime);assert.equal(same.items[0].publishedAt,fresh.publishedAt);
 const revision=mergeFeedResults(same,[{status:'fulfilled',value:[{...fresh,summary:'revised evidence'}]}],['B'],'2026-10-23T10:10:00Z');
 assert.deepEqual(revision.changes,{added:0,revised:1});assert.equal(revision.lastChangeAt,'2026-10-23T10:10:00Z');
});
test('freshness uses actual raw article dates, not RSS build times or filtered matches',()=>{
 const time=Date.parse(now),dated=[{...fresh,publishedAt:'2026-10-23T09:00:00Z'},{...fresh,publishedAt:'2026-10-24T09:00:00Z'}],live=feedReceipt(dated,[],{now:time,maxAgeHours:72});
 assert.equal(live.stale,false);assert.equal(live.latestPublishedAt,'2026-10-23T09:00:00.000Z');assert.equal(live.parsedCount,1);
 const stopped=feedReceipt([{...old,publishedAt:'2025-06-11T07:09:00Z'}],[],{now:time,maxAgeHours:72});assert.equal(stopped.stale,true);
 const official=feedReceipt([{...old,publishedAt:'2026-09-11T00:00:00Z'}],[],{now:time});assert.equal(official.stale,false);
 const out=mergeFeedResults({items:[old]},[{status:'fulfilled',value:stopped},{status:'fulfilled',value:live}],['A','B'],now);
 assert.equal(out.sourceStatus[0].ok,false);assert.equal(out.sourceStatus[0].freshness,'stale');assert.equal(out.sourceStatus[1].ok,true);assert.deepEqual(out.failedSources,['A']);assert.equal(out.items[0].title,old.title);
});
