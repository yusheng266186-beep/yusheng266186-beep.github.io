import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';const frozenRequire=createRequire(new URL('../docs/validation/4.6.0/kernel/core.js',import.meta.url));const Core=frozenRequire('./core.js'),Legacy=frozenRequire('./quant.js'),Adaptive=frozenRequire('./adaptive-model.js');import {summarize,compare} from './validation-utils.mjs';
const root='docs/validation/4.6.0/',json=async p=>JSON.parse(await readFile(root+p,'utf8')),hash=b=>createHash('sha256').update(b).digest('hex');
const plan=await json('plan.json'),rows=await json('frozen-history.json'),stage=process.argv[2]||'development',reproduce=process.argv.includes('--reproduce');
if(hash(JSON.stringify(rows))!==plan.dataHash)throw Error('Frozen data mismatch');for(const [p,h]of Object.entries(plan.kernel))if(hash(await readFile(root+'kernel/'+p.split('/').at(-1)))!==h)throw Error('Kernel changed after predeclaration: '+p);
async function save(name,data){let old;try{old=await json(name);}catch{}if(old){if(!reproduce)throw Error('Sealed result; use --reproduce');const stable=x=>JSON.stringify(x,(k,v)=>k==='createdAt'?undefined:v);if(stable(old)!==stable(data))throw Error('Reproduction mismatch '+name);}else await writeFile(root+name,JSON.stringify(data,null,2)+'\n');}
function collect(data,phases,models){const records=[];
 for(const id of models){if(id==='naive')continue;const began=Date.now(),p=id==='legacy'?Legacy.profile(data):Adaptive.profile(data,{},id==='boosted'?'boosted':'adaptive');
  for(const e of p.evaluations)for(const r of e.records){const phase=phases.find(k=>r.origin>=plan.splits[k].start&&r.target<=plan.splits[k].end);if(!phase)continue;const oi=data.findIndex(x=>x.time===r.origin),move=data[oi].close/data[Math.max(0,oi-60)].close-1;records.push({...r,candidate:id,phase,days:e.days,pctError:(r.center/r.actual-1)*100,regime:move>.05?'rising':move<-.05?'falling':'sideways'});}
  console.log(id+' evaluation ms '+(Date.now()-began));
 }
 return records;
}
function summary(records){const out={};for(const id of plan.candidates){out[id]={};for(const days of plan.horizons)out[id][days]=Object.fromEntries(Object.keys(plan.splits).map(phase=>[phase,summarize(records.filter(r=>r.candidate===id&&r.days===days&&r.phase===phase))]));}return out;}
function gate(a,b,gain){const result=compare(a,b,gain,plan.gate);if(!(a.primary.mape<=a.primary.naiveMape))result.reasons.push('not-better-than-persistence');return {...result,pass:result.reasons.length===0};}
if(stage==='development'){
 const past=rows.filter(r=>r.time<=plan.splits.validation.end),records=collect(past,['development','validation'],plan.candidates),summaries=summary(records);
 const horizons=plan.horizons.map(days=>{const trials=plan.candidates.filter(id=>id!=='legacy').map(id=>({id,development:gate(summaries[id][days].development,summaries.legacy[days].development,.02),validation:gate(summaries[id][days].validation,summaries.legacy[days].validation,.02)}));const passed=trials.filter(t=>t.development.pass&&t.validation.pass).sort((a,b)=>summaries[a.id][days].validation.primary.mape-summaries[b.id][days].validation.primary.mape);return {days,selected:passed[0]?.id||'legacy',trials};});
 await save('development.json',{createdAt:new Date().toISOString(),summaries,records});await save('selection.json',{planHash:hash(JSON.stringify(plan)),horizons});console.log(JSON.stringify(horizons));
}else if(stage==='holdout'){
 const selection=await json('selection.json');if(selection.planHash!==hash(JSON.stringify(plan)))throw Error('Selection/plan mismatch');
 // Both declared challengers are reported, even when rejected; only the frozen selection can be adopted.
 const records=collect(rows,['holdout'],plan.candidates),summaries=summary(records);
 const horizons=selection.horizons.map(s=>{const current=summaries.legacy[s.days].holdout,candidate=summaries[s.selected][s.days].holdout;const result=s.selected==='legacy'?{pass:false,reasons:['no-qualified-development-candidate']}:gate(candidate,current,.01);return {...s,current,candidate,accepted:result.pass,holdoutGate:result};});
 await save('holdout.json',{createdAt:new Date().toISOString(),selectionHash:hash(JSON.stringify(selection)),horizons,summaries,records});console.log(JSON.stringify(horizons.map(h=>({days:h.days,selected:h.selected,accepted:h.accepted,gate:h.holdoutGate}))));
}else throw Error('Unknown stage');
