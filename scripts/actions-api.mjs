export async function actionsApi(path,{method='GET',body,fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const repo=process.env.GITHUB_REPOSITORY,token=process.env.GH_TOKEN;
 if(!/^[\w.-]+\/[\w.-]+$/.test(repo||'')||!token)throw Error('Actions repository/token unavailable');
 for(let attempt=0;attempt<3;attempt++){
  try{
   const response=await fetchImpl('https://api.github.com/repos/'+repo+'/'+path,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
   if(!response.ok){const error=Error('GitHub Actions API HTTP '+response.status);error.retryable=response.status===429||response.status>=500;throw error;}
   return response.status===204?null:await response.json();
  }catch(error){if(error.retryable===false||attempt===2)throw error;await sleep(1000*2**attempt);}
 }
}
export const dispatchWorkflow=(file,inputs={})=>actionsApi('actions/workflows/'+encodeURIComponent(file)+'/dispatches',{method:'POST',body:{ref:'main',inputs}});
