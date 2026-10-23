/* Deterministic gold surface data; runs off the UI thread when Workers are available. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AurumGoldSurface = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";
  function create(size) {
    const unit = size / 1024;
    const normals = new Uint8Array(size * size * 4), roughness = new Uint8Array(size * size * 4);
    const heights = new Float32Array(size * size);
    // Deterministic, tileable tool marks: broad forged undulations under fine,
    // interrupted scratches. Both maps stay in the ribbon's tangent space.
    function hash(x, y) {
      let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
      h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    }
    function noise(x, y, nx, ny) {
      const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const h = (a, b) => hash((a % nx + nx) % nx, (b % ny + ny) % ny);
      return (h(ix, iy) * (1-sx) + h(ix+1, iy) * sx) * (1-sy) + (h(ix, iy+1) * (1-sx) + h(ix+1, iy+1) * sx) * sy;
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size;
        const forged = noise(u*30, v*28, 30, 28) * .18 + noise(u*104, v*92, 104, 92) * .05;
        const fine = hash(x, y) * .002;
        heights[y*size+x] = forged + fine;
      }
    }
    // Individual marks have finite lengths, varied directions and soft edges.
    // Keep them shallow: this is finished solid metal, rather than worn foil.
    function mark(cx, cy, length, radius, angle, depth, bend = 0) {
      const c = Math.cos(angle), s = Math.sin(angle), extent = Math.ceil(length + radius * 3);
      for (let py = -extent; py <= extent; py++) for (let px = -extent; px <= extent; px++) {
        const along = px*c + py*s, across = -px*s + py*c - bend * (along / Math.max(1,length)) ** 2;
        const d = Math.hypot(Math.max(0, Math.abs(along) - length), across) / radius;
        if (d > 2.5) continue;
        const x = (Math.round(cx+px)+size)%size, y = (Math.round(cy+py)+size)%size;
        const taper = length ? Math.max(0,1-(along/(length+radius*2))**2) : 1;
        heights[y*size+x] -= depth * Math.exp(-d*d*2) * taper;
      }
    }
    for (let i = 0; i < 700; i++) {
      const a = hash(i, 7), b = hash(i, 19), c = hash(i, 31);
      if (noise(a*7,b*8,7,8)<.42) continue;
      const direction = hash(i, 59) < .7 ? (hash(i, 53)-.5)*1.4 : hash(i, 53)*Math.PI;
      const radius = (.9+hash(i,67)**2*1.3)*unit;
      mark(a*size, b*size, (1+c*c*28)*unit, radius, direction, .004+c**3*.026, (hash(i,83)-.5)*3*unit);
    }
    for (let i = 0; i < 60; i++) {
      const r = (1+hash(i, 97)*1.4)*unit;
      mark(hash(i, 71)*size, hash(i, 89)*size, 0, r, 0, .012+hash(i, 101)*.02);
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y*size+x)*4, h = heights[y*size+x];
        const dx = heights[y*size+(x+1)%size] - heights[y*size+(x+size-1)%size];
        const dy = heights[((y+1)%size)*size+x] - heights[((y+size-1)%size)*size+x];
        const nx = -dx * 3 * unit, ny = -dy * 3 * unit, length = Math.hypot(nx, ny, 1);
        normals[i] = Math.round((nx / length * .5 + .5) * 255);
        normals[i + 1] = Math.round((ny / length * .5 + .5) * 255);
        normals[i + 2] = Math.round((1 / length * .5 + .5) * 255);
        normals[i + 3] = 255;
        const polish = noise(x/size*9, y/size*12, 9, 12);
        const r = Math.round(170 + h * 70 + polish * 45);
        roughness[i] = r; roughness[i + 1] = r; roughness[i + 2] = r; roughness[i + 3] = 255;
      }
    }
    return { size, normals, roughness };
  }
  return { create };
});
