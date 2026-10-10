import { finite, PALETTE } from './model.js';
import { esc, fmt, int, empty } from './ui.js';
const W=800;
function svg(id,body,height,label){return '<div class="chart"><svg id="'+esc(id)+'" viewBox="0 0 '+W+' '+height+'" role="img" aria-label="'+esc(label)+'" xmlns="http://www.w3.org/2000/svg"><style>text{font-family:system-ui,-apple-system,sans-serif;fill:#74847e;font-size:12px}.axis{stroke:#e4e9e2;stroke-width:1}.value{fill:#29493e;font-size:12px;font-weight:600}</style>'+body+'</svg></div>';}
const tip = text => '<title>'+esc(text)+'</title>';
const zeroDomain = values => {const v=values.filter(finite);let lo=Math.min(0,...v),hi=Math.max(1,...v);if(lo===hi)hi=lo+1;return [lo,hi];};
export function bars(id,rows,{label='班级对比',suffix='',color=PALETTE[0],horizontal=false}={}){
 if(!rows.length)return empty();
 if(horizontal){
  const h=Math.max(190,rows.length*38+45),[lo,hi]=zeroDomain(rows.map(r=>r.value)),scale=x=>140+(x-lo)/(hi-lo)*590;
  let body='';
  for(let t=0;t<=4;t++){const v=lo+(hi-lo)*t/4,x=scale(v);body+='<line class="axis" x1="'+x+'" y1="8" x2="'+x+'" y2="'+(h-25)+'"/><text x="'+x+'" y="'+(h-8)+'" text-anchor="middle">'+fmt(v,0)+esc(suffix)+'</text>';}
  rows.forEach((r,i)=>{const y=20+i*38,known=finite(r.value),x=known?scale(r.value):scale(0),base=scale(0);
   body+='<g tabindex="0">'+tip(r.label+'：'+fmt(r.value)+suffix)+'<text x="128" y="'+(y+13)+'" text-anchor="end">'+esc(r.label)+'</text><rect x="'+Math.min(x,base)+'" y="'+y+'" width="'+Math.max(known?2:0,Math.abs(x-base))+'" height="22" rx="4" fill="'+(r.color||color)+'"/><text class="value" x="'+(Math.max(x,base)+7)+'" y="'+(y+15)+'">'+fmt(r.value)+esc(suffix)+'</text></g>';
  });return svg(id,body,h,label);
 }
 const h=280,[lo,hi]=zeroDomain(rows.map(r=>r.value)),left=48,right=775,top=22,bottom=234,scale=v=>bottom-(v-lo)/(hi-lo)*(bottom-top),step=(right-left)/rows.length,width=Math.min(56,step*.58);
 let body='';
 for(let t=0;t<=4;t++){const v=lo+(hi-lo)*t/4,y=scale(v);body+='<line class="axis" x1="'+left+'" y1="'+y+'" x2="'+right+'" y2="'+y+'"/><text x="40" y="'+(y+4)+'" text-anchor="end">'+fmt(v,0)+'</text>';}
 rows.forEach((r,i)=>{const x=left+step*(i+.5),v=r.value,known=finite(v),y=known?scale(v):scale(0),base=scale(0);
 body+='<g tabindex="0">'+tip(r.label+'：'+fmt(v)+suffix)+'<rect x="'+(x-width/2)+'" y="'+Math.min(base,y)+'" width="'+width+'" height="'+(known?Math.max(2,Math.abs(base-y)):0)+'" rx="5" fill="'+(r.color||color)+'"/><text class="value" x="'+x+'" y="'+(v<0?y+16:y-8)+'" text-anchor="middle">'+fmt(v,rows.length>15?0:1)+'</text><text x="'+x+'" y="258" text-anchor="middle">'+esc(r.short||r.label)+'</text></g>';
 });return svg(id,body,h,label);
}
export function lines(id,labels,series,{suffix='',zero=false,label='考试轨迹'}={}){
 const vals=series.flatMap(s=>s.values).filter(finite);if(!vals.length)return empty('尚无可展示的轨迹','选择有成绩的考试，或改用其他指标。');
 let lo=Math.min(...vals),hi=Math.max(...vals);if(zero)lo=Math.min(0,lo);const pad=Math.max(1,(hi-lo)*.15);lo-=pad;hi+=pad;
 const l=58,r=768,t=32,b=252,h=328,x=i=>labels.length>1?l+(r-l)*i/(labels.length-1):(l+r)/2,y=v=>b-(v-lo)/(hi-lo)*(b-t);let body='';
 for(let i=0;i<=4;i++){const v=lo+(hi-lo)*i/4,yy=y(v);body+='<line class="axis" x1="'+l+'" y1="'+yy+'" x2="'+r+'" y2="'+yy+'"/><text x="47" y="'+(yy+4)+'" text-anchor="end">'+fmt(v,0)+esc(suffix)+'</text>';}
 if(lo<0&&hi>0)body+='<line x1="'+l+'" y1="'+y(0)+'" x2="'+r+'" y2="'+y(0)+'" stroke="#aebbb3" stroke-dasharray="4 4"/>';
 labels.forEach((lab,i)=>{if(labels.length<=9||i%2===0||i===labels.length-1)body+='<text x="'+x(i)+'" y="278" text-anchor="middle">'+esc(lab)+'</text>';});
 series.forEach((s,si)=>{const c=s.color||PALETTE[si%PALETTE.length];let path='',connected=false;
 s.values.forEach((v,i)=>{if(!finite(v)){connected=false;return;}path+=(connected?' L':' M')+x(i)+' '+y(v);connected=true;});
 body+='<path d="'+path+'" fill="none" stroke="'+c+'" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>';
 s.values.forEach((v,i)=>{if(!finite(v))return;body+='<g tabindex="0">'+tip(labels[i]+' · '+s.name+'：'+fmt(v)+suffix)+'<circle cx="'+x(i)+'" cy="'+y(v)+'" r="5" fill="'+c+'" stroke="#fff" stroke-width="2"/></g>';});
 body+='<circle cx="'+(60+si*170)+'" cy="309" r="4" fill="'+c+'"/><text x="'+(72+si*170)+'" y="313">'+esc(s.name)+'</text>';
 });return svg(id,body,h,label);
}
export function distribution(id,bins,label='成绩分布'){
 return bars(id,bins,{label,color:'#759be8'});
}
export function scatter(id,rows,{label='均分与达线率',xLabel='总分均分',yLabel='本科上线率',color=PALETTE[0]}={}){
 const points=rows.filter(r=>finite(r.x)&&finite(r.y));if(!points.length)return empty();
 let xmin=Math.min(...points.map(r=>r.x))-15,xmax=Math.max(...points.map(r=>r.x))+15,ymin=0,ymax=100;
 const x=v=>65+(v-xmin)/(xmax-xmin)*665,y=v=>260-(v-ymin)/(ymax-ymin)*225;let body='';
 for(let i=0;i<=4;i++){const yy=260-i*225/4;body+='<line class="axis" x1="65" x2="730" y1="'+yy+'" y2="'+yy+'"/><text x="50" y="'+(yy+4)+'" text-anchor="end">'+i*25+'%</text>';const xx=65+i*665/4;body+='<text x="'+xx+'" y="284" text-anchor="middle">'+fmt(xmin+(xmax-xmin)*i/4,0)+'</text>';}
 points.forEach((p,i)=>{const rad=Math.max(9,Math.min(25,Math.sqrt(p.size||30)*2));
 body+='<g tabindex="0">'+tip(p.label+' · '+fmt(p.x)+'分 · '+fmt(p.y)+'% · '+int(p.size)+'人')+'<circle cx="'+x(p.x)+'" cy="'+y(p.y)+'" r="'+rad+'" fill="'+(p.color||color)+'" fill-opacity=".65" stroke="white" stroke-width="2"/><text class="value" x="'+x(p.x)+'" y="'+(y(p.y)+4)+'" text-anchor="middle">'+esc(p.short||p.label)+'</text></g>';});
 body+='<text x="730" y="312" text-anchor="end">'+esc(xLabel)+'</text><text x="65" y="18">'+esc(yLabel)+'</text>';
 return svg(id,body,326,label);
}
export function radar(id,axes,series,label='学科结构'){
 if(!axes.length)return empty();
 const cx=400,cy=150,r=113,n=axes.length,point=(i,v)=>[cx+Math.sin(i*2*Math.PI/n)*r*v,cy-Math.cos(i*2*Math.PI/n)*r*v];let body='';
 for(const f of [.25,.5,.75,1])body+='<polygon points="'+axes.map((_,i)=>point(i,f).join(',')).join(' ')+'" fill="none" stroke="#e0e6df"/>';
 axes.forEach((a,i)=>{const p=point(i,1),q=point(i,1.22);body+='<line class="axis" x1="'+cx+'" y1="'+cy+'" x2="'+p[0]+'" y2="'+p[1]+'"/><text x="'+q[0]+'" y="'+(q[1]+4)+'" text-anchor="middle">'+esc(a)+'</text>';});
 series.forEach((s,si)=>{const c=s.color||PALETTE[si];const ps=axes.map((a,i)=>point(i,Math.max(0,Math.min(1,s.values[i]||0))).join(',')).join(' ');
 body+='<polygon points="'+ps+'" fill="'+c+'" fill-opacity=".12" stroke="'+c+'" stroke-width="2">'+tip(s.name+'：'+s.values.map(v=>fmt(v*100)+'%').join(' / '))+'</polygon><circle cx="'+(245+si*170)+'" cy="313" r="4" fill="'+c+'"/><text x="'+(258+si*170)+'" y="317">'+esc(s.name)+'</text>';});return svg(id,body,335,label);
}
export function heatColor(v){if(!finite(v))return 'rgba(116,132,126,.06)';if(v<.4)return 'rgba(223,137,95,'+(0.18+.7*(.4-v)/.4)+')';if(v<.7)return 'rgba(169,160,88,'+(.16+.3*(.7-v)/.3)+')';return 'rgba(34,104,87,'+(.18+.55*(v-.7)/.3)+')';}
export function heatmap(id,columns,rows,renderLabel=null){
 if(!columns.length||!rows.length)return empty('没有逐题记录','该科目或考试可能没有小题数据。');
 return '<div class="heatmap-wrap" id="'+esc(id)+'"><table class="heatmap"><thead><tr><th>学生 / 班级</th>'+columns.map(c=>'<th title="'+esc(c.knowledge||'')+'">'+esc(c.label)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr><th>'+(renderLabel?renderLabel(r):esc(r.label))+'</th>'+columns.map((c,i)=>{const v=r.values[i],rate=finite(v)&&finite(c.max)&&c.max>0?v/c.max:null;return '<td style="background:'+heatColor(rate)+'" title="'+esc(c.label+' · '+(c.knowledge||'未标注')+' · '+fmt(v)+' / '+fmt(c.max))+'">'+fmt(v,1)+'</td>';}).join('')+'</tr>').join('')+'</tbody></table></div>';
}
