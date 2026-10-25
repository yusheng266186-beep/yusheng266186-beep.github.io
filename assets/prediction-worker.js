/* Keep rolling regressions and historical replay off the rendering thread. */
importScripts('core.js?v=5.1.4','evidence.js?v=5.1.4','quant.js?v=5.1.4','adaptive-model.js?v=5.1.4','research-engine.js?v=5.1.4','vintage-store.js?v=5.1.4','event-engine.js?v=5.1.4','forecast-system.js?v=5.1.4');
self.onmessage=function({data}){
  try {
    const result=data.type==='replay'?(data.model?.startsWith('system')?AurumForecastSystem.replay(data.daily,data.date,data.days,data.systemInputs,{mode:data.model==='system-snapshot'?'snapshot':'strict'}):AurumResearchEngine.replay(data.daily,data.date,data.days,data.evidence,data.model)):AurumResearchEngine.profile(data.daily,data.evidence);
    self.postMessage({id:data.id,type:data.type,result});
  }catch(error){self.postMessage({id:data.id,type:data.type,error:String(error.message)});}
};
