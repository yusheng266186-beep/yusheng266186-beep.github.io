import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Intelligence=require('../assets/research-intelligence.js');
const hosts=['sge.com.cn','pbc.gov.cn','stats.gov.cn','safe.gov.cn','federalreserve.gov','ecb.europa.eu','bea.gov','bls.gov','gold.org','finance.sina.com.cn','cnbc.com','bbc.co.uk','bbc.com'];
export function safeArticleUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))?u.href:null;}catch{return null;}}
const entities=s=>s.replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(x[\da-f]+|\d+);/gi,(all,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';});
export function extractExcerpt(html){
 const safe=html.replace(/<(script|style|nav|header|footer|aside|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' '),body=safe.match(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i)?.[1]||safe;
 const paragraphs=[...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m=>entities(m[1].replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim()).filter(s=>s.length>=35&&!/cookie|javascript|订阅|版权|广告|登录|隐私|copyright|all rights reserved|subscribe|sign in/i.test(s));
 const seen=new Set();return paragraphs.filter(p=>!seen.has(p)&&seen.add(p)).slice(0,7).join('\n').slice(0,1200);
}
export async function fetchArticle(url,{fetchImpl=fetch}={}){
 let current=safeArticleUrl(url);if(!current)throw Error('UNSUPPORTED_PUBLISHER');const signal=AbortSignal.timeout(9000);
 for(let i=0;i<4;i++){const r=await fetchImpl(current,{redirect:'manual',headers:{'User-Agent':'AurumGoldResearch/5.2.0 (+https://github.com/yusheng266186-beep/yusheng266186-beep.github.io)','Accept':'text/html'},signal});
  if(r.status>=300&&r.status<400){const next=safeArticleUrl(new URL(r.headers.get('location')||'',current).href);if(!next)throw Error('UNSAFE_REDIRECT');current=next;continue;}
  if(!r.ok)throw Error('ARTICLE_HTTP_'+r.status);if(!/text\/html/i.test(r.headers.get('content-type')||''))throw Error('ARTICLE_NOT_HTML');if(Number(r.headers.get('content-length'))>1200000)throw Error('ARTICLE_TOO_LARGE');
  const reader=r.body.getReader(),chunks=[];let size=0;try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1200000)throw Error('ARTICLE_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=Buffer.concat(chunks),charset=/charset\s*=\s*["']?([\w-]+)/i.exec(r.headers.get('content-type')||'')?.[1]||/charset\s*=\s*["']?([\w-]+)/i.exec(bytes.subarray(0,2048).toString())?.[1]||'utf-8';let html;try{html=new TextDecoder(charset).decode(bytes);}catch{html=bytes.toString('utf8');}
  const excerpt=extractExcerpt(html);if(excerpt.length<80)throw Error('ARTICLE_BODY_UNAVAILABLE');return {url:current,excerpt};
 }throw Error('ARTICLE_REDIRECT_LIMIT');
}
export async function enrichArticles(desk,previous={},options={}){
 const now=options.now??Date.now(),cache=new Map((previous.articles||[]).filter(a=>Number.isFinite(Date.parse(a.capturedAt))&&Date.parse(a.capturedAt)<=now).map(a=>[a.key,a])),requests=new Set((previous.followUps||[]).filter(r=>desk.events.some(f=>f.id===r.id&&Intelligence.fingerprint(f)===r.fingerprint)).map(r=>r.id));
 const priority=f=>(requests.has(f.id)?1000:0)+(f.weight||0)-f.ageDays*4;
 const candidates=desk.events.filter(f=>safeArticleUrl(f.url)).filter(f=>{const a=cache.get(Intelligence.articleKey(f));return !a||a.status!=='ok'&&now-Date.parse(a.capturedAt)>2*3600000;}).sort((a,b)=>priority(b)-priority(a)).slice(0,4);
 const results=await Promise.allSettled(candidates.map(async f=>{const entry={key:Intelligence.articleKey(f),id:f.id,sourceUrl:f.url,capturedAt:new Date(now).toISOString(),requestedByAI:requests.has(f.id)};try{return {...entry,status:'ok',...await fetchArticle(f.url,options),capturedAt:new Date(options.captureNow?.()??now).toISOString()};}catch(error){return {...entry,status:'unavailable',reason:/^[A-Z_0-9]+$/.test(error.message)?error.message:'ARTICLE_FETCH_FAILED'};}}));
 for(const result of results)if(result.status==='fulfilled')cache.set(result.value.key,result.value);
 const keys=new Set(desk.events.map(Intelligence.articleKey));return [...cache.values()].filter(a=>keys.has(a.key)).sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt)).slice(0,80);
}
