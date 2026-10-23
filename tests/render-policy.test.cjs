const test = require('node:test'), assert = require('node:assert/strict');
const P = require('../assets/render-policy.js');

test('rendering stays at the same cadence on 60, 120 and 144 Hz displays', () => {
  for (const hz of [60, 120, 144]) {
    let previous = null, draws = 0;
    for (let i = 0; i < hz * 10; i++) {
      const paint = P.nextPaint(i * 1000 / hz, previous);
      if (paint !== null) { previous = paint; draws++; }
    }
    assert.ok(draws >= 590 && draws <= 610, `${hz} Hz: ${draws} draws`);
  }
});

test('native resolution remains inside pixel and texture limits on large screens', () => {
  for (const [width, height, coarse, deviceRatio] of [[393, 852, true, 3], [1920, 1080, false, 2], [3840, 2160, false, 2], [2560, 1440, false, 1]]) {
    const ratio = P.pixelRatio({width, height, coarse, deviceRatio, maxTextureSize: 4096});
    assert.ok(width * height * ratio * ratio <= (coarse ? 1800000 : 8300000) + 1);
    assert.ok(Math.max(width, height) * ratio <= 4096);
    assert.ok(ratio > 0 && ratio <= 2);
  }
});

test('paint pressure below 25ms is detected without penalizing healthy 144Hz cadence', () => {
  const overloaded = P.governor(), healthy = P.governor();
  for (let i=0; i<110; i++) overloaded.sample(20);
  assert.equal(overloaded.quality, .9);
  const pattern = [20.833,13.889,20.833,13.889,13.889];
  for (let i=0; i<1200; i++) healthy.sample(pattern[i % pattern.length]);
  assert.equal(healthy.quality, 1);
});

test('sustained frame pressure lowers cost, isolated stalls do not, recovery is gradual', () => {
  const g = P.governor();
  g.sample(180); for (let i = 0; i < 130; i++) g.sample(16.67);
  assert.equal(g.quality, 1);
  for (let i = 0; i < 70; i++) g.sample(34);
  assert.equal(g.quality, .9);
  for (let i = 0; i < 1000; i++) g.sample(34);
  assert.equal(g.quality, .65);
  g.reset(); for (let i = 0; i < 610; i++) g.sample(16.67);
  assert.equal(g.quality, .7);
  g.sample(60000); assert.equal(g.quality, .7);
});
