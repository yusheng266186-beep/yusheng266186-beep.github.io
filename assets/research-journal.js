/* Immutable research snapshots; independent of live quotes and account storage. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AurumJournalStore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const key = "aurum-research-journal-v1", limit = 50;
  function text(value, max) { return String(value || "").trim().slice(0, max); }
  function positive(value) { return typeof value === "number" && Number.isFinite(value) && value > 0; }
  function date(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
  function reviewData(value) {
    if (value == null) return null;
    if (typeof value !== "object" || !text(value.note,560) || !date(value.updatedAt)) throw Error("回看记录无效，原内容未覆盖。");
    return {note:text(value.note,560),updatedAt:new Date(value.updatedAt).toISOString()};
  }
  function snapshot(input, now = Date.now(), id = String(now)) {
    if (!Number.isFinite(now) || !text(id, 80) || !input || !positive(input.price) || !date(input.quoteAsOf) || !positive(input.days) || !text(input.horizon, 20) ||
        ![input.low, input.center, input.high].every(positive) || input.low > input.center || input.center > input.high) {
      throw Error("有效报价、报价时点或情景输入不足，暂时无法记录。");
    }
    return { id: text(id, 80), createdAt: new Date(now).toISOString(), price: input.price,
      quoteAsOf: input.quoteAsOf, source: text(input.source, 200), dataTier: text(input.dataTier, 40),
      horizon: text(input.horizon, 20), days: input.days, low: input.low, center: input.center, high: input.high,
      note: text(input.note, 280), review:reviewData(input.review), factors: (input.factors || []).slice(0, 12).map(f => {
        if (!f || typeof f.value !== "number" || !Number.isFinite(f.value) || Math.abs(f.value) > 100) throw Error("假设参数无效。");
        return { id: text(f.id, 40), name: text(f.name, 40), value: f.value, origin: text(f.origin, 30) };
      }) };
  }
  function parse(raw) {
    if (raw === null) return [];
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !Array.isArray(data.items) || data.items.length > limit) throw Error("手记格式无效，原记录未覆盖。");
    const ids = new Set();
    return data.items.map(item => {
      if (!item || !date(item.createdAt) || !item.id) throw Error("手记记录无效，原记录未覆盖。");
      const validated = snapshot(item, Date.parse(item.createdAt), item.id);
      if (ids.has(validated.id)) throw Error("手记记录重复，原记录未覆盖。");
      ids.add(validated.id); return validated;
    }).sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  function read(storage) { return parse(storage.getItem(key)); }
  function append(storage, item) {
    const items = read(storage);
    if (items.length >= limit) throw Error("已保存 50 条手记，请先导出，再移除不需要的记录。");
    if (items.some(saved => saved.id === item.id)) throw Error("这条手记已保存。");
    const validated = snapshot(item, Date.parse(item.createdAt), item.id);
    const next = [validated, ...items].sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    storage.setItem(key, JSON.stringify({version: 1, items: next}));
    return next;
  }
  function changeSince(item, quote, now=Date.now()) {
    if (item.dataTier === "manual" || quote?.dataTier === "manual" || !positive(quote?.price) || !date(quote?.asOf) || Date.parse(quote.asOf)>now+300000 || Date.parse(quote.asOf) <= Date.parse(item.quoteAsOf)) return null;
    return (quote.price / item.price - 1) * 100;
  }
  function review(storage,id,note,now=Date.now()) {
    const value=reviewData({note,updatedAt:new Date(now).toISOString()}),items=read(storage),item=items.find(item=>item.id===id);
    if (!item) throw Error("原手记已被移除，请重新选择。");
    const next=items.map(row=>row.id===id?{...row,review:value}:row);
    storage.setItem(key,JSON.stringify({version:1,items:next}));return next;
  }
  function remove(storage, id) {
    const items = read(storage), next = items.filter(item => item.id !== id);
    storage.setItem(key, JSON.stringify({version:1, items:next}));
    return items.find(item => item.id === id) || null;
  }
  function restore(storage, raw) {
    if (typeof raw !== "string" || raw.length > 1000000) throw Error("请选择小于 1 MB 的 AURUM 手记 JSON 备份。");
    const incoming = parse(raw), current = read(storage), byId = new Map(current.map(item => [item.id,item]));
    let added = 0, skipped = 0, updated = 0;
    for (const item of incoming) {
      const existing = byId.get(item.id);
      if (existing) {
        const {review:oldReview,...oldSnapshot}=existing,{review:incomingReview,...incomingSnapshot}=item;
        if (JSON.stringify(oldSnapshot) !== JSON.stringify(incomingSnapshot)) throw Error("备份中有同编号、内容不同的手记，未覆盖任何记录。");
        if (incomingReview && (!oldReview || Date.parse(incomingReview.updatedAt)>Date.parse(oldReview.updatedAt))) {byId.set(item.id,item);updated++;continue;}
        if (oldReview && incomingReview && oldReview.updatedAt===incomingReview.updatedAt && oldReview.note!==incomingReview.note) throw Error("同一时点的回看内容冲突，未覆盖任何记录。");
        skipped++; continue;
      }
      byId.set(item.id,item); added++;
    }
    if (byId.size > limit) throw Error("合并后超过 50 条，请先导出并整理本机记录。");
    const items = [...byId.values()].sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    if (added || updated) storage.setItem(key, JSON.stringify({version:1,items}));
    return {added,updated,skipped,items};
  }
  return { key, limit, snapshot, parse, read, append, remove, restore, review, changeSince };
});
