const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function parseEcb(xml){
 return [...xml.matchAll(/<Cube time=['"]([^'"]+)['"]>([\s\S]*?)<\/Cube>/g)].map(m=>{
 const rates=Object.fromEntries([...m[2].matchAll(/currency=['"]([^'"]+)['"] rate=['"]([^'"]+)['"]/g)].map(x=>[x[1],Number(x[2])]));
 return {date:m[1],cny:rates.CNY/rates.USD,usd:1/rates.USD};
 }).filter(r=>r.cny>0&&r.usd>0).sort((a,b)=>a.date.localeCompare(b.date));
}
export function parseTreasury(xml){
 return [...xml.matchAll(/<m:properties>([\s\S]*?)<\/m:properties>/g)].map(m=>{
 const date=m[1].match(/<d:NEW_DATE[^>]*>([^<]+)/)?.[1]?.slice(0,10),value=Number(m[1].match(/<d:TC_10YEAR[^>]*>([^<]+)/)?.[1]);return {date,value};
 }).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&Number.isFinite(r.value)).sort((a,b)=>a.date.localeCompare(b.date));
}
export function parseVix(csv){
 return csv.trim().split(/\r?\n/).slice(1).map(line=>{const a=line.split(','),d=a[0].split('/');return {date:`${d[2]}-${d[0]?.padStart(2,'0')}-${d[1]?.padStart(2,'0')}`,value:Number(a[4])};}).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&r.value>0).sort((a,b)=>a.date.localeCompare(b.date));
}
export function buildFactors({id,url,rows},now){
 rows=rows.filter(r=>r.date<=now.slice(0,10));const last=rows.at(-1),base=rows.at(-Math.min(21,rows.length));if(!last||!base)return [];
 const common={source:id,url,observedAt:last.date+'T23:59:59Z',availableAt:now};
 // Dates lack release time. Use end-of-day and never backdate first availability.
 if(id==='ecb')return [
  {...common,id:'cny',label:'人民币 / 美元',value:last.cny,change:(last.cny/base.cny-1)*100,unit:'%',signal:clamp(Math.log(last.cny/base.cny)/.025,-1,1),weight:1.2,detail:'20 个参考日变化；人民币走弱对国内克价偏正向'},
  {...common,id:'usd',label:'美元 / 欧元代理',value:last.usd,change:(last.usd/base.usd-1)*100,unit:'%',signal:clamp(-Math.log(last.usd/base.usd)/.04,-1,1),weight:.6,detail:'双边汇率代理，不是美元指数；美元走强偏负向'}];
 if(id==='treasury')return [{...common,id:'realRates',label:'美国 10 年实际收益率',value:last.value,change:last.value-base.value,unit:'百分点',signal:clamp(-(last.value-base.value)/.5,-1,1),weight:1,detail:'20 个参考日变动；实际收益率上升偏负向'}];
 return [{...common,id:'risk',label:'VIX 风险情绪',value:last.value,change:(last.value/base.value-1)*100,unit:'%',signal:clamp(Math.log(last.value/base.value)/.5,-1,1),weight:.5,detail:'权益波动代理；流动性冲击下相关关系可能改变'}];
}
export function mergeSnapshots(previous,factors,status,now){
 const old=Array.isArray(previous.snapshots)?previous.snapshots:[],last=old.at(-1);
 const signature=fs=>JSON.stringify(fs.map(f=>[f.id,f.value,f.change,f.observedAt]));
 const merged=[...new Map([...(last?.factors||[]),...factors].map(f=>[f.id,f])).values()];
 const snapshots=factors.length&&signature(merged)!==signature(last?.factors||[])?old.concat({capturedAt:now,factors:merged}):old;
 return {generatedAt:now,status,snapshots:snapshots.slice(-2000)};
}
