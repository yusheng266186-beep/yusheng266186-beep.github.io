// One policy for automatic calls, manual refreshes, queue sizing, and public receipts.
export const RESEARCH_POLICY=Object.freeze({trigger:'new-evidence',minimumIntervalMinutes:0,catchUpIntervalMinutes:0,maxCallsPerDay:null,newItemsPerCall:8,freshItemsPerCall:4,contextItemsPerCall:2});
export function decision({desk,previous,usage,now=Date.now(),configured=false,backlog=0,force=false}){
 const day=new Date(now+8*3600000).toISOString().slice(0,10),base={call:false,day,intervalMinutes:0,nextEligibleAt:new Date(now).toISOString()};
 if(!desk.ready)return {...base,nextEligibleAt:null,reason:'价格资料不足'};
 if(!force&&!backlog&&previous?.narration?.inputKey===desk.inputKey&&['ready','partial'].includes(previous.narration.status))return {...base,nextEligibleAt:null,reason:'证据未变化，复用已有解读'};
 if(!configured)return {...base,nextEligibleAt:null,reason:'模型服务未配置，结构化研究正常运行'};
 return {...base,call:true,reason:backlog?'新消息或变更内容已到达，立即研判':'市场证据已变化，立即更新研判'};
}
