(function () {
  "use strict";
  const Store = window.AurumJournalStore, $ = id => document.getElementById(id);
  let options, pending = null, trigger = null, removed = null, showingAll = false;
  const money = n => new Intl.NumberFormat("zh-CN", {minimumFractionDigits:2, maximumFractionDigits:2}).format(n);
  const time = value => new Date(value).toLocaleString("zh-CN", {month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false});
  function node(tag, className, content) {
    const el = document.createElement(tag); if (className) el.className = className;
    if (content !== undefined) el.textContent = content; return el;
  }
  function exportJournal() {
    try {
      const raw = localStorage.getItem(Store.key);
      if (!raw) return;
      const url = URL.createObjectURL(new Blob([raw], {type:"application/json"}));
      const a = node("a"); a.href = url; a.download = "aurum-observations-" + new Date().toISOString().slice(0,10) + ".json";
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { options.notify("手记导出失败", error.message, "error"); }
  }
  function render() {
    if (!options) return;
    const list = $("journalList"), openIds = new Set([...list.querySelectorAll("details[open]")].map(el => el.dataset.entryId)); list.replaceChildren();
    const undo = $("journalUndo"); undo.replaceChildren();
    if (removed) {
      undo.append(node("span", "", "已移除一条手记。"));
      const button = node("button", "text-button", "撤销");
      button.type = "button"; button.onclick = () => {
        try { Store.append(localStorage, removed); removed = null; render(); }
        catch (error) { options.notify("无法撤销", error.message, "error"); }
      };
      undo.append(button);
    }
    let items;
    try { items = Store.read(localStorage); }
    catch (error) {
      list.append(node("p", "journal-empty", "本机手记暂时无法读取，原内容未覆盖。可先导出备份。"));
      $("exportJournal").disabled = false; $("journalNavCount").textContent = "—"; return;
    }
    $("journalNavCount").textContent = String(items.length); $("exportJournal").disabled = !items.length;
    if (!items.length) {
      const empty = node("div", "journal-empty");
      empty.append(node("p", "", "把当时的价格、假设和理由留在这里，给下一次回看一个参照。"));
      const link = node("a", "text-link", "记录第一个情景 ↗"); link.href = "#forecast"; empty.append(link); list.append(empty); return;
    }
    const quote = options.getQuote();
    items.slice(0, showingAll ? items.length : 3).forEach(item => {
      const row = node("details", "journal-entry"); row.dataset.entryId = item.id; row.open = openIds.has(item.id);
      const summary = node("summary", "journal-entry-summary");
      const title = node("div", "journal-entry-title");
      title.append(node("span", "", time(item.createdAt) + " · " + item.horizon), node("strong", "", item.note || "留存一份情景观察"));
      const value = node("div", "journal-entry-value"); value.append(node("span", "", "记录时中枢 · 元/克"), node("strong", "", money(item.center)));
      summary.append(title, value, node("b", "journal-expand", "+"));
      const content = node("div", "journal-entry-content"), metrics = node("div", "journal-metrics");
      if (item.note) content.append(node("p", "journal-full-note", item.note));
      [["记录时主价", money(item.price) + " 元/克"], ["原情景区间", money(item.low) + " — " + money(item.high)]].forEach(([label, value]) => {
        const metric = node("div"); metric.append(node("span", "", label), node("strong", "", value)); metrics.append(metric);
      });
      const change = Store.changeSince(item, quote), comparison = node("div");
      comparison.append(node("span", "", "报价相对记录时变化"), node("strong", "", change === null ? "等待更晚的有效报价" : (change >= 0 ? "+" : "") + change.toFixed(2) + "%")); metrics.append(comparison);
      const factors = node("div", "journal-factors"); item.factors.forEach(f => factors.append(node("span", "", f.name + " " + (f.value > 0 ? "+" : "") + f.value)));
      const tier = item.dataTier === "snapshot" ? "部署快照" : item.dataTier === "manual" ? "手动报价" : "公开行情记录";
      content.append(metrics, node("p", "journal-provenance", tier + " · 报价截至 " + new Date(item.quoteAsOf).toLocaleString("zh-CN", {hour12:false}) + " · " + item.source), factors,
        node("p", "journal-caption", "这是当时的研究快照。报价变化不代表情景预测准确率。"));
      const replay = node("button", "text-button journal-replay", "用这组假设重新推演 ↗"); replay.type = "button";
      replay.onclick = () => options.applySnapshot(item); content.append(replay);
      const remove = node("button", "text-button journal-remove", "移除此条手记"); remove.type = "button";
      remove.onclick = () => {
        try { removed = Store.remove(localStorage, item.id); render(); }
        catch (error) { options.notify("无法移除手记", error.message, "error"); }
      };
      content.append(remove);
      row.append(summary, content); list.append(row);
    });
    if (items.length > 3) {
      const more = node("button", "text-button journal-more", showingAll ? "收起至最近三条" : "查看全部 " + items.length + " 条手记 ↗");
      more.type = "button"; more.onclick = () => { showingAll = !showingAll; render(); }; list.append(more);
    }
  }
  function open() {
    try {
      pending = Store.snapshot(options.getSnapshot(), Date.now(), crypto.randomUUID());
      trigger = document.activeElement;
      $("journalCaptureMeta").textContent = pending.horizon + " · 中枢 " + money(pending.center) + " 元/克 · 报价 " + money(pending.price);
      $("journalNote").value = ""; $("journalError").textContent = "";
      $("journalDialog").showModal(); document.body.classList.add("journal-open"); $("journalNote").focus();
    } catch (error) { options.notify("暂时无法记录", error.message, "error"); }
  }
  function init(config) {
    options = config;
    $("captureScenario").addEventListener("click", open);
    $("closeJournal").addEventListener("click", () => $("journalDialog").close());
    $("journalDialog").addEventListener("close", () => { document.body.classList.remove("journal-open"); pending = null; trigger?.focus({preventScroll:true}); });
    $("journalForm").addEventListener("submit", event => {
      event.preventDefault(); if (!pending) return;
      try {
        Store.append(localStorage, {...pending, note: $("journalNote").value});
        $("journalDialog").close(); render(); options.navigate("intelligence");
        requestAnimationFrame(() => $("journalSection").scrollIntoView({behavior:"instant", block:"start"}));
        options.notify("观察已保存到本机", "报价时点、情景区间和全部假设已一同留存。");
      } catch (error) { $("journalError").textContent = error.message || "本机存储不可用，手记尚未保存。"; }
    });
    $("exportJournal").addEventListener("click", exportJournal);
    addEventListener("storage", event => { if (event.key === Store.key || event.key === null) render(); });
    render();
  }
  window.AurumJournal = {init, render};
})();
