/* Point-in-time evidence rules, shared by collector and browser. No network or DOM. */
(function(root,factory){if(typeof module==="object"&&module.exports)module.exports=factory();else root.AurumEvidence=factory();})(typeof globalThis==="object"?globalThis:this,function(){
  "use strict";
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const rules=[
    ["policy",1,/(?:lower(?:s|ed|ing)?|cut(?:s)?|reduc(?:e[ds]?|ing)) (?:the )?(?:three key )?(?:ECB )?(?:target range|interest rates?|policy rates?|federal funds)|降息|下调.{0,10}(?:政策利率|基准利率)/i,"政策利率下调"],
    ["policy",-1,/(?:rais(?:e[ds]?|ing)|hik(?:e[ds]?|ing)|increas(?:e[ds]?|ing)) (?:the )?(?:three key )?(?:ECB )?(?:target range|interest rates?|policy rates?|federal funds)|加息|上调.{0,10}(?:政策利率|基准利率)/i,"政策利率上调"],
    ["demand",1,/(?:central banks?|央行).{0,60}(?:net purchas|gold purchas|buy(?:ing)? gold|增持黄金|购金)|黄金储备.{0,8}增加/i,"央行购金需求"],
    ["demand",-1,/(?:central banks?|央行).{0,60}(?:sell(?:ing)? gold|gold sales|减持黄金|出售黄金)/i,"央行售金供给"],
    ["risk",1,/(?:military invasion|armed conflict|bank(?:ing)? crisis|sovereign default|武装冲突|军事冲突|银行危机|主权违约)/i,"明确的避险事件"],
    ["risk",-1,/(?:ceasefire agreement|peace agreement|停火协议|和平协议)/i,"避险事件缓和"],
    ["flows",1,/(?:gold.{0,15}(?:ETF|fund)|黄金.{0,6}(?:ETF|基金)).{0,35}(?:net inflows?|资金净流入)/i,"黄金基金净流入"],
    ["flows",-1,/(?:gold.{0,15}(?:ETF|fund)|黄金.{0,6}(?:ETF|基金)).{0,35}(?:net outflows?|资金净流出)/i,"黄金基金净流出"]
  ];
  function classifyNews(item){
    const text=String(item.title||"")+" "+String(item.summary||"");
    // No generic 'inflation', 'risk' or 'cut' scoring. Negated/conditional statements stay unresolved.
    if(/(?:does not|did not|not to|no plans to|may|might|could|expected to|forecast to).{0,45}(?:cut|lower|raise|hike|buy|sell)|不.{0,5}(?:降息|加息|购金)|可能|预计|有望/i.test(text))return {score:0,dimension:"unresolved",reason:"条件、预期或否定语句，未作方向判定"};
    const hits=rules.filter(r=>r[2].test(text)),sum=hits.reduce((s,r)=>s+r[1],0);
    return {score:sum?Math.sign(sum)*.6:0,dimension:hits[0]?.[0]||"unresolved",reason:hits.length?hits.map(r=>r[3]).join(" / "):"未识别明确事件方向"};
  }
  function known(item,cutoff){return Number.isFinite(Date.parse(item.firstSeenAt))&&Math.max(Date.parse(item.firstSeenAt),Date.parse(item.publishedAt)||Infinity)<=cutoff;}
  function context(data={},asOf=Date.now()){
    const cutoff=typeof asOf==="number"?asOf:Date.parse(asOf),groups=new Map(),events=[],seen=new Set();
    for(const original of data.news||[]){
      const versions=(original.versions||[]).filter(v=>Date.parse(v.firstSeenAt)<=cutoff).sort((a,b)=>Date.parse(b.firstSeenAt)-Date.parse(a.firstSeenAt));
      const item=original.versions?.length?(versions.length?{...original,...versions[0]}:null):original;
      if(!item)continue;
      if(!known(item,cutoff))continue;
      const age=(cutoff-Date.parse(item.publishedAt))/36e5;if(age<0||age>168)continue;
      const key=String(item.title||"").toLowerCase().replace(/[^\p{L}\p{N}]/gu,"")+":"+String(item.publishedAt).slice(0,10);if(seen.has(key))continue;seen.add(key);
      const s=classifyNews(item);if(!s.score)continue;
      const value=s.score*Math.exp(-Math.LN2*age/48);
      // Each provider/dimension gets one strongest event; repeated notices cannot multiply influence.
      const group=(item.source||"")+":"+s.dimension,old=groups.get(group);
      const event={id:item.id,label:s.reason,dimension:s.dimension,value,source:item.source,url:item.url,publishedAt:item.publishedAt};
      if(!old||Math.abs(value)>Math.abs(old.value))groups.set(group,event);
    }
    events.push(...groups.values());
    const newsValue=events.length?clamp(events.reduce((s,x)=>s+x.value,0)/Math.sqrt(events.length),-1,1):0;
    const snapshots=(data.snapshots||[]).filter(s=>Number.isFinite(Date.parse(s.capturedAt))&&Date.parse(s.capturedAt)<=cutoff).sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt));
    const latest=snapshots[0],drivers=[];
    for(const f of latest?.factors||[]){
      const observation=Date.parse(f.observedAt),age=(cutoff-observation)/864e5,available=Date.parse(f.availableAt||latest.capturedAt);
      if(!Number.isFinite(age)||age<0||age>7||!Number.isFinite(available)||available>cutoff||!Number.isFinite(f.signal)||!Number.isFinite(f.weight)||!(f.weight>0))continue;
      drivers.push({...f,rawValue:f.value,value:clamp(f.signal,-1,1)*Math.exp(-Math.LN2*age/5)});
    }
    const marketValue=drivers.length?clamp(drivers.reduce((s,f)=>s+f.value*f.weight,0)/Math.max(1,drivers.reduce((s,f)=>s+f.weight,0)),-1,1):0;
    return {asOf:new Date(cutoff).toISOString(),newsValue,marketValue,events,drivers,capturedAt:latest?.capturedAt||null,
      active:events.length+drivers.length,score:clamp(.35*newsValue+.65*marketValue,-1,1)};
  }
  function movement(ctx,h,sigma){
    // Explicit expert overlay, capped, transient. Not passed off as fitted or historically validated.
    return ctx?clamp(ctx.score* Math.min(.012,Math.max(.003,sigma))*5*(1-Math.exp(-h/10))*Math.exp(-Math.max(0,h-21)/252),-.04,.04):0;
  }
  return {classifyNews,context,movement};
});
