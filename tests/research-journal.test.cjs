const test = require('node:test'), assert = require('node:assert/strict');
const J = require('../assets/research-journal.js');
const input = {price:866,quoteAsOf:'2026-10-23T10:00:00Z',source:'example',dataTier:'snapshot',horizon:'1 个月',days:21,low:800,center:865,high:930,note:'观察',factors:[{id:'risk',name:'避险情绪',value:10,origin:'manual'}]};
const now = Date.parse('2026-10-23T12:00:00Z');
function memory() { let raw = null; return {getItem:()=>raw,setItem:(_,value)=>{raw=value;}}; }
test('research snapshots preserve the original quote, horizon, and assumptions independently',()=>{
  const item = J.snapshot(input,now,'a'), storage = memory();
  J.append(storage,item); input.factors[0].value=20;
  assert.equal(J.read(storage)[0].factors[0].value,10);
  assert.equal(J.read(storage)[0].quoteAsOf,input.quoteAsOf);
  assert.equal(J.read(storage)[0].horizon,'1 个月');
  input.factors[0].value=10;
});
test('invalid quotes and intervals cannot become saved observations',()=>{
  for(const patch of [{price:0},{quoteAsOf:null},{low:900},{high:800},{center:Infinity},{days:0}])assert.throws(()=>J.snapshot({...input,...patch},now,'a'));
});
test('corrupt storage and failed writes preserve data and never report a save',()=>{
  let raw='broken'; const storage={getItem:()=>raw,setItem:(_,value)=>{raw=value;}};
  assert.throws(()=>J.append(storage,J.snapshot(input,now,'a'))); assert.equal(raw,'broken');
  assert.throws(()=>J.append({getItem:()=>null,setItem:()=>{throw Error('quota');}},J.snapshot(input,now,'a')),/quota/);
});
test('removing an observation can be undone with its exact saved content',()=>{
  const storage=memory(),item=J.snapshot(input,now,'a'); J.append(storage,item);
  const removed=J.remove(storage,'a'); assert.equal(J.read(storage).length,0);
  J.append(storage,removed); assert.deepEqual(J.read(storage)[0],item);
  assert.throws(()=>J.append(storage,item),/已保存/);
});
test('comparison requires a later timestamp, not merely a new fetch',()=>{
  const item=J.snapshot(input,now,'a');
  assert.equal(J.changeSince(item,{price:900,asOf:input.quoteAsOf}),null);
  assert.equal(J.changeSince(item,{price:900,asOf:'2026-10-22T10:00:00Z'}),null);
  assert.equal(J.changeSince(item,{price:900,asOf:null}),null);
  assert.ok(J.changeSince(item,{price:900,asOf:'2026-10-23T11:00:00Z'})>0);
});
test('backups merge chronologically, skip duplicates, and round-trip exact observations',()=>{
  const storage=memory(),a=J.snapshot(input,now,'a'),b=J.snapshot({...input,note:'later'},now+1000,'b');
  J.append(storage,a);
  const raw=JSON.stringify({version:1,items:[a,b]});
  const result=J.restore(storage,raw);
  assert.equal(result.added,1);assert.equal(result.skipped,1);
  assert.deepEqual(J.read(storage),[b,a]);
  assert.equal(J.restore(storage,raw).added,0);
});
test('conflicting or malformed backups never partially replace local observations',()=>{
  const storage=memory(),a=J.snapshot(input,now,'a');J.append(storage,a);const original=storage.getItem();
  for(const raw of ['invalid',JSON.stringify({version:1,items:[J.snapshot(input,now,'b'),{...a,note:'conflict'}]}),JSON.stringify({version:1,items:[a,{...a,id:' a '} ]})]) {
    assert.throws(()=>J.restore(storage,raw));assert.equal(storage.getItem(),original);
  }
});
test('oversized merged backups and failed storage writes do not report successful recovery',()=>{
  const storage=memory(),items=Array.from({length:50},(_,i)=>J.snapshot(input,now+i,'local-'+i));
  storage.setItem('',JSON.stringify({version:1,items}));const original=storage.getItem();
  assert.throws(()=>J.restore(storage,JSON.stringify({version:1,items:[J.snapshot(input,now,'new')]})),/50/);
  assert.equal(storage.getItem(),original);
  assert.throws(()=>J.restore({getItem:()=>null,setItem:()=>{throw Error('quota');}},JSON.stringify({version:1,items:[items[0]]})),/quota/);
});
test('undoing an older observation preserves the original timeline order',()=>{
  const storage=memory(),a=J.snapshot(input,now,'a'),b=J.snapshot(input,now+1000,'b');
  J.append(storage,a);J.append(storage,b);const removed=J.remove(storage,'a');J.append(storage,removed);
  assert.deepEqual(J.read(storage).map(item=>item.id),['b','a']);
});
