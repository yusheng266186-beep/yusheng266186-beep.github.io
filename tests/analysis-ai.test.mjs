import test from 'node:test';import assert from 'node:assert/strict';import {aiInput,canonicalize,consistent,decision,generate,parseTransport} from '../scripts/analysis-ai.mjs';
import Analysis from '../assets/analysis-engine.js';import {readFileSync} from 'node:fs';const fixture=JSON.parse(readFileSync(new URL('./fixtures/analysis-input.json',import.meta.url))),desk=Analysis.build(fixture,Date.parse(fixture._fixture.asOf)),input=aiInput(desk),valid=()=>({headline:'把相反线索放在一起核实',interpretations:[{text:'价格结构与风险线索可能存在分歧，需要后续收盘核实。',evidenceIds:['P-CLOSE']},{text:'汇率与利率的传导路径尚需核实。',evidenceIds:['F-cny','F-realRates']}],questions:[{text:'下一次收盘能否确认区间变化？',evidenceIds:['P-CLOSE']}]});
test('compact public input excludes accounts and keeps evidence references and verified numeric direction',()=>{assert.ok(input.evidence.length<=23);assert.ok(!('portfolio'in input));assert.ok(!('account'in input));const fx=input.evidence.find(f=>f.id==='F-cny');assert.ok(fx.observedChange.includes(fx.change<0?'走强':'走弱'));assert.ok(Buffer.byteLength(JSON.stringify(input))<20000);});
test('extra explanatory fields do not invalidate useful output; ungrounded, price, instruction and direction conflicts are removed',()=>{const v=valid();v.extra='harmless';assert.deepEqual(canonicalize(v,input).discardedFields,['extra']);for(const row of [{text:'预计目标价上涨',evidenceIds:['P-CLOSE']},{text:'可以保证获利',evidenceIds:['P-CLOSE']},{text:'无依据的解读',evidenceIds:['invented']},{text:'上涨概率为八成',evidenceIds:['P-CLOSE']}]){const p=valid();p.interpretations.push(row);const out=canonicalize(p,input);assert.equal(out.interpretations.length,2);assert.ok(out.warnings.length);}assert.equal(consistent('人民币走弱', ['F-cny'],{evidence:[{id:'F-cny',change:-.6}]}),false);assert.equal(consistent('人民币走强',['F-cny'],{evidence:[{id:'F-cny',change:-.6}]}),true);assert.equal(consistent('实际收益率上行',['F-realRates'],{evidence:[{id:'F-realRates',change:-.2}]}),false);assert.equal(consistent('油价上行',['F-oil'],{evidence:[{id:'F-oil',change:-2}]}),false);});
test('normal reviews run every twenty minutes, backlog catch-up every ten, with no unchanged-input calls',()=>{
 const now=Date.parse('2026-10-25T15:00:00Z'),request={desk,configured:true,now},attempt=minutes=>({day:'2026-10-25',startedAt:new Date(now-minutes*60000).toISOString(),status:'ready'});
 assert.equal(decision({...request,configured:false}).call,false);
 assert.equal(decision({...request,previous:{narration:{status:'ready',inputKey:desk.inputKey}}}).call,false);
 assert.equal(decision({...request,usage:{attempts:[attempt(19)]}}).call,false);
 assert.equal(decision({...request,usage:{attempts:[attempt(20)]}}).call,true);
 assert.equal(decision({...request,backlog:16,usage:{attempts:[attempt(9)]}}).call,false);
 assert.equal(decision({...request,backlog:16,usage:{attempts:[attempt(10)]}}).call,true);
 assert.equal(decision({...request,backlog:15,usage:{attempts:[attempt(10)]}}).call,false);
 assert.equal(decision({...request,backlog:124,usage:{attempts:[{...attempt(10),status:'failed'}]}}).call,false);
 assert.equal(decision({...request,usage:{attempts:[]}}).call,true);
});
test('daily budget covers all ten-minute windows, counts failures and manual calls, and respects China midnight',()=>{
 const now=Date.parse('2026-10-25T15:00:00Z'),attempts=Array.from({length:143},()=>({day:'2026-10-25',startedAt:'2026-10-25T01:00:00Z',status:'failed'})),request={desk,configured:true,now,usage:{attempts}};
 assert.equal(decision(request).call,true);
 attempts.push({...attempts[0]});
 assert.equal(decision(request).call,false);assert.equal(decision({...request,force:true}).call,false);
 assert.equal(decision(request).nextEligibleAt,'2026-10-25T16:00:00.000Z');
 assert.equal(decision({...request,now:Date.parse('2026-10-25T16:00:00Z')}).call,true);
 assert.equal(decision({...request,force:true,desk:{ready:false}}).call,false);
 const recent={day:'2026-10-25',startedAt:'2026-10-25T14:59:00Z',status:'dispatched'};
 assert.equal(decision({...request,usage:{attempts:[recent,attempts[0]]}}).call,false);
});
test('stream completion and actual tool traces are enforced; empty provider placeholders are accepted',()=>{const chunk=x=>'data: '+JSON.stringify(x)+'\n\n',body=chunk({model:'test',choices:[{delta:{content:JSON.stringify(valid()),function_call:{name:'',arguments:''},tool_calls:[]},finish_reason:null}]})+chunk({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:20}})+'data: [DONE]\n\n';assert.equal(parseTransport(body).usage.prompt_tokens,10);assert.throws(()=>parseTransport(body.replace('data: [DONE]','')),/INCOMPLETE/);assert.throws(()=>parseTransport(chunk({choices:[{delta:{tool_calls:[{type:'function',function:{name:'search'}}]}}]})+body),/TOOL_POLICY/);});
test('native call registers no tools, carries public compact input and emits canonical interpretation only',async()=>{
 let calls=0;
 const result=await generate(desk,{key:'private-test-key',fetchImpl:async(url,opts)=>{
  calls++;const body=JSON.parse(opts.body);assert.deepEqual(body.tools,[]);assert.equal(body.tool_choice,'none');assert.equal(body.stream,true);assert.ok(!opts.body.includes('private-test-key'));assert.equal(opts.headers.Authorization,'Bearer private-test-key');
  return {ok:true,text:async()=>JSON.stringify({model:'deepseek-v4.1-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify(valid())}}],usage:{prompt_tokens:100,completion_tokens:50}})};
 }});
 assert.equal(calls,1);assert.equal(result.status,'ready');assert.equal(result.toolsRegistered,0);
 await assert.rejects(generate(desk,{key:'private-test-key',fetchImpl:async()=>({ok:false,status:503,text:async()=>''})}),/HTTP_503/);
});
