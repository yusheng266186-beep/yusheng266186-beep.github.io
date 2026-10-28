import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile),script=fileURLToPath(new URL('../scripts/build-analysis-desk.mjs',import.meta.url));
test('the actual builder drains multiple batches, checkpoints all reviews, keeps uncapped daily usage and reuses them next run',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aurum-research-runtime-'));
 try{
  await mkdir(join(dir,'data'));
  const input=JSON.parse(await readFile(new URL('./fixtures/analysis-input.json',import.meta.url),'utf8')),now=Date.parse(input._fixture.asOf),day=new Date(now+8*3600000).toISOString().slice(0,10);
  input.news.items=Array.from({length:24},(_,i)=>({title:'黄金价格与市场消息观察第'+i+'条',summary:'黄金市场需要结合最新消息核对传导方向，尚未出现确定性结论。',source:'公开消息测试',url:'https://example.com/news/'+i,publishedAt:new Date(now-60000*(25-i)).toISOString(),firstSeenAt:new Date(now-60000*(25-i)).toISOString()}));
  for(const [file,value] of Object.entries({'market-history':input.history,news:input.news,'research-factors':input.research,'forecast-publication':input.publication||{},'analysis-ai-usage':{schema:1,attempts:Array.from({length:250},()=>({day,startedAt:new Date(now).toISOString(),status:'ready'}))}}))await writeFile(join(dir,'data',file+'.json'),JSON.stringify(value));
  const preload=join(dir,'mock-provider.mjs');
  await writeFile(preload,`import {appendFile} from 'node:fs/promises';
Date.now=()=>${now};
globalThis.fetch=async(url,options)=>{
 if(url!=='https://www.codebuddy.cn/v2/chat/completions')throw Error('Unexpected network access');
 const request=JSON.parse(options.body),input=JSON.parse(request.messages[1].content),events=input.evidence.filter(f=>f.type==='event');
 await appendFile('model-calls.ndjson',JSON.stringify({workIds:input.workIds,submitted:events.length})+'\\n');
 const content={headline:'对照价格与消息',interpretations:[{text:'需要结合后续收盘核对消息传导。',evidenceIds:['P-CLOSE']}],questions:[{text:'后续收盘能否确认区间变化？',evidenceIds:['P-CLOSE']}],newsReviews:events.map(f=>({id:f.id,relevance:'direct',status:'reported',dimension:'price',effect:'unclear',quote:f.label,reason:'价格报道保留为观察资料。',factor:{dimension:'none',effect:'unclear',intensity:'weak',novelty:'unknown',duration:'days',quote:f.label,mechanism:'传导证据不足，暂不修正预测。'}})),relations:[],hypotheses:[],followUps:[]};
 return new Response(JSON.stringify({model:'deepseek-v4.1-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:100,completion_tokens:200}}));
};\n`);
  const run=()=>exec(process.execPath,['--import',pathToFileURL(preload).href,script],{cwd:dir,env:{...process.env,AURUM_CODEBUDDY_API_KEY:'isolated-fixture-key',AURUM_ANALYSIS_DEADLINE:''},timeout:10000});
  await run();let desk=JSON.parse(await readFile(join(dir,'data/analysis-desk.json'),'utf8'));
  assert.equal(desk.aiPolicy.maxCallsPerDay,null);assert.equal(desk.aiPolicy.minimumIntervalMinutes,0);assert.equal(desk.aiPolicy.usedToday,253);assert.equal(desk.aiPolicy.pendingItems,0);assert.equal(desk.aiPolicy.queue.callsMade,3);assert.equal(desk.aiPolicy.queue.completedItems,24);assert.equal(desk.intelligence.stats.reviewed,24);
  const calls=(await readFile(join(dir,'model-calls.ndjson'),'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(calls.map(c=>c.workIds.length),[8,8,8]);assert.ok(calls.every(c=>c.submitted<=10));
  await run();desk=JSON.parse(await readFile(join(dir,'data/analysis-desk.json'),'utf8'));assert.equal(desk.aiPolicy.queue.callsMade,0);assert.equal(desk.aiPolicy.usedToday,253);assert.equal((await readFile(join(dir,'model-calls.ndjson'),'utf8')).trim().split('\n').length,3);
 }finally{await rm(dir,{recursive:true,force:true});}
});
