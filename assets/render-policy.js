/* Keep the decorative scene inside a frame and pixel budget. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AurumRenderPolicy = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const interval = 1000 / 60;
  function pixelRatio({ width, height, deviceRatio = 1, coarse = false, maxTextureSize = 8192, quality = 1 }) {
    const area = Math.max(1, width * height), budget = coarse ? 1800000 : 8300000;
    const desired = coarse ? deviceRatio : Math.max(1.25, deviceRatio);
    return Math.min(desired, 2, Math.sqrt(budget / area), maxTextureSize / Math.max(1, width, height)) * quality;
  }
  // Carry the remainder forward: a 120/144 Hz screen must not make the scene
  // render twice as often, or a slightly early 60 Hz callback skip a whole frame.
  function nextPaint(now, previous) {
    if (previous === null) return now;
    const delta = now - previous;
    if (delta < interval - 1) return null;
    return now - Math.max(0, delta % interval < interval - 1 ? delta % interval : 0);
  }
  function governor() {
    let quality = 1, total = 0, slow = 0, count = 0, healthy = 0;
    return {
      get quality() { return quality; },
      reset() { total = slow = count = healthy = 0; },
      sample(ms) {
        if (ms <= 0 || ms > 250) return false;
        total += ms; count++; if (ms > 25) slow++;
        if (total < 2000) return false;
        const average = total / count;
        const overloaded = slow / count > .18 || average > 18.75, clean = slow / count < .015 && average < 17.5;
        healthy = clean ? healthy + total : 0;
        let next = quality;
        if (overloaded) { next = Math.max(.65, quality - .1); healthy = 0; }
        else if (healthy >= 10000) { next = Math.min(1, quality + .05); healthy = 0; }
        total = slow = count = 0;
        next = +next.toFixed(2);
        if (next === quality) return false;
        quality = next; return true;
      }
    };
  }
  function motionReduced(preference, systemReduced) {
    return preference === "reduced" || (preference !== "standard" && !!systemReduced);
  }
  function createContext(canvas) {
    // Some integrated GPUs reject a high-performance/MSAA context but support a lean one.
    for (const options of [{ antialias: true, powerPreference: "high-performance" }, { antialias: false, powerPreference: "default" }]) {
      try {
        const context = canvas.getContext("webgl2", { alpha: false, ...options });
        if (context) return { context, compatibility: !options.antialias };
      } catch {}
    }
    throw Object.assign(Error("WebGL 2 unavailable"), { worldReason: "graphics" });
  }
  async function fetchBuffer(url, { timeoutMs = 15000, retries = 1, fetchImpl = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, { signal: controller.signal, cache: attempt ? "reload" : "default" });
        if (!response.ok) throw Object.assign(Error("Scene resource HTTP " + response.status), { retryable: response.status === 429 || response.status >= 500 });
        // The deadline includes body download, not just receipt of headers.
        return await response.arrayBuffer();
      } catch (error) {
        if (attempt >= retries || error.retryable === false) throw error;
      } finally { clearTimeout(timer); }
      await wait(500 * (attempt + 1));
    }
  }
  return { pixelRatio, nextPaint, governor, motionReduced, createContext, fetchBuffer };
});
