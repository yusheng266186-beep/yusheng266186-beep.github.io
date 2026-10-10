import { personName, studentHistory, studentAt, subjectsFor, maxOf, weakSubjects, gap, percentile, getLine, studentQuestions, finite, profile, examShort } from '../model.js';
import { header, select, metrics, metric, fmt, int, pct, trend, panel, table, tag, segmented, note, chartTools, searchField, button, esc, empty, filters, signed } from '../ui.js';
import { lines, radar, bars, heatColor } from '../charts.js';
import { scoresSheet } from '../export.js';
export function student(data,s){
 const roster=data.students.filter(p=>p.name.includes(s.search||''));
 if(!s.sid)s.sid=roster[0]?.id||data.students[0]?.id;
 const history=studentHistory(data,s.sid),row=studentAt(data,s.sid,s.exam),person=personName(data,s.sid);
 const selector='<section class="student-selector">'+searchField('search',s.search,'输入姓名，查找学生…')+select('sid','选择学生',roster.slice(0,500).map(p=>[p.id,p.name]),s.sid)+'<span class="muted">找到 '+roster.length+' 位学生</span></section>';
 if(!row)return {html:header('06 / A PERSONAL JOURNEY','每个人，都有自己的轨迹。','从学生出发，联结不同班级、不同时期的成绩。')+selector+empty('这位学生还没有成绩','导入完整成绩工作簿后，历史和小题会按姓名联结。'),sheets:{}};
 s.exam=row.exam;const subs=subjectsFor([row]);if(!subs.includes(s.subject))s.subject=subs[0]||'语文';
 const values=s.metric==='percentile'?history.map(r=>percentile(data,r)):s.metric==='top'?history.map(r=>gap(data,r,'top')):s.metric==='under'?history.map(r=>gap(data,r,'under')):history.map(r=>r.total);
 const questionSubjects=[...subs,...(data.answers.filter(a=>a.sid===s.sid&&a.exam===row.exam).map(a=>a.subject).filter(sub=>!subs.includes(sub)))];
 const qs=studentQuestions(data,row,s.subject),weak=weakSubjects(data,row,'under');
 const allSubjects=subjectsFor(history);if(!allSubjects.includes(s.trendSubject))s.trendSubject=allSubjects[0];
 const p=profile(data,row.classNo),historyCols=[{label:'考试',render:r=>'<button class="text-link" data-set="exam" data-value="'+esc(r.exam)+'">'+esc(examShort(data,r.exam))+'</button>'},{label:'所在班',render:r=>r.classNo+'班'},{label:'总分 / 原分',numeric:true,render:r=>fmt(r.total)+' / '+fmt(r.rawTotal)},{label:'同类分位',numeric:true,render:r=>fmt(percentile(data,r))},{label:'特控分差',numeric:true,render:r=>trend(gap(data,r,'top'))},{label:'本科分差',numeric:true,render:r=>trend(gap(data,r,'under'))}];
 const html=header('06 / A PERSONAL JOURNEY','每个人，都有自己的轨迹。','按学生联结所有考次，转班也能延续记录。先理解变化，再寻找下一次成长的支点。')+
 selector+'<div class="student-banner"><div class="student-avatar">'+esc(person.replace('同学','').slice(-2))+'</div><div><h2>'+esc(person)+'</h2><p>'+row.classNo+'班 · '+p.type+' · '+(row.track==='physics'?'物理类':'历史类')+' · '+row.language+'</p></div><div class="student-banner-right">'+tag(history.length+'场成绩已联结','green')+button('生成个人报告','report-current')+'</div></div>'+
 filters(select('exam','观察考次',[...history].reverse().map(r=>[r.exam,examShort(data,r.exam)]),row.exam)+segmented('metric',[['total','赋分总分'],['percentile','同类分位'],['top','特控分差'],['under','本科分差']],s.metric))+
 metrics(metric('本次赋分总分',fmt(row.total),'原始总分 '+fmt(row.rawTotal),'green')+metric('同类相对分位',fmt(percentile(data,row)),'同类别、同届别的当次相对位置','blue')+metric('距特控线',signed(gap(data,row,'top')),'特控线 '+fmt(getLine(data,row,'top'),2))+metric('距本科线',signed(gap(data,row,'under')),'本科线 '+fmt(getLine(data,row,'under'),2),'clay'))+
 panel('阶段成绩变化','保留所有可联结考次，缺失分数保留断点。点击下方考次可查看当时的学科和小题。',lines('student-timeline',history.map(r=>r.exam),[{name:s.metric==='percentile'?'同类分位':s.metric==='top'?'距特控线':s.metric==='under'?'距本科线':'赋分总分',values}],{zero:['top','under'].includes(s.metric)}),chartTools('student-timeline'))+
 '<div class="grid-two">'+panel('学科表现','当前观察考次的实际选科；赋分占满分比例。',radar('student-radar',subs,[{name:person,values:subs.map(sub=>row.subjects[sub].score/maxOf(sub))}]),chartTools('student-radar'))+
 panel('离哪一科的有效线最近？','负值是尚未达到本科有效线；正值是高于有效线的余量。',bars('student-gaps',weak.map(w=>({label:w.subject,value:w.gap,color:w.gap<0?'#df895f':'#226857'})),{horizontal:true}),chartTools('student-gaps'))+'</div>'+
 panel('本次学科成绩','原分与赋分并列，逐项呈现有效线和分差。',table([{label:'学科',key:'subject'},{label:'原分',numeric:true,render:r=>fmt(row.subjects[r.subject].raw)},{label:'赋分',numeric:true,render:r=>fmt(row.subjects[r.subject].score)},{label:'原考试名次',numeric:true,render:r=>int(row.subjects[r.subject].rank)},{label:'特控线 / 分差',numeric:true,render:r=>fmt(getLine(data,row,'top',r.subject),2)+' / '+signed(gap(data,row,'top',r.subject))},{label:'本科线 / 分差',numeric:true,render:r=>fmt(getLine(data,row,'under',r.subject),2)+' / '+signed(gap(data,row,'under',r.subject))}],subs.map(subject=>({subject}))))+
 panel('学科随时间怎样变化？','每科单独观察，分数与本科有效线并列；选科发生变化时保留缺口。',select('trendSubject','观察学科',allSubjects,s.trendSubject)+lines('student-subject-history',history.map(r=>r.exam),[{name:s.trendSubject+'赋分',values:history.map(r=>r.subjects?.[s.trendSubject]?.score??null)},{name:'本科有效线',color:'#df895f',values:history.map(r=>getLine(data,r,'under',s.trendSubject))}]),chartTools('student-subject-history'))+
 panel('每一场，都保留下来','个人历史按身份联结，班级字段保留当次实际所在班。',table(historyCols,history),button('导出个人完整成绩','export-view'))+
 panel('本次逐题得分','选择学科查看每一道题的得分、满分和知识点。',select('subject','当前学科',questionSubjects,s.subject)+(qs.length?'<div class="question-grid">'+qs.map(q=>'<article class="question-card" style="--cell-color:'+heatColor(q.max&&q.score!=null?q.score/q.max:null)+'"><div><span>'+esc(q.label)+'</span>'+tag(q.max==null?'满分待明确':q.score>=q.max?'满分':q.score===0?'零分':'')+'</div><strong>'+fmt(q.score)+'<small> / '+fmt(q.max)+'</small></strong><p>'+esc(q.knowledge||'未标注知识点')+'</p><span class="question-loss">失分 '+fmt(q.loss)+'</span></article>').join('')+'</div>':empty('这个科目还没有该生小题记录','总分与学科成绩已保留；补充小题表后会在这里展开。')))+
 note('同类分位采用本站数据中同考试、同类别、同届别的学生计算，100表示最靠前。原考试排名保留来源口径；导入原表后显示真实姓名，数据留在此浏览器。');
 return {html,sheets:{'个人历次成绩':scoresSheet(data,history),'个人学科小题得分':[['考试','学科','题号','知识点','得分','满分','失分'],...history.flatMap(r=>subjectsFor([r]).flatMap(sub=>studentQuestions(data,r,sub).map(q=>[examShort(data,r.exam),sub,q.label,q.knowledge,q.score,q.max,q.loss])))]}};
}
