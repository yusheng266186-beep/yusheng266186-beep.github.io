export const SUBJECTS = ['语文','数学','英语','日语','物理','历史','化学','生物','政治','地理'];
export const PALETTE = ['#226857','#759be8','#df895f','#9874af','#a69b43','#64a4ad','#ce6f83','#617875'];
export const EXAM_NAMES = {'入口':'入口成绩','1册':'高一上期末','21':'高一下阶段考试','2册':'高一下期末','33':'高二上阶段考试','3册':'高二上期末','41':'高二下第一次月考','4半':'高二下半期考试','4月':'高二下阶段考试','43':'高二下第二次月考','4册':'高二下零诊','51':'高三第一次月考','52':'高三第二次月考'};
export const EXAM_ORDER = ['入口','1册','21','2册','33','3册','41','4半','4月','43','4册','51','52'];
export const finite = v => typeof v === 'number' && Number.isFinite(v);
export const mean = values => {const v=values.filter(finite);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;};
export const sum = values => values.filter(finite).reduce((a,b)=>a+b,0);
export const quantile = (values,p) => {const v=values.filter(finite).sort((a,b)=>a-b);if(!v.length)return null;const i=(v.length-1)*p,k=Math.floor(i);return v[k]+(v[Math.min(k+1,v.length-1)]-v[k])*(i-k);};
export const stats = values => {const v=values.filter(finite),avg=mean(v);return {count:v.length,avg,median:quantile(v,.5),p25:quantile(v,.25),p75:quantile(v,.75),min:v.length?Math.min(...v):null,max:v.length?Math.max(...v):null,sd:v.length?Math.sqrt(mean(v.map(x=>(x-avg)**2))):null};};
export const maxOf = subject => ['语文','数学','英语','日语'].includes(subject)?150:100;
export const classDefaults = no => ({no,track:no<=9||no===17?'physics':'history',cohort:no>=17?'repeat':'regular',type:no>=17?'补习班':no===1?'华英班':[2,10].includes(no)?'直播班':no===7?'日语平行班':no===15?'体育班':no===16?'美术班':'平行班',combination:no>=17?'按学生实际选科':no===9?'物化地':no<=9?'物化生':'历政地',foreignLanguage:no===7?'日语':'英语',lead:'',teachers:{},targets:{top:null,under:null}});
export const trackName = track => track==='physics'?'物理类':track==='history'?'历史类':'全部类别';
export const cohortName = cohort => cohort==='repeat'?'补习班':cohort==='regular'?'应届班':'全部班型';
export const profile = (data,no) => ({...classDefaults(Number(no)),...(data.profiles?.[no]||{})});
const cache=new WeakMap();
export function index(data){
  if(cache.has(data))return cache.get(data);
  const persons=new Map(data.students.map(p=>[p.id,p])),byExam=new Map(),byPerson=new Map(),byAnswer=new Map(),lineMap=new Map();
  for(const r of data.scores){if(!byExam.has(r.exam))byExam.set(r.exam,[]);byExam.get(r.exam).push(r);if(!byPerson.has(r.sid))byPerson.set(r.sid,[]);byPerson.get(r.sid).push(r);}
  for(const a of data.answers){const k=`${a.sid}|${a.exam}`;if(!byAnswer.has(k))byAnswer.set(k,[]);byAnswer.get(k).push(a);}
  for(const l of data.lines)lineMap.set(`${l.exam}|${l.track}`,l);
  const result={persons,byExam,byPerson,byAnswer,lineMap};cache.set(data,result);return result;
}
export function invalidate(data){cache.delete(data);}
export const personName = (data,sid) => index(data).persons.get(sid)?.name||'未命名学生';
export const examLabel = (data,id) => data.exams.find(e=>e.id===id)?.label||EXAM_NAMES[id]||id;
export const examShort = (data,id) => `${id} · ${examLabel(data,id)}`;
export const latestExam = data => data.exams.at(-1)?.id||'';
export function normalizeDataset(data){
  data.schemaVersion=1;data.students||=[];data.scores||=[];data.profiles||={};data.lines||=[];data.answers||=[];data.banks||={};data.exams||=[];
  data.scores=[...new Map(data.scores.map(r=>[`${r.exam}|${r.classNo}|${r.sid}`,r])).values()];
  data.answers=[...new Map(data.answers.map(r=>[`${r.exam}|${r.classNo}|${r.sid}|${r.subject}`,r])).values()];
  data.exams.sort((a,b)=>(a.order??99)-(b.order??99)||a.id.localeCompare(b.id,'zh',{numeric:true}));
  for(const no of new Set(data.scores.map(r=>r.classNo)))data.profiles[no]={...classDefaults(no),...data.profiles[no]};
  invalidate(data);return data;
}
export function selectScores(data,ctx={}){
  const source=ctx.exam?index(data).byExam.get(ctx.exam)||[]:data.scores;
  const classes=ctx.classes?.map(Number);
  return source.filter(r=>(!ctx.track||ctx.track==='all'||r.track===ctx.track)&&(!ctx.cohort||ctx.cohort==='all'||profile(data,r.classNo).cohort===ctx.cohort)&&(!classes?.length||classes.includes(r.classNo))&&(!ctx.classNo||ctx.classNo==='all'||r.classNo===Number(ctx.classNo)));
}
export const subjectsFor = rows => SUBJECTS.filter(s=>rows.some(r=>finite(r.subjects?.[s]?.score)));
export const getLine = (data,row,tier='under',subject=null) => {const l=index(data).lineMap.get(`${row.exam}|${row.track}`);return subject?l?.subjects?.[subject]?.[tier]??null:l?.[tier]??null;};
export const gap = (data,row,tier='under',subject=null) => {const s=subject?row.subjects?.[subject]?.score:row.total,l=getLine(data,row,tier,subject);return finite(s)&&finite(l)?s-l:null;};
export const qualifies = (data,row,tier='under',subject=null) => {const d=gap(data,row,tier,subject);return d==null?null:d>=0;};
export function describe(data,rows){
  const totals=rows.filter(r=>finite(r.total));
  const base=stats(totals.map(r=>r.total));
  const topRows=totals.filter(r=>finite(getLine(data,r,'top'))),underRows=totals.filter(r=>finite(getLine(data,r,'under')));
  const top=topRows.filter(r=>qualifies(data,r,'top')).length,under=underRows.filter(r=>qualifies(data,r,'under')).length;
  return {...base,records:rows.length,top:topRows.length?top:null,under:underRows.length?under:null,topBase:topRows.length,underBase:underRows.length,topRate:topRows.length?top/topRows.length:null,underRate:underRows.length?under/underRows.length:null,nearTop:topRows.filter(r=>gap(data,r,'top')<0&&gap(data,r,'top')>=-20).length,nearUnder:underRows.filter(r=>gap(data,r,'under')<0&&gap(data,r,'under')>=-20).length,missing:rows.length-totals.length};
}
export function classTable(data,ctx={}){
  const rows=selectScores(data,ctx),groups=new Map();
  for(const r of rows){if(!groups.has(r.classNo))groups.set(r.classNo,[]);groups.get(r.classNo).push(r);}
  return [...groups].map(([no,rs])=>({no,profile:profile(data,no),rows:rs,...describe(data,rs),subjects:Object.fromEntries(subjectsFor(rs).map(s=>[s,subjectStats(data,rs,s)]))})).sort((a,b)=>a.no-b.no);
}
export function subjectStats(data,rows,subject){
  const valid=rows.filter(r=>finite(r.subjects?.[subject]?.score)),base=stats(valid.map(r=>r.subjects[subject].score));
  const topBase=valid.filter(r=>finite(getLine(data,r,'top',subject))),underBase=valid.filter(r=>finite(getLine(data,r,'under',subject)));
  const top=topBase.filter(r=>qualifies(data,r,'top',subject)).length,under=underBase.filter(r=>qualifies(data,r,'under',subject)).length;
  return {...base,subject,rawAvg:mean(valid.map(r=>r.subjects[subject].raw)),top:topBase.length?top:null,under:underBase.length?under:null,topRate:topBase.length?top/topBase.length:null,underRate:underBase.length?under/underBase.length:null,topDouble:topBase.length?topBase.filter(r=>qualifies(data,r,'top',subject)&&qualifies(data,r,'top')).length:null,underDouble:underBase.length?underBase.filter(r=>qualifies(data,r,'under',subject)&&qualifies(data,r,'under')).length:null,topLine:mean(topBase.map(r=>getLine(data,r,'top',subject))),underLine:mean(underBase.map(r=>getLine(data,r,'under',subject))),missing:rows.length-valid.length};
}
export function nearLine(data,rows,tier='under',window=20,side='below'){
  return rows.map(row=>{
    const d=gap(data,row,tier);if(d==null)return null;
    const eligible=side==='both'?Math.abs(d)<=window:side==='above'?d>=0&&d<=window:d<0&&d>=-window;
    if(!eligible)return null;
    const weaknesses=subjectsFor([row]).map(subject=>({subject,gap:gap(data,row,tier,subject),score:row.subjects[subject].score})).filter(r=>r.gap!=null&&r.gap<0).sort((a,b)=>a.gap-b.gap);
    return {row,gap:d,weaknesses,nearest:[...weaknesses].sort((a,b)=>b.gap-a.gap)[0]};
  }).filter(Boolean).sort((a,b)=>Math.abs(a.gap)-Math.abs(b.gap));
}
export function weakSubjects(data,row,tier='under'){
  return subjectsFor([row]).map(subject=>({subject,score:row.subjects[subject].score,gap:gap(data,row,tier,subject)})).filter(s=>s.gap!=null).sort((a,b)=>a.gap-b.gap);
}
export function classTrajectory(data,classNo,selected=[],metric='avg',matched=false){
  const exams=data.exams.filter(e=>!selected.length||selected.includes(e.id));
  let ids=null;
  if(matched){const sets=exams.map(e=>new Set(selectScores(data,{exam:e.id,classNo}).map(r=>r.sid)));ids=sets.length?new Set([...sets[0]].filter(id=>sets.every(s=>s.has(id)))):new Set();}
  return exams.map(e=>{
    const rows=selectScores(data,{exam:e.id,classNo}).filter(r=>!ids||ids.has(r.sid)),d=describe(data,rows);
    const value=metric==='avg'?d.avg:metric==='topRate'?d.topRate==null?null:d.topRate*100:metric==='underRate'?d.underRate==null?null:d.underRate*100:metric==='top'?d.top:metric==='under'?d.under:metric==='topGap'?mean(rows.map(r=>gap(data,r,'top'))):metric==='underGap'?mean(rows.map(r=>gap(data,r,'under'))):mean(rows.map(r=>r.subjects?.[metric]?.score));
    return {exam:e.id,label:e.label,value,rows,summary:d};
  });
}
export function percentile(data,row){
  if(!finite(row.total))return null;
  const peers=selectScores(data,{exam:row.exam,track:row.track,cohort:profile(data,row.classNo).cohort}).filter(r=>finite(r.total));
  const rank=1+peers.filter(r=>r.total>row.total).length;
  return peers.length>1?(peers.length-rank)/(peers.length-1)*100:100;
}
export function studentHistory(data,sid){
  const rows=index(data).byPerson.get(sid)||[];
  return data.exams.map(e=>rows.find(r=>r.exam===e.id)).filter(Boolean);
}
export function studentAt(data,sid,exam){return (index(data).byPerson.get(sid)||[]).find(r=>r.exam===exam)||studentHistory(data,sid).at(-1);}
export function histogram(values,step=50){
  const v=values.filter(finite);if(!v.length)return [];
  const lower=Math.floor(Math.min(...v)/step)*step,upper=Math.ceil((Math.max(...v)+.01)/step)*step;
  const bins=[];for(let start=lower;start<upper;start+=step)bins.push({label:`${start}–${start+step}`,value:v.filter(x=>x>=start&&x<start+step).length,start,end:start+step});return bins;
}
export function itemAnalysis(data,ctx,subject){
  const scoped=selectScores(data,ctx),scopeKeys=new Set(scoped.map(r=>`${r.sid}|${r.classNo}`));
  const answers=data.answers.filter(a=>a.exam===ctx.exam&&a.subject===subject&&scopeKeys.has(`${a.sid}|${a.classNo}`));
  const allowed=new Set([...scoped.filter(r=>finite(r.subjects?.[subject]?.score)).map(r=>`${r.sid}|${r.classNo}`),...answers.map(a=>`${a.sid}|${a.classNo}`)]);
  const bank=data.banks[`${subject}|${ctx.exam}`]||[];
  const ordered=[...answers].sort((a,b)=>sum(b.values)-sum(a.values));
  const grouped=Math.max(1,Math.floor(ordered.length*(data.rules?.topFraction??.27)));
  const high=ordered.slice(0,grouped),low=ordered.slice(-grouped);
  const questions=bank.map((q,i)=>{
    const vals=answers.map(a=>a.values[i]).filter(finite),avg=mean(vals),max=finite(q.max)&&q.max>0?q.max:null;
    const lost=max==null?null:mean(vals.map(v=>Math.max(0,max-v)));
    const topAvg=mean(high.map(a=>a.values[i])),lowAvg=mean(low.map(a=>a.values[i]));
    return {...q,index:i,count:vals.length,avg,max,rate:max&&avg!=null?avg/max:null,lost,discrimination:max&&ordered.length>=6&&topAvg!=null&&lowAvg!=null?(topAvg-lowAvg)/max:null,zero:vals.filter(v=>v===0).length,full:max?vals.filter(v=>v>=max).length:null};
  });
  const groups=new Map();
  for(const q of questions){for(const k of (q.knowledge||'未标注').split(/[,，;；]/).map(k=>k.trim()).filter(Boolean)){if(!groups.has(k))groups.set(k,[]);groups.get(k).push(q);}}
  const knowledge=[...groups].map(([name,qs])=>{
    const known=qs.filter(q=>q.max&&q.count),possible=sum(known.map(q=>q.max*q.count)),earned=sum(known.map(q=>q.avg*q.count));
    return {name,questions:qs,rate:possible?earned/possible:null,lost:known.length?sum(known.map(q=>q.lost)):null,count:sum(qs.map(q=>q.count)),priority:!possible?'待补题目满分':earned/possible<(data.rules?.lowRate??.5)?'优先修复':earned/possible<(data.rules?.focusRate??.75)?'巩固迁移':'保持优势'};
  }).sort((a,b)=>(b.lost||0)-(a.lost||0));
  return {answers,questions,knowledge,averageRaw:mean(answers.filter(a=>a.values.some(finite)).map(a=>sum(a.values))),coverage:allowed.size?answers.length/allowed.size:0};
}
export function studentQuestions(data,row,subject){
  const a=(index(data).byAnswer.get(`${row.sid}|${row.exam}`)||[]).find(a=>a.subject===subject&&a.classNo===row.classNo);
  const bank=data.banks[`${subject}|${row.exam}`]||[];
  return a?bank.map((q,i)=>({...q,index:i,score:a.values[i]??null,loss:finite(q.max)&&finite(a.values[i])?Math.max(0,q.max-a.values[i]):null})):[];
}
export function overviewNotes(data,rows){
  const d=describe(data,rows),subjects=subjectsFor(rows).map(s=>subjectStats(data,rows,s)).filter(s=>s.underRate!=null).sort((a,b)=>a.underRate-b.underRate);
  const weakest=subjects[0];
  return [{tag:'分层',title:d.nearUnder?`${d.nearUnder}人处于本科线下20分`:'先看学生分层',text:d.nearUnder?'把总分距离与最容易补上的学科交叉排序，建立逐人的跟进计划。':'达线判断依照每名学生所属类别的有效线。'},
    {tag:'学科',title:weakest?`${weakest.subject}有效率 ${Math.round(weakest.underRate*100)}%`:'学科逐项展开',text:weakest?`该学科有${weakest.under}人达到本科有效线，结合双上线与逐题得分识别问题。`:'有成绩但没有对应有效线时，保留分数分布，不替学生推断达线。'},
    {tag:'结构',title:d.p25!=null?`中间50%分布在 ${d.p25.toFixed(0)}–${d.p75.toFixed(0)} 分`:'保留每一种成绩状态',text:'平均分之外，同时看分位数与尾部学生，分别安排基础巩固和提升任务。'}];
}
