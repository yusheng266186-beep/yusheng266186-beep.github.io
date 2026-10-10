import { selectScores, describe, classTable, subjectStats, subjectsFor, overviewNotes, histogram, profile, getLine, mean, PALETTE, finite } from '../model.js';
import { header, filters, examSelect, trackSelect, cohortSelect, metrics, metric, fmt, int, pct, panel, table, classLink, tag, meter, note, chartTools, button } from '../ui.js';
import { bars, scatter, distribution } from '../charts.js';
import { scoresSheet } from '../export.js';
export function overview(data,s){
 const rows=selectScores(data,s),d=describe(data,rows),classes=classTable(data,s),subjects=subjectsFor(rows),notes=overviewNotes(data,rows);
 const topLine=rows[0]?getLine(data,rows[0],'top'):null,underLine=rows[0]?getLine(data,rows[0],'under'):null;
 const html=header('01 / THE BIG PICTURE','把全局，看得更清楚。','先看结构，再追问原因。达线、班级差异和学科表现，在一个研究视野中展开。',button('生成本页报告','report-current','secondary'))+
 filters(examSelect(data,'exam',s.exam)+trackSelect(s.track)+cohortSelect(s.cohort))+
 '<section class="overview-hero"><div><div class="eyebrow">学习的变化，有迹可循</div><h2>从一张成绩表，<br>走向每一位学生。</h2><p>'+data.grade+' · '+(s.track==='physics'?'物理类':'历史类')+' · '+(s.cohort==='repeat'?'补习班独立观察':'应届班整体观察')+'</p><div class="hero-tags">'+tag('特控线 '+fmt(topLine,2),'on-dark')+tag('本科线 '+fmt(underLine,2),'on-dark')+'</div></div><div class="hero-orbit" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div><i class="orb orb-a"></i><i class="orb orb-b"></i><i class="orb orb-c"></i><div class="orbit-center"><span>见微</span><small>SEE THE PROGRESS</small></div></div></section>'+
 metrics(metric('有效总分人数',int(d.count),int(d.missing)+'条记录没有总分','')+metric('总分均分',fmt(d.avg),'中位数 '+fmt(d.median),'blue')+metric('特控上线',int(d.top),pct(d.topRate)+' · 有效基数 '+int(d.topBase),'green')+metric('本科上线',int(d.under),pct(d.underRate)+' · 有效基数 '+int(d.underBase),'clay'))+
 '<div class="grid-two wide-left">'+panel('班级的相对位置','横轴为均分，纵轴为本科上线率；圆的大小对应有效总分人数。',scatter('overview-position',classes.map(c=>({label:c.no+'班',short:c.no+'班',x:c.avg,y:c.underRate==null?null:c.underRate*100,size:c.count,color:c.profile.type.includes('平行')?PALETTE[1]:PALETTE[0]}))),chartTools('overview-position'))+
 panel('值得进一步追问','基于当前范围的观察线索。','<div class="evidence-list">'+notes.map((n,i)=>'<article><span class="evidence-number">0'+(i+1)+'</span><div>'+tag(n.tag)+'<h3>'+n.title+'</h3><p>'+n.text+'</p></div></article>').join('')+'</div>')+'</div>'+
 '<div class="grid-two">'+panel('总分分布','每50分一个区间；缺失总分不进入分布。',distribution('overview-distribution',histogram(rows.map(r=>r.total))),chartTools('overview-distribution'))+
 panel('学科本科有效率','依据各学科自己的有效线，英语与日语分别展示。',bars('overview-subject',subjects.map(subject=>({label:subject,value:subjectStats(data,rows,subject).underRate==null?null:subjectStats(data,rows,subject).underRate*100})),{suffix:'%',horizontal:true}),chartTools('overview-subject'))+'</div>'+
 panel('班级总览','点击班级，进入这一班的单次成绩分析。',table([{label:'班级',render:r=>classLink(r.no)},{label:'班型',render:r=>tag(r.profile.type)},{label:'人数',numeric:true,render:r=>int(r.count)},{label:'均分',numeric:true,render:r=>fmt(r.avg)},{label:'特控人数',numeric:true,render:r=>int(r.top)},{label:'特控率',numeric:true,render:r=>pct(r.topRate)},{label:'本科人数',numeric:true,render:r=>int(r.under)},{label:'本科率',render:r=>meter(r.underRate)},{label:'本科线下20分',numeric:true,render:r=>int(r.nearUnder)}],classes),button('导出 Excel','export-view'))+
 note('17班为物理类补习班，18班为历史类补习班。应届与补习分别呈现；缺失成绩和缺失有效线分别保留，不以0代替。');
 return {html,sheets:{'班级总览':[['班级','班型','人数','均分','中位数','特控人数','特控率','本科人数','本科率','本科临界20分'],...classes.map(c=>[c.no,c.profile.type,c.count,c.avg,c.median,c.top,c.topRate,c.under,c.underRate,c.nearUnder])],'学生明细':scoresSheet(data,rows)}};
}
