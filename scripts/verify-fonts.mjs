import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile('assets/fonts/cjk-manifest.json','utf8')),css=await readFile('assets/fonts.css','utf8');
function contains(ranges,cp){let low=0,high=ranges.length-1;while(low<=high){const i=(low+high)>>1,[a,b]=ranges[i];if(cp<a)high=i-1;else if(cp>b)low=i+1;else return true;}return false;}
const blocks=[...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(m=>m[1]);
for(let i=0;i<manifest.files.length;i+=8){
 const checked=await Promise.allSettled(manifest.files.slice(i,i+8).map(async item=>{
  const raw=await readFile(item.path),sha=createHash('sha256').update(raw).digest('hex');
  if(raw.toString('ascii',0,4)!=='wOF2'||sha!==item.sha256||raw.length!==item.bytes)throw Error('CJK font asset mismatch: '+item.path);
  const block=blocks.find(b=>b.includes('url('+item.path.replace(/^assets\//,'')+')'));
  if(!block?.includes("font-family: '"+item.family+"'")&&!block?.includes("font-family:'"+item.family+"'"))throw Error('CJK font face missing: '+item.path);
  const ranges=block.match(/unicode-range:\s*([^;]+);/)?.[1],normalize=s=>String(s).replace(/\s/g,'').toUpperCase();
  if(normalize(ranges)!==normalize(item.unicodeRange))throw Error('CJK Unicode routing mismatch: '+item.path);
 }));for(const r of checked)if(r.status==='rejected')throw r.reason;
}
const news=JSON.parse(await readFile('data/news.json','utf8')),html=await readFile('index.html','utf8');
const text=html.replace(/<[^>]+>/g,' ')+news.items.map(item=>item.title+' '+(item.summary||'')).join('\n');
const used=[...new Set([...text].map(c=>c.codePointAt(0)).filter(cp=>cp>=0x3400&&cp<=0x9fff))];
const decoder=new TextDecoder('gb18030',{fatal:true}),common=[];
for(let a=0xb0;a<=0xf7;a++)for(let b=0xa1;b<=0xfe;b++)if(!(a===0xd7&&b>=0xfa))common.push(decoder.decode(Uint8Array.of(a,b)).codePointAt(0));
for(const [name,family] of Object.entries(manifest.families)){
 if(family.basicHanCovered<20900)throw Error(name+' lacks broad Han coverage');
 const missing=[...new Set(common.concat(used).filter(cp=>!contains(family.ranges,cp)))];
 if(missing.length)throw Error(name+' missing Chinese characters: '+missing.map(cp=>String.fromCodePoint(cp)).join(''));
}
if(/url\(https?:/i.test(css))throw Error('Runtime font URLs must be self-hosted');
console.log('CJK font hashes, Unicode routing, all 6,763 GB2312 Han characters and current page/news glyphs verified.');
