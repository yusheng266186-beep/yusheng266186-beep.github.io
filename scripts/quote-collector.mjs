import Core from "../assets/core.js";

// Injected providers keep transport, selection and file persistence independently testable.
export async function collectQuotes({providers,previous,now=Date.now()}) {
  const results=await Promise.allSettled(providers.map(async ([name,fetcher])=>{
    const start=Date.now(),quote=await fetcher();
    if(quote.timePrecision==="date-only") {
      const t=Core.timestamp(quote.referenceDate+"T00:00:00+08:00");
      if(!(quote.priceCnyGram>0)||!t||Core.chinaDate(t)!==quote.referenceDate||quote.referenceDate>Core.chinaDate(new Date(now).toISOString())||Core.ageHours(t,now)>120)throw Error("Invalid or expired official reference date");
      return {quote,kind:"reference",latencyMs:Date.now()-start};
    }
    if(!(quote.priceCnyGram>0)||Core.ageHours(quote.asOf,now)>96)throw Error("Invalid or expired quote timestamp");
    return {quote,kind:"quote",latencyMs:Date.now()-start};
  }));
  const candidates=results.filter(r=>r.status==="fulfilled"&&r.value.kind==="quote").map(r=>r.value.quote);
  const references=results.filter(r=>r.status==="fulfilled"&&r.value.kind==="reference").map(r=>r.value.quote);
  const sourceHealth=results.map((r,i)=>{const old=previous?.sourceHealth?.find(s=>s.source===providers[i][0]);return {source:providers[i][0],ok:r.status==="fulfilled",checkedAt:new Date(now).toISOString(),lastSuccessAt:r.status==="fulfilled"?new Date(now).toISOString():old?.lastSuccessAt||(old?.ok?old.checkedAt:null)||null,
    ...(r.status==="fulfilled"?{kind:r.value.kind,asOf:r.value.quote.asOf,referenceDate:r.value.quote.referenceDate,latencyMs:r.value.latencyMs}:{error:String(r.reason.message).slice(0,160)})};});
  if(!candidates.length)throw Object.assign(Error("All domestic sources failed; previous snapshot and its timestamp retained."),{sourceHealth});
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
  return {quote,sourceHealth,retained:selection.retained,references};
}

export function parseOfficialReference(html) {
  const date=html.match(/上海黄金交易所\s*(\d{4})年(\d{1,2})月(\d{1,2})日延时行情/);
  if(!date)throw Error('Official page has no reference date');
  const referenceDate=`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`;
  const cells=[...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(row=>[...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(cell=>cell[1].replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim())).find(row=>row[0]==='Au99.99');
  if(!cells||!cells.slice(1,5).every(v=>Core.numeric(v)>0))throw Error('Official page has no valid Au99.99 reference');
  const [,latest,high,low,open]=cells;
  return {market:'CN-SGE',primaryContract:'AU9999',unit:'CNY/g',priceCnyGram:Core.numeric(latest),
    highCnyGram:Core.numeric(high),lowCnyGram:Core.numeric(low),openCnyGram:Core.numeric(open),
    previousCnyGram:null,changeCnyGram:null,changePct:null,volume:null,turnover:null,
    asOf:null,referenceDate,timePrecision:'date-only',dataTier:'official-reference',
    source:'上海黄金交易所官方日期级参照',sourceUrl:'https://www.sge.com.cn/sjzx/yshqbg',
    observed:{previous:false,open:true,range:true,change:false,changeAmount:false,volume:false,turnover:false}};
}
