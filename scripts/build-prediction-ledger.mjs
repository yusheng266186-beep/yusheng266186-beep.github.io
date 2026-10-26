import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import Core from '../assets/core.js';import Quant from '../assets/research-engine.js';import Evidence from '../assets/evidence.js';
import {modelIdentity} from './model-identity.mjs';
import {updateLedger} from './ledger-utils.mjs';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const [history,news,research,packageInfo]=await Promise.all(['data/market-history.json','data/news.json','data/research-factors.json','package.json'].map(json));
const now=new Date().toISOString(),daily=Core.closedDaily(history.daily,history.generatedAt).closed;
let previous={entries:[]};try{previous=await json('data/forecast-ledger.json');}catch{}
const methodHash=await modelIdentity();
const publication=await json('data/forecast-publication.json').catch(()=>null),evidence={news:news.items,snapshots:research.snapshots,aiNews:publication?.newsFactors?.snapshot},profile=publication?.methodHash===methodHash&&publication.inputs?.historyAsOf===history.generatedAt?publication.defaultProfile:Quant.profile(daily,evidence);profile.context=Evidence.context(evidence,publication?.generatedAt||now);
const last=daily.at(-1),forecasts=profile.ready?Quant.scenarioModel(last.close,profile).points:[];
if(profile.research)profile.research.context=profile.context;
const shadowForecasts=profile.research?.ready?Quant.scenarioModel(last.close,profile.research).points.map(f=>({...f,model:'adaptive'})):[];
if(publication?.methodHash===methodHash&&publication.origin===last.time)for(const [id,p]of [['system-full',publication.system],['system-price',publication.baseline]])for(const f of p?.evaluations||[])shadowForecasts.push({model:id,days:f.days,center:f.center,low:f.low,high:f.high,up:f.distribution.ready?f.distribution.up:null,quantiles:f.distribution.ready?f.distribution.quantiles:null,calibrationCount:f.calibrationCount,regime:f.regime.label,mode:p.mode});
const out=updateLedger(previous,{daily,forecasts,shadowForecasts,now,version:packageInfo.version,methodHash,historyAsOf:history.generatedAt,
 inputHash:createHash('sha256').update(JSON.stringify({daily,news,research})).digest('hex')});
await writeFile('data/forecast-ledger.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({origins:out.entries.length,resolved:out.entries.reduce((s,e)=>s+e.forecasts.filter(f=>f.result).length,0),asOf:out.generatedAt}));
