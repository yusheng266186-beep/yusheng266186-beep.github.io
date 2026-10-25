// Deliberately narrow extraction. A post-release "expected" value is never a pre-event record.
const months={january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',july:'07',august:'08',september:'09',october:'10',november:'11',december:'12'};
export function extractNumbers(item){
 // Recompute derived fields after any text revision; a rejected template must not retain an older extraction.
 item={...item};for(const key of ['actual','indicator','unit','period'])delete item[key];
 const text=String(item.title||'')+' '+String(item.summary||''),published=Date.parse(item.publishedAt),seen=Date.parse(item.firstSeenAt);if(!Number.isFinite(published)||!Number.isFinite(seen))return {item,expectation:null};
 const indicator=/\bCPI\b|消费者物价|居民消费价格/i.test(text)?'CPI':/非农|\bpayrolls?\b/i.test(text)?'payrolls':null;if(!indicator)return {item,expectation:null};
 const chinese=text.match(/(20\d{2})年\s*(\d{1,2})月/),english=text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i),period=chinese?chinese[1]+'-'+chinese[2].padStart(2,'0'):english?english[2]+'-'+months[english[1].toLowerCase()]:null;
 if(!period)return {item,expectation:null};
 const metric=indicator==='CPI'?/同比|year.over.year|annual(?:ly)?/i.test(text)?'yoy':/环比|month.over.month|monthly/i.test(text)?'mom':null:'jobs';if(!metric||indicator==='CPI'&&(/同比/.test(text)&&/环比/.test(text)||/year.over.year/i.test(text)&&/month.over.month/i.test(text)))return {item,expectation:null};
 const core=/核心|\bcore\b/i.test(text),headline=/总体|整体|\bheadline\b/i.test(text);
 // Multiple reported CPI numbers or both definitions in one item require human/structured disambiguation.
 const percentageCount=(text.match(/[+-]?\d+(?:\.\d+)?\s*%/g)||[]).length;
 if(indicator==='CPI'&&(core&&headline||percentageCount>2))return {item,expectation:null};
 const unit=indicator==='CPI'?'%:'+metric+':'+(core?'core':'headline'):'jobs',normalize=(s)=>Number(s.replace(/[,\s万k]/gi,''))*(/万/.test(s)?10000:/k/i.test(s)?1000:1);
 const actual=indicator==='CPI'?text.match(/(?:公布(?:值)?|实际(?:值)?|reported|came in at|rose|increased|fell|declined)[^。;；\d+-]{0,28}([+-]?\d+(?:\.\d+)?)\s*%/i):text.match(/(?:公布(?:值)?|实际(?:值)?|added|rose by|increased by)[^。;；\d+-]{0,20}([+-]?[\d,]+(?:\.\d+)?\s*万?|[+-]?\d+(?:\.\d+)?\s*k)\s*(?:人|jobs|个)?/i);
 const expected=indicator==='CPI'?text.match(/(?:预期(?:值)?|预计|expected(?: to (?:rise|fall|be|increase))?(?: at| by)?|forecast(?: at)?|consensus(?: at)?)[^。;；\d+-]{0,20}([+-]?\d+(?:\.\d+)?)\s*%/i):text.match(/(?:预期(?:值)?|预计|expected|forecast|consensus)[^。;；\d+-]{0,20}([+-]?[\d,]+(?:\.\d+)?\s*万?|[+-]?\d+(?:\.\d+)?\s*k)/i);
 const enriched=actual?{...item,indicator,period,unit,actual:normalize(actual[1])}:item;
 const date=text.match(/(?:将于|scheduled (?:for|on)|due (?:on)?)[^\d]{0,8}(20\d{2})[-/]([01]?\d)[-/]([0-3]?\d)/i),eventAt=date?`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}T00:00:00Z`:null;
 const known=Math.max(published,seen),expectation=expected&&!actual&&eventAt&&known<Date.parse(eventAt)&&/^https:\/\//.test(item.url||'')?{indicator,period,unit,value:normalize(expected[1]),knownAt:new Date(known).toISOString(),eventAt,url:item.url,source:item.source,provenance:'pre-release-publication'}:null;
 return {item:enriched,expectation};
}
export function enrichArchive(items,previousExpectations=[]){const expectations=new Map(previousExpectations.map(e=>[JSON.stringify([e.indicator,e.period,e.unit,e.url,e.knownAt]),e]));
 const enriched=items.map(original=>{const versions=original.versions?.length?original.versions:[original],next=versions.map(v=>{const result=extractNumbers({...original,...v,versions:undefined});if(result.expectation){const e=result.expectation;expectations.set(JSON.stringify([e.indicator,e.period,e.unit,e.url,e.knownAt]),e);}return result.item;});return original.versions?.length?{...original,...next.at(-1),firstSeenAt:original.firstSeenAt,versions:next.map(({versions,...v})=>v)}:next[0];});return {items:enriched,expectations:[...expectations.values()]};
}
