import {readFile,appendFile} from 'node:fs/promises';
import {actionsApi,dispatchWorkflow} from './actions-api.mjs';import {recoveryDecision} from './update-service.mjs';
let health={};try{health=JSON.parse(await readFile('data/pipeline-health.json','utf8'));}catch{}
const response=await actionsApi('actions/workflows/refresh-research.yml/runs?branch=main&per_page=30');
const decision=recoveryDecision({health,runs:response.workflow_runs||[],force:process.env.FORCE_RECOVERY==='true',failedEvent:process.env.UPSTREAM_CONCLUSION==='failure'});
for(const id of decision.cancel)await actionsApi('actions/runs/'+id+'/cancel',{method:'POST'});
// A canceled window may still own the concurrency slot; the new one queues safely.
if(decision.recover||decision.cancel.length)await dispatchWorkflow('refresh-research.yml');
console.log(JSON.stringify(decision));
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'\nUpdate service recovery check: '+JSON.stringify(decision)+'\n');
