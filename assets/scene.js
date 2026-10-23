/* UI choreography is independent of prices, calculations, and account storage. */
(function () {
  "use strict";
  const Q = s => document.querySelector(s), QA = s => [...document.querySelectorAll(s)];
  const pages = ["overview", "history", "forecast", "trading", "intelligence"];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)"), phone = matchMedia("(max-width: 979px)");
  const animations = new Map(); let current = "overview", held = null, pointerFrame = 0;
  function enabled() { return !reduce.matches && !document.body.classList.contains("light-motion"); }
  function animate(el, frames, duration = 420, spring = false) {
    if (!el || !enabled() || !el.animate) return;
    animations.get(el)?.cancel();
    const a = el.animate(frames, { duration, easing: spring ? "cubic-bezier(.2,.85,.25,1.1)" : "cubic-bezier(.16,1,.3,1)", fill: "both" });
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
  function go(id, updateURL = true) {
    if (id === "decision" || id === "methodology") { const target = id; go(id === "decision" ? "intelligence" : "forecast", updateURL); requestAnimationFrame(() => Q("#" + target)?.scrollIntoView({ behavior: enabled() ? "smooth" : "auto" })); return; }
    if (!pages.includes(id)) id = "overview";
    const changed = current !== id, previous = Q("[data-page='" + current + "']");
    if (changed && previous && enabled() && !phone.matches) {
      const rect = previous.getBoundingClientRect(), ghost = previous.cloneNode(true);
      ghost.removeAttribute("id"); ghost.removeAttribute("data-page"); ghost.hidden = false; ghost.className = "motion-ghost";
      ghost.setAttribute("inert", ""); ghost.setAttribute("aria-hidden", "true"); ghost.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
      ghost.style.cssText = "left:" + rect.left + "px;top:" + rect.top + "px;width:" + rect.width + "px;height:" + Math.min(rect.height, innerHeight) + "px";
      document.body.append(ghost); const a = animate(ghost, [{ opacity: .6, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-7px)" }], 140);
      if (a) a.finished.then(() => ghost.remove(), () => ghost.remove()); else ghost.remove();
    }
    current = id; document.body.dataset.chapter = id;
    const context = Q("#marketContext"), contextHost = Q(id === "overview" ? "#overviewContext" : "#mainContent");
    if (context && contextHost && context.parentElement !== contextHost) contextHost.prepend(context);
    QA("[data-page]").forEach(el => { el.hidden = el.dataset.page !== id; });
    synchronizeNav();
    if (updateURL && location.hash !== "#" + id) history.pushState(null, "", "#" + id);
    if (changed) {
      scrollTo({ top: 0, behavior: "auto" });
      const page = Q("[data-page='" + id + "']");
      animate(page, [{ opacity: .2, transform: "translateY(12px)" }, { opacity: 1, transform: "translateY(0)" }], phone.matches ? 240 : 320);
      QA("#" + id + " > .section-heading, #" + id + " > .panel").slice(0, 4).forEach((el, i) => {
        if (enabled()) { const a = el.animate([{ opacity: .3, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 420, delay: i * 30, easing: "cubic-bezier(.16,1,.3,1)" }); a.finished.then(() => a.cancel(), () => {}); }
      });
      window.dispatchEvent(new CustomEvent("aurum:chapter", { detail: id }));
    }
  }
  document.addEventListener("click", e => {
    const a = e.target.closest("a[href^='#'],[data-go]");
    if (!a || a.classList.contains("skip-link")) return;
    const id = a.dataset.go || a.getAttribute("href").slice(1);
    if (pages.includes(id) || ["decision", "methodology"].includes(id)) { e.preventDefault(); go(id); }
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
    if (phone.matches || e.pointerType === "touch" || !enabled() || document.body.classList.contains("drawer-open")) return;
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    pointerFrame = requestAnimationFrame(() => { document.documentElement.style.setProperty("--scene-x", (e.clientX / innerWidth - .5) * -5 + "px"); document.documentElement.style.setProperty("--scene-y", (e.clientY / innerHeight - .5) * -3 + "px"); pointerFrame = 0; });
  }, { passive: true });
  ["pointerup", "pointercancel", "blur"].forEach(type => window.addEventListener(type, release));
  document.addEventListener("visibilitychange", () => { if (document.hidden) { release(); animations.forEach(a => a.cancel()); document.body.classList.add("scene-paused"); } else document.body.classList.remove("scene-paused"); });
  Q("#motionToggle").onclick = () => { const on = document.body.classList.toggle("light-motion"); Q("#motionToggle").setAttribute("aria-pressed", String(on)); Q("#motionToggle").setAttribute("aria-label", on ? "恢复标准动效" : "减少动态效果"); if (on) animations.forEach(a => a.cancel()); };
  addEventListener("resize", synchronizeNav); addEventListener("popstate", () => go(location.hash.slice(1), false)); addEventListener("hashchange", () => go(location.hash.slice(1), false));
  document.fonts?.ready.then(synchronizeNav);
  go(location.hash.slice(1) || "overview", false);
  animate(Q(".hero-title"), [{ opacity: .1, transform: "translateY(20px)" }, { opacity: 1, transform: "translateY(0)" }], 780);
  window.AurumUI = { go, animate, synchronizeNav, motionEnabled: enabled };
})();
