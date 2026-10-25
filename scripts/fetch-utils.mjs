export async function fetchText(url,{timeoutMs=12000,retries=2,maxChars=6000000,fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),headers={}}={}){
 let last;
 for(let attempt=0;attempt<=retries;attempt++){
  try{
   const res=await fetchImpl(url,{signal:AbortSignal.timeout(timeoutMs),headers:{'User-Agent':'Mozilla/5.0 AurumResearch/4.4.1',...headers},cache:'no-store'});
   if(!res.ok){const error=Error(`HTTP ${res.status}`);error.retryable=res.status===429||res.status>=500;throw error;}
   const text=await res.text();if(text.length>maxChars)throw Object.assign(Error('Response exceeds data limit'),{retryable:false});return text;
  }catch(error){last=error;if(error.retryable===false||attempt===retries)throw error;await sleep(250*2**attempt);}
 }
 throw last;
}
