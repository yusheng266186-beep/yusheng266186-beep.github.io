const test=require('node:test'),assert=require('node:assert/strict');
const H=require('../assets/gold-geometry.js');
test('the sculpture is a finite solid mesh with valid depth, thickness and unit normals',()=>{
  const m=H.create();const count=m.positions.length/3;
  assert.equal(m.normals.length,m.positions.length);assert.equal(m.uvs.length,count*2);
  assert.ok(count>65535);assert.ok(m.indices instanceof Uint32Array);assert.ok(m.indices.length>100000);
  for(const value of m.positions)assert.ok(Number.isFinite(value));
  for(const index of m.indices)assert.ok(index<count);
  for(let i=0;i<m.normals.length;i+=3)assert.ok(Math.abs(Math.hypot(...m.normals.slice(i,i+3))-1)<.0001);
  const zs=[];for(let i=2;i<m.positions.length;i+=3)zs.push(m.positions[i]);
  assert.ok(Math.max(...zs)-Math.min(...zs)>4);
  const inner=H.surface(.7,0,-.075),outer=H.surface(.7,0,.075);
  assert.ok(Math.hypot(...outer.map((v,i)=>v-inner[i]))>.149);
});
test('following the helix changes axial height, angle and camera distance together',()=>{
  const start=H.cameraAt('history',0,0),end=H.cameraAt('history',1.5,0);
  assert.ok(end.angle>start.angle+.9);assert.ok(end.lift>start.lift+.9);
  assert.ok(end.distance<start.distance-.8);
  assert.equal(H.cameraAt('overview',0,0).angle,0);
  assert.ok(H.cameraAt('overview',0,60).angle>1);
});
test('physical gold has outward-facing triangles and orthogonal tangent frames on every surface',()=>{
  const m=H.create({segments:420}),p=m.positions,n=m.normals,t=m.tangents;
  for(let i=0;i<t.length;i+=4){
    const j=i/4*3;
    assert.ok(Math.abs(Math.hypot(t[i],t[i+1],t[i+2])-1)<.0001);
    assert.ok(Math.abs(t[i]*n[j]+t[i+1]*n[j+1]+t[i+2]*n[j+2])<.0001);
    assert.ok(t[i+3]===1||t[i+3]===-1);
  }
  for(let i=0;i<m.indices.length;i+=3){
    const [a,b,c]=[m.indices[i]*3,m.indices[i+1]*3,m.indices[i+2]*3];
    const u=[p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]],v=[p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]];
    const face=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const outward=face.reduce((sum,value,k)=>sum+value*(n[a+k]+n[b+k]+n[c+k]),0);
    assert.ok(outward>0,'front-face winding must match physical surface normals');
  }
});
test('all five chapters have distinct spatial poses and remain outside the sculpture',()=>{
  const names=['overview','history','forecast','trading','intelligence'];
  const angles=names.map(name=>H.cameraAt(name,0,0).angle);
  assert.equal(new Set(angles).size,5);
  for(const name of names)for(let scroll=0;scroll<=5;scroll+=.1){
    const camera=H.cameraAt(name,scroll,0);
    assert.ok(camera.distance>5);assert.ok(Object.values(camera).every(Number.isFinite));
  }
});
