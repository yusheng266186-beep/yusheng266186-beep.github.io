/* Structured, version-aware events. Missing pre-event expectations remain missing. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./evidence.js'));else root.AurumEvents=factory(root.AurumEvidence);})(typeof globalThis==='object'?globalThis:this,function(Evidence){
 'use strict';const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 function at(news,cutoff,expectations=[]){const time=Date.parse(cutoff),seen=new Set(),events=[];
  for(const item of news||[]){
   const versions=item.versions?.length?item.versions:[item],usable=versions.filter(v=>Date.parse(v.firstSeenAt||item.firstSeenAt)<=time&&Date.parse(v.publishedAt||item.publishedAt)<=time).sort((a,b)=>Date.parse(b.firstSeenAt)-Date.parse(a.firstSeenAt)),v=usable[0];if(!v)continue;
   const knownAt=new Date(Math.max(Date.parse(v.firstSeenAt||item.firstSeenAt),Date.parse(v.publishedAt||item.publishedAt))).toISOString(),age=(time-Date.parse(v.publishedAt||item.publishedAt))/86400000;if(age<0||age>3650)continue;
   const text=(v.title||item.title||'')+' '+(v.summary||item.summary||''),key=(v.title||item.title||'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');if(seen.has(key))continue;seen.add(key);
   const signal=Evidence.classifyNews({...item,...v}),conditional=/可能|或将|预计|若|如果|\b(?:may|might|could|expects?|forecast|if)\b/i.test(text);
   const indicator=/\bCPI\b|消费者物价|居民消费价格/i.test(text)?'CPI':/非农|\bpayrolls?\b/i.test(text)?'payrolls':/FOMC|联邦基金|降息|加息/i.test(text)?'policy':null;
   const actual=Number.isFinite(v.actual)?v.actual:null,period=v.period||item.period||null;
   // A consensus printed after the release is never treated as a pre-event expectation.
   const prior=expectations.filter(e=>e.indicator===indicator&&period&&e.period===period&&Number.isFinite(e.value)&&e.unit===v.unit&&Date.parse(e.knownAt)<Date.parse(v.publishedAt||item.publishedAt)&&Date.parse(e.eventAt)<=time&&/^https:\/\//.test(e.url||'')).sort((a,b)=>Date.parse(b.knownAt)-Date.parse(a.knownAt))[0];
   const surprise=actual!==null&&prior?actual-prior.value:null;
   events.push({id:item.id||key,title:v.title||item.title,summary:v.summary||'',source:item.source,url:item.url,publishedAt:v.publishedAt||item.publishedAt,knownAt,ageDays:age,dimension:surprise!==null?'surprise:'+indicator+':'+v.unit:signal?.dimension||'unclassified',direction:surprise!==null?Math.sign(surprise):conditional?0:Math.sign(signal?.score||0),conditional:surprise!==null?false:conditional,novelty:Math.exp(-Math.LN2*age/2),indicator,period,actual,consensus:prior?.value??null,surprise,unit:v.unit||null,expectationUrl:prior?.url||null,reason:surprise!==null?'预先归档的同单位预期差；方向关系由到期反应估计':signal?.reason||'未识别出明确已发生的方向事件'});
  }
  return events.sort((a,b)=>Date.parse(b.knownAt)-Date.parse(a.knownAt));
 }
 function response(events,rows,cutoff,h){const time=Date.parse(cutoff),groups={},occupied={};
  for(const e of [...events].sort((a,b)=>Date.parse(a.knownAt)-Date.parse(b.knownAt))){if(!e.direction||e.conditional)continue;const start=rows.findIndex(r=>Date.parse(r.time+'T15:30:00+08:00')>Date.parse(e.knownAt)),end=start+Math.min(h,21);if(start<0||!rows[end]||Date.parse(rows[end].time+'T15:30:00+08:00')>time||start<=(occupied[e.dimension]??-1))continue;
   occupied[e.dimension]=end;(groups[e.dimension]||(groups[e.dimension]=[])).push({value:Math.log(rows[end].close/rows[start].close)*e.direction,target:rows[end].time,eventId:e.id});
  }
  return Object.fromEntries(Object.entries(groups).map(([dim,items])=>[dim,{count:items.length,mean:items.length>=12?items.slice(-60).reduce((s,r)=>s+r.value,0)/Math.min(60,items.length):null}]));
 }
 function overlay(news,rows,cutoff,h,sigma,expectations=[]){const events=at(news,cutoff,expectations),history=response(events,rows,cutoff,h),active=events.filter(e=>e.ageDays<=5&&e.direction&&!e.conditional),used=new Set();let move=0;
  for(const e of active){const r=history[e.dimension];if(used.has(e.dimension)||!r||r.count<12)continue;used.add(e.dimension);move+=e.direction*r.mean*e.novelty;}
  return {events:events.slice(0,40),history,trainedDimensions:used.size,move:clamp(move,-Math.min(.02,sigma*Math.sqrt(h)*.5),Math.min(.02,sigma*Math.sqrt(h)*.5))};
 }
 return {at,response,overlay};
});
