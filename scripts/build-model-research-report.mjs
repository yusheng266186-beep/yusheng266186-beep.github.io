import {readFile,writeFile} from 'node:fs/promises';
const root='docs/validation/4.6.0/',json=async name=>JSON.parse(await readFile(root+name,'utf8'));
const [plan,development,selection,tail,rows]=await Promise.all(['plan.json','development.json','selection.json','holdout.json','frozen-history.json'].map(json));
const all=development.records.concat(tail.records),labels={7:'1 周',30:'1 个月',180:'6 个月',365:'1 年',1095:'3 年'};
const out={schema:1,id:plan.id,createdAt:tail.createdAt,data:{count:rows.length,first:rows[0].time,last:rows.at(-1).time,hash:plan.dataHash},kernel:plan.kernel,phases:plan.splits,notes:plan.notes,candidates:['legacy','boosted','adaptive'],
 horizons:plan.horizons.map(days=>{const h=tail.horizons.find(h=>h.days===days);const records=all.filter(r=>r.days===days&&r.candidate==='adaptive'&&r.phase==='holdout');const indexes=[0,Math.floor(records.length/2),records.length-1];return{days,label:labels[days],active:h.accepted?h.selected:'legacy',selected:h.selected,accepted:h.accepted,trials:h.trials,holdoutGate:h.holdoutGate,
 metrics:Object.fromEntries(plan.candidates.map(id=>[id,{...development.summaries[id][days],holdout:tail.summaries[id][days].holdout}])),examples:[...new Set(indexes)].filter(i=>i>=0&&records[i]).map(i=>records[i])};}),
 sources:[{label:'World Gold Council GRAM',url:'https://www.gold.org/goldhub/tools/gold-return-attribution-model',use:'驱动因素分组；归因框架不是未来准确率保证'},
 {label:'Chronos-2',url:'https://github.com/amazon-science/chronos-forecasting',use:'借鉴外生变量与分位预测思路；未下载或运行预训练权重，未移植其准确率'},
 {label:'TimesFM',url:'https://github.com/google-research/timesfm',use:'研究多变量方法；未运行或部署预训练权重'},
 {label:'Gold ARIMA / XGBoost / LSTM comparison',url:'https://github.com/LouSens/gold-price-forecast-arima-lstm',use:'借鉴收益率重构、时间切分和持平基准对照；未复制其实现'},
 {label:'XGBoost paper',url:'https://arxiv.org/abs/1603.02754',use:'借鉴浅层残差提升；本项目实现不是 XGBoost 库'}]};
await writeFile('data/model-research.json',JSON.stringify(out)+'\n');
console.log(JSON.stringify({records:all.length,origins:new Set(all.map(r=>r.origin)).size,bytes:JSON.stringify(out).length,active:out.horizons.map(h=>({days:h.days,active:h.active}))}));
