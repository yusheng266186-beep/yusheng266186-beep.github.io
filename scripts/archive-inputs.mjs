import {readFile,writeFile,rename} from 'node:fs/promises';import Vintage from '../assets/vintage-store.js';import Events from '../assets/event-engine.js';import {fetchText} from './fetch-utils.mjs';
import {enrichArchive} from './event-extract.mjs';
const json=async p=>{try{return JSON.parse(await readFile(p,'utf8'));}catch{return {};}};
const now=new Date().toISOString(),[archive,research,history,news,previous]=await Promise.all(['data/observation-vintages.json','data/research-factors.json','data/market-history.json','data/news.json','data/event-archive.json'].map(json));
const incoming=(research.snapshots||[]).flatMap(s=>(s.factors||[]).map(f=>({series:'factor:'+f.id,date:f.observationDate||f.observedAt?.slice(0,10),value:f.value,source:f.source,url:f.url,unit:f.unit,availability:'recorded-capture',capturedAt:f.availableAt||s.capturedAt})));
incoming.push(...(history.daily||[]).map(r=>({series:'au9999',date:r.time,value:r.close,source:r.volumeSource||history.source,url:history.sourceUrl,unit:'CNY/g',availability:'recorded-capture',capturedAt:r.observedAt||history.generatedAt})));
const macroStatus=[];
// ALFRED is optional and never silently replaced by latest revised FRED values.
const macroDue=!previous.macroCheckedAt||Date.now()-Date.parse(previous.macroCheckedAt)>24*3600000;
if(process.env.FRED_API_KEY&&!macroDue)macroStatus.push(...(previous.macroStatus||[]));
else if(process.env.FRED_API_KEY){
 for(const id of ['CPIAUCSL','UNRATE','DFII10'])try{
  const u=new URL('https://api.stlouisfed.org/fred/series/observations');for(const [k,v]of Object.entries({series_id:id,api_key:process.env.FRED_API_KEY,file_type:'json',observation_start:'2019-01-01',realtime_start:'2019-01-01',realtime_end:now.slice(0,10),output_type:'3',limit:'100000'}))u.searchParams.set(k,v);
  const data=JSON.parse(await fetchText(u,{timeoutMs:20000,maxChars:18000000,retries:1}));if(!Array.isArray(data.observations)||data.count>data.observations.length)throw Error('Incomplete vintage response');
  const rows=data.observations.filter(r=>r.value!=='.'&&Number.isFinite(Number(r.value))&&r.realtime_start<=now.slice(0,10));
  incoming.push(...rows.map(r=>({series:'macro:'+id,date:r.date,value:Number(r.value),vintage:r.realtime_start,source:'ALFRED',url:'https://alfred.stlouisfed.org/series?seid='+id,availability:'official-vintage',publishedAt:Vintage.readyAt(r.realtime_start)})));macroStatus.push({series:id,ok:true,versions:rows.length});
 }catch{macroStatus.push({series:id,ok:false,error:'ALFRED request failed or incomplete; key and request URL omitted from logs'});}
}else macroStatus.push({ok:false,status:'not-configured',reason:'FRED_API_KEY not configured; no historical macro vintages imported'});
const out=Vintage.merge(archive,incoming,now),byURL=new Map((previous.items||[]).map(x=>[x.url,x]));
for(const item of news.items||[])byURL.set(item.url,item);
const items=[...byURL.values()];if(items.length>20000)throw Error('Event archive exceeds capacity; no older events deleted');
const enriched=enrichArchive(items,previous.expectations||[]),events={schema:1,generatedAt:now,...enriched,structured:Events.at(enriched.items,now,enriched.expectations),macroStatus,macroCheckedAt:macroDue?now:previous.macroCheckedAt};
for(const [p,d]of [['data/observation-vintages.json',out],['data/event-archive.json',events]]){await writeFile(p+'.tmp',JSON.stringify(d)+'\n');await rename(p+'.tmp',p);}
console.log(JSON.stringify({versions:out.records.length,events:items.length,structured:events.structured.length,macroStatus}));
