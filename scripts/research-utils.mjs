const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function parseNominal(xml){return [...xml.matchAll(/<m:properties>([\s\S]*?)<\/m:properties>/g)].map(m=>{
 const field=name=>{const text=m[1].match(new RegExp('<d:'+name+'[^>]*>([^<]+)'))?.[1];return text?.trim()?Number(text):NaN;};
 return {date:m[1].match(/<d:NEW_DATE[^>]*>([^<]+)/)?.[1]?.slice(0,10),two:field('BC_2YEAR'),ten:field('BC_10YEAR')};
}).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&Number.isFinite(r.two)&&Number.isFinite(r.ten)).sort((a,b)=>a.date.localeCompare(b.date));}
export function parseOil(csv){return csv.trim().split(/\r?\n/).slice(1).map(line=>{const [date,value]=line.split(',');return {date,value:value?.trim()?Number(value):NaN};}).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&r.value>0).sort((a,b)=>a.date.localeCompare(b.date));}
export function parsePositioning(csv){return csv.split(/\r?\n/).filter(line=>line.startsWith('"GOLD - COMMODITY EXCHANGE INC."')).map(line=>{
 const a=line.slice(line.indexOf('",')+2).split(',').map(x=>x.trim());
 return {date:a[1],openInterest:Number(a[6]),long:Number(a[12]),short:Number(a[13])};
}).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&r.openInterest>0&&r.long>=0&&r.short>=0&&r.long<=r.openInterest&&r.short<=r.openInterest).map(r=>({...r,value:(r.long-r.short)/r.openInterest})).sort((a,b)=>a.date.localeCompare(b.date));}

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
 const common={source:id,url,observationDate:last.date,timePrecision:'date-only',observedAt:last.date+'T00:00:00Z',availableAt:now};
 // Midnight is only the date-based decay reference; actual availability is the first capture.
 if(id==='nominal')return [
  {...common,id:'nominal2y',label:'美国 2 年名义收益率',group:'rates',value:last.two,change:last.two-base.two,unit:'百分点',signal:clamp(-(last.two-base.two)/.5,-1,1),weight:0,detail:'短端利率监测代理；避免与实际收益率重复施加方向先验'},
  {...common,id:'yieldCurve',label:'10 年减 2 年利差',group:'rates',value:last.ten-last.two,change:(last.ten-last.two)-(base.ten-base.two),unit:'百分点',signal:clamp(((last.ten-last.two)-(base.ten-base.two))/.5,-1,1),weight:0,detail:'监测经济周期，不预设固定黄金涨跌方向；档案充足后才可估计系数'}];
 if(id==='oil')return [{...common,id:'oil',label:'WTI 原油',value:last.value,change:(last.value/base.value-1)*100,unit:'%',signal:clamp(Math.log(last.value/base.value)/.2,-1,1),weight:0,detail:'通胀与增长的混合代理，监测输入；不预设固定利好利坏'}];
 if(id==='positioning')return [{...common,id:'positioning',label:'CFTC 管理资金净持仓占比',value:last.value*100,change:0,unit:'%',maxAgeDays:14,signal:clamp(last.value/.4,-1,1),weight:0,detail:'COMEX 黄金期货、仅期货；周度头寸可能滞后，不把拥挤方向等同于未来涨跌'}];
 if(id==='ecb')return [
  {...common,id:'cny',label:'人民币 / 美元',value:last.cny,change:(last.cny/base.cny-1)*100,unit:'%',signal:clamp(Math.log(last.cny/base.cny)/.025,-1,1),weight:1.2,detail:'20 个参考日变化；人民币走弱对国内克价偏正向'},
  {...common,id:'usd',label:'美元 / 欧元代理',value:last.usd,change:(last.usd/base.usd-1)*100,unit:'%',signal:clamp(-Math.log(last.usd/base.usd)/.04,-1,1),weight:.6,detail:'双边汇率代理，不是美元指数；美元走强偏负向'}];
 if(id==='treasury')return [{...common,id:'realRates',group:'rates',label:'美国 10 年实际收益率',value:last.value,change:last.value-base.value,unit:'百分点',signal:clamp(-(last.value-base.value)/.5,-1,1),weight:1,detail:'20 个参考日变动；实际收益率上升偏负向'}];
 return [{...common,id:'risk',label:'VIX 风险情绪',value:last.value,change:(last.value/base.value-1)*100,unit:'%',signal:clamp(Math.log(last.value/base.value)/.5,-1,1),weight:.5,detail:'权益波动代理；流动性冲击下相关关系可能改变'}];
}
export function mergeSnapshots(previous,factors,status,now){
 const old=Array.isArray(previous.snapshots)?previous.snapshots:[],last=old.at(-1);
 const signature=fs=>JSON.stringify(fs.map(f=>[f.id,f.value,f.change,f.observedAt,f.weight,f.group]));
 const stable=factors.map(f=>{const old=last?.factors?.find(x=>x.id===f.id);return old&&signature([old])===signature([f])?{...f,availableAt:old.availableAt}:f;});
 const merged=[...new Map([...(last?.factors||[]),...stable].map(f=>[f.id,f])).values()];
 const snapshots=factors.length&&signature(merged)!==signature(last?.factors||[])?old.concat({capturedAt:now,factors:merged}):old;
 return {generatedAt:now,status,snapshots:snapshots.slice(-2000)};
}

export function inflationFactor(nominal,real,now){
 const rs=new Map(real.rows.map(r=>[r.date,r.value])),paired=nominal.rows.filter(r=>r.date<=now.slice(0,10)&&rs.has(r.date));if(paired.length<2)return [];
 const a=paired.at(-1),b=paired.at(-Math.min(21,paired.length)),value=a.ten-rs.get(a.date),change=value-(b.ten-rs.get(b.date));
 return [{id:'inflation',label:'10 年盈亏平衡通胀近似',group:'rates',value,change,unit:'百分点',signal:clamp(change/.4,-1,1),weight:0,source:'treasury-derived',url:nominal.url,observationDate:a.date,observedAt:a.date+'T00:00:00Z',availableAt:now,timePrecision:'date-only',detail:'同日名义减实际收益率，含风险与流动性溢价；监测输入，不作纯通胀预期'}];
}
