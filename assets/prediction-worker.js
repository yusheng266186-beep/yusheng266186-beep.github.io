/* Keep rolling regressions and historical replay off the rendering thread. */
importScripts('core.js?v=5.1.3','evidence.js?v=5.1.3','quant.js?v=5.1.3','adaptive-model.js?v=5.1.3','research-engine.js?v=5.1.3','vintage-store.js?v=5.1.3','event-engine.js?v=5.1.3','forecast-system.js?v=5.1.3');
self.onmessage=function({data}){
  try {
    const result=data.type==='replay'?(data.model?.startsWith('system')?AurumForecastSystem.replay(data.daily,data.date,data.days,data.systemInputs,{mode:data.model==='system-snapshot'?'snapshot':'strict'}):AurumResearchEngine.replay(data.daily,data.date,data.days,data.evidence,data.model)):AurumResearchEngine.profile(data.daily,data.evidence);
    self.postMessage({id:data.id,type:data.type,result});
  }catch(error){self.postMessage({id:data.id,type:data.type,error:String(error.message)});}
};
