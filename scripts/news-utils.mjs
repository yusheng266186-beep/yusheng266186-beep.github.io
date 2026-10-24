export function mergeFeedResults(previous, results, sourceNames, now = new Date().toISOString()) {
  const valid = x => x && typeof x.title === 'string' && /^https:\/\//.test(x.url || '') &&
    Number.isFinite(Date.parse(x.publishedAt)) && Date.parse(x.publishedAt) <= Date.parse(now) + 300000;
  const succeeded = results.map((r, i) => r.status === 'fulfilled' && r.value.some(valid) ? i : -1).filter(i => i >= 0);
  if (!succeeded.length) throw new Error('All official feeds failed; retained the existing news snapshot.');
  const failed = sourceNames.filter((_, i) => !succeeded.includes(i));
  const retained = (previous.items || []).filter(valid);
  const incoming = succeeded.flatMap(i => results[i].value.filter(valid));
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
  return { generatedAt: now, failedSources: failed, sourceStatus:sourceNames.map((source,i)=>({source,ok:succeeded.includes(i),checkedAt:now})), items: [...byURL.values()].sort((a,b) => Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,1500) };
}
