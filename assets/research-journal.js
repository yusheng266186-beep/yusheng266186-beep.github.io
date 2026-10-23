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
  function snapshot(input, now = Date.now(), id = String(now)) {
    if (!input || !positive(input.price) || !date(input.quoteAsOf) || !positive(input.days) || !text(input.horizon, 20) ||
        ![input.low, input.center, input.high].every(positive) || input.low > input.center || input.center > input.high) {
      throw Error("有效报价、报价时点或情景输入不足，暂时无法记录。");
    }
    return { id: text(id, 80), createdAt: new Date(now).toISOString(), price: input.price,
      quoteAsOf: input.quoteAsOf, source: text(input.source, 200), dataTier: text(input.dataTier, 40),
      horizon: text(input.horizon, 20), days: input.days, low: input.low, center: input.center, high: input.high,
      note: text(input.note, 280), factors: (input.factors || []).slice(0, 12).map(f => {
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
      if (!date(item.createdAt) || !item.id || ids.has(item.id)) throw Error("手记记录无效，原记录未覆盖。");
      ids.add(item.id);
      return snapshot(item, Date.parse(item.createdAt), item.id);
    });
  }
  function read(storage) { return parse(storage.getItem(key)); }
  function append(storage, item) {
    const items = read(storage);
    if (items.length >= limit) throw Error("已保存 50 条手记，请先导出，再移除不需要的记录。");
    if (items.some(saved => saved.id === item.id)) throw Error("这条手记已保存。");
    const validated = snapshot(item, Date.parse(item.createdAt), item.id);
    const next = [validated, ...items];
    storage.setItem(key, JSON.stringify({version: 1, items: next}));
    return next;
  }
  function changeSince(item, quote) {
    if (!positive(quote?.price) || !date(quote?.asOf) || Date.parse(quote.asOf) <= Date.parse(item.quoteAsOf)) return null;
    return (quote.price / item.price - 1) * 100;
  }
  function remove(storage, id) {
    const items = read(storage), next = items.filter(item => item.id !== id);
    storage.setItem(key, JSON.stringify({version:1, items:next}));
    return items.find(item => item.id === id) || null;
  }
  return { key, limit, snapshot, parse, read, append, remove, changeSince };
});
