// One policy for automatic calls, manual refreshes, queue sizing, and public receipts.
export const RESEARCH_POLICY=Object.freeze({trigger:'half-hour-window',minimumIntervalMinutes:30,catchUpIntervalMinutes:30,maxCallsPerDay:null,maxCallsPerCycle:1,newItemsPerCall:8,freshItemsPerCall:4,contextItemsPerCall:2});
export function decision({desk,previous,usage,now=Date.now(),configured=false,backlog=0,force=false}){
 const intervalMinutes=RESEARCH_POLICY.minimumIntervalMinutes,day=new Date(now+8*3600000).toISOString().slice(0,10),times=(Array.isArray(usage?.attempts)?usage.attempts:[]).map(a=>Date.parse(a.startedAt)).filter(Number.isFinite),latest=times.length?Math.max(...times):null,eligible=latest===null?now:latest+intervalMinutes*60000,base={call:false,day,intervalMinutes,nextEligibleAt:new Date(Math.max(now,eligible)).toISOString()};
 if(!desk.ready)return {...base,nextEligibleAt:null,reason:'价格资料不足'};
 if(!force&&!backlog&&previous?.narration?.inputKey===desk.inputKey&&['ready','partial'].includes(previous.narration.status))return {...base,nextEligibleAt:null,reason:'证据未变化，复用已有解读'};
 if(!configured)return {...base,nextEligibleAt:null,reason:'模型服务未配置，结构化研究正常运行'};
 // Failed calls and manual refreshes use the same interval, including across midnight.
 if(now<eligible)return {...base,reason:'消息已保留，等待下一次半小时研判窗口'};
 return {...base,call:true,reason:'半小时研判窗口已到，处理新增或变更的证据'};
}
