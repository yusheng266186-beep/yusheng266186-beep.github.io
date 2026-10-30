import {createHash} from 'node:crypto';
// Snapshots repeat most unchanged events. Store each exact event version once;
// hashes include all fields, so revised evidence and its known-at time stay distinct.
export function packArchive(archive){
 const eventVersions={},snapshots=(archive.snapshots||[]).map(snapshot=>{
  const {events,...meta}=snapshot,eventRefs=(events||[]).map(event=>{
   const key=createHash('sha256').update(JSON.stringify(event)).digest('hex');
   if(!Object.hasOwn(eventVersions,key))eventVersions[key]=event;
   return key;
  });
  return {...meta,eventRefs};
 });
 return {...archive,schema:2,encoding:'event-references',snapshots,eventVersions};
}
export function unpackArchive(archive){
 if(archive.schema!==2)return archive;
 if(archive.encoding!=='event-references'||!archive.eventVersions||!Array.isArray(archive.snapshots))throw Error('Invalid news factor archive');
 const {encoding,eventVersions,...meta}=archive;
 return {...meta,schema:1,snapshots:archive.snapshots.map(snapshot=>{
  if(!Array.isArray(snapshot.eventRefs))throw Error('Missing news factor event references');
  const {eventRefs,...fields}=snapshot;
  return {...fields,events:eventRefs.map(key=>{
   if(!Object.hasOwn(eventVersions,key))throw Error('Missing news factor event version: '+key);
   return eventVersions[key];
  })};
 })};
}
