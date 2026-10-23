/* One continuous solid gold helix, with physical metal and a photographed studio. */
(function () {
  "use strict";
  const host = document.getElementById("goldWorld"), Helix = window.AurumHelix;
  if (!host || !Helix) return;
  const canvas = host.querySelector("canvas"), base = new URL(".", document.currentScript.src);
  const media = matchMedia("(prefers-reduced-motion: reduce)"), touch = matchMedia("(pointer: coarse)");
  let THREE, renderer, scene, sculpture, material, geometry, camera, environment, normalMap, roughnessMap;
  let ready = false, lost = false, disposed = false, frame = 0, last = 0, lastPaint = 0, elapsed = 0;
  let reduced = media.matches, paused = document.hidden, chapter = host.dataset.scene || "overview";
  let scrollTarget = 0, scrollNow = 0, pointer = [0, 0], pointerNow = [0, 0], width = 1, height = 1;
  let pose = Helix.cameraAt(chapter, 0, 0);
  try {
    const saved = localStorage.getItem("aurum-motion-v1") === "reduced";
    reduced = reduced || saved;
    if (saved) document.body.classList.add("light-motion");
  } catch {}

  function brushedMetalMaps() {
    const size = touch.matches ? 1024 : 2048, unit = size / 1024;
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
    function map(data) {
      const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true; texture.repeat.set(1.1, .55);
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      texture.needsUpdate = true; return texture;
    }
    return { normal: map(normals), roughness: map(roughness) };
  }

  async function setup() {
    THREE = await import("./vendor/three.module.min.js");
    const { HDRLoader } = await import("./vendor/HDRLoader.js");
    if (disposed) return;
    renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: "low-power" });
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
    const hdr = new THREE.DataTexture(hdri.data, hdri.width, hdri.height, THREE.RGBAFormat, hdri.type);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    hdr.minFilter = THREE.LinearFilter; hdr.magFilter = THREE.LinearFilter;
    hdr.generateMipmaps = false; hdr.flipY = true; hdr.needsUpdate = true;
    const pmrem = new THREE.PMREMGenerator(renderer);
    environment = pmrem.fromEquirectangular(hdr);
    hdr.dispose(); pmrem.dispose();
    scene.environment = environment.texture;
    scene.environmentRotation.set(.7, .6, .1);
    scene.environmentIntensity = 1;

    const mesh = Helix.create({ segments: touch.matches ? 720 : 1200 });
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setAttribute("tangent", new THREE.BufferAttribute(mesh.tangents, 4));
    geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const maps = brushedMetalMaps(); normalMap = maps.normal; roughnessMap = maps.roughness;
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
    resize(); document.body.classList.add("world-ready"); wake();
  }

  function resize() {
    width = host.clientWidth; height = host.clientHeight;
    if (!width || !height) return;
    if (ready && !lost) {
      const wanted = touch.matches ? devicePixelRatio || 1 : Math.max(1.5, devicePixelRatio || 1);
      const budget = Math.sqrt((touch.matches ? 2500000 : 8300000) / (width * height));
      const dpr = Math.min(wanted, 2, budget, renderer.capabilities.maxTextureSize / Math.max(width, height));
      renderer.setPixelRatio(dpr); renderer.setSize(width, height, false);
      camera.aspect = width / height; camera.updateProjectionMatrix(); render();
    }
    wake();
  }
  function render() {
    if (!ready || lost || disposed) return;
    const p = reduced ? [0, 0] : pointerNow, aspect = width / height;
    sculpture.rotation.set(0, pose.angle, -.04, "ZYX");
    const distance = pose.distance * (aspect < .9 ? 1.24 : 1), lift = pose.lift;
    camera.position.set(p[0] * .25, lift + .32 + p[1] * .2, distance);
    camera.lookAt(0, lift, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const shift = aspect < .9 ? .55 : pose.framing;
    camera.projectionMatrix.elements[8] = -shift;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    renderer.render(scene, camera);
  }
  function tick(now) {
    frame = 0;
    if (paused || lost || disposed || !ready) return;
    const dt = last ? Math.min((now - last) / 1000, .05) : .016; last = now;
    if (!reduced) {
      elapsed += dt;
      const smoothing = 1 - Math.exp(-dt * 1.9);
      scrollNow += (scrollTarget - scrollNow) * (1 - Math.exp(-dt * 3.5));
      pointerNow = pointerNow.map((v, i) => v + (pointer[i] - v) * smoothing);
      const target = Helix.cameraAt(chapter, scrollNow, elapsed);
      while (target.angle - pose.angle > Math.PI) target.angle -= Math.PI * 2;
      while (target.angle - pose.angle < -Math.PI) target.angle += Math.PI * 2;
      for (const k of Object.keys(pose)) {
        const step = (target[k] - pose[k]) * smoothing;
        const speed = k === "angle" ? .55 : k === "lift" ? 1.1 : k === "distance" ? 1.6 : 1;
        pose[k] += Math.max(-speed * dt, Math.min(speed * dt, step));
      }
    } else { pose = Helix.cameraAt(chapter, 0, 0); pointerNow = [0, 0]; }
    if (!touch.matches || now - lastPaint > 31 || reduced) { render(); lastPaint = now; }
    if (!reduced) frame = requestAnimationFrame(tick);
  }
  function wake() {
    host.dataset.motion = reduced ? "reduced" : paused ? "paused" : "active";
    if (!frame && !paused && !lost && !disposed && ready) { last = 0; frame = requestAnimationFrame(tick); }
  }
  function setChapter(id) {
    chapter = ["overview", "history", "forecast", "trading", "intelligence"].includes(id) ? id : "overview";
    host.dataset.scene = chapter; scrollTarget = 0;
    if (reduced) pose = Helix.cameraAt(chapter, 0, 0); wake();
  }
  function setMotion(value) { reduced = !!value; if (frame) cancelAnimationFrame(frame); frame = 0; wake(); }
  function onScroll() {
    scrollTarget = Math.min(5, Math.max(0, scrollY / Math.max(innerHeight * .9, 1)));
    document.documentElement.style.setProperty("--scroll-progress", String(Math.min(1, scrollTarget / 4))); wake();
  }
  function cleanup() {
    disposed = true; if (frame) cancelAnimationFrame(frame);
    geometry?.dispose(); material?.dispose(); normalMap?.dispose(); roughnessMap?.dispose(); environment?.dispose(); renderer?.dispose();
  }
  canvas.addEventListener("webglcontextlost", e => {
    e.preventDefault(); lost = true; if (frame) cancelAnimationFrame(frame); frame = 0;
    document.body.classList.remove("world-ready"); host.dataset.renderer = "poster";
  });
  canvas.addEventListener("webglcontextrestored", () => {
    lost = false; if (ready) { host.dataset.renderer = "physical-gold-helix"; document.body.classList.add("world-ready"); resize(); }
  });
  addEventListener("resize", resize, { passive: true }); addEventListener("scroll", onScroll, { passive: true });
  addEventListener("pointermove", e => {
    if (e.pointerType !== "touch" && !touch.matches && !document.body.classList.contains("drawer-open")) pointer = [(e.clientX / innerWidth - .5) * 2, (.5 - e.clientY / innerHeight) * 2];
  }, { passive: true });
  document.addEventListener("pointerleave", () => { pointer = [0, 0]; });
  document.addEventListener("visibilitychange", () => { paused = document.hidden; if (paused && frame) cancelAnimationFrame(frame); frame = 0; wake(); });
  addEventListener("aurum:motion", e => setMotion(e.detail));
  media.addEventListener("change", () => setMotion(media.matches || document.body.classList.contains("light-motion")));
  addEventListener("pagehide", e => { if (e.persisted) { paused = true; if (frame) cancelAnimationFrame(frame); frame = 0; } else cleanup(); });
  addEventListener("pageshow", e => { if (e.persisted) { paused = document.hidden; wake(); } });
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
