import {readFile,writeFile} from 'node:fs/promises';
import {parseEcb,parseTreasury,parseVix,parseNominal,parseOil,parsePositioning,inflationFactor,buildFactors,mergeSnapshots} from './research-utils.mjs';
import {fetchText} from './fetch-utils.mjs';
const now=new Date().toISOString(),year=new Date().getUTCFullYear();
const sources=[
 ['ecb','https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml',parseEcb],
 ['treasury',`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_real_yield_curve&field_tdr_date_value=${year}`,parseTreasury],
 ['cboe','https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv',parseVix],
 ['nominal',`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`,parseNominal],
 ['oil','https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILWTICO',parseOil],
 ['positioning','https://www.cftc.gov/dea/newcot/f_disagg.txt',parsePositioning]
];
const results=await Promise.allSettled(sources.map(async([id,url,parse])=>{
 let rows=parse(await fetchText(url,{timeoutMs:15000}));
 if(['treasury','nominal'].includes(id)&&rows.length<21){const priorUrl=url.replace(`=${year}`,`=${year-1}`);rows=parse(await fetchText(priorUrl,{timeoutMs:15000})).concat(rows).sort((a,b)=>a.date.localeCompare(b.date));}
 if(rows.length<(id==='positioning'?1:2))throw Error(`${id} no usable observations`);return {id,url,rows};
}));
let previous={};try{previous=JSON.parse(await readFile('data/research-factors.json','utf8'));}catch{}
const factors=results.flatMap((r,i)=>r.status==='fulfilled'?buildFactors(r.value,now):[]);
const valid=results.filter(r=>r.status==='fulfilled').map(r=>r.value),nominal=valid.find(r=>r.id==='nominal'),real=valid.find(r=>r.id==='treasury');if(nominal&&real)factors.push(...inflationFactor(nominal,real,now));
const status=sources.map(([id,url],i)=>{const old=(previous.status||[]).find(s=>s.id===id)||{},ok=results[i].status==='fulfilled';return {id,url,checkedAt:now,ok,lastSuccessAt:ok?now:old.lastSuccessAt||null,failureStreak:ok?0:(old.failureStreak||0)+1,error:ok?null:String(results[i].reason.message).slice(0,160)};});
const out=mergeSnapshots(previous,factors,status,now);
await writeFile('data/research-factors.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({factors:factors.length,sources:status,snapshots:out.snapshots.length}));
if(!factors.length)process.exitCode=1;
