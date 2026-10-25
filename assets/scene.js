/* UI choreography is independent of prices, calculations, and account storage. */
(function () {
  "use strict";
  const Q = s => document.querySelector(s), QA = s => [...document.querySelectorAll(s)];
  const pages = ["overview", "history", "forecast", "trading", "intelligence"];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)"), phone = matchMedia("(max-width: 979px)");
  const animations = new Map(); let current = "overview", held = null;
  let motionPreference = "auto";
  try { motionPreference = localStorage.getItem("aurum-motion-v1") || "auto"; } catch {}
  function enabled() { return !window.AurumRenderPolicy.motionReduced(motionPreference, reduce.matches); }
  function animate(el, frames, duration = 420, spring = false, delay = 0) {
    if (!el || !enabled() || !el.animate) return;
    animations.get(el)?.cancel();
    const a = el.animate(frames, { duration, delay, easing: spring ? "cubic-bezier(.2,.85,.25,1.1)" : "cubic-bezier(.16,1,.3,1)", fill: "both" });
    animations.set(el, a);
    a.finished.then(() => { if (animations.get(el) === a) animations.delete(el); a.cancel(); }, () => { if (animations.get(el) === a) animations.delete(el); });
    return a;
  }
  function synchronizeNav() {
    QA(".nav-item").forEach(a => { a.classList.toggle("active", a.dataset.section === current); if (a.dataset.section === current) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    const active = Q(".nav-item.active"), bead = Q(".nav-bead");
    if (!active || !bead) return;
    const old = getComputedStyle(bead).transform, x = active.offsetLeft;
    bead.style.width = active.offsetWidth + "px"; bead.style.transform = "translateX(" + x + "px)";
    animate(bead, [{ transform: old === "none" ? bead.style.transform : old }, { transform: "translateX(" + x + "px) scaleX(1)", offset: .7 }, { transform: bead.style.transform }], 260, false);
  }
  let initialized = false, anchorFrame = 0;
  const positions = new Map();
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  function resolveDestination(fragment) {
    let id; try { id = decodeURIComponent(String(fragment || "overview").replace(/^#/,"")); } catch { id = "overview"; }
    if (pages.includes(id)) return {id,page:id,target:null};
    const target = document.getElementById(id), page = target?.closest("[data-page]")?.dataset.page;
    return page ? {id,page,target} : {id:"overview",page:"overview",target:null};
  }
  function go(fragment, updateURL = true, options = {}) {
    const destination = resolveDestination(fragment), id = destination.page, target = destination.target;
    const changed = current !== id, direction = pages.indexOf(id) >= pages.indexOf(current) ? 1 : -1;
    if (changed && initialized) positions.set(current,scrollY);
    if (changed) { animations.forEach(a => a.cancel()); release(); }
    if (anchorFrame) cancelAnimationFrame(anchorFrame);
    current = id; document.body.dataset.chapter = id;
    if (changed || !initialized) window.AurumWorld?.setChapter(id);
    Q("#chapterNumber").textContent = String(pages.indexOf(id) + 1).padStart(2,"0");
    const context = Q("#marketContext"), contextHost = Q(id === "overview" ? "#overviewContext" : "#mainContent");
    if (context && contextHost && context.parentElement !== contextHost) contextHost.prepend(context);
    QA("[data-page]").forEach(el => { el.hidden = el.dataset.page !== id; });
    synchronizeNav();
    if (updateURL && location.hash !== "#" + destination.id) history.pushState(null, "", "#" + destination.id);
    if (changed || (initialized && !target)) scrollTo({ top: options.restore && !target ? positions.get(id) || 0 : 0, behavior: "instant" });
    if (changed) {
      QA("#" + id + " > .section-heading").slice(0, 4).forEach((el, i) => {
        animate(el, [{ opacity: .25, transform: "translateY("+direction*18+"px)" }, { opacity: 1, transform: "translateY(0)" }], 620, false, i*45);
      });
      QA("#"+id+" .account-strip>div,#"+id+" .forecast-card").forEach((el,i) => {
        animate(el,[{opacity:.3,transform:"translateY(16px)"},{opacity:1,transform:"translateY(0)"}],520,false,55+i*45);
      });
      window.dispatchEvent(new CustomEvent("aurum:chapter", { detail: id }));
      if (options.focus !== false && !target) {
        const heading = Q("#"+id+" h1"); heading?.setAttribute("tabindex","-1"); heading?.focus({preventScroll:true});
      }
    }
    if (target) {
      // Reveal an anchor's complete hierarchy before measuring its position.
      for (let el = target; el && el !== document.body; el = el.parentElement) if (el.tagName === "DETAILS") el.open = true;
      anchorFrame = requestAnimationFrame(() => {
        anchorFrame = 0;
        target.scrollIntoView({behavior: initialized && updateURL && !changed && enabled() ? "smooth" : "auto",block:"start"});
        if (options.focus !== false) { target.setAttribute("tabindex","-1"); target.focus({preventScroll:true}); }
      });
    }
    initialized = true;
  }
  document.addEventListener("click", e => {
    if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest("a[href^='#'],[data-go]");
    if (!a || a.classList.contains("skip-link") || a.hasAttribute("download") || a.target === "_blank") return;
    const id = a.dataset.go || a.getAttribute("href").slice(1);
    const destination = resolveDestination(id);
    if (destination.id !== id) return;
    e.preventDefault(); go(id);
  });
  document.addEventListener("keydown", e => {
    const link = e.target.closest(".nav-item");
    if (!link || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault(); const i = pages.indexOf(current), n = e.key === "Home" ? 0 : e.key === "End" ? pages.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + pages.length) % pages.length;
    go(pages[n]); Q("[data-section='" + pages[n] + "']").focus();
  });
  function release() { held?.el.classList.remove("is-held"); held = null; }
  document.addEventListener("pointerdown", e => {
    const el = e.target.closest("button,summary,.nav-item,.wide-button");
    if (!el || el.disabled || !enabled() || e.button !== 0) return;
    release(); const r = el.getBoundingClientRect(); el.dataset.touch = "";
    el.style.setProperty("--touch-x", ((e.clientX - r.left) / r.width * 100) + "%"); el.style.setProperty("--touch-y", ((e.clientY - r.top) / r.height * 100) + "%");
    held = { el, x: e.clientX, y: e.clientY }; el.classList.add("is-held");
  }, { passive: true });
  document.addEventListener("pointermove", e => {
    if (held && Math.hypot(e.clientX - held.x, e.clientY - held.y) > 12) release();
  }, { passive: true });
  ["pointerup", "pointercancel", "blur"].forEach(type => window.addEventListener(type, release));
  document.addEventListener("visibilitychange", () => { if (document.hidden) { release(); animations.forEach(a => a.cancel()); document.body.classList.add("scene-paused"); } else document.body.classList.remove("scene-paused"); });
  function syncMotion() {
    const minimized = !enabled(), button = Q("#motionToggle"), select = Q("#motionPreference");
    document.body.classList.toggle("light-motion", minimized);
    button.setAttribute("aria-pressed", String(minimized));
    button.setAttribute("aria-label", minimized ? "恢复标准动效" : "减少动态效果");
    button.title = minimized ? (motionPreference === "auto" && reduce.matches ? "系统减少动效已开启 · 点击恢复本站动效" : "恢复标准动效") : "减少动态效果";
    if (select) select.value = ["standard","reduced"].includes(motionPreference) ? motionPreference : "auto";
    if (minimized) { animations.forEach(a => a.cancel()); document.getAnimations().forEach(a => a.cancel()); }
    dispatchEvent(new CustomEvent("aurum:motion", { detail: minimized }));
  }
  function chooseMotion(preference) {
    motionPreference = ["standard","reduced"].includes(preference) ? preference : "auto";
    try { if (motionPreference === "auto") localStorage.removeItem("aurum-motion-v1"); else localStorage.setItem("aurum-motion-v1", motionPreference); } catch {}
    syncMotion();
  }
  Q("#motionToggle").onclick = () => chooseMotion(enabled() ? "reduced" : "standard");
  Q("#motionPreference")?.addEventListener("change", e => chooseMotion(e.target.value));
  reduce.addEventListener("change", syncMotion);
  // Reading surfaces remain fully visible during native scrolling. Fading or
  // translating a large translucent panel changes its compositor surface and
  // produces a visible flash, especially around the factor controls.
  addEventListener("aurum:horizon", () => {
    animate(Q("#scenarioFocus"),[{opacity:.45,transform:"translateY(6px)"},{opacity:1,transform:"translateY(0)"}],260);
  });
  syncMotion();
  let navWidth = innerWidth, navFrame = 0;
  addEventListener("resize", () => {
    if (innerWidth === navWidth || navFrame) return;
    navFrame = requestAnimationFrame(() => { navFrame = 0; navWidth = innerWidth; synchronizeNav(); });
  }); let historyFrame = 0;
  function followHistory() {
    if (historyFrame) cancelAnimationFrame(historyFrame);
    historyFrame = requestAnimationFrame(() => { historyFrame = 0; go(location.hash.slice(1),false,{restore:true}); });
  }
  addEventListener("popstate",followHistory); addEventListener("hashchange",followHistory);
  document.fonts?.ready.then(synchronizeNav);
  go(location.hash.slice(1) || "overview", false, {focus:false});
  animate(Q(".hero-title"), [{ opacity: .1, transform: "translateY(20px)" }, { opacity: 1, transform: "translateY(0)" }], 780);
  window.AurumUI = { go, animate, synchronizeNav, motionEnabled: enabled };
})();
