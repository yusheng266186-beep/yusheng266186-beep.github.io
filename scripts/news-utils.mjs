export function mergeFeedResults(previous, results, sourceNames, now = new Date().toISOString()) {
  const valid = x => x && typeof x.title === 'string' && /^https:\/\//.test(x.url || '') &&
    Number.isFinite(Date.parse(x.publishedAt)) && Date.parse(x.publishedAt) <= Date.parse(now) + 300000;
  const itemsOf=r=>Array.isArray(r.value)?r.value:r.value?.items||[];
  const succeeded = results.map((r, i) => r.status === 'fulfilled' && (itemsOf(r).some(valid)||r.value?.validFeed===true) ? i : -1).filter(i => i >= 0);
  if (!succeeded.length) throw new Error('All official feeds failed; retained the existing news snapshot.');
  const healthy = succeeded.filter(i=>results[i].value?.stale!==true);
  const failed = sourceNames.filter((_, i) => !healthy.includes(i));
  const retained = (previous.items || []).filter(valid);
  const incoming = succeeded.flatMap(i => itemsOf(results[i]).filter(valid));
  const byURL = new Map(retained.map(x=>[x.url,{...x,firstSeenAt:x.firstSeenAt||now}]));
  let added=0,revised=0;
  for(const item of incoming){
    const old=byURL.get(item.url);
    if(!old){byURL.set(item.url,{...item,firstSeenAt:now});added++;}
    else if(old.title!==item.title||old.summary!==item.summary){
      const version=x=>({title:x.title,summary:x.summary,publishedAt:x.publishedAt,firstSeenAt:x.firstSeenAt});
      const versions=old.versions||[version(old)];
      byURL.set(item.url,{...item,firstSeenAt:old.firstSeenAt,versions:versions.concat({...version(item),firstSeenAt:now}).slice(-100)});
      revised++;
    }
  }
  return { generatedAt: now, checkedAt:now, lastChangeAt:added||revised?now:previous.lastChangeAt||null,changes:{added,revised},failedSources: failed, sourceStatus:sourceNames.map((source,i)=>{
    const old=(previous.sourceStatus||[]).find(s=>s.source===source)||{},ok=healthy.includes(i),received=results[i].status==='fulfilled'?itemsOf(results[i]).filter(valid):[],meta=results[i].value||{},stale=meta.stale===true;
    return {source,ok,checkedAt:now,lastSuccessAt:ok?now:old.lastSuccessAt||null,failureStreak:ok?0:(old.failureStreak||0)+1,received:received.length,latestPublishedAt:meta.latestPublishedAt||old.latestPublishedAt||null,parsedCount:meta.parsedCount??null,freshness:stale?'stale':ok?'current':'unavailable',
      error:ok?null:stale?'来源可访问，但原文已超过'+meta.maxAgeHours+'小时未更新':String(results[i].reason?.message||'No valid dated feed').slice(0,160)};
  }), items: [...byURL.values()].sort((a,b) => Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,1500) };
}
export function failedFeedSnapshot(previous,results,sourceNames,now){
 return {...previous,checkedAt:now,failedSources:sourceNames,sourceStatus:sourceNames.map((source,i)=>{const old=(previous.sourceStatus||[]).find(s=>s.source===source)||{};return {source,ok:false,checkedAt:now,lastSuccessAt:old.lastSuccessAt||null,failureStreak:(old.failureStreak||0)+1,error:String(results[i].reason?.message||'No valid dated feed').slice(0,160)};})};
}
export function goldRelevant(item){
 const title=String(item.title||''),summary=String(item.summary||'');
 if(/黄金|金价|贵金属|白银|沪金|美联储|央行|通胀|利率|国债|避险|中东|停火|伊朗|乌克兰|关税|外汇|人民币|美指|美元(?:指数|兑|走|涨|跌|反弹|升值|贬值)/.test(title))return true;
 if(/\b(?:gold|bullion|precious metals?|silver|FOMC|monetary|Fed|Federal Reserve|inflation|CPI|PPI|interest rates?|treasur(?:y|ies)|real yields?|dollar|ceasefire|war|Iran|Ukraine|tariffs?|CFTC)\b/i.test(title))return true;
 // Energy supply, broad-market stress and trade policy can reach gold through
 // inflation, yields or liquidity. Admit the evidence; the semantic model still
 // determines relevance and direction rather than treating keywords as a factor.
 const macro=/(?:OPEC\+?|欧佩克|石油输出国)|(?:原油|石油|油价|能源).{0,10}(?:产量|配额|供应|供给|价格|涨|跌|减产|增产)|(?:WTI|Brent|crude oil|oil prices?|oil output|oil supply|production quotas?)\b|(?:美伊|俄乌).{0,8}(?:谈判|和谈|冲突|战争)|(?:贸易协定|贸易谈判|贸易战|出口管制)|(?:美股|全球股市|全球市场).{0,12}(?:暴跌|崩盘|抛售|流动性)|(?:\btrade (?:deal|talks|war)\b)|(?:global markets?|Wall Street).{0,30}(?:sell.?off|crash|liquidity)/i;
 if(macro.test(title))return true;
 if(/(?:伊朗|乌克兰|霍尔木兹|中东|美伊|俄乌).{0,65}(?:打击|战争|冲突|谈判|和谈|停火|制裁)|(?:打击|战争|冲突|谈判|和谈|停火|制裁).{0,40}(?:伊朗|乌克兰|霍尔木兹|中东)|(?:OPEC|欧佩克|原油|石油).{0,30}(?:产量|配额|供应|供给|减产|增产)|\b(?:Iran|Ukraine|Hormuz).{0,80}(?:strike|war|conflict|talks|ceasefire|sanctions)\b/i.test(summary))return true;
 return /\b(?:gold|bullion|FOMC|Federal Reserve|policy rates?)\b|黄金|美联储/.test(summary);
}
export function feedReceipt(parsed,items,{now=Date.now(),maxAgeHours=null}={}){
 const dates=parsed.map(i=>Date.parse(i.publishedAt)).filter(t=>Number.isFinite(t)&&t<=now+300000),latest=dates.length?Math.max(...dates):null;
 return {items,validFeed:true,parsedCount:dates.length,latestPublishedAt:latest===null?null:new Date(latest).toISOString(),maxAgeHours,stale:latest!==null&&Number.isFinite(maxAgeHours)&&now-latest>maxAgeHours*3600000};
}
