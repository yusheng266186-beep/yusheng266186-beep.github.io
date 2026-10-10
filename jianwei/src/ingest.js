import { SUBJECTS, EXAM_ORDER, EXAM_NAMES, classDefaults, finite, normalizeDataset } from './model.js';
const txt=v=>String(v??'').trim();
const num=v=>v==null||txt(v)===''?null:Number.isFinite(Number(v))?Number(v):null;
const code=v=>txt(v).replace(/[物历]$/,'');
const track=(raw,n)=>/[历]$/.test(txt(raw))?'history':/[物]$/.test(txt(raw))?'physics':classDefaults(n).track;
const cityExam=e=>['入口','1册','2册','3册','4册'].includes(e);
const hash=text=>{let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return 's'+(h>>>0).toString(36);};
const fresh=source=>({schemaVersion:1,school:'荣县一中',grade:'高2024级',title:'成绩研究工作区',sourceName:source,importedAt:new Date().toISOString(),anonymous:false,students:[],scores:[],profiles:{},exams:[],lines:[],banks:{},answers:[],sheets:[]});
function people(data){
 const map=new Map(data.students.map(s=>[s.name,s]));
 return name=>{name=txt(name);if(!map.has(name)){const person={id:hash(name),name};map.set(name,person);data.students.push(person);}return map.get(name).id;};
}
function examsFrom(data){
 const ids=new Set([...data.scores.map(r=>r.exam),...data.answers.map(r=>r.exam)]);
 for(const id of ids)if(!data.exams.some(e=>e.id===id))data.exams.push({id,label:EXAM_NAMES[id]||id,scope:cityExam(id)?'city':'school',order:EXAM_ORDER.includes(id)?EXAM_ORDER.indexOf(id):99});
 return normalizeDataset(data);
}
export function rowsOf(XLSX,sheet){
 const range=XLSX.utils.decode_range(sheet['!ref']||'A1');range.e.c=Math.min(range.e.c,99);
 return XLSX.utils.sheet_to_json(sheet,{header:1,defval:null,raw:true,range,blankrows:true});
}
export function parseWorkbook(XLSX,buffer,source,progress=()=>{},mapping=null){
 progress('读取工作表目录',8);
 const meta=XLSX.read(buffer,{type:'array',bookSheets:true});
 const chosen=meta.SheetNames.filter(n=>n==='学生基础'||n==='教师名单'||/^班级有效人/.test(n)||SUBJECTS.includes(n));
 if(!meta.SheetNames.includes('学生基础')){const generic=meta.SheetNames.filter(n=>!SUBJECTS.includes(n)&&!/(班级有效人|个人学科小题|班级多次|班级成绩|教师名单|说明)/.test(n));chosen.push(...generic);}
 const workbook=XLSX.read(buffer,{type:'array',cellFormula:false,cellStyles:false,cellHTML:false,sheets:chosen.length?chosen:undefined});
 const data=fresh(source);data.sheets=meta.SheetNames;
 const idFor=people(data),basic=workbook.Sheets['学生基础'];
 if(!basic){
  const sheets=Object.entries(workbook.Sheets).map(([name,s])=>({name,rows:rowsOf(XLSX,s)}));
  const main=sheets.find(s=>s.rows.slice(0,15).some(row=>row.some(c=>/^(姓名|学生姓名)$/.test(txt(c)))))||sheets[0];
  const result=parseFlat(main?.rows||[],source,mapping);
  result.sheets=meta.SheetNames;
  if(!result.scores.length&&SUBJECTS.some(s=>workbook.Sheets[s])){
   parseItems(data,workbook,XLSX,idFor,progress);
   return examsFrom(data);
  }
  return result;
 }
 progress('提取历次成绩与两类有效线',22);
 const rows=rowsOf(XLSX,basic);
 for(let i=0;i<Math.min(rows.length,50);i++){
  const r=rows[i];if(!/[物历]$/.test(txt(r[1]))||!finite(num(r[2])))continue;
  const t=track(r[1],1),e=code(r[1]),ss=t==='physics'?['语文','数学','英语','物理','化学','生物']:['语文','数学','英语','历史','政治','地理'];
  const subjects=Object.fromEntries(ss.map((s,j)=>[s,{top:num(r[3+j]),under:num(r[12+j])}]));
  subjects['日语']={...subjects['英语'],source:'外语有效线'};
  if(t==='physics')subjects['地理']={...subjects['生物'],source:'物化地对应原表生物列'};
  data.lines.push({exam:e,track:t,top:num(r[2]),under:num(r[11]),subjects});
 }
 for(let i=0;i<rows.length;i++){
  const r=rows[i],n=num(r[2]),name=txt(r[3]);
  if(!/[物历]$/.test(txt(r[0]))||!n||!name||!txt(r[1])||!Number.isInteger(n)||n>99)continue;
  if(txt(r[1])==='荣县一中')data.school=txt(r[1]);else if(data.scores.length)continue;else data.school=txt(r[1]);
  const t=track(r[0],n),e=code(r[0]),language=txt(r[38]).includes('日语')||n===7?'日语':'英语',subjects={};
  const fields=[['语文',10,10,11,12],['数学',13,13,14,15],[language,16,16,17,18],[t==='physics'?'物理':'历史',19,19,20,21],['政治',22,23,25,null],['地理',26,27,29,null],['化学',30,31,33,null],['生物',34,35,37,null]];
  for(const [s,raw,assigned,ranking,school] of fields){
   if(num(r[assigned])==null)continue;
   const subject=n===9&&s==='生物'?'地理':s;
   subjects[subject]={score:num(r[assigned]),raw:num(r[raw]),rank:num(r[ranking]),schoolRank:school==null?null:num(r[school])};
  }
  data.scores.push({exam:e,rawExam:txt(r[0]),sid:idFor(name),classNo:n,track:t,total:num(r[5]),rawTotal:num(r[4]),cityRank:cityExam(e)?num(r[7]):null,schoolRank:cityExam(e)?null:num(r[9])??num(r[7]),subjects,language,sourceRow:i+1});
  data.profiles[n]||=classDefaults(n);
 }
 progress('提取班级目标与任课信息',35);
 for(const name of chosen.filter(n=>/^班级有效人/.test(n))){
  for(const r of rowsOf(XLSX,workbook.Sheets[name])){
   const n=num(r[0]);if(!n||!Number.isInteger(n)||!data.profiles[n])continue;
   if(num(r[3])!=null||num(r[4])!=null)data.profiles[n].targets={top:num(r[3]),under:num(r[4])};
   if(txt(r[1]))data.profiles[n].lead=txt(r[1]);
  }
 }
 if(workbook.Sheets['教师名单']){
  const teacherSubjects=['语文','数学','英语','物理','化学','生物','政治','历史','地理'];
  for(const r of rowsOf(XLSX,workbook.Sheets['教师名单'])){
   const n=num(r[4]);if(!n||!data.profiles[n]||!txt(r[0]).includes('2024'))continue;
   const p=data.profiles[n];p.lead=txt(r[5])||p.lead;
   p.teachers=Object.fromEntries(teacherSubjects.map((s,j)=>[s,txt(r[6+j])]).filter(([,name])=>name));
   if(txt(r[20])&&n<17)p.combination=txt(r[20]);
  }
 }
 parseItems(data,workbook,XLSX,idFor,progress);
 const answerSubjects=new Map();
 for(const a of data.answers){const k=a.sid+'|'+a.exam;if(!answerSubjects.has(k))answerSubjects.set(k,new Set());answerSubjects.get(k).add(a.subject);}
 for(const r of data.scores){
  if(![17,18].includes(r.classNo))continue;
  const actual=answerSubjects.get(r.sid+'|'+r.exam);
  if(actual?.has('地理')&&!actual.has('生物')&&r.subjects['生物']&&!r.subjects['地理']){r.subjects['地理']=r.subjects['生物'];delete r.subjects['生物'];}
 }
 progress('整理独立分析工作区',95);
 return examsFrom(data);
}
function parseItems(data,workbook,XLSX,idFor,progress){
 const subjects=SUBJECTS.filter(s=>workbook.Sheets[s]),known=new Set(data.scores.map(r=>r.exam));
 const scored=new Map(data.scores.map(r=>[r.exam+'|'+r.classNo+'|'+r.sid,r]));
 subjects.forEach((subject,si)=>{
  progress('读取 '+subject+' 小题、满分与知识点',40+Math.round(si/subjects.length*48));
  const rows=rowsOf(XLSX,workbook.Sheets[subject]),columns={};
  for(let i=0;i<rows.length;i++){
   const r=rows[i];if(txt(r[2])!=='题号')continue;
   const e=code(r[1]);if(known.size&&!known.has(e))continue;
   const maxima=rows[i+1]||[],knowledge=rows[i+2]||[],bank=[],cols=[];
   for(let c=3;c<r.length;c++){
    if(!txt(r[c])||/^(总分|客观分|主观分|原分|赋分|合计)$/.test(txt(r[c])))continue;
    if(maxima[c]==null&&!txt(knowledge[c]))continue;
    cols.push(c);bank.push({label:txt(r[c]),max:num(maxima[c]),knowledge:txt(knowledge[c]),maxNote:txt(maxima[c]).includes('*')?'原表满分未明确':'',sourceMax:txt(maxima[c])});
   }
   if(bank.length){data.banks[subject+'|'+e]=bank;columns[e]=cols;}
  }
  for(const r of rows){
   const n=num(r[1]),name=txt(r[2]),e=code(r[0]);if(!/[物历]$/.test(txt(r[0]))||!n||!name||!columns[e])continue;
   const sid=idFor(name),score=scored.get(e+'|'+n+'|'+sid);
   if(data.scores.length&&!score)continue;
   if(subject==='英语'&&score?.language==='日语')continue;
   const values=columns[e].map(c=>num(r[c]));if(!values.some(finite))continue;
   data.answers.push({exam:e,sid,classNo:n,track:score?.track||track(r[0],n),subject,values});
   data.profiles[n]||=classDefaults(n);
  }
 });
}
export const FLAT_FIELDS=[['name','姓名'],['classNo','班级'],['exam','考试'],['total','赋分总分'],['rawTotal','原始总分'],['track','类别'],['language','外语语种'],['cityRank','市排名'],['schoolRank','校排名'],...SUBJECTS.map(s=>[s,s+'成绩'])];
const ALIASES={name:['姓名','学生姓名','name'],classNo:['班级','班号','行政班','class','classno'],exam:['考试','考试名称','考次','exam'],total:['赋分总分','总赋分','总分','total'],rawTotal:['原始总分','原分总分','原始分'],track:['类别','科类','track'],language:['外语语种','语种','language'],cityRank:['市排名','全市名次','cityrank'],schoolRank:['校排名','校名次','年级名次','schoolrank']};
export function detectFlat(rows){
 const headerRow=rows.findIndex(r=>r.some(c=>['姓名','学生姓名','name'].includes(txt(c).toLowerCase())));
 const rowIndex=headerRow<0?0:headerRow,headers=(rows[rowIndex]||[]).map(txt),mapping={};
 for(const [key] of FLAT_FIELDS){
  const aliases=ALIASES[key]||[key,key+'成绩',key+'赋分'];
  mapping[key]=headers.findIndex(h=>aliases.includes(h.toLowerCase()));if(mapping[key]<0)mapping[key]=null;
 }
 return {headers,mapping,headerRow:rowIndex,preview:rows.slice(rowIndex+1,rowIndex+6)};
}
export function parseFlat(rows,source,mapping=null){
 const data=fresh(source),idFor=people(data),auto=detectFlat(rows);mapping||=auto.mapping;
 for(const row of rows.slice(auto.headerRow+1)){
  const val=k=>mapping[k]==null||mapping[k]===''?null:row[Number(mapping[k])];
  const name=txt(val('name')),n=num(txt(val('classNo')).replace(/[^\d]/g,''));if(!name||!n)continue;
  const e=code(val('exam'))||'本次',t=txt(val('track')).includes('历')?'history':txt(val('track')).includes('物')?'physics':classDefaults(n).track,subjects={};
  for(const s of SUBJECTS){const v=num(val(s));if(v!=null)subjects[s]={score:v,raw:v,rank:null,schoolRank:null};}
  data.scores.push({exam:e,rawExam:txt(val('exam')),sid:idFor(name),classNo:n,track:t,total:num(val('total')),rawTotal:num(val('rawTotal')),cityRank:num(val('cityRank')),schoolRank:num(val('schoolRank')),subjects,language:txt(val('language'))|| (subjects['日语']?'日语':'英语')});
  data.profiles[n]||=classDefaults(n);
 }
 return examsFrom(data);
}
export function adaptJSON(json,source){
 if(Array.isArray(json))return parseFlat([Object.keys(json[0]||{}),...json.map(r=>Object.keys(json[0]||{}).map(k=>r[k]))],source);
 if(json.schemaVersion===1&&Array.isArray(json.students))return normalizeDataset({...json,sourceName:source,importedAt:new Date().toISOString()});
 if(!Array.isArray(json.scores))throw new Error('JSON 中没有可导入的成绩。请导入见微数据备份或原项目的 GradeDataset 数据。');
 const data=fresh(source),idFor=people(data);
 data.school=json.school||data.school;data.sheets=json.sheets||[];
 for(const r of json.scores){const n=Number(r.classNo),e=code(r.exam),p=classDefaults(n);data.profiles[n]={...p,type:r.classType||p.type,combination:r.combination||p.combination};data.scores.push({exam:e,rawExam:r.rawExam||r.exam,sid:idFor(r.name),classNo:n,track:r.track?.includes('历史')?'history':p.track,total:num(r.total),rawTotal:null,cityRank:num(r.cityRank),schoolRank:num(r.schoolRank),language:r.subjects?.['日语']!=null?'日语':'英语',subjects:Object.fromEntries(Object.entries(r.subjects||{}).map(([s,v])=>[s,{score:num(v),raw:null,rank:null,schoolRank:null}]))});}
 for(const l of json.thresholds||[])data.lines.push({exam:code(l.exam),track:l.track?.includes('历史')?'history':'physics',top:num(l.topTotal),under:num(l.undergraduateTotal),subjects:Object.fromEntries(SUBJECTS.map(s=>[s,{top:num(l.topSubjects?.[s]),under:num(l.undergraduateSubjects?.[s])}]))});
 for(const [key,bank] of Object.entries(json.questionBanks||{})){const parts=key.split(/[|:]/).filter(Boolean),subject=SUBJECTS.find(s=>parts.includes(s));const e=parts.find(s=>s!==subject);if(subject&&e)data.banks[subject+'|'+code(e)]=bank.map(q=>({label:txt(q.question),max:q.maxScoreSource==='inferred'?null:num(q.maxScore),knowledge:txt(q.knowledge),maxNote:q.maxScoreSource==='inferred'?'原备份满分为推断值，待明确':''}));}
 for(const a of json.itemResponses||[])data.answers.push({exam:code(a.exam),sid:idFor(a.name),classNo:Number(a.classNo),track:classDefaults(Number(a.classNo)).track,subject:a.subject,values:(a.scores||[]).map(num)});
 return examsFrom(data);
}
export function mergeDatasets(current,incoming){
 if(current.anonymous&&!incoming.anonymous&&incoming.scores.length)return normalizeDataset(incoming);
 const data=structuredClone(current),names=new Map(data.students.map(s=>[s.name,s.id])),remap=new Map();
 for(const p of incoming.students){const sid=names.get(p.name)||p.id;remap.set(p.id,sid);if(!names.has(p.name)){data.students.push({...p,id:sid});names.set(p.name,sid);}}
 const usable=p=>({...p,sid:remap.get(p.sid)||p.sid});
 data.scores.push(...incoming.scores.map(usable));data.answers.push(...incoming.answers.map(usable));
 data.banks={...data.banks,...incoming.banks};data.profiles={...data.profiles,...Object.fromEntries(Object.entries(incoming.profiles).map(([n,p])=>{const old=data.profiles[n];if(old?.manuallyConfigured||old&&!incoming.scores.length)return [n,old];return [n,{...old,...p,lead:p.lead||old?.lead||'',teachers:{...old?.teachers,...Object.fromEntries(Object.entries(p.teachers||{}).filter(([,v])=>v))},targets:p.targets?.top==null&&p.targets?.under==null?old?.targets:p.targets}];}))};
 data.lines=[...new Map([...data.lines,...incoming.lines].map(l=>[l.exam+'|'+l.track,l])).values()];
 data.exams=[...new Map([...data.exams,...incoming.exams].map(e=>[e.id,e])).values()];
 data.sheets=[...new Set([...data.sheets,...incoming.sheets])];data.sourceName=incoming.sourceName;data.importedAt=incoming.importedAt;data.anonymous=current.anonymous&&incoming.anonymous;
 return normalizeDataset(data);
}
