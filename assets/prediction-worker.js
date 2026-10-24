/* Keep rolling regressions and historical replay off the rendering thread. */
importScripts('core.js?v=4.4.0','evidence.js?v=4.4.0','quant.js?v=4.4.0');
self.onmessage=function({data}){
  try {
    const result=data.type==='replay'?AurumQuant.replay(data.daily,data.date,data.days,data.evidence):AurumQuant.profile(data.daily,data.evidence);
    self.postMessage({id:data.id,type:data.type,result});
  }catch(error){self.postMessage({id:data.id,type:data.type,error:String(error.message)});}
};
