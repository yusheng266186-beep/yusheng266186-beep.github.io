/* AURUM domain model. No DOM, network, storage, or fabricated market data. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AurumCore = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const numeric = (v, fallback = NaN) => {
    if ((typeof v !== "number" && typeof v !== "string") || String(v).trim() === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const money = v => Math.round((v + Number.EPSILON) * 100) / 100;
  function timestamp(v) {
    if (typeof v !== "string" || !v.trim()) return null;
    const n = Date.parse(v);
    return Number.isFinite(n) ? new Date(n).toISOString() : null;
  }
  function ageHours(v, now = Date.now()) {
    const t = timestamp(v);
    return t && Date.parse(t) <= now + 300000 ? Math.max(0, (now - Date.parse(t)) / 3600000) : Infinity;
  }
  function quoteState(q, now = Date.now()) {
    const age = ageHours(q && q.asOf, now);
    if (!q || !(q.priceCnyGram > 0)) return { key: "missing", label: "暂无有效报价", age, stale: true };
    if (q.dataTier === "manual") return { key: "manual", label: "手动假设价格", age, stale: true };
    if (age > 36) return { key: "stale", label: "历史快照 · 已过期", age, stale: true };
    if (q.dataTier === "snapshot" || q.dataTier === "fallback") return { key: "snapshot", label: "部署快照", age, stale: false };
    if (q.dataTier === "official-delayed" || age > 1) return { key: "delayed", label: "延时行情", age, stale: false };
    return { key: "live", label: "公开行情", age, stale: false };
  }
  function normalizeQuote(raw, now = Date.now()) {
    raw = raw && typeof raw === "object" ? raw : {};
    const price = numeric(raw.priceCnyGram, 0), previous = numeric(raw.previousCnyGram, price);
    const q = Object.assign({}, raw, {
      priceCnyGram: price > 0 ? price : 0, previousCnyGram: previous > 0 ? previous : price,
      openCnyGram: numeric(raw.openCnyGram) > 0 ? numeric(raw.openCnyGram) : price, highCnyGram: numeric(raw.highCnyGram) > 0 ? numeric(raw.highCnyGram) : price,
      lowCnyGram: numeric(raw.lowCnyGram) > 0 ? numeric(raw.lowCnyGram) : price,
      changeCnyGram: numeric(raw.changeCnyGram, price - previous),
      changePct: numeric(raw.changePct, previous > 0 ? (price / previous - 1) * 100 : 0),
      asOf: timestamp(raw.asOf), fetchedAt: timestamp(raw.fetchedAt),
      source: String(raw.source || "暂无来源"), dataTier: String(raw.dataTier || "snapshot"),
      sourceUrl: String(raw.sourceUrl || "https://www.sge.com.cn/sjzx/yshqbg"),
      volume: numeric(raw.volume, 0), turnover: numeric(raw.turnover, 0),
      contracts: Array.isArray(raw.contracts) ? raw.contracts.filter(c => numeric(c.latest) > 0) : [],
      internationalCnyGram: NaN, domesticPremiumPct: NaN
    });
    const intl = raw.internationalReference || {}, fxTime = raw.fxAsOf || intl.fxAsOf;
    const synchronous = ageHours(q.asOf, now) <= 36 && ageHours(intl.asOf, now) <= 36 &&
      ageHours(fxTime, now) <= 72 && Math.abs(Date.parse(q.asOf) - Date.parse(intl.asOf)) <= 8 * 3600000;
    if (synchronous && numeric(intl.priceUsdOz) > 0 && numeric(raw.usdCny) > 0) {
      q.internationalCnyGram = numeric(intl.priceUsdOz) / 31.1034768 * numeric(raw.usdCny);
      q.domesticPremiumPct = (q.priceCnyGram / q.internationalCnyGram - 1) * 100;
    }
    q.premiumNote = synchronous ? "同一时间窗口的期货折算参考" : "国际报价或汇率时间不匹配，暂不比较";
    return q;
  }
  function normalizePoints(points) {
    const map = new Map();
    for (const p of Array.isArray(points) ? points : []) {
      const time = String(p.time || "");
      if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(time)) continue;
      const day = time.slice(0, 10), date = new Date(day + "T00:00:00Z");
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) continue;
      const row = Object.assign({}, p, { time });
      for (const key of ["open", "high", "low", "close"]) row[key] = numeric(p[key]);
      if (![row.open, row.high, row.low, row.close].every(v => Number.isFinite(v) && v > 0)) continue;
      if (row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close) || row.high < row.low) continue;
      row.volume = numeric(p.volume, 0); row.turnover = numeric(p.turnover, 0); row.changePct = numeric(p.changePct, 0);
      map.set(time, row);
    }
    return [...map.values()].sort((a, b) => a.time.localeCompare(b.time));
  }
  function chinaDate(v) {
    const t = timestamp(v);
    return t ? new Date(Date.parse(t) + 8 * 3600000).toISOString().slice(0, 10) : "";
  }
  function chartHistory(daily, quote) {
    const points = daily.map(p => Object.assign({}, p));
    const day = chinaDate(quote.asOf), last = points[points.length - 1];
    if (!last || !day || day < last.time.slice(0, 10) || !(quote.priceCnyGram > 0)) return points;
    const live = { time: day + " LIVE", open: quote.openCnyGram, close: quote.priceCnyGram,
      high: quote.highCnyGram, low: quote.lowCnyGram, volume: quote.volume, changePct: quote.changePct, live: true };
    if (day === last.time.slice(0, 10)) points[points.length - 1] = live;
    else points.push(live);
    return points;
  }
  function momentum(points, days) {
    if (points.length <= days) return NaN;
    return points[points.length - 1].close / points[points.length - 1 - days].close - 1;
  }
  function volatility(points) {
    const rows = points.slice(-91), returns = [];
    for (let i = 1; i < rows.length; i++) returns.push(Math.log(rows[i].close / rows[i - 1].close));
    if (returns.length < 10) return NaN;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    return Math.sqrt(returns.reduce((s, x) => s + (x - mean) ** 2, 0) / (returns.length - 1));
  }
  function scenarioAt(price, days, vol, drift) {
    const years = Math.max(0, days) / 365, center = price * Math.exp(drift * years);
    const width = vol * Math.sqrt(252 * years) * 1.25;
    return { center, low: center * Math.exp(-width), high: center * Math.exp(width) };
  }
  function scenarioModel(price, daily, score) {
    const vol = volatility(daily), trend = momentum(daily, Math.min(60, daily.length - 1));
    const ready = price > 0 && daily.length >= 30 && Number.isFinite(vol) && Number.isFinite(trend);
    const drift = clamp(numeric(score, 0) / 100 * .12 + numeric(trend, 0) * .25, -.2, .2);
    const horizons = [["1 周", 7], ["1 个月", 30], ["6 个月", 180], ["1 年", 365], ["3 年", 1095]];
    return { ready, vol, drift, points: ready ? horizons.map(([label, days]) => {
      const p = scenarioAt(price, days, vol, drift);
      return Object.assign(p, { label, days, stance: p.center > price * 1.025 ? "偏强假设" : p.center < price * .975 ? "偏弱假设" : "平稳假设" });
    }) : [] };
  }
  function emptyPortfolio() { return { cash: 100000, grams: 0, avgCost: 0, realized: 0, totalFees: 0, initialCash: 100000, trades: [] }; }
  function validatePortfolio(raw) {
    if (!raw || typeof raw !== "object") throw new Error("账户文件格式无效");
    const out = {};
    for (const k of ["cash", "grams", "avgCost", "realized", "totalFees", "initialCash"]) {
      out[k] = numeric(raw[k]);
      if (!Number.isFinite(out[k]) || (k !== "realized" && out[k] < 0)) throw new Error("账户金额或持仓无效");
    }
    if (out.grams > 0 && out.avgCost <= 0) throw new Error("持仓成本无效");
    if (!Array.isArray(raw.trades) || raw.trades.length > 50000) throw new Error("成交记录格式无效");
    out.trades = raw.trades.map(t => {
      if (!t || !["buy", "sell"].includes(t.side) || !(numeric(t.grams) > 0) || !(numeric(t.price) > 0) ||
          !(numeric(t.value) > 0) || !(numeric(t.fee) >= 0) || !timestamp(t.createdAt)) throw new Error("成交明细无效");
      return Object.assign({}, t, { note: String(t.note || "").slice(0, 1000) });
    });
    return out;
  }
  function portfolioStats(p, price) {
    const marketValue = p.grams * price, investedCost = p.grams * p.avgCost;
    const equity = p.cash + marketValue, unrealized = marketValue - investedCost;
    return { marketValue, investedCost, equity, unrealized, pnlPct: investedCost ? unrealized / investedCost * 100 : 0,
      totalReturn: equity - p.initialCash, allocation: equity > 0 ? marketValue / equity * 100 : 0 };
  }
  function order(p, q, config, input, now = Date.now()) {
    const side = input.side === "sell" ? "sell" : "buy", grams = numeric(input.grams),
      feePct = numeric(input.feePct), spreadPct = numeric(input.spreadPct),
      purity = numeric(config.purity, 1), premium = numeric(config.productPremium, 0),
      maxPosition = numeric(config.maxPosition, 15);
    const price = q.priceCnyGram * purity * (1 + premium / 100) * (1 + (side === "buy" ? 1 : -1) * spreadPct / 200);
    const value = money(grams * price), fee = money(value * feePct / 100),
      total = money(side === "buy" ? value + fee : value - fee), stats = portfolioStats(p, q.priceCnyGram);
    const mode = quoteState(q, now), historical = mode.stale || q.dataTier === "manual";
    const checks = [
      { ok: Number.isFinite(grams) && grams > 0 && Math.abs(grams * 100 - Math.round(grams * 100)) < 1e-6, label: "交易克数", value: "至少 0.01g，精确到 0.01g" },
      { ok: feePct >= 0 && feePct <= 5 && spreadPct >= 0 && spreadPct <= 10 && price > 0 && purity > 0 && purity <= 1 && premium >= -50 && premium <= 200 && maxPosition >= 1 && maxPosition <= 100, label: "价格与费用", value: "手续费 0—5%，价差 0—10%" },
      { ok: q.priceCnyGram > 0 && (!historical || input.historical === true), label: "行情时效", value: historical ? "需开启历史价格练习" : mode.label },
      { ok: side === "sell" || total <= money(stats.equity * maxPosition / 100), label: "单笔上限", value: money(stats.equity * maxPosition / 100).toFixed(2) + " 元" },
      { ok: side === "buy" ? total <= p.cash : grams <= p.grams, label: side === "buy" ? "可用现金" : "可卖持仓", value: side === "buy" ? p.cash.toFixed(2) + " 元" : p.grams.toFixed(2) + "g" }
    ];
    const projectedGrams = side === "buy" ? p.grams + grams : p.grams - grams,
      projectedCash = p.cash + (side === "buy" ? -total : total), projectedEquity = projectedCash + projectedGrams * q.priceCnyGram;
    return { side, grams, price, value, fee, total, historical, checks, valid: checks.every(c => c.ok),
      projectedAllocation: projectedEquity > 0 ? projectedGrams * q.priceCnyGram / projectedEquity * 100 : 0 };
  }
  function execute(p, q, config, input, now = Date.now()) {
    const o = order(p, q, config, input, now), failure = o.checks.find(c => !c.ok);
    if (failure) throw new Error(failure.label + "：" + failure.value);
    const next = Object.assign({}, p, { trades: p.trades.slice() });
    if (o.side === "buy") {
      next.avgCost = (p.grams * p.avgCost + o.total) / (p.grams + o.grams);
      next.cash = money(p.cash - o.total); next.grams = money(p.grams + o.grams);
    } else {
      next.cash = money(p.cash + o.total); next.grams = money(p.grams - o.grams);
      next.realized = money(p.realized + o.value - o.fee - p.avgCost * o.grams);
      if (next.grams === 0) next.avgCost = 0;
    }
    next.totalFees = money(p.totalFees + o.fee);
    next.trades.unshift({ id: String(now) + "-" + p.trades.length, side: o.side, grams: o.grams, price: o.price,
      value: o.value, fee: o.fee, note: String(input.note || "").slice(0, 1000), createdAt: new Date(now).toISOString(),
      quoteAsOf: q.asOf, dataMode: o.historical ? "historical-practice" : q.dataTier });
    return next;
  }
  function csvCell(value) {
    let s = String(value == null ? "" : value);
    if (typeof value === "string" && /^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return { numeric, money, timestamp, ageHours, quoteState, normalizeQuote, normalizePoints, chinaDate, chartHistory,
    momentum, volatility, scenarioAt, scenarioModel, emptyPortfolio, validatePortfolio, portfolioStats, order, execute, csvCell };
});
