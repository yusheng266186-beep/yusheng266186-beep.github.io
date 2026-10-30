import test from 'node:test';import assert from 'node:assert/strict';
import {packArchive,unpackArchive} from '../scripts/news-factor-archive.mjs';
test('exact event versions are shared without changing any frozen snapshot or known-at value',()=>{
 const event={id:'N-example',label:'黄金市场消息',knownAt:'2026-10-25T00:00:00Z',quote:'这是引用的连续原文片段。'.repeat(12),effect:'support'};
 const original={schema:1,version:'news-factors-1',generatedAt:'2026-10-30T00:00:00Z',snapshots:Array.from({length:80},(_,i)=>({inputKey:'snapshot-'+i,generatedAt:'2026-10-25T01:00:00Z',events:[{...event},{...event,id:'N-second'}],coverage:{reviewed:2}}))};
 original.snapshots[25].events[0].knownAt='2026-10-25T02:00:00Z';original.snapshots[40].events[0].effect='pressure';
 const before=JSON.stringify(original),packed=packArchive(original),restored=unpackArchive(JSON.parse(JSON.stringify(packed)));
 assert.deepEqual(restored,original);assert.equal(JSON.stringify(original),before);assert.equal(Object.keys(packed.eventVersions).length,4);
 assert.ok(Buffer.byteLength(JSON.stringify(packed))<Buffer.byteLength(before)*.5);
 assert.deepEqual(unpackArchive(packArchive(restored)),original);assert.equal(unpackArchive(original),original);
});
test('missing referenced evidence is rejected instead of silently discarding historical snapshots',()=>{
 const broken={schema:2,encoding:'event-references',eventVersions:{},snapshots:[{inputKey:'old',eventRefs:['missing']}]};
 assert.throws(()=>unpackArchive(broken),/Missing news factor event version/);
 assert.throws(()=>unpackArchive({...broken,encoding:'unknown'}),/Invalid/);
 assert.throws(()=>unpackArchive({...broken,snapshots:[{}]}),/Missing news factor event references/);
});
