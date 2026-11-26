import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile),script=fileURLToPath(new URL('../scripts/build-analysis-desk.mjs',import.meta.url));
test('the actual builder makes one call per half hour, preserves backlog and records uncapped usage',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aurum-research-runtime-'));
 try{
  await mkdir(join(dir,'data'));
  const input=JSON.parse(await readFile(new URL('./fixtures/analysis-input.json',import.meta.url),'utf8')),now=Date.parse(input._fixture.asOf),day=new Date(now+8*3600000).toISOString().slice(0,10);
  input.news.items=Array.from({length:24},(_,i)=>({title:'黄金价格与市场消息观察第'+i+'条',summary:'黄金市场需要结合最新消息核对传导方向，尚未出现确定性结论。',source:'公开消息测试',url:'https://example.com/news/'+i,publishedAt:new Date(now-60000*(25-i)).toISOString(),firstSeenAt:new Date(now-60000*(25-i)).toISOString()}));
  for(const [file,value] of Object.entries({'market-history':input.history,news:input.news,'research-factors':input.research,'forecast-publication':input.publication||{},'analysis-ai-usage':{schema:1,attempts:Array.from({length:250},()=>({day,startedAt:new Date(now-31*60000).toISOString(),status:'ready'}))}}))await writeFile(join(dir,'data',file+'.json'),JSON.stringify(value));
  const preload=join(dir,'mock-provider.mjs');
  await writeFile(preload,`import {appendFile} from 'node:fs/promises';
Date.now=()=>Number(process.env.FIXTURE_NOW);
globalThis.fetch=async(url,options)=>{
 if(options.headers.Authorization!=='Bearer isolated-fixture-key')throw Error('Unexpected authentication');
 if(url.href==='https://fixture-model.example/runner/config')return Response.json({model:'gpt-6.1-terra',reasoningEffort:'max',revision:1});
 if(url.href!=='https://fixture-model.example/runner/research')throw Error('Unexpected network access');
 const {input,expectedRevision}=JSON.parse(options.body);
 if(process.env.AURUM_BACKLOG_STATE&&expectedRevision!==1)throw Error('Bulk selection was not pinned');
 const events=input.evidence.filter(f=>f.type==='event');
 await appendFile('model-calls.ndjson',JSON.stringify({workIds:input.workIds,submitted:events.length})+'\\n');
 const content={headline:'对照价格与消息',interpretations:[{text:'需要结合后续收盘核对消息传导。',evidenceIds:['P-CLOSE']}],questions:[{text:'后续收盘能否确认区间变化？',evidenceIds:['P-CLOSE']}],newsReviews:events.map(f=>({id:f.id,relevance:'direct',status:'reported',dimension:'price',effect:'unclear',quote:f.label,reason:'价格报道保留为观察资料。',factor:{dimension:'none',effect:'unclear',intensity:'weak',novelty:'unknown',duration:'days',quote:f.label,mechanism:'传导证据不足，暂不修正预测。'}})),relations:[],hypotheses:[],followUps:[]};
 return Response.json({model:'gpt-6.1-terra',provider:'openai-codex',reasoningEffort:'max',revision:1,output:JSON.stringify(content),usage:{input:100,output:200}});
};\n`);
  const run=(time,extra={})=>exec(process.execPath,['--import',pathToFileURL(preload).href,script],{cwd:dir,env:{...process.env,GITHUB_ACTIONS:'true',AURUM_MODEL_ENDPOINT:'https://fixture-model.example',AURUM_MODEL_RUNNER_KEY:'isolated-fixture-key',AURUM_ANALYSIS_DEADLINE:'',FIXTURE_NOW:String(time),...extra},timeout:10000});
  await run(now);let desk=JSON.parse(await readFile(join(dir,'data/analysis-desk.json'),'utf8'));
  assert.equal(desk.aiPolicy.maxCallsPerDay,null);assert.equal(desk.aiPolicy.minimumIntervalMinutes,30);assert.equal(desk.aiPolicy.usedToday,251);assert.equal(desk.aiPolicy.pendingItems,14);assert.equal(desk.aiPolicy.queue.callsMade,1);assert.equal(desk.aiPolicy.queue.completedItems,10);assert.equal(desk.intelligence.stats.reviewed,10);assert.equal(desk.aiPolicy.continueImmediately,false);assert.equal(desk.aiPolicy.activeIntervalMinutes,30);
  assert.equal(desk.narration.model,'gpt-6.1-terra');assert.equal(desk.narration.reasoningEffort,'max');
  assert.equal(desk.aiPolicy.nextEligibleAt,new Date(now+30*60000).toISOString());
  await run(now+5*60000);desk=JSON.parse(await readFile(join(dir,'data/analysis-desk.json'),'utf8'));assert.equal(desk.aiPolicy.queue.callsMade,0);assert.equal(desk.aiPolicy.usedToday,251);assert.equal(desk.aiPolicy.pendingItems,14);
  await run(now+30*60000);desk=JSON.parse(await readFile(join(dir,'data/analysis-desk.json'),'utf8'));assert.equal(desk.aiPolicy.queue.callsMade,1);assert.equal(desk.aiPolicy.usedToday,252);assert.equal(desk.aiPolicy.pendingItems,4);
  await run(now+60*60000);desk=JSON.parse(await readFile(join(dir,'data/analysis-desk.json'),'utf8'));assert.equal(desk.aiPolicy.queue.callsMade,1);assert.equal(desk.aiPolicy.pendingItems,0);assert.equal(desk.intelligence.stats.reviewed,24);
  await run(now+90*60000);desk=JSON.parse(await readFile(join(dir,'data/analysis-desk.json'),'utf8'));assert.equal(desk.aiPolicy.queue.callsMade,0);
  const calls=(await readFile(join(dir,'model-calls.ndjson'),'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(calls.map(c=>c.workIds.length),[10,10,4]);assert.ok(calls.every(c=>c.submitted<=12));

  const bulkTime=now+61*60000;
  input.news.items.push(...Array.from({length:16},(_,i)=>({title:'黄金市场待补审报道片段第'+i+'条',
   summary:'市场仍在等待经济数据确认新的黄金传导因素。',source:'批量测试',url:'https://example.com/backlog/'+i,
   publishedAt:new Date(bulkTime-60000).toISOString(),firstSeenAt:new Date(bulkTime-60000).toISOString()})));
  await writeFile(join(dir,'data','news.json'),JSON.stringify(input.news));
  const bulkEnv={AURUM_BACKLOG_STATE:join(dir,'backlog.json'),GITHUB_RUN_ID:'22'};
  await run(bulkTime,bulkEnv);
  desk=JSON.parse(await readFile(join(dir,'data/analysis-desk.json'),'utf8'));
  const receipt=desk.aiPolicy.lastBulkReview;
  assert.deepEqual([receipt.status,receipt.total,receipt.reviewed,receipt.remaining,receipt.attempts],['completed',16,16,0,2]);
  const afterBulk=(await readFile(join(dir,'model-calls.ndjson'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(afterBulk.map(c=>c.workIds.length),[10,10,4,10,6]);
  assert.ok(afterBulk.slice(-2).every(c=>c.submitted<=12));
  await run(bulkTime+60000);
  desk=JSON.parse(await readFile(join(dir,'data/analysis-desk.json'),'utf8'));
  assert.equal(desk.aiPolicy.queue.callsMade,0);
  assert.equal(desk.aiPolicy.lastBulkReview.reviewed,16);

 }finally{await rm(dir,{recursive:true,force:true});}
});
