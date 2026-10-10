import { personName, examShort, profile, describe, classTable, selectScores, subjectsFor, subjectStats, studentHistory, gap, itemAnalysis, finite } from './model.js';
import { fmt, pct, signed, esc } from './ui.js';
export function download(content,name,type='application/octet-stream'){
 const blob=content instanceof Blob?content:new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
export function backup(data){download(JSON.stringify(data),'见微-工作区备份-'+new Date().toISOString().slice(0,10)+'.json','application/json');}
let libraries=null;
export async function vendors(){
 if(!libraries)libraries=Promise.all(['xlsx.full.min.js','jszip.min.js'].map(name=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='./vendor/'+name;s.onload=resolve;s.onerror=()=>reject(new Error('导出组件加载失败'));document.head.append(s);})));
 await libraries;return {XLSX:window.XLSX,JSZip:window.JSZip};
}
export async function spreadsheet(sheets,name='见微-成绩分析'){
 const {XLSX}=await vendors(),book=XLSX.utils.book_new();
 for(const [title,rows] of Object.entries(sheets)){const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=(rows[0]||[]).map((_,i)=>({wch:i===0?22:16}));XLSX.utils.book_append_sheet(book,sheet,title.slice(0,31));}
 XLSX.writeFile(book,name+'.xlsx');
}
export function reportModel(data,state){
 const ctx={exam:state.exam,track:state.track,cohort:state.cohort,classes:state.type==='items'?state.classes:undefined};
 if(state.type==='class'){ctx.classNo=state.classNo;delete ctx.track;delete ctx.cohort;}
 if(state.type==='student')delete ctx.track;
 const students=state.type==='student'?[...(studentHistory(data,state.sid)||[])]:selectScores(data,ctx);
 const rows=state.type==='student'?students.filter(r=>r.exam===state.exam):students;
 const d=describe(data,rows),cs=classTable(data,ctx),subs=subjectsFor(rows),title=state.type==='student'?personName(data,state.sid)+' · 学习轨迹报告':state.type==='class'?state.classNo+'班 · 质量分析报告':state.type==='items'?state.subject+' · 试卷诊断报告':'年级 · 质量研究报告';
 const lines=[['分析范围',examShort(data,state.exam)],['参与人数',String(rows.length)],['有效总分人数',String(d.count)],['总分均分',fmt(d.avg)],['特控上线',fmt(d.top,0)+'人 / '+pct(d.topRate)],['本科上线',fmt(d.under,0)+'人 / '+pct(d.underRate)],['本科线下20分',fmt(d.nearUnder,0)+'人']];
 const sections=[{title:'整体结构',headers:['指标','结果'],rows:lines},{title:'学科表现',headers:['学科','均分','原分均分','有效人数','本科有效','本科双上线','本科有效率'],rows:subs.map(s=>{const v=subjectStats(data,rows,s);return [s,fmt(v.avg),fmt(v.rawAvg),v.count,fmt(v.under,0),fmt(v.underDouble,0),pct(v.underRate)];})}];
 if(state.type==='grade'||state.type==='class')sections.push({title:'班级表现',headers:['班级','班型','人数','均分','特控人数','本科人数','本科率'],rows:cs.map(c=>[c.no+'班',c.profile.type,c.count,fmt(c.avg),fmt(c.top,0),fmt(c.under,0),pct(c.underRate)])});
 if(state.type==='student')sections.push({title:'历次考试',headers:['考试','班级','总分','原总分','特控分差','本科分差'],rows:students.map(r=>[examShort(data,r.exam),r.classNo+'班',fmt(r.total),fmt(r.rawTotal),signed(gap(data,r,'top')),signed(gap(data,r,'under'))])});
 if(state.type==='items'){
  const a=itemAnalysis(data,ctx,state.subject);
  sections.push({title:'逐题诊断',headers:['题号','知识点','平均分','满分','得分率','区分度','零分人数'],rows:a.questions.map(q=>[q.label,q.knowledge,fmt(q.avg),fmt(q.max),pct(q.rate),fmt(q.discrimination,2),q.zero])},{title:'知识点行动',headers:['知识点','得分率','平均失分','建议'],rows:a.knowledge.map(k=>[k.name,pct(k.rate),fmt(k.lost),k.priority])});
 }
 const critical=rows.filter(r=>{const v=gap(data,r,'under');return v!=null&&v<0&&v>=-20;}).sort((a,b)=>gap(data,b,'under')-gap(data,a,'under'));
 sections.push({title:'本科临界学生',headers:['姓名','班级','总分','距本科线'],rows:critical.map(r=>[personName(data,r.sid),r.classNo+'班',fmt(r.total),signed(gap(data,r,'under'))])});
 if(state.notes)sections.push({title:'教师研判与行动',headers:['记录'],rows:state.notes.split('\n').filter(Boolean).map(n=>[n])});
 return {title,subtitle:data.school+' · '+data.grade+' · '+examShort(data,state.exam),sections,created:new Date().toLocaleDateString('zh-CN'),anonymous:data.anonymous};
}
export function reportHTML(report){
 return '<article class="report-paper"><div class="report-brand">见微 <span>LEARNING OBSERVATORY</span></div><h1>'+esc(report.title)+'</h1><p class="report-subtitle">'+esc(report.subtitle)+'</p>'+report.sections.map(s=>'<section><h2>'+esc(s.title)+'</h2><table><thead><tr>'+s.headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+s.rows.map(r=>'<tr>'+r.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></section>').join('')+'<footer>见微 · 学情研究台　'+esc(report.created)+(report.anonymous?'　匿名数据':'')+'<br>缺失值以 — 保留；分数线依照考试和科类分别取值。</footer></article>';
}
export async function reportDOCX(report){
 const {JSZip}=await vendors(),zip=new JSZip(),x=esc,p=(text,bold=false)=>'<w:p><w:r>'+(bold?'<w:rPr><w:b/></w:rPr>':'')+'<w:t xml:space="preserve">'+x(text)+'</w:t></w:r></w:p>';
 const body=p('见微 · 学情研究台',true)+p(report.title,true)+p(report.subtitle)+report.sections.map(s=>p(s.title,true)+'<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B8C8BE"/><w:left w:val="single" w:sz="4" w:color="B8C8BE"/><w:bottom w:val="single" w:sz="4" w:color="B8C8BE"/><w:right w:val="single" w:sz="4" w:color="B8C8BE"/><w:insideH w:val="single" w:sz="4" w:color="DCE4DE"/><w:insideV w:val="single" w:sz="4" w:color="DCE4DE"/></w:tblBorders></w:tblPr>'+[s.headers,...s.rows].map((r,i)=>'<w:tr>'+r.map(c=>'<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr>'+p(String(c??''),i===0)+'</w:tc>').join('')+'</w:tr>').join('')+'</w:tbl>').join('')+p('生成于 '+report.created);
 zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 zip.file('word/document.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="850" w:bottom="1000" w:left="850"/></w:sectPr></w:body></w:document>');
 download(await zip.generateAsync({type:'blob'}),report.title+'.docx');
}
export function printReport(report){
 let box=document.getElementById('print-area');if(!box){box=document.createElement('div');box.id='print-area';document.body.append(box);}box.innerHTML=reportHTML(report);window.print();
}
export function exportSVG(id){
 const svg=document.getElementById(id);if(!svg?.matches('svg'))throw new Error('这个内容请使用 Excel 导出。');
 const clone=svg.cloneNode(true);clone.setAttribute('xmlns','http://www.w3.org/2000/svg');download(new XMLSerializer().serializeToString(clone),'见微-'+id+'.svg','image/svg+xml');
}
export async function exportPNG(id){
 const svg=document.getElementById(id);if(!svg?.matches('svg'))return;
 const blob=new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}),url=URL.createObjectURL(blob),img=new Image();
 img.onload=()=>{const box=svg.viewBox.baseVal,c=document.createElement('canvas');c.width=box.width*2;c.height=box.height*2;const ctx=c.getContext('2d');ctx.fillStyle='#fffef9';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);c.toBlob(b=>download(b,'见微-'+id+'.png'));URL.revokeObjectURL(url);};img.src=url;
}
export function scoresSheet(data,rows){
 const subs=subjectsFor(rows);return [['考试','姓名','班级','科类','语种','赋分总分','原始总分','市排名','校排名','特控分差','本科分差',...subs.flatMap(s=>[s+'赋分',s+'原分',s+'本科分差'])],...rows.map(r=>[examShort(data,r.exam),personName(data,r.sid),r.classNo,r.track==='physics'?'物理类':'历史类',r.language,r.total,r.rawTotal,r.cityRank,r.schoolRank,gap(data,r,'top'),gap(data,r,'under'),...subs.flatMap(s=>[r.subjects[s]?.score??null,r.subjects[s]?.raw??null,gap(data,r,'under',s)])])];
}
