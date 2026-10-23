/* One continuous solid gold helix, with physical metal and a photographed studio. */
(function () {
  "use strict";
  const host = document.getElementById("goldWorld"), Helix = window.AurumHelix, Policy = window.AurumRenderPolicy;
  if (!host || !Helix || !Policy) return;
  const canvas = host.querySelector("canvas"), base = new URL(".", document.currentScript.src);
  const media = matchMedia("(prefers-reduced-motion: reduce)"), touch = matchMedia("(pointer: coarse)");
  let THREE, renderer, scene, sculpture, material, geometry, camera, environment, normalMap, roughnessMap;
  let ready = false, lost = false, disposed = false, frame = 0, last = 0, lastPaint = null, elapsed = 0;
  let resizePending = true, bufferWidth = 0, bufferHeight = 0, bufferRatio = 0, projectionShift = NaN;
  let preparationWorker = null, preparationTimer = 0, environmentData = null, restoreFrame = 0, lastRenderStamp = 0;
  const governor = Policy.governor(), poseKeys = ["angle", "distance", "lift", "framing"];
  const wayfinder = document.querySelector(".scene-wayfinder");
  let progressNow = -1, drawCount = 0;
  let reduced = media.matches, paused = document.hidden, chapter = host.dataset.scene || "overview";
  function readingOverlay() { return document.body.matches(".drawer-open,.modal-open,.journal-open"); }
  let scrollTarget = 0, scrollNow = 0, pointer = [0, 0], pointerNow = [0, 0], width = 1, height = 1;
  let pose = Helix.cameraAt(chapter, 0, 0);
  const profiling = new URLSearchParams(location.search).has("perf");
  let sampleStart = 0, sampleLast = 0, frameTimes = [], bufferChanges = 0, contextLosses = 0;
  function sampleFrame(now) {
    if (!profiling) return;
    if (sampleLast && now - sampleLast < 250) frameTimes.push(now - sampleLast);
    sampleLast = now;
    if (!sampleStart) sampleStart = now;
    if (now - sampleStart < 2000 || !frameTimes.length) return;
    const sorted = [...frameTimes].sort((a,b) => a-b), total = frameTimes.reduce((a,b) => a+b,0);
    host.dataset.performance = JSON.stringify({ fps: +(frameTimes.length*1000/total).toFixed(1), p95: +sorted[Math.floor(sorted.length*.95)].toFixed(1), slowFrames: frameTimes.filter(ms=>ms>25).length, frames: frameTimes.length, draws: drawCount, buffers: bufferChanges, losses: contextLosses, dpr: renderer.getPixelRatio() });
    sampleStart = now; frameTimes = []; drawCount = 0;
  }
  try {
    const saved = localStorage.getItem("aurum-motion-v1") === "reduced";
    reduced = reduced || saved;
    if (saved) document.body.classList.add("light-motion");
  } catch {}

  async function prepareSculpture() {
    if (typeof Worker !== "undefined" && location.protocol !== "file:") {
      try {
        return await new Promise((resolve, reject) => {
          const worker = preparationWorker = new Worker(new URL("gold-worker.js", base));
          const finish = () => { clearTimeout(preparationTimer); worker.terminate(); preparationWorker = null; };
          preparationTimer = setTimeout(() => { finish(); reject(Error("Sculpture preparation timed out")); }, 30000);
          worker.onmessage = e => {
            finish();
            if (e.data.error) reject(Error(e.data.error)); else resolve(e.data);
          };
          worker.onerror = e => { e.preventDefault(); finish(); reject(Error("Sculpture worker unavailable")); };
          worker.postMessage({ size: touch.matches ? 1024 : 2048, segments: touch.matches ? 720 : 1200 });
        });
      } catch (error) { console.warn("AURUM preparation fallback:", error.message); }
    }
    // Direct-file / restricted-browser fallback uses the smaller material map.
    await new Promise(resolve => setTimeout(resolve, 0));
    return { mesh: Helix.create({ segments: touch.matches ? 720 : 1200 }), maps: window.AurumGoldSurface.create(1024) };
  }
  function brushedMetalMaps(data) {
    function map(bytes) {
      const texture = new THREE.DataTexture(bytes, data.size, data.size, THREE.RGBAFormat);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true; texture.repeat.set(1.1, .55);
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      texture.needsUpdate = true; return texture;
    }
    return { normal: map(data.normals), roughness: map(data.roughness) };
  }

  function rebuildEnvironment() {
    const data = environmentData;
    if (!data || disposed) throw Error("Studio environment unavailable");
    const hdr = new THREE.DataTexture(data.data, data.width, data.height, THREE.RGBAFormat, data.type);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    hdr.minFilter = THREE.LinearFilter; hdr.magFilter = THREE.LinearFilter;
    hdr.generateMipmaps = false; hdr.flipY = true; hdr.needsUpdate = true;
    const pmrem = new THREE.PMREMGenerator(renderer);
    try {
      const next = pmrem.fromEquirectangular(hdr), previous = environment;
      environment = next; scene.environment = next.texture; previous?.dispose();
    } finally { hdr.dispose(); pmrem.dispose(); }
  }

  async function setup() {
    let preparationError;
    const prepared = prepareSculpture().catch(error => { preparationError = error; return null; });
    THREE = await import("./vendor/three.module.min.js");
    const { HDRLoader } = await import("./vendor/HDRLoader.js");
    if (disposed) return;
    renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x080909, 1);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
    const response = await fetch(new URL("environment/studio-small-03-1k.hdr", base), { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error("Studio environment unavailable");
    const hdri = new HDRLoader().parse(await response.arrayBuffer());
    if (disposed) return;
    // Retain the studio's shapes while protecting gold detail in the brightest
    // softboxes. Unbounded capture peaks otherwise clip the metal to white.
    const half = hdri.type === THREE.HalfFloatType;
    for (let i = 0; i < hdri.data.length; i += 4) {
      const rgb = [0,1,2].map(c => half ? THREE.DataUtils.fromHalfFloat(hdri.data[i+c]) : hdri.data[i+c]);
      const scale = 4.5 / (4.5 + Math.max(...rgb));
      for (let c = 0; c < 3; c++) hdri.data[i+c] = half ? THREE.DataUtils.toHalfFloat(rgb[c]*scale) : rgb[c]*scale;
    }
    environmentData = hdri; rebuildEnvironment();
    scene.environmentRotation.set(.7, .6, .1);
    scene.environmentIntensity = 1;

    const data = await prepared;
    if (!data) throw preparationError;
    const { mesh, maps: surfaceData } = data;
    if (disposed) return;
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setAttribute("tangent", new THREE.BufferAttribute(mesh.tangents, 4));
    geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const maps = brushedMetalMaps(surfaceData); normalMap = maps.normal; roughnessMap = maps.roughness;
    material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(.98, .57, .16), metalness: 1, roughness: .22,
      normalMap, normalScale: new THREE.Vector2(.42, .42), roughnessMap,
      anisotropy: .08, anisotropyRotation: 0,
      clearcoat: 0, envMapIntensity: 1.1, side: THREE.FrontSide
    });
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", `
        #include <normal_fragment_maps>
        // Filter subpixel normal changes into roughness instead of bright,
        // jagged glints. Mesh silhouette AA is handled by supersampling/MSAA.
        vec3 goldDx = dFdx(normal), goldDy = dFdy(normal);
        float goldVariance = max(dot(goldDx,goldDx), dot(goldDy,goldDy));
        roughnessFactor = sqrt(min(1.0, roughnessFactor*roughnessFactor + min(0.08,goldVariance*0.25)));
      `);
    };
    material.customProgramCacheKey = () => "aurum-gold-filtered-v1";
    sculpture = new THREE.Mesh(geometry, material);
    sculpture.rotation.z = -.04; scene.add(sculpture);
    const key = new THREE.DirectionalLight(0xffedce, 1.4); key.position.set(-3, 5, 6); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffd18a, 1.0); rim.position.set(4, 3, -4); scene.add(rim);
    ready = true; host.dataset.renderer = "physical-gold-helix";
    applySize(); render(); document.body.classList.add("world-ready"); wake();
  }

  function resize() { resizePending = true; wake(); }
  function applySize() {
    resizePending = false;
    const nextWidth = Math.round(host.clientWidth), nextHeight = Math.round(host.clientHeight);
    if (!nextWidth || !nextHeight || !ready || lost) return false;
    const ratio = Policy.pixelRatio({ width: nextWidth, height: nextHeight, deviceRatio: devicePixelRatio || 1,
      coarse: touch.matches, maxTextureSize: renderer.capabilities.maxTextureSize, quality: governor.quality });
    if (nextWidth === bufferWidth && nextHeight === bufferHeight && Math.abs(ratio - bufferRatio) < .001) return false;
    width = bufferWidth = nextWidth; height = bufferHeight = nextHeight; bufferRatio = ratio;
    // One allocation, only for a real size/quality change, followed by a draw in
    // this same frame. Browser chrome scrolling must not clear the canvas.
    renderer.setDrawingBufferSize(width, height, ratio); bufferChanges++;
    camera.aspect = width / height; projectionShift = NaN;
    return true;
  }
  function render() {
    if (!ready || lost || disposed) return;
    const p = reduced ? [0, 0] : pointerNow, aspect = width / height;
    sculpture.rotation.set(0, pose.angle, -.04, "ZYX");
    const distance = pose.distance * (aspect < .9 ? 1.24 : 1), lift = pose.lift;
    camera.position.set(p[0] * .25, lift + .32 + p[1] * .2, distance);
    camera.lookAt(0, lift, 0);
    const shift = aspect < .9 ? .55 : pose.framing;
    if (!Number.isFinite(projectionShift) || Math.abs(shift - projectionShift) > .00001) {
      camera.updateProjectionMatrix(); camera.projectionMatrix.elements[8] = -shift;
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert(); projectionShift = shift;
    }
    renderer.render(scene, camera); drawCount++;
  }
  function tick(now) {
    frame = 0;
    if (paused || lost || disposed || !ready) return;
    sampleFrame(now);
    const ms = last ? now - last : 0, dt = ms ? Math.min(ms / 1000, .05) : .016; last = now;
    const resized = resizePending && applySize();
    if (!reduced) {
      elapsed += dt;
      const smoothing = 1 - Math.exp(-dt * 1.9);
      scrollNow += (scrollTarget - scrollNow) * (1 - Math.exp(-dt * 3.5));
      pointerNow[0] += (pointer[0] - pointerNow[0]) * smoothing;
      pointerNow[1] += (pointer[1] - pointerNow[1]) * smoothing;
      const target = Helix.cameraAt(chapter, scrollNow, elapsed);
      while (target.angle - pose.angle > Math.PI) target.angle -= Math.PI * 2;
      while (target.angle - pose.angle < -Math.PI) target.angle += Math.PI * 2;
      for (const k of poseKeys) {
        const step = (target[k] - pose[k]) * smoothing;
        const speed = k === "angle" ? .55 : k === "lift" ? 1.1 : k === "distance" ? 1.6 : 1;
        pose[k] += Math.max(-speed * dt, Math.min(speed * dt, step));
      }
    } else { pose = Helix.cameraAt(chapter, 0, 0); pointerNow = [0, 0]; }
    const paintTime = Policy.nextPaint(now, lastPaint);
    if (paintTime !== null || resized || reduced) {
      const started = performance.now(); render();
      const cost = performance.now() - started, paintInterval = lastRenderStamp ? now - lastRenderStamp : 0;
      if (!reduced && governor.sample(Math.max(paintInterval, cost))) resizePending = true;
      lastRenderStamp = now; lastPaint = paintTime ?? now;
    }
    const progress = Math.min(1, scrollTarget / 4);
    if (wayfinder && Math.abs(progress - progressNow) > .001) {
      wayfinder.style.setProperty("--scroll-progress", String(progress)); progressNow = progress;
    }
    if (!reduced) frame = requestAnimationFrame(tick);
  }
  function wake() {
    host.dataset.motion = reduced ? "reduced" : paused ? "paused" : "active";
    if (!frame && !paused && !lost && !disposed && ready) { last = 0; lastPaint = null; lastRenderStamp = 0; frame = requestAnimationFrame(tick); }
  }
  function setChapter(id) {
    chapter = ["overview", "history", "forecast", "trading", "intelligence"].includes(id) ? id : "overview";
    host.dataset.scene = chapter; scrollTarget = 0;
    if (reduced) pose = Helix.cameraAt(chapter, 0, 0); wake();
  }
  function setMotion(value) { reduced = !!value; if (frame) cancelAnimationFrame(frame); frame = 0; wake(); }
  function onScroll() {
    scrollTarget = Math.min(5, Math.max(0, scrollY / Math.max((height > 1 ? height : innerHeight) * .9, 1)));
    wake();
  }
  function cleanup() {
    disposed = true; if (frame) cancelAnimationFrame(frame);
    overlayObserver.disconnect();
    if (restoreFrame) cancelAnimationFrame(restoreFrame); environmentData = null;
    clearTimeout(preparationTimer); preparationWorker?.terminate(); preparationWorker = null;
    geometry?.dispose(); material?.dispose(); normalMap?.dispose(); roughnessMap?.dispose(); environment?.dispose(); renderer?.dispose();
  }
  canvas.addEventListener("webglcontextlost", e => {
    e.preventDefault(); contextLosses++; lost = true; if (frame) cancelAnimationFrame(frame); frame = 0;
    if (restoreFrame) cancelAnimationFrame(restoreFrame); restoreFrame = 0;
    document.body.classList.remove("world-ready"); host.dataset.renderer = "poster";
  });
  canvas.addEventListener("webglcontextrestored", () => {
    // Three.js restores its GL state later in this same event dispatch. Rebuild
    // the render-target pixels next frame, before revealing the metal again.
    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = 0; if (disposed) return;
      if (!ready) { lost = false; return; }
      try {
        rebuildEnvironment(); lost = false; bufferRatio = 0; applySize(); render(); governor.reset();
        host.dataset.renderer = "physical-gold-helix"; document.body.classList.add("world-ready"); wake();
      } catch (error) { lost = true; host.dataset.renderer = "poster"; console.warn("AURUM environment recovery:", error.message); }
    });
  });
  addEventListener("resize", resize, { passive: true }); addEventListener("scroll", onScroll, { passive: true });
  addEventListener("pointermove", e => {
    if (e.pointerType !== "touch" && !touch.matches && !readingOverlay()) pointer = [(e.clientX / innerWidth - .5) * 2, (.5 - e.clientY / innerHeight) * 2];
  }, { passive: true });
  document.addEventListener("pointerleave", () => { pointer = [0, 0]; });
  function syncReadingState() {
    const next = document.hidden || readingOverlay();
    if (next === paused) return;
    paused=next; if (frame) cancelAnimationFrame(frame); frame=0;
    governor.reset(); sampleLast=sampleStart=0;frameTimes=[];pointer=[0,0];wake();
  }
  const overlayObserver=new MutationObserver(syncReadingState);
  overlayObserver.observe(document.body,{attributes:true,attributeFilter:["class"]});
  document.addEventListener("visibilitychange",syncReadingState);
  addEventListener("aurum:motion", e => setMotion(e.detail));
  media.addEventListener("change", () => setMotion(media.matches || document.body.classList.contains("light-motion")));
  addEventListener("pagehide", e => { if (e.persisted) { paused = true; if (frame) cancelAnimationFrame(frame); frame = 0; } else cleanup(); });
  addEventListener("pageshow", e => { if (e.persisted) { paused = document.hidden || readingOverlay(); wake(); } });
  window.AurumWorld = { setChapter, setMotion };
  if (!document.querySelector(".chapter-nav")) {
    const button = document.getElementById("motionToggle");
    function sync() { button?.setAttribute("aria-pressed", String(reduced)); button?.setAttribute("aria-label", reduced ? "恢复标准动效" : "减少动态效果"); }
    if (button) button.onclick = () => {
      const next = !reduced; document.body.classList.toggle("light-motion", next);
      try { localStorage.setItem("aurum-motion-v1", next ? "reduced" : "standard"); } catch {}
      setMotion(next || media.matches); sync();
    };
    sync();
  }
  setChapter(location.hash.slice(1) || host.dataset.scene || "overview"); onScroll();
  setup().catch(error => { cleanup(); host.dataset.renderer = "poster"; document.body.classList.remove("world-ready"); console.warn("AURUM sculpture fallback:", error.message); });
})();
