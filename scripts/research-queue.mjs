// Drain a fixed evidence snapshot without sleeps or a call-count cap. Checkpoint each
// result; the finite Actions window hands remaining work to the next window.
export async function drainResearchQueue({buildInput,run,onResult,onError,now=Date.now,deadline=Infinity,requestReserveMs=115000}){
 const attempted=new Set();let callsMade=0,completedItems=0,stopReason='runtime-budget';
 while(now()+requestReserveMs<=deadline){
  const input=buildInput([...attempted],now()),ids=input.workIds||[];
  if(!ids.length&&(callsMade||input.backlog)){stopReason=input.backlog?'unresolved-items':'queue-empty';break;}
  ids.forEach(id=>attempted.add(id));callsMade++;
  let result;
  try{result=await run(input);}catch(error){await onError(error,input);stopReason='provider-error';break;}
  completedItems+=ids.filter(id=>result.reviews?.[id]?.factor).length;
  await onResult(result,input,{callsMade,attemptedItems:attempted.size,completedItems,stopReason:'processing'});
  if(!ids.length){stopReason='queue-empty';break;}
 }
 return {callsMade,attemptedItems:attempted.size,completedItems,stopReason};
}
