export function mergeFeedResults(previous, results, sourceNames, now = new Date().toISOString()) {
  const valid = x => x && typeof x.title === 'string' && /^https:\/\//.test(x.url || '') &&
    Number.isFinite(Date.parse(x.publishedAt)) && Date.parse(x.publishedAt) <= Date.parse(now) + 300000;
  const itemsOf=r=>Array.isArray(r.value)?r.value:r.value?.items||[];
  const succeeded = results.map((r, i) => r.status === 'fulfilled' && (itemsOf(r).some(valid)||r.value?.validFeed===true) ? i : -1).filter(i => i >= 0);
  if (!succeeded.length) throw new Error('All official feeds failed; retained the existing news snapshot.');
  const failed = sourceNames.filter((_, i) => !succeeded.includes(i));
  const retained = (previous.items || []).filter(valid);
  const incoming = succeeded.flatMap(i => itemsOf(results[i]).filter(valid));
  const byURL = new Map(retained.map(x=>[x.url,{...x,firstSeenAt:x.firstSeenAt||now}]));
  for(const item of incoming){
    const old=byURL.get(item.url);
    if(!old)byURL.set(item.url,{...item,firstSeenAt:now});
    else if(old.title!==item.title||old.summary!==item.summary){
      const version=x=>({title:x.title,summary:x.summary,publishedAt:x.publishedAt,firstSeenAt:x.firstSeenAt});
      const versions=old.versions||[version(old)];
      byURL.set(item.url,{...item,firstSeenAt:old.firstSeenAt,versions:versions.concat({...version(item),firstSeenAt:now}).slice(-100)});
    }
  }
  return { generatedAt: now, checkedAt:now, failedSources: failed, sourceStatus:sourceNames.map((source,i)=>{
    const old=(previous.sourceStatus||[]).find(s=>s.source===source)||{},ok=succeeded.includes(i),received=results[i].status==='fulfilled'?itemsOf(results[i]).filter(valid):[];
    return {source,ok,checkedAt:now,lastSuccessAt:ok?now:old.lastSuccessAt||null,failureStreak:ok?0:(old.failureStreak||0)+1,received:received.length,
      error:ok?null:String(results[i].reason?.message||'No valid dated feed').slice(0,160)};
  }), items: [...byURL.values()].sort((a,b) => Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,1500) };
}
export function failedFeedSnapshot(previous,results,sourceNames,now){
 return {...previous,checkedAt:now,failedSources:sourceNames,sourceStatus:sourceNames.map((source,i)=>{const old=(previous.sourceStatus||[]).find(s=>s.source===source)||{};return {source,ok:false,checkedAt:now,lastSuccessAt:old.lastSuccessAt||null,failureStreak:(old.failureStreak||0)+1,error:String(results[i].reason?.message||'No valid dated feed').slice(0,160)};})};
}
export function goldRelevant(item){
 const title=String(item.title||''),summary=String(item.summary||'');
 if(/黄金|金价|贵金属|白银|沪金|美联储|央行|通胀|利率|国债|避险|中东|停火|伊朗|乌克兰|关税|外汇|人民币|美指|美元(?:指数|兑|走|涨|跌|反弹|升值|贬值)/.test(title))return true;
 if(/\b(?:gold|bullion|precious metals?|silver|FOMC|monetary|Fed|Federal Reserve|inflation|CPI|PPI|interest rates?|treasur(?:y|ies)|real yields?|dollar|ceasefire|war|Iran|Ukraine|tariffs?|CFTC)\b/i.test(title))return true;
 return /\b(?:gold|bullion|FOMC|Federal Reserve|policy rates?)\b|黄金|美联储/.test(summary);
}
