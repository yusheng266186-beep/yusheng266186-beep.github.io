importScripts('../vendor/xlsx.full.min.js');
self.onmessage=async event=>{
 try{
  const {buffer,name,mapping}=event.data,module=await import('./ingest.js'),progress=(message,percent)=>self.postMessage({type:'progress',message,percent});
  let data;
  if(/\.json$/i.test(name)){progress('读取数据备份',25);data=module.adaptJSON(JSON.parse(new TextDecoder().decode(buffer)),name);}
  else if(/\.csv$/i.test(name)){
   let text=new TextDecoder('utf-8').decode(buffer);if(text.includes('\uFFFD'))text=new TextDecoder('gb18030').decode(buffer);
   const w=XLSX.read(text,{type:'string',raw:true});const rows=module.rowsOf(XLSX,w.Sheets[w.SheetNames[0]]);
   if(!mapping){self.postMessage({type:'mapping',...module.detectFlat(rows),name});return;}
   data=module.parseFlat(rows,name,mapping);
  }else{
   const meta=XLSX.read(buffer,{type:'array',bookSheets:true});
   if(!meta.SheetNames.includes('学生基础')&&!meta.SheetNames.some(n=>['语文','数学','英语','日语','物理','历史','化学','生物','地理','政治'].includes(n))&&!mapping){
    const w=XLSX.read(buffer,{type:'array',sheets:[meta.SheetNames[0]],cellHTML:false,cellStyles:false});const rows=module.rowsOf(XLSX,w.Sheets[meta.SheetNames[0]]);
    self.postMessage({type:'mapping',...module.detectFlat(rows),name});return;
   }
   data=module.parseWorkbook(XLSX,buffer,name,progress,mapping);
  }
  if(!data.scores.length&&!data.answers.length)throw new Error('没有读取到成绩或小题记录。请选择原始质量复盘表，或调整字段对应关系。');
  self.postMessage({type:'done',data});
 }catch(error){self.postMessage({type:'error',message:error.message||String(error)});}
};
