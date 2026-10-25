export function parseSinaSpot(text){
 const match=text.match(/var\s+\w+\s*=\s*\(([\s\S]*)\)\s*;?\s*$/);if(!match)throw Error('No dated XAU JSONP payload');
 const data=JSON.parse(match[1]);if(!Array.isArray(data))throw Error('XAU payload is not an array');
 return data.map(r=>({date:r.date,value:Number(r.close)})).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&r.value>100&&r.value<50000);
}
export function parseSinaFx(text){const match=text.match(/var\s+\w+\s*=\s*\(("[\s\S]*")\)\s*;?\s*$/);if(!match)throw Error('No dated FX JSONP payload');return JSON.parse(match[1]).split('|').map(row=>{const [date,,,,close]=row.split(',');return {date,value:Number(close)};}).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&r.value>2&&r.value<15);}
export function parseEcbFx(xml){return [...xml.matchAll(/<Cube time=['"]([^'"]+)['"]>([\s\S]*?)<\/Cube>/g)].map(m=>{const get=id=>Number(m[2].match(new RegExp("currency=['\"]"+id+"['\"] rate=['\"]([^'\"]+)"))?.[1]);return {date:m[1],value:get('CNY')/get('USD')};}).filter(r=>r.value>2&&r.value<15);}
export function rowsToArchive(rows,{series,source,url,now}){return rows.filter(r=>r.date>='2019-01-01'&&r.date<now.slice(0,10)).map(r=>({...r,series,source,url,unit:series==='goldUsdOz'?'USD/troy-oz':'CNY/USD',availability:'first-capture'}));}
