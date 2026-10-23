/* Transferred buffers avoid blocking scrolling while the sculpture is built. */
"use strict";
importScripts("gold-geometry.js", "gold-surface.js");
self.onmessage = function (event) {
  try {
    const mesh = self.AurumHelix.create({ segments: event.data.segments });
    const maps = self.AurumGoldSurface.create(event.data.size);
    self.postMessage({ mesh, maps }, [mesh.positions.buffer, mesh.normals.buffer, mesh.tangents.buffer,
      mesh.uvs.buffer, mesh.indices.buffer, maps.normals.buffer, maps.roughness.buffer]);
  } catch (error) { self.postMessage({ error: error.message }); }
};
