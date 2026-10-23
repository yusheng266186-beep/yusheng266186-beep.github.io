/* A solid helical gold ribbon. Shared with geometry regression checks. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AurumHelix = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const TAU = Math.PI * 2;
  function surface(theta, b, t) {
    const lean = .38 + Math.sin(theta * .47) * .10;
    const forged = .007 * Math.sin(theta * 7.3 + b * 4.1) + .004 * Math.sin(theta * 17.9 - b * 9.7);
    const radius = 2.12 + .24 * Math.sin(theta * .37) + .055 * Math.cos(b / 1.05 * Math.PI * .5) + b * Math.sin(lean) + t * Math.cos(lean) + forged;
    return [radius * Math.cos(theta), -theta * 5.4 / TAU + b * Math.cos(lean) - t * Math.sin(lean), radius * Math.sin(theta)];
  }
  function create(options = {}) {
    const turns = options.turns || 3.4, segments = options.segments || 1200;
    const halfWidth = 1.05, halfThickness = .13, bevel = .048, arcSteps = 10;
    const ring = [];
    function cornerPoint(corner, angle) {
      const sx = corner === 0 || corner === 3 ? 1 : -1, sy = corner < 2 ? 1 : -1;
      return [sx * (halfWidth - bevel) + Math.cos(angle) * bevel, sy * (halfThickness - bevel) + Math.sin(angle) * bevel];
    }
    for (let corner = 0; corner < 4; corner++) {
      for (let step = 0; step <= arcSteps; step++) ring.push(cornerPoint(corner, (corner * .5 + step / arcSteps * .5) * Math.PI));
      const end = ring[ring.length-1], next = cornerPoint((corner+1)%4, (corner+1)*Math.PI*.5);
      const subdivisions = Math.abs(next[0]-end[0]) > 1 ? 15 : 2;
      for(let k=1;k<subdivisions;k++) ring.push(end.map((v,i)=>v+(next[i]-v)*k/subdivisions));
    }
    const positions = [], normals = [], tangents = [], uvs = [], indices = [], m = ring.length;
    const start = -Math.PI * turns, end = Math.PI * turns;
    for (let j = 0; j <= segments; j++) {
      const theta = start + (end - start) * j / segments;
      for (let k = 0; k < m; k++) {
        const [b, t] = ring[k], p = surface(theta, b, t);
        const next = ring[(k + 1) % m], previous = ring[(k + m - 1) % m];
        const ahead = surface(theta + .0001, b, t), behind = surface(theta - .0001, b, t);
        const sideA = surface(theta, next[0], next[1]), sideB = surface(theta, previous[0], previous[1]);
        const a = ahead.map((v, i) => v - behind[i]), c = sideA.map((v, i) => v - sideB[i]);
        const n = [a[1]*c[2]-a[2]*c[1],a[2]*c[0]-a[0]*c[2],a[0]*c[1]-a[1]*c[0]];
        const length = Math.hypot(...n);
        const normal=n.map(v=>v/length), dot=a.reduce((sum,v,i)=>sum+v*normal[i],0);
        const tangent=a.map((v,i)=>v-dot*normal[i]), tl=Math.hypot(...tangent), T=tangent.map(v=>v/tl);
        const B=surface(theta,b+.0001,t).map((v,i)=>v-p[i]);
        const cross=[normal[1]*T[2]-normal[2]*T[1],normal[2]*T[0]-normal[0]*T[2],normal[0]*T[1]-normal[1]*T[0]];
        const handed=cross.reduce((sum,v,i)=>sum+v*B[i],0)>=0?1:-1;
        const warp = .028*Math.sin(theta*1.23+b*1.9)+.012*Math.sin(theta*3.17-b*4.1);
        positions.push(...p); normals.push(...normal); tangents.push(...T,handed); uvs.push((theta-start)/TAU+warp,b);
        if (j < segments) {
          const i = j*m+k, nextK = j*m+(k+1)%m;
          indices.push(i,i+m,nextK,nextK,i+m,nextK+m);
        }
      }
    }
    // Closed end caps preserve a solid silhouette at every camera angle.
    for (const [j, sign] of [[0,-1],[segments,1]]) {
      const theta=start+(end-start)*j/segments, center=surface(theta,0,0);
      const tangent=[-Math.sin(theta)*sign,0,Math.cos(theta)*sign], length=1;
      const first=positions.length/3;
      positions.push(...center);normals.push(...tangent.map(v=>v/length));tangents.push(0,1,0,1);uvs.push(j/segments*turns,0);
      for (let k=0;k<m;k++) {
        positions.push(...surface(theta,...ring[k]));normals.push(...tangent.map(v=>v/length));tangents.push(0,1,0,1);uvs.push(j/segments*turns,ring[k][0]);
      }
      for(let k=0;k<m;k++) {
        const left=surface(theta,...ring[k]),right=surface(theta,...ring[(k+1)%m]);
        const A=left.map((v,i)=>v-center[i]),B=right.map((v,i)=>v-center[i]);
        const face=[A[1]*B[2]-A[2]*B[1],A[2]*B[0]-A[0]*B[2],A[0]*B[1]-A[1]*B[0]];
        if(face.reduce((sum,v,i)=>sum+v*tangent[i],0)>0)indices.push(first,first+1+k,first+1+(k+1)%m);
        else indices.push(first,first+1+(k+1)%m,first+1+k);
      }
    }
    const IndexArray = positions.length/3 > 65535 ? Uint32Array : Uint16Array;
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), tangents: new Float32Array(tangents), uvs: new Float32Array(uvs), indices: new IndexArray(indices), turns, segments };
  }
  function cameraAt(chapter, scroll, time) {
    const presets = {
      overview: [0, 7.6, -1.6, .38], history: [.92, 8.1, -.8, .52],
      forecast: [1.95, 8.6, 0, .46], trading: [3.1, 7.7, .7, .52], intelligence: [4.15, 8.2, 1.7, .46]
    };
    const p=presets[chapter]||presets.overview;
    // Orbit and axial ascent are coupled, following the helix's own pitch.
    return { angle:p[0]+scroll*.68+time*.024, distance:p[1]-Math.sin(Math.min(scroll,2.8)*.8)*1.15,
      lift:p[2]+scroll*.73, framing:p[3] };
  }
  return { create, cameraAt, surface };
});
