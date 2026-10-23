const test = require('node:test'), assert = require('node:assert/strict');
const Surface = require('../assets/gold-surface.js');

test('worker surface data is repeatable, transferable, and contains valid tangent normals', () => {
  const a = Surface.create(64), b = Surface.create(64);
  assert.deepEqual(a, b);
  assert.equal(a.normals.byteLength, 64 * 64 * 4);
  assert.equal(a.roughness.byteLength, a.normals.byteLength);
  const levels = new Set();
  for (let i = 0; i < a.normals.length; i += 4) {
    const normal = [0, 1, 2].map(k => a.normals[i+k] / 255 * 2 - 1);
    assert.ok(Math.abs(Math.hypot(...normal) - 1) < .015);
    assert.equal(a.normals[i+3], 255); assert.equal(a.roughness[i+3], 255);
    levels.add(a.roughness[i]);
  }
  assert.ok(levels.size > 15);
  const moved = structuredClone(a, { transfer: [a.normals.buffer, a.roughness.buffer] });
  assert.equal(a.normals.byteLength, 0); assert.deepEqual(moved, b);
});
