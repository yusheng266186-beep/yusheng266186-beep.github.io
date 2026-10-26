import {parseTransport,transportAudit} from './analysis-ai.mjs';
// Native SSE repeats provider metadata on each token. Bound the wire separately
// from meaningful output and discard transport overhead as it arrives.
export async function readResearchTransport(response){
 if(!response.body?.getReader){const raw=await response.text();if(raw.length>16e6)throw Error('MODEL_RESPONSE_TOO_LARGE');return parseTransport(raw);}
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',bytes=0,mode='',content='',finish='',model='',usage={},done=false;
 function line(raw){if(!raw.startsWith('data:'))return;const value=raw.slice(5).trim();if(value==='[DONE]'){done=true;return;}if(!value)return;const p=JSON.parse(value),c=p.choices?.[0];if(p.error)throw Error('MODEL_STREAM_ERROR');
  if(transportAudit(p)||p.choices?.some(c=>(c.delta?.tool_calls||[]).some(t=>t.id||t.type||t.function?.name||t.function?.arguments)||c.delta?.function_call?.name||c.delta?.function_call?.arguments))throw Error('MODEL_TOOL_POLICY_VIOLATION');
  if(typeof c?.delta?.content==='string')content+=c.delta.content;if(content.length>200000)throw Error('MODEL_CONTENT_TOO_LARGE');if(c?.finish_reason)finish=c.finish_reason;if(p.model)model=p.model;if(p.usage)usage=p.usage;
 }
 try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>16e6)throw Error('MODEL_RESPONSE_TOO_LARGE');buffer+=decoder.decode(chunk.value,{stream:true});if(!mode&&buffer.trim())mode=buffer.trimStart().startsWith('{')?'json':'sse';if(mode==='sse'){const lines=buffer.split('\n');buffer=lines.pop();for(const value of lines)line(value.replace(/\r$/,''));if(buffer.length>1000000)throw Error('MODEL_FRAME_TOO_LARGE');}else if(buffer.length>1000000)throw Error('MODEL_CONTENT_TOO_LARGE');}
  buffer+=decoder.decode();if(mode==='json')return parseTransport(buffer);for(const value of buffer.split(/\r?\n/))line(value);if(!done||finish!=='stop'||!content)throw Error('MODEL_INCOMPLETE');return {model,usage,choices:[{finish_reason:finish,message:{content}}]};
 }catch(error){if(usage.prompt_tokens||usage.completion_tokens)error.usage={input:usage.prompt_tokens||0,output:usage.completion_tokens||0};throw error;}finally{await reader.cancel().catch(()=>{});}
}
