import { normalizeDataset, latestExam, EXAM_ORDER, SUBJECTS, selectScores, profile, studentAt, nearLine, personName, invalidate } from './model.js';
import { overview } from './views/overview.js';
import { effective } from './views/effective.js';
import { classroom } from './views/classroom.js';
import { history } from './views/history.js';
import { items } from './views/items.js';
import { student } from './views/student.js';
import { actions } from './views/actions.js';
import { reports } from './views/reports.js';
import { library } from './views/data.js';
import { icon, esc, button, empty, fmt, select, panel } from './ui.js';
import { readDataset, writeDataset, clearDataset, loadSample, readPrefs, writePrefs } from './store.js';
import { mergeDatasets, FLAT_FIELDS } from './ingest.js';
import { spreadsheet, backup, reportDOCX, printReport, exportSVG, exportPNG } from './export.js';

const routes=[
 {id:'overview',name:'年级研判',subtitle:'从整体结构看学情',group:'研究视野',render:overview},
 {id:'effective',name:'有效达线',subtitle:'有效人、双上线与任务',render:effective},
 {id:'classroom',name:'一卷透视',subtitle:'一个班的单次成绩',render:classroom},
 {id:'history',name:'纵向对照',subtitle:'并列考次与共同参考',render:history},
 {id:'items',name:'逐题研究',subtitle:'学科、试题和知识点',group:'走近学生',render:items},
 {id:'student',name:'个人轨迹',subtitle:'一个人的全部成绩',render:student},
 {id:'actions',name:'临界行动',subtitle:'从临界到具体跟进',render:actions},
 {id:'reports',name:'报告工坊',subtitle:'可编辑研判与多格式导出',group:'研究材料',render:reports},
 {id:'data',name:'数据书房',subtitle:'本机导入、口径与备份',render:library}
];
const main=document.getElementById('main'),fileInput=document.getElementById('file-input'),importDialog=document.getElementById('import-dialog'),paletteDialog=document.getElementById('palette-dialog');
let data=null,states={},current='overview',view=null,importing=false,pendingMapping=null,renderTimer=null;
let plans=readPrefs('actions',[]);
const number=v=>v==null||String(v).trim()===''?null:Number.isFinite(Number(v))?Number(v):null;
const today=()=>new Date().toLocaleDateString('zh-CN');
function defaults(){
 const e=latestExam(data),prev=data.exams.at(-2)?.id||e,initialSid=data.students[0]?.id;
 return {
  overview:{exam:e,track:'physics',cohort:'regular'},
  effective:{exam:e,previous:prev,track:'physics',cohort:'regular',language:'all',mode:'totals',subject:'数学',tier:'under'},
  classroom:{exam:e,classNo:4,mode:'scores',baseline:'type',search:'',sort:'total',page:1},
  history:{classNo:4,exams:data.exams.slice(-6).map(e=>e.id),metric:'avg',matrix:'total',matched:false,search:'',sort:'name'},
  items:{exam:e,subject:'数学',track:'physics',cohort:'regular',classes:[],mode:'questions',heatLevel:'class',search:'',question:null,page:1},
  student:{sid:initialSid,exam:e,subject:'语文',trendSubject:'数学',search:'',metric:'total'},
  actions:{exam:e,track:'physics',cohort:'regular',classes:[],tier:'under',window:data.rules?.criticalWindow||20,side:'below'},
  reports:{exam:e,type:'grade',classNo:4,sid:initialSid,subject:'数学',track:'physics',cohort:'regular',notes:''},
  data:{tab:'sources',importMode:'merge',classNo:4,lineExam:e,lineTrack:'physics',subject:'物理',bankExam:e}
 };
}
function setupStates(reset=false){
 const defs=defaults();
 for(const route of routes)states[route.id]={...defs[route.id],...(reset?{}:readPrefs('view:'+route.id,{}))};
 sanitize();
}
function sanitize(){
 const ids=new Set(data.exams.map(e=>e.id)),classes=new Set(Object.keys(data.profiles).map(Number)),people=new Set(data.students.map(s=>s.id));
 for(const state of Object.values(states)){
  for(const key of ['exam','previous','lineExam','bankExam'])if(key in state&&!ids.has(state[key]))state[key]=latestExam(data);
  if('classNo' in state&&!classes.has(Number(state.classNo)))state.classNo=[...classes][0]||1;
  if('sid' in state&&!people.has(state.sid))state.sid=data.students[0]?.id;
  if(state.classes)state.classes=state.classes.map(String).filter(n=>classes.has(Number(n)));
  if(state.exams)state.exams=state.exams.filter(e=>ids.has(e));
 }
}
function toast(message,error=false){
 const el=document.createElement('div');el.className='toast'+(error?' error':'');el.textContent=message;document.getElementById('toasts').append(el);setTimeout(()=>el.remove(),error?6500:3500);
}
function nav(){
 document.getElementById('navigation').innerHTML=routes.map((r,i)=>(r.group?'<div class="nav-section">'+r.group+'</div>':'')+'<a href="#'+r.id+'" class="nav-link '+(current===r.id?'active':'')+'"'+(current===r.id?' aria-current="page"':'')+'>'+icon(r.id)+'<span>'+r.name+'</span><small>0'+(i+1)+'</small></a>').join('');
 document.getElementById('breadcrumb').textContent=routes.find(r=>r.id===current)?.name||'年级研判';
 document.getElementById('data-status').textContent=data.anonymous?'匿名样本 · 本机分析':'本机成绩 · '+data.exams.length+'场';
 document.title='见微 · '+(routes.find(r=>r.id===current)?.name||'学情研究台');
}
function render(animate=false){
 if(!data)return;
 const focused=document.activeElement,field=focused?.dataset.field,selection=focused?.selectionStart,scroll=main.scrollTop;
 const route=routes.find(r=>r.id===current)||routes[0],s=states[current];
 try{
  view=route.render(data,s,{actions:plans});
  main.innerHTML=view.html;
  main.classList.toggle('view-enter',animate);
  writePrefs('view:'+current,s);nav();
  if(field){const target=main.querySelector('[data-field="'+CSS.escape(field)+'"]');if(target){target.focus({preventScroll:true});if(selection!=null&&target.setSelectionRange)try{target.setSelectionRange(selection,selection);}catch{}}}
  main.scrollTop=scroll;
 }catch(error){
  main.innerHTML=empty('这个分析暂时无法展开',error.message)+button('打开数据书房','open-data','primary');
 }
}
function go(route,patch={}){
 clearTimeout(renderTimer);
 if(!routes.some(r=>r.id===route))route='overview';
 Object.assign(states[route],patch);writePrefs('view:'+route,states[route]);document.body.classList.remove('menu-open');
 if(current===route){render(true);return;}
 if(location.hash.slice(1)===route){current=route;render(true);}else location.hash=route;
}
window.addEventListener('hashchange',()=>{
 clearTimeout(renderTimer);
 const route=location.hash.slice(1);current=routes.some(r=>r.id===route)?route:'overview';
 const update=()=>{render(true);window.scrollTo({top:0,behavior:'instant'});};
 if(document.startViewTransition&&!matchMedia('(prefers-reduced-motion: reduce)').matches)document.startViewTransition(update);else update();
});
function setField(key,value){
 const s=states[current];s[key]=value;if(['search','sort','exam','classNo','subject','mode','heatLevel'].includes(key))s.page=1;
 if(['track','cohort'].includes(key)&&s.classes)s.classes=[];
 if(key==='subject'||key==='exam')if('question' in s)s.question=null;
 if(current==='student'&&key==='search'&&value){const found=data.students.filter(p=>p.name.includes(value));if(found.length&&!found.some(p=>p.id===s.sid))s.sid=found[0].id;}
 writePrefs('view:'+current,s);render();
}
document.addEventListener('change',event=>{
 const t=event.target;if(t.dataset.multi){
  const key=t.dataset.multi,list=states[current][key]||[],value=String(t.value);
  states[current][key]=t.checked?[...new Set([...list,value])]:list.filter(v=>v!==value);states[current].page=1;render();return;
 }
 if(t.dataset.planToggle){const p=plans.find(p=>p.id===t.dataset.planToggle);if(p){p.status=t.checked?'done':'doing';writePrefs('actions',plans);render();}return;}
 if(t.dataset.field&&!t.matches('input[type=search],textarea'))setField(t.dataset.field,t.type==='checkbox'?t.checked:['classNo','window','question'].includes(t.dataset.field)?Number(t.value):t.value);
});
document.addEventListener('input',event=>{
 const t=event.target;
 if(t.dataset.planNote){const p=plans.find(p=>p.id===t.dataset.planNote);if(p){p.note=t.value;writePrefs('actions',plans);}return;}
 if(t.dataset.field&&t.matches('input[type=search],textarea')){
  const key=t.dataset.field,value=t.value,route=current;states[route][key]=value;writePrefs('view:'+route,states[route]);clearTimeout(renderTimer);renderTimer=setTimeout(()=>{if(current===route)setField(key,value);},220);
 }
});
document.addEventListener('click',async event=>{
 const b=event.target.closest('[data-action],[data-set]');if(!b||b.disabled)return;
 if(b.dataset.set){setField(b.dataset.set,b.dataset.value);return;}
 const action=b.dataset.action,s=states[current];
 try{
  if(action==='menu'){document.body.classList.toggle('menu-open');return;}
  if(action==='import'){fileInput.click();return;}
  if(action==='open-data'){go('data');return;}
  if(action==='open-actions'){go('actions',{exam:s.exam,track:s.track||profile(data,s.classNo).track,cohort:s.cohort||profile(data,s.classNo).cohort});return;}
  if(action==='open-class'){go('classroom',{classNo:Number(b.dataset.class),exam:s.exam||latestExam(data),search:'',page:1});return;}
  if(action==='open-student'){paletteDialog.close();go('student',{sid:b.dataset.sid,exam:b.dataset.exam||s.exam||latestExam(data),search:''});return;}
  if(action==='focus-question'){s.question=Number(b.dataset.index);render();main.querySelector('.question-focus')?.scrollIntoView({behavior:'smooth',block:'center'});return;}
  if(action==='clear-question'){s.question=null;render();return;}
  if(action==='page-prev'||action==='page-next'){s.page=Math.max(1,(s.page||1)+(action==='page-next'?1:-1));render();return;}
  if(action==='export-view'){await spreadsheet(view.sheets,'见微-'+routes.find(r=>r.id===current).name);toast('Excel 已在本机生成');return;}
  if(action==='chart-export'){exportSVG(b.dataset.chart);return;}
  if(action==='chart-png'){exportPNG(b.dataset.chart);return;}
  if(action==='backup'){backup({...data,actions:plans});return;}
  if(action==='template'){await template();return;}
  if(action==='palette'){paletteDialog.showModal();const input=document.getElementById('palette-input');input.value='';paletteResults('');input.focus();return;}
  if(action==='close-palette'){paletteDialog.close();return;}
  if(action==='palette-route'){paletteDialog.close();go(b.dataset.route);return;}
  if(action==='close-import'){importDialog.close();return;}
  if(action==='sample'){data=normalizeDataset(await loadSample());await persist();setupStates(true);render(true);toast('已打开匿名成绩样本');return;}
  if(action==='clear-local'){
   await clearDataset();for(const key of Object.keys(localStorage))if(key.startsWith('jianwei:'))localStorage.removeItem(key);plans=[];writePrefs('actions',[]);data=normalizeDataset(await loadSample());setupStates(true);render(true);toast('本机成绩与行动记录已清除，当前显示匿名样本');return;
  }
  if(action==='plan-add'){
   const row=studentAt(data,b.dataset.sid,s.exam);if(!row)return;const match=nearLine(data,[row],s.tier,Number(s.window),s.side)[0];
   const id=row.sid+'|'+s.exam+'|'+s.tier;
   if(!plans.some(p=>p.id===id)){plans.push({id,sid:row.sid,exam:s.exam,classNo:row.classNo,tier:s.tier,subject:match?.nearest?.subject||'',status:'doing',note:'',created:today()});writePrefs('actions',plans);render();toast('已加入跟进清单');}return;
  }
  if(action==='plan-remove'){plans=plans.filter(p=>p.id!==b.dataset.id);writePrefs('actions',plans);render();return;}
  if(action==='report-current'){
   const type=current==='student'?'student':current==='items'?'items':['classroom','history'].includes(current)?'class':'grade';
   go('reports',{type,exam:s.exam||s.exams?.at(-1)||latestExam(data),classNo:s.classNo||4,sid:s.sid||data.students[0]?.id,subject:s.subject||'数学',track:s.track||'physics',cohort:s.cohort||'regular',classes:s.classes||[]});return;
  }
  if(action==='report-docx'){await reportDOCX(view.report);toast('Word 报告已生成');return;}
  if(action==='report-xlsx'){await spreadsheet(view.sheets,view.report.title);return;}
  if(action==='report-print'){printReport(view.report);return;}
 }catch(error){toast(error.message,true);}
});
async function persist(){
 invalidate(data);normalizeDataset(data);try{await writeDataset(data);}catch{toast('此浏览器无法保存工作区；请导出备份以保留数据。',true);}
}
document.addEventListener('submit',async event=>{
 const form=event.target;if(!form.matches('#profile-form,#rules-form,#lines-form,#exams-form,#bank-form,#mapping-form'))return;event.preventDefault();
 const f=new FormData(form),s=states[current];
 if(form.id==='mapping-form'){
  const mapping=Object.fromEntries(FLAT_FIELDS.map(([key])=>[key,f.get(key)===''?null:Number(f.get(key))]));
  if(mapping.name==null||mapping.classNo==null){toast('请对应姓名和班级列',true);return;}
  const pending=pendingMapping;pendingMapping=null;showProgress(pending.file.name,'按你选择的字段读取成绩',20);
  pending.worker.postMessage({buffer:pending.buffer,name:pending.file.name,mapping});return;
 }
 if(form.id==='profile-form'){
  const n=Number(s.classNo),p=data.profiles[n]||profile(data,n),t=f.get('track');
  data.profiles[n]={...p,manuallyConfigured:true,lead:f.get('lead'),type:f.get('type'),track:t,cohort:f.get('cohort'),combination:f.get('combination'),foreignLanguage:f.get('foreignLanguage'),targets:{top:number(f.get('top')),under:number(f.get('under'))},teachers:Object.fromEntries(SUBJECTS.map(sub=>[sub,String(f.get('teacher-'+sub)||'')]))};
  for(const r of data.scores)if(r.classNo===n)r.track=t;for(const a of data.answers)if(a.classNo===n)a.track=t;
 }else if(form.id==='rules-form'){
  const low=Math.max(0,Math.min(1,number(f.get('lowRate'))/100)),focus=Math.max(low,Math.min(1,number(f.get('focusRate'))/100));
  data.rules={criticalWindow:Math.max(1,number(f.get('criticalWindow'))||20),topFraction:Math.max(.05,Math.min(.5,number(f.get('topFraction'))/100||.27)),lowRate:low,focusRate:focus};
  states.actions.window=data.rules.criticalWindow;
 }else if(form.id==='lines-form'){
  const subjects=Object.fromEntries(SUBJECTS.filter(sub=>f.has(sub+'-top')).map(sub=>[sub,{top:number(f.get(sub+'-top')),under:number(f.get(sub+'-under'))}]));
  const line={exam:s.lineExam,track:s.lineTrack,top:number(f.get('total-top')),under:number(f.get('total-under')),subjects};
  const i=data.lines.findIndex(l=>l.exam===s.lineExam&&l.track===s.lineTrack);if(i<0)data.lines.push(line);else data.lines[i]=line;
 }else if(form.id==='exams-form'){
  for(const e of data.exams){e.label=String(f.get('label-'+e.id)||e.id);e.order=number(f.get('order-'+e.id))??99;e.scope=f.get('scope-'+e.id);}
 }else if(form.id==='bank-form'){
  const key=s.subject+'|'+s.bankExam;data.banks[key]=(data.banks[key]||[]).map((q,i)=>({...q,label:String(f.get('label-'+i)||q.label),max:number(f.get('max-'+i)),knowledge:String(f.get('knowledge-'+i)||''),maxNote:number(f.get('max-'+i))==null?'满分待明确':''}));
 }
 await persist();render();toast('已保存到本机工作区');
});
function showProgress(name,message,percent){
 if(!importDialog.open)importDialog.showModal();
 document.getElementById('import-content').innerHTML='<div class="dialog-body"><div class="eyebrow">本机导入 · LOCAL WORKSPACE</div><div class="dialog-heading"><h2>正在整理研究材料</h2></div><div class="import-file">'+esc(name)+'</div><p>'+esc(message)+'</p><div class="import-progress"><i style="width:'+percent+'%"></i></div><p class="mapping-help">成绩和小题在浏览器中读取，大工作簿可能需要稍等片刻。</p></div>';
}
function showMapping(meta,pending){
 pendingMapping={...pending,meta};
 const options=[['','不使用此列'],...meta.headers.map((h,i)=>[i,(i+1)+' · '+(h||'未命名列')])];
 document.getElementById('import-content').innerHTML='<div class="dialog-body"><div class="eyebrow">字段对应 · FIELD MAPPING</div><div class="dialog-heading"><h2>告诉见微，每一列是什么。</h2></div><p>姓名与班级是联结的起点。没有的成绩列可以留空。</p><form id="mapping-form"><div class="mapping-grid">'+FLAT_FIELDS.map(([key,label])=>'<label class="field"><span>'+esc(label)+'</span><select name="'+esc(key)+'">'+options.map(([v,t])=>'<option value="'+v+'"'+(String(v)===String(meta.mapping[key]??'')?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select></label>').join('')+'</div><button class="btn primary" type="submit">使用这些字段导入</button></form></div>';
}
async function readFile(file){
 const buffer=await file.arrayBuffer();
 return new Promise((resolve,reject)=>{
  const worker=new Worker('./src/import-worker.js');
  worker.onerror=()=>{worker.terminate();reject(new Error('工作簿读取未完成，请使用 Excel 标准格式或 JSON 备份。'));};
  worker.onmessage=event=>{
   const result=event.data;
   if(result.type==='progress')showProgress(file.name,result.message,result.percent);
   else if(result.type==='mapping')showMapping(result,{file,buffer,worker,resolve,reject});
   else if(result.type==='done'){worker.terminate();resolve(result.data);}
   else if(result.type==='error'){worker.terminate();reject(new Error(result.message));}
  };
  worker.postMessage({buffer,name:file.name});
 });
}
async function importFiles(files){
 if(importing){toast('请等待当前文件导入完成');return;}
 importing=true;
 try{
  let importedCount=0;
  for(const file of files){
   showProgress(file.name,'打开文件',3);const incoming=await readFile(file);
   if(data.anonymous&&!incoming.anonymous&&!incoming.scores.length)throw new Error('请先导入含真实姓名的成绩原表，再补充上传小题。');
   const mode=states.data.importMode||'merge';data=normalizeDataset(mode==='replace'&&importedCount===0?incoming:mergeDatasets(data,incoming));importedCount++;
   if(incoming.actions){plans=incoming.actions;writePrefs('actions',plans);}
   await persist();sanitize();toast(file.name+' 已导入：'+incoming.scores.length+'条成绩、'+incoming.answers.length+'条小题学科记录');
  }
  importDialog.close();pendingMapping=null;render(true);
 }catch(error){
  document.getElementById('import-content').innerHTML='<div class="dialog-body"><div class="dialog-heading"><h2>这份材料尚未读入</h2></div><p>'+esc(error.message)+'</p><div class="export-buttons">'+button('回到工作区','close-import','primary')+'</div></div>';
 }finally{importing=false;fileInput.value='';}
}
fileInput.addEventListener('change',()=>{if(fileInput.files.length)importFiles([...fileInput.files]);});
document.addEventListener('dragover',event=>{const zone=event.target.closest('#drop-zone');if(zone){event.preventDefault();zone.classList.add('dragover');}});
document.addEventListener('dragleave',event=>event.target.closest('#drop-zone')?.classList.remove('dragover'));
document.addEventListener('drop',event=>{const zone=event.target.closest('#drop-zone');if(zone){event.preventDefault();zone.classList.remove('dragover');const files=[...event.dataTransfer.files].filter(f=>/\.(xlsx|xls|csv|json)$/i.test(f.name));if(files.length)importFiles(files);}});
importDialog.addEventListener('cancel',event=>{if(importing){event.preventDefault();if(pendingMapping){pendingMapping.worker.terminate();pendingMapping.reject(new Error('已取消这次导入'));pendingMapping=null;}}});
document.getElementById('sidebar-backdrop').addEventListener('click',()=>document.body.classList.remove('menu-open'));
function paletteResults(query){
 if(!data)return;const q=query.trim(),rs=routes.filter(r=>(r.name+r.subtitle).includes(q)),people=q?data.students.filter(p=>p.name.includes(q)).slice(0,18):[];
 document.getElementById('palette-results').innerHTML=(rs.length?'<div class="palette-section">分析入口</div>'+rs.map(r=>'<button class="palette-result" data-action="palette-route" data-route="'+r.id+'">'+icon(r.id)+'<span>'+r.name+'</span><small>'+r.subtitle+'</small></button>').join(''):'')+(people.length?'<div class="palette-section">学生档案</div>'+people.map(p=>{const row=studentAt(data,p.id,latestExam(data));return '<button class="palette-result" data-action="open-student" data-sid="'+esc(p.id)+'">'+icon('student')+'<span>'+esc(p.name)+'</span><small>'+(row?row.classNo+'班':'暂无成绩')+'</small></button>';}).join(''):'')+(!rs.length&&!people.length?empty('没有找到相关内容','尝试姓名中的一个字，或分析入口名称。'):'');
}
document.getElementById('palette-input').addEventListener('input',event=>paletteResults(event.target.value));
document.addEventListener('keydown',event=>{
 if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();paletteDialog.showModal();document.getElementById('palette-input').focus();paletteResults(document.getElementById('palette-input').value);}
 if(event.key==='Escape')document.body.classList.remove('menu-open');
});
async function template(){
 const header=['考试(如53物/53历)','学校','班级','姓名','原始总分','赋分总分','原分市排名','赋分市排名','原分校排名','赋分校排名','语文','语文市排名','语文校排名','数学','数学市排名','数学校排名','外语','外语市排名','外语校排名','物理/历史','首选科市排名','首选科校排名','政治原分','政治赋分','政治原分排名','政治赋分排名','地理原分','地理赋分','地理原分排名','地理赋分排名','化学原分','化学赋分','化学原分排名','化学赋分排名','生物原分(9班为地理)','生物赋分(9班为地理)','生物原分排名','生物赋分排名','外语语种'];
 await spreadsheet({'学生基础':[header], '语文':[[null,'53','题号','1','2','3'],[null,null,'分值',5,5,10],[null,null,'知识点','现代文阅读','文言基础','表达与写作'],['53物',1,'请填写姓名',null,null,null]],'使用说明':[['项目','说明'],['成绩填写','在学生基础表按列填写，考试代码以物或历结尾，例如53物。原分与赋分分别填写，缺失留空。'],['小题填写','题号、分值、知识点三行保留，在第4行及以后填写考试代码、班级、姓名和逐题得分。其他学科可复制语文表并改为对应学科名。'],['小题单独上传','可只保留各学科工作表。先导入真实成绩，再以追加方式上传小题。'],['有效线与人数任务','导入后在资料与口径中设置。'],['姓名联结','不同考试和小题表的姓名保持一致，转班按当次班级填写。']]},'见微-成绩与小题录入模板');
}
async function boot(){
 try{
  let local=null;try{local=await readDataset();}catch{}
  data=normalizeDataset(local||await loadSample());if(local?.actions&&!plans.length){plans=local.actions;writePrefs('actions',plans);}
  setupStates();current=routes.some(r=>r.id===location.hash.slice(1))?location.hash.slice(1):'overview';render(true);
 }catch(error){main.innerHTML=empty('工作区暂时没有打开',error.message)+button('导入原始成绩表','import','primary');data=normalizeDataset({schemaVersion:1,students:[],scores:[],answers:[],exams:[],profiles:{},lines:[],banks:{},school:'荣县一中',grade:'高2024级'});setupStates();}
}
boot();
