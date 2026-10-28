// One policy for automatic calls, manual refreshes, queue sizing, and public receipts.
export const RESEARCH_POLICY=Object.freeze({minimumIntervalMinutes:20,catchUpIntervalMinutes:10,catchUpBacklog:16,maxCallsPerDay:144,newItemsPerCall:8,freshItemsPerCall:4,contextItemsPerCall:2});
export function decision({desk,previous,usage,now=Date.now(),configured=false,backlog=0,force=false}){
 const p=RESEARCH_POLICY,day=new Date(now+8*3600000).toISOString().slice(0,10),attempts=Array.isArray(usage?.attempts)?usage.attempts:[],today=attempts.filter(a=>a.day===day);
 const latest=attempts.filter(a=>Number.isFinite(Date.parse(a.startedAt))).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt))[0];
 // Failed/incomplete work waits for the normal window rather than a fast retry loop.
 const intervalMinutes=backlog>=p.catchUpBacklog&&latest?.status!=='failed'?p.catchUpIntervalMinutes:p.minimumIntervalMinutes;
 const eligible=latest?Date.parse(latest.startedAt)+intervalMinutes*60000:now,base={call:false,day,intervalMinutes,nextEligibleAt:new Date(Math.max(now,eligible)).toISOString()};
 if(!desk.ready)return {...base,nextEligibleAt:null,reason:'价格资料不足'};
 if(!force&&previous?.narration?.inputKey===desk.inputKey&&['ready','partial'].includes(previous.narration.status))return {...base,nextEligibleAt:null,reason:'证据未变化，复用已有解读'};
 if(!configured)return {...base,nextEligibleAt:null,reason:'模型服务未配置，结构化研究正常运行'};
 if(today.length>=p.maxCallsPerDay)return {...base,nextEligibleAt:new Date(Date.parse(day+'T16:00:00Z')).toISOString(),reason:'今日模型研判已达'+p.maxCallsPerDay+'次尝试上限，继续采集并保留待处理消息'};
 if(!force&&now<eligible)return {...base,reason:'证据已更新，等待下一次'+intervalMinutes+'分钟研判窗口'};
 return {...base,call:true,reason:backlog>=p.catchUpBacklog?'分批追赶待处理消息':'处理新增或变更的证据'};
}
