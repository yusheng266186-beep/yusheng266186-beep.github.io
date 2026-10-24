import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import Core from '../assets/core.js';import Quant from '../assets/quant.js';import Evidence from '../assets/evidence.js';
import {updateLedger} from './ledger-utils.mjs';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const [history,news,research,packageInfo]=await Promise.all(['data/market-history.json','data/news.json','data/research-factors.json','package.json'].map(json));
const now=new Date().toISOString(),daily=Core.closedDaily(history.daily,history.generatedAt).closed;
let previous={entries:[]};try{previous=await json('data/forecast-ledger.json');}catch{}
const methodHash=createHash('sha256').update((await Promise.all(['assets/core.js','assets/quant.js','assets/evidence.js'].map(p=>readFile(p)))).map(b=>b.toString()).join('\n')).digest('hex');
const evidence={news:news.items,snapshots:research.snapshots},profile=Quant.profile(daily,evidence);profile.context=Evidence.context(evidence,now);
const last=daily.at(-1),forecasts=profile.ready?Quant.scenarioModel(last.close,profile).points:[];
const out=updateLedger(previous,{daily,forecasts,now,version:packageInfo.version,methodHash,historyAsOf:history.generatedAt,
 inputHash:createHash('sha256').update(JSON.stringify({daily,news,research})).digest('hex')});
await writeFile('data/forecast-ledger.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({origins:out.entries.length,resolved:out.entries.reduce((s,e)=>s+e.forecasts.filter(f=>f.result).length,0),asOf:out.generatedAt}));
