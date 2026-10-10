import { SUBJECTS, selectScores, itemAnalysis, classTable, subjectStats, subjectsFor, mean, finite, sum, personName, profile, getLine } from '../model.js';
import { header, filters, examSelect, select, cohortSelect, trackSelect, pillChecks, metrics, metric, fmt, pct, int, panel, segmented, table, button, chartTools, tag, note, esc, personLink, classLink, meter, searchField, empty } from '../ui.js';
import { bars, heatmap, heatColor } from '../charts.js';
export function items(data,s){
 const ctx={exam:s.exam,track:s.track,cohort:s.cohort,classes:s.classes.map(Number)};
 const all=selectScores(data,ctx),a=itemAnalysis(data,ctx,s.subject),subjectSummary=subjectStats(data,all,s.subject);
 const classNos=[...new Set(selectScores(data,{exam:s.exam,track:s.track,cohort:s.cohort}).map(r=>r.classNo))].sort((a,b)=>a-b);
 const cs=classTable(data,ctx).map(c=>({...c,subject:subjectStats(data,c.rows,s.subject),item:itemAnalysis(data,{...ctx,classes:[c.no]},s.subject)}));
 const chosen=s.question==null?null:a.questions.find(q=>q.index===Number(s.question)),known=a.questions.filter(q=>q.max&&q.avg!=null);
 const rate=known.length?sum(known.map(q=>q.avg))/sum(known.map(q=>q.max)):null;
 let content='';
 if(s.mode==='questions'){
  content=table([{label:'题号',render:q=>'<button class="text-link" data-action="focus-question" data-index="'+q.index+'">'+esc(q.label)+'</button>'},{label:'知识点',render:q=>'<span class="knowledge-label">'+esc(q.knowledge||'未标注')+'</span>'},{label:'满分',numeric:true,render:q=>fmt(q.max)+(q.maxNote?'<small class="cell-sub">'+esc(q.maxNote)+'</small>':'')},{label:'均分',numeric:true,render:q=>fmt(q.avg)},{label:'得分率',render:q=>meter(q.rate)},{label:'平均失分',numeric:true,render:q=>fmt(q.lost)},{label:'区分度',numeric:true,render:q=>fmt(q.discrimination,2)},{label:'零分 / 满分',numeric:true,render:q=>int(q.zero)+' / '+int(q.full)},{label:'记录数',numeric:true,render:q=>int(q.count)}],a.questions);
 }else if(s.mode==='knowledge'){
  content=table([{label:'知识点',key:'name'},{label:'对应题目',render:k=>'<div class="question-links">'+k.questions.map(q=>'<button data-action="focus-question" data-index="'+q.index+'">'+esc(q.label)+'</button>').join('')+'</div>'},{label:'加权得分率',render:k=>meter(k.rate)},{label:'平均失分合计',numeric:true,render:k=>fmt(k.lost)},{label:'行动优先级',render:k=>tag(k.priority,k.priority==='优先修复'?'clay':k.priority==='保持优势'?'green':'blue')}],a.knowledge);
 }else{
  const heatRows=s.heatLevel==='class'?cs.map(c=>({label:c.no+'班',no:c.no,values:c.item.questions.map(q=>q.avg)})):a.answers.filter(r=>personName(data,r.sid).includes(s.search||'')).sort((a,b)=>a.classNo-b.classNo).map(r=>({...r,label:personName(data,r.sid)+' · '+r.classNo+'班'}));
  const pages=Math.max(1,Math.ceil(heatRows.length/40)),page=Math.min(s.page||1,pages);
  content='<div class="inline-controls">'+segmented('heatLevel',[['class','班级均分'],['student','逐个学生']],s.heatLevel)+(s.heatLevel==='student'?searchField('search',s.search):'')+'<span class="heat-legend"><i class="low"></i>低得分 <i class="high"></i>高得分</span></div>'+heatmap('items-heatmap',a.questions,heatRows.slice((page-1)*40,page*40),r=>r.sid?personLink(data,r,r.label):classLink(r.no))+'<div class="pagination"><span>第'+page+' / '+pages+'页 · 共'+heatRows.length+'行</span>'+button('上一页','page-prev','ghost',page<=1?'disabled':'')+button('下一页','page-next','ghost',page>=pages?'disabled':'')+'</div>';
 }
 let focus='';
 if(chosen){
  const values=a.answers.filter(r=>finite(r.values[chosen.index])).sort((a,b)=>a.values[chosen.index]-b.values[chosen.index]);
  focus=panel('聚焦：'+chosen.label+'题',chosen.knowledge||'原表没有标注知识点','<div class="question-focus"><div class="question-facts">'+tag('满分 '+fmt(chosen.max))+tag('得分率 '+pct(chosen.rate))+tag('区分度 '+fmt(chosen.discrimination,2))+'</div>'+bars('items-focus',cs.map(c=>({label:c.no+'班',value:c.item.questions[chosen.index]?.avg})),{label:chosen.label+'题班级均分'})+'</div>'+table([{label:'学生',render:r=>personLink(data,r)},{label:'班级',render:r=>classLink(r.classNo)},{label:'本题得分',numeric:true,render:r=>fmt(r.values[chosen.index])}],values.slice(0,12)),button('收起','clear-question'));
 }
 const html=header('05 / QUESTION BY QUESTION','每一道题，都有线索。','先选学科和考试，再决定观察哪些学生。学科表现、试题结构、知识点和逐人得分互相联结。')+
 filters(select('subject','研究学科',SUBJECTS,s.subject)+examSelect(data,'exam',s.exam)+trackSelect(s.track)+cohortSelect(s.cohort))+
 panel('研究范围','不选班级表示当前类别、届别的所有班级。',pillChecks('classes',classNos.map(n=>[String(n),n+'班 · '+profile(data,n).type]),s.classes))+
 metrics(metric('学科赋分均分',fmt(subjectSummary.avg),'原分均分 '+fmt(subjectSummary.rawAvg),'green')+metric('本科学科有效',int(subjectSummary.under),pct(subjectSummary.underRate)+' · 双上线 '+int(subjectSummary.underDouble),'blue')+metric('小题记录',int(a.answers.length),'当前范围覆盖率 '+pct(a.coverage))+metric('已知满分题得分率',pct(rate),int(known.length)+'题进入计算','clay'))+
 panel('学科在各班的表现','小题原始得分与学科赋分分别展示。有效人数取学科有效线。',table([{label:'班级',render:c=>classLink(c.no)},{label:'学科有效人数',numeric:true,render:c=>int(c.subject.count)},{label:'赋分均分',numeric:true,render:c=>fmt(c.subject.avg)},{label:'原分均分',numeric:true,render:c=>fmt(c.subject.rawAvg)},{label:'特控有效 / 双上线',numeric:true,render:c=>int(c.subject.top)+' / '+int(c.subject.topDouble)},{label:'本科有效 / 双上线',numeric:true,render:c=>int(c.subject.under)+' / '+int(c.subject.underDouble)},{label:'小题记录',numeric:true,render:c=>int(c.item.answers.length)}],cs))+
 panel('试题得分轮廓','仅对原表有明确满分的题目计算得分率。',a.questions.length?bars('items-rates',a.questions.map(q=>({label:q.label,value:q.rate==null?null:q.rate*100,color:q.rate<.5?'#df895f':q.rate<.75?'#a69b43':'#226857'})),{suffix:'%',label:'各题得分率'}):empty('这场考试还没有该科小题','可以在数据书房补充上传小题表，已有总分与学科分析仍可使用。'),chartTools('items-rates'))+
 panel('从题目走到教学行动','区分度采用学科小题总分最高与最低两组学生，各取'+fmt((data.rules?.topFraction??.27)*100,0)+'%。',segmented('mode',[['questions','逐题诊断'],['knowledge','知识点行动'],['heatmap','得分热力图']],s.mode)+content,button('导出小题与知识点','export-view'))+focus+
 note('日语学生不计入英语小题；物化地使用地理题库。带星号的题目满分保留为待明确，得分率、失分与区分度保持空缺，可在数据书房补充。小题只有原始得分，不进行赋分推断。');
 const qSheet=[['题号','知识点','满分','均分','得分率','平均失分','区分度','零分人数','满分人数','有效记录'],...a.questions.map(q=>[q.label,q.knowledge,q.max,q.avg,q.rate,q.lost,q.discrimination,q.zero,q.full,q.count])];
 return {html,sheets:{'逐题诊断':qSheet,'知识点行动':[['知识点','题号','得分率','平均失分合计','建议'],...a.knowledge.map(k=>[k.name,k.questions.map(q=>q.label).join('、'),k.rate,k.lost,k.priority])],'个人学科小题得分':[['姓名','班级','考试','学科',...a.questions.map(q=>q.label)],...a.answers.map(r=>[personName(data,r.sid),r.classNo,s.exam,s.subject,...r.values])]}};
}
