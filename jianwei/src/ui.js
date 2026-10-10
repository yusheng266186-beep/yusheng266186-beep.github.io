import { finite, examShort, profile, trackName, cohortName } from './model.js';
export const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmt = (v,d=1) => finite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
export const int = v => fmt(v,0);
export const pct = v => finite(v)?fmt(v*100,1)+'%':'—';
export const signed = (v,d=1) => finite(v)?(v>0?'+':'')+fmt(v,d):'—';
export const trend = v => '<span class="'+(finite(v)?v>=0?'positive':'negative':'muted')+'">'+signed(v)+'</span>';
const paths={
 overview:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
 effective:'M4 20V10m5 10V4m5 16v-7m5 7V7M2 20h20',
 classroom:'M3 5h18v14H3zM7 9h10M7 13h5M8 22v-3m8 3v-3',
 history:'M3 17l5-7 5 3 7-9M15 4h5v5M3 21h18',
 items:'M4 4h16v16H4zM4 10h16M10 4v16M15 13v4m-2-2h4',
 student:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
 actions:'M9 3h6l1 3h4v15H4V6h4zM8 11l2 2 5-5M8 17h8',
 reports:'M6 2h9l4 4v16H6zM14 2v5h5M9 12h7M9 16h7',
 data:'M20 5c0 2-4 3-8 3S4 7 4 5s4-3 8-3 8 1 8 3Zm0 0v14c0 2-4 3-8 3s-8-1-8-3V5M4 12c0 2 4 3 8 3s8-1 8-3',
 arrow:'M5 12h14m-5-5 5 5-5 5', upload:'M12 16V3m-5 5 5-5 5 5M3 16v5h18v-5',
 search:'M20 20l-6-6M16 9a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
 download:'M12 3v13m-5-5 5 5 5-5M3 17v4h18v-4', close:'M6 6l12 12M6 18 18 6',
 menu:'M4 6h16M4 12h16M4 18h16', check:'M4 12l5 5L20 6',
 plus:'M12 4v16M4 12h16', sun:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2',
 info:'M12 16v-5m0-3v-.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'
};
export const icon = name => '<svg viewBox="0 0 24 24" class="icon" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[name]||paths.arrow)+'"/></svg>';
export const tag = (text,tone='') => '<span class="tag '+tone+'">'+esc(text)+'</span>';
export function header(kicker,title,description,extra=''){
 return '<header class="page-head"><div><div class="eyebrow">'+esc(kicker)+'</div><h1>'+esc(title)+'</h1><p>'+esc(description)+'</p></div>'+extra+'</header>';
}
export const button = (text,action,kind='secondary',extra='') => '<button class="btn '+kind+'" data-action="'+esc(action)+'" '+extra+'>'+esc(text)+'</button>';
export function select(key,label,options,value,extra=''){
 return '<label class="field"><span>'+esc(label)+'</span><select data-field="'+esc(key)+'" '+extra+'>'+options.map(o=>{
 const [v,t]=Array.isArray(o)?o:[o,o];return '<option value="'+esc(v)+'"'+(String(v)===String(value)?' selected':'')+'>'+esc(t)+'</option>';
 }).join('')+'</select></label>';
}
export const examSelect = (data,key,value,label='本次考试') => select(key,label,[...data.exams].reverse().map(e=>[e.id,examShort(data,e.id)]),value);
export const classSelect = (data,key,value,all=false) => select(key,'班级',(all?[['all','全部班级']]:[]).concat(Object.keys(data.profiles).map(Number).sort((a,b)=>a-b).map(n=>[n,n+'班 · '+profile(data,n).type+' · '+trackName(profile(data,n).track)])),value);
export const trackSelect = value => select('track','分析类别',[['physics','物理类'],['history','历史类']],value);
export const cohortSelect = value => select('cohort','学生群体',[['regular','应届班'],['repeat','补习班']],value);
export const filters = html => '<div class="filter-bar">'+html+'</div>';
export function segmented(key,options,value){
 return '<div class="segmented" role="group">'+options.map(o=>'<button data-set="'+esc(key)+'" data-value="'+esc(o[0])+'" class="'+(String(value)===String(o[0])?'active':'')+'">'+esc(o[1])+'</button>').join('')+'</div>';
}
export function metric(label,value,detail='',tone='',decoration=''){
 return '<article class="metric '+tone+'"><div class="metric-label">'+esc(label)+decoration+'</div><strong>'+value+'</strong><div class="metric-detail">'+detail+'</div></article>';
}
export const metrics = html => '<div class="metrics">'+html+'</div>';
export function panel(title,subtitle,body,extra='',cls=''){
 return '<section class="panel '+cls+'"><div class="panel-head"><div><h2>'+esc(title)+'</h2>'+(subtitle?'<p>'+esc(subtitle)+'</p>':'')+'</div>'+extra+'</div>'+body+'</section>';
}
export const empty = (title='当前范围没有记录',text='换一个考试或导入原始成绩表后继续分析。') => '<div class="empty">'+icon('data')+'<h3>'+esc(title)+'</h3><p>'+esc(text)+'</p></div>';
export const note = text => '<p class="footnote">'+icon('info')+'<span>'+esc(text)+'</span></p>';
export function table(columns,rows,options={}){
 if(!rows.length)return empty();
 return '<div class="table-wrap"><table><thead><tr>'+columns.map(c=>'<th'+(c.numeric?' class="numeric"':'')+'>'+esc(c.label)+'</th>').join('')+'</tr></thead><tbody>'+rows.map((r,i)=>'<tr'+(options.rowClass?' class="'+options.rowClass(r,i)+'"':'')+'>'+columns.map(c=>'<td'+(c.numeric?' class="numeric"':'')+'>'+(c.render?c.render(r,i):esc(r[c.key]))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
export const personLink = (data,row,name) => '<button class="text-link" data-action="open-student" data-sid="'+esc(row.sid)+'" data-exam="'+esc(row.exam)+'">'+esc(name??data.students.find(p=>p.id===row.sid)?.name??row.sid)+'</button>';
export const classLink = n => '<button class="text-link" data-action="open-class" data-class="'+int(n)+'">'+int(n)+'班</button>';
export const meter = (value,label='',tone='') => '<div class="meter-cell"><span>'+esc(label||pct(value))+'</span><div class="meter '+tone+'"><i style="width:'+Math.max(0,Math.min(100,(value||0)*100))+'%"></i></div></div>';
export const scopeLabel = (data,state) => trackName(state.track)+' · '+cohortName(state.cohort)+' · '+examShort(data,state.exam);
export const searchField = (key,value,placeholder='搜索姓名…') => '<label class="search-field">'+icon('search')+'<input data-field="'+esc(key)+'" type="search" placeholder="'+esc(placeholder)+'" value="'+esc(value||'')+'"></label>';
export const chartTools = id => '<div class="chart-tools"><button class="icon-btn" data-action="chart-export" data-chart="'+esc(id)+'" title="导出图表 SVG">'+icon('download')+'</button><button class="icon-btn chart-png" data-action="chart-png" data-chart="'+esc(id)+'" title="导出图表 PNG">PNG</button></div>';
export const pillChecks = (key,options,values) => '<div class="pill-checks">'+options.map(o=>'<label class="'+(values.includes(String(o[0]))?'chosen':'')+'"><input type="checkbox" data-multi="'+esc(key)+'" value="'+esc(o[0])+'"'+(values.includes(String(o[0]))?' checked':'')+'>'+esc(o[1])+'</label>').join('')+'</div>';
export const toggle = (key,label,checked) => '<label class="toggle"><input type="checkbox" data-field="'+esc(key)+'"'+(checked?' checked':'')+'><span>'+esc(label)+'</span></label>';
