/* Immutable observation versions. Snapshot diagnostics never masquerade as historical availability. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.AurumVintage=factory();})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'));
 const readyAt=date=>new Date(Date.parse(date+'T00:00:00Z')+32*3600000).toISOString();
 function merge(previous={},incoming=[],now=new Date().toISOString()){
  if(!Number.isFinite(Date.parse(now)))throw Error('Invalid archive capture time');
  const records=(previous.records||[]).map(r=>({...r})),byKey=new Map(records.map(r=>[r.series+'|'+r.date+'|'+r.source+'|'+r.vintage,r]));
  for(const item of incoming){
   if(!item||!validDate(item.date)||!Number.isFinite(item.value)||!item.series||!item.source||Date.parse(item.date)>Date.parse(now))continue;
   const published=Date.parse(item.publishedAt),vintage=item.vintage||'capture',key=item.series+'|'+item.date+'|'+item.source+'|'+vintage,old=byKey.get(key);
   if(old&&old.value===item.value)continue;
   const capture=Date.parse(item.capturedAt),availableAt=Number.isFinite(published)&&item.availability==='official-vintage'?new Date(Math.max(published,Date.parse(item.date))).toISOString():item.availability==='recorded-capture'&&Number.isFinite(capture)&&capture<=Date.parse(now)?new Date(capture).toISOString():now;
   const row={...item,vintage,firstSeenAt:now,availableAt,revision:old?(old.revision||0)+1:0};
   records.push(row);byKey.set(key,row);
  }
  if(records.length>250000)throw Error('Archive capacity exceeded; retained previous file instead of deleting vintages');
  return {schema:1,generatedAt:now,records};
 }
 function select(archive,series,cutoff,{mode='strict',source}={}){
  const time=Date.parse(cutoff),byDate=new Map();if(!Number.isFinite(time))return [];
  for(const r of archive?.records||[]){if(r.series!==series||(source&&r.source!==source)||!validDate(r.date)||!Number.isFinite(r.value))continue;
   const known=Date.parse(mode==='snapshot'?readyAt(r.date):r.availableAt);if(!Number.isFinite(known)||known>time||Date.parse(r.date)>time)continue;
   const previous=byDate.get(r.date);
   if(!previous||Date.parse(r.availableAt)>Date.parse(previous.availableAt)||r.availableAt===previous.availableAt&&(r.revision||0)>(previous.revision||0))byDate.set(r.date,{...r,diagnostic:mode==='snapshot'});
  }
  return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
 }
 function summary(archive){const series={};for(const r of archive?.records||[]){const s=series[r.series]||(series[r.series]={observations:new Set(),versions:0,firstSeenAt:r.firstSeenAt,latest:r.date});s.observations.add(r.date);s.versions++;if(r.date>s.latest)s.latest=r.date;if(r.firstSeenAt<s.firstSeenAt)s.firstSeenAt=r.firstSeenAt;}return Object.fromEntries(Object.entries(series).map(([id,s])=>[id,{...s,observations:s.observations.size}]));}
 return {merge,select,summary,readyAt};
});
