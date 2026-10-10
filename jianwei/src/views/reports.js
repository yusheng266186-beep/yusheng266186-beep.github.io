import { SUBJECTS, studentHistory, latestExam } from '../model.js';
import { header, filters, examSelect, classSelect, trackSelect, cohortSelect, select, panel, button, esc, note } from '../ui.js';
import { reportModel, reportHTML } from '../export.js';
export function reports(data,s){
 if(!s.sid)s.sid=data.students[0]?.id;
 const history=s.type==='student'?studentHistory(data,s.sid):[];
 if(s.type==='student'&&!history.some(r=>r.exam===s.exam))s.exam=history.at(-1)?.exam||latestExam(data);
 const model=reportModel(data,s),scope=s.type==='class'?classSelect(data,'classNo',s.classNo):s.type==='student'?select('sid','选择学生',data.students.map(p=>[p.id,p.name]),s.sid):trackSelect(s.track)+cohortSelect(s.cohort)+(s.type==='items'?select('subject','研究学科',SUBJECTS,s.subject):'');
 const html=header('08 / REPORT STUDIO','把研究，写成一份报告。','按年级、班级、学生或试卷独立组织内容，留出教师判断的位置。')+
 filters(select('type','报告类型',[['grade','年级质量报告'],['class','班级单次报告'],['student','个人轨迹报告'],['items','试卷诊断报告']],s.type)+(s.type==='student'?select('exam','观察考次',history.map(r=>[r.exam,r.exam+' · '+data.exams.find(e=>e.id===r.exam)?.label]),s.exam):examSelect(data,'exam',s.exam))+scope)+
 '<div class="report-layout"><aside class="report-tools">'+panel('加上你的判断','数据描述现象，教师决定下一步。','<label class="field"><span>研判与行动记录</span><textarea data-field="notes" rows="9" placeholder="例如：本科临界学生以数学基础题为首要任务，每周追踪错题重做情况。">'+esc(s.notes||'')+'</textarea></label><div class="export-buttons">'+button('下载 Word','report-docx','primary')+button('下载 Excel','report-xlsx')+button('打印 / 保存 PDF','report-print')+'</div>')+note('PDF 通过浏览器打印窗口保存；Word 与 Excel 在本机生成。报告内容随当前设置更新。')+'</aside><div class="report-preview">'+reportHTML(model)+'</div></div>';
 return {html,report:model,sheets:Object.fromEntries(model.sections.map(section=>[section.title,[section.headers,...section.rows]]))};
}
