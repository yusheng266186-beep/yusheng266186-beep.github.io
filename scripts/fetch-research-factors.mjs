import {readFile,writeFile} from 'node:fs/promises';
import {parseEcb,parseTreasury,parseVix,buildFactors,mergeSnapshots} from './research-utils.mjs';
const now=new Date().toISOString(),year=new Date().getUTCFullYear();
const sources=[
 ['ecb','https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml',parseEcb],
 ['treasury',`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_real_yield_curve&field_tdr_date_value=${year}`,parseTreasury],
 ['cboe','https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv',parseVix]
];
const results=await Promise.allSettled(sources.map(async([id,url,parse])=>{
 const res=await fetch(url,{signal:AbortSignal.timeout(18000),headers:{'User-Agent':'Mozilla/5.0 AurumResearch/4.4'}});
 if(!res.ok)throw Error(`${id} HTTP${res.status}`);const rows=parse(await res.text());
 if(rows.length<2)throw Error(`${id} no usable observations`);return {id,url,rows};
}));
let previous={};try{previous=JSON.parse(await readFile('data/research-factors.json','utf8'));}catch{}
const factors=results.flatMap((r,i)=>r.status==='fulfilled'?buildFactors(r.value,now):[]);
const status=sources.map(([id,url],i)=>({id,url,checkedAt:now,ok:results[i].status==='fulfilled',error:results[i].status==='rejected'?String(results[i].reason.message).slice(0,160):null}));
const out=mergeSnapshots(previous,factors,status,now);
await writeFile('data/research-factors.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({factors:factors.length,sources:status,snapshots:out.snapshots.length}));
