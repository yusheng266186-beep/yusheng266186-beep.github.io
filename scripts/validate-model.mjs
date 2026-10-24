import fs from 'node:fs/promises';import vm from 'node:vm';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
import path from 'node:path';import {pathToFileURL} from 'node:url';import {summarize,compare as check} from './validation-utils.mjs';
const root=pathToFileURL(path.resolve(process.argv[3]||'docs/validation/4.5.0')+'/'),read=async name=>JSON.parse(await fs.readFile(new URL(name,root),'utf8'));
const hashes=await read('kernel-manifest.json');for(const [name,hash] of Object.entries(hashes))if(createHash('sha256').update(await fs.readFile(new URL('kernel/'+name,root))).digest('hex')!==hash)throw Error('Archived kernel changed: '+name);
const reproduce=process.argv.includes('--reproduce');async function save(name,value){const file=new URL(name,root);let existing;try{existing=JSON.parse(await fs.readFile(file,'utf8'));}catch{}if(existing){if(!reproduce)throw Error('Sealed result already exists; use --reproduce for a read-only check');const stable=x=>JSON.stringify(x,(key,value)=>key==='createdAt'?undefined:value);if(stable(existing)!==stable(value))throw Error('Reproduction mismatch: '+name);console.log('Exact reproduction: '+name);}else await fs.writeFile(file,JSON.stringify(value,null,2)+'\n');}
const plan=await read('plan.json'),rows=await read('frozen-history.json'),stage=process.argv[2]||'development';
if(!reproduce){let sealed=false;try{await fs.access(new URL(stage==='development'?'selection.json':'holdout.json',root));sealed=true;}catch{}if(sealed)throw Error('Experiment is sealed; --reproduce compares results without rewriting them. Start a separately declared experiment for new hypotheses.');}
if(createHash('sha256').update(JSON.stringify(rows)).digest('hex')!==plan.dataHash)throw Error('Frozen data changed');
const require=createRequire(new URL('kernel/quant.js',root));
const source=await fs.readFile(new URL('kernel/quant.js',root),'utf8');
function quant(id){let code=source;
 if(id==='ridge80')code=code.replace('j===0?5:20','j===0?5:80');
 if(id==='trend65')code=code.replaceAll('.7*','.35*').replaceAll('.3*','.65*');
 if(id==='direct252')code=code.replace('Math.min(63,h)','Math.min(252,h)').replace('h>63?1+.35*Math.log(h/63):1','h>252?1+.35*Math.log(h/252):1');
 const context={module:{exports:{}},require};vm.runInNewContext(code,context);return context.module.exports;
}
const compare=(a,b,improvement)=>check(a,b,improvement,plan.gate);
async function collect(phases,ids){const all=[];
 for(const candidate of ids){const Q=quant(candidate);let count=0;
  for(let i=plan.originStart;i<rows.length;i+=plan.originStride){
   const applicable=plan.horizons.map(days=>({days,h:Math.max(1,Math.round(days*252/365))})).filter(({h})=>phases.some(phase=>i>=plan.splits[phase].start&&i+h<=plan.splits[phase].end));if(!applicable.length)continue;
   const p=Q.profile(rows.slice(0,i+1)),change=rows[i].close/rows[i-60].close-1,regime=change>.05?'rising':change<-.05?'falling':'sideways';
   for(const {days,h} of applicable){const target=rows[i+h],value=Q.at(rows[i].close,days,p),actual=target.close,phase=phases.find(phase=>i>=plan.splits[phase].start&&i+h<=plan.splits[phase].end),pctError=(value.center/actual-1)*100;
    all.push({candidate,phase,days,steps:h,originIndex:i,origin:rows[i].time,target:target.time,start:rows[i].close,...value,actual,error:Math.abs(pctError),pctError,naiveError:Math.abs(rows[i].close/actual-1)*100,hit:actual>=value.low&&actual<=value.high,directionHit:Math.sign(value.center-rows[i].close)===Math.sign(actual-rows[i].close),regime,evidenceCount:0});
   }
   if(++count%15===0)console.log(candidate,rows[i].time,count);
  }
 }
 return all;
}
if(stage==='development'){
 const records=await collect(['development','validation'],plan.candidates.map(c=>c.id)),summaries={};
 for(const candidate of plan.candidates.map(c=>c.id)){summaries[candidate]={};for(const days of plan.horizons)summaries[candidate][days]=Object.fromEntries(['development','validation'].map(phase=>[phase,summarize(records.filter(r=>r.candidate===candidate&&r.days===days&&r.phase===phase))]));}
 const selection={planHash:createHash('sha256').update(JSON.stringify(plan)).digest('hex'),createdAt:new Date().toISOString(),horizons:[]};
 for(const days of plan.horizons){const trials=plan.candidates.filter(c=>c.id!=='current').map(c=>({id:c.id,development:compare(summaries[c.id][days].development,summaries.current[days].development,plan.gate.developmentImprovement),validation:compare(summaries[c.id][days].validation,summaries.current[days].validation,plan.gate.validationImprovement)}));
  const qualified=trials.filter(t=>t.development.pass&&t.validation.pass).sort((a,b)=>summaries[a.id][days].validation.primary.mape-summaries[b.id][days].validation.primary.mape);
  selection.horizons.push({days,selected:qualified[0]?.id||'current',trials});
 }
 await save('development.json',{summaries,records});await save('selection.json',selection);console.log(JSON.stringify({selection:selection.horizons.map(h=>({days:h.days,selected:h.selected})),summaries},null,2));
}else if(stage==='holdout'){
 const selection=await read('selection.json');if(selection.planHash!==createHash('sha256').update(JSON.stringify(plan)).digest('hex'))throw Error('Plan changed after selection');
 const ids=[...new Set(['current',...selection.horizons.map(h=>h.selected)])],records=await collect(['holdout'],ids),results=[];
 for(const h of selection.horizons){const current=summarize(records.filter(r=>r.days===h.days&&r.candidate==='current')),candidate=summarize(records.filter(r=>r.days===h.days&&r.candidate===h.selected));
  const gate=h.selected==='current'?{pass:false,reasons:['no-qualified-development-candidate']}:compare(candidate,current,plan.gate.minHoldoutImprovement);
  results.push({...h,current,candidate,accepted:gate.pass,holdoutGate:gate});
 }
 const result={createdAt:new Date().toISOString(),selectionHash:createHash('sha256').update(JSON.stringify(selection)).digest('hex'),results,records};await save('holdout.json',result);console.log(JSON.stringify({results},null,2));
}else throw Error('Unknown stage');
