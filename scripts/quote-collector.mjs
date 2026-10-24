import Core from "../assets/core.js";

// Injected providers keep transport, selection and file persistence independently testable.
export async function collectQuotes({providers,previous,now=Date.now()}) {
  const results=await Promise.allSettled(providers.map(async ([name,fetcher])=>{
    const start=Date.now(),quote=await fetcher();
    if(!(quote.priceCnyGram>0)||Core.ageHours(quote.asOf,now)>96)throw Error("Invalid or expired quote timestamp");
    return {quote,latencyMs:Date.now()-start};
  }));
  const candidates=results.filter(r=>r.status==="fulfilled").map(r=>r.value.quote);
  if(!candidates.length)throw Error("All domestic sources failed; previous snapshot and its timestamp retained.");
  const selection=Core.selectQuote(candidates,previous,now);
  let quote=selection.quote;
  const official=candidates.find(q=>q.dataTier==="official-delayed");
  if(official&&quote.dataTier!=="official-delayed"&&Math.abs(Date.parse(quote.asOf)-Date.parse(official.asOf))<=120000){
    const differencePct=(quote.priceCnyGram/official.priceCnyGram-1)*100;
    quote={...quote,sourceConflict:quote.sourceConflict||Math.abs(differencePct)>2.5,
      validation:{source:"上海黄金交易所官方延时行情",checkedAt:new Date(now).toISOString(),officialAsOf:official.asOf,
        officialPriceCnyGram:official.priceCnyGram,differencePct},
      delay:Math.abs(differencePct)>2.5?"同窗口来源价格分歧，保留来源报价并等待核验":quote.delay+"；已用同期上金所延时价对照"};
  }
  const sourceHealth=results.map((r,i)=>({source:providers[i][0],ok:r.status==="fulfilled",
    ...(r.status==="fulfilled"?{asOf:r.value.quote.asOf,latencyMs:r.value.latencyMs}:{error:String(r.reason.message).slice(0,160)})}));
  return {quote,sourceHealth,retained:selection.retained};
}
