(function () {
  "use strict";

  var DATA = window.__AURUM_DATA__ || {};
  var CONFIG_KEY = "aurum-os-config-v5";
  var PORTFOLIO_KEY = "aurum-os-portfolio-v3";
  var DEFAULT_CONFIG = {
    priceProvider: "domestic",
    manualPrice: 0,
    refreshSeconds: 15,
    purity: 1,
    productPremium: 0,
    maxPosition: 15,
    stopLoss: 4,
    takeProfit: 8,
    alertLower: 0,
    alertUpper: 0,
    aiEndpoint: "https://api.openai.com/v1/chat/completions",
    aiModel: "gpt-5",
    aiProvider: "OpenAI compatible",
    aiApiKey: "",
    saveApiKey: false
  };
  var DEFAULT_FACTORS = [
    { id: "cnDemand", name: "国内实物需求", value: 24, weight: 1.25, note: "节庆、金饰、金条与 ETF 需求" },
    { id: "cny", name: "人民币强弱", value: 8, weight: 1.15, note: "人民币走弱通常抬高国内克价" },
    { id: "sgeMomentum", name: "沪金趋势动量", value: 0, weight: 1.35, note: "真实日线与均线结构动态计算" },
    { id: "premium", name: "内外盘溢价", value: 0, weight: 1.05, note: "国内相对国际折算价的偏离" },
    { id: "centralBanks", name: "央行购金", value: 34, weight: 0.95, note: "中长期结构性需求" },
    { id: "realRates", name: "海外实际利率", value: -12, weight: 0.85, note: "实际利率上行通常压制金价" },
    { id: "usd", name: "美元方向", value: -8, weight: 0.72, note: "国际金价的外部定价条件" },
    { id: "risk", name: "避险情绪", value: 22, weight: 0.92, note: "地缘、金融与流动性风险" },
    { id: "positioning", name: "市场拥挤度", value: -4, weight: 0.68, note: "过度拥挤会放大回撤" }
  ];
  var SOURCES = [
    {
      name: "上海黄金交易所",
      tier: "官方",
      description: "Au99.99 合约规则、延时行情与每日历史行情",
      url: "https://www.sge.com.cn/sjzx/yshqbg"
    },
    {
      name: "东方财富 AU9999",
      tier: "公开行情",
      description: "浏览器直连报价与日线历史备用链路",
      url: "https://quote.eastmoney.com/q/118.AU9999.html"
    },
    {
      name: "新浪 SGE_AU9999",
      tier: "公开行情",
      description: "国内行情备用源，用于主链路异常时自动切换",
      url: "https://finance.sina.com.cn/futures/quotes/SGE_AU9999.shtml"
    },
    {
      name: "中国人民银行",
      tier: "官方",
      description: "货币政策、外汇储备与宏观流动性观察",
      url: "https://www.pbc.gov.cn/"
    }
  ];

  var state = {
    config: loadConfig(),
    portfolio: loadPortfolio(),
    quote: normalizeQuote(DATA.market || fallbackQuote()),
    history: normalizeHistory(DATA.history),
    news: normalizeNews(DATA.news),
    factors: DEFAULT_FACTORS.map(function (item) { return Object.assign({}, item); }),
    forecasts: [],
    sourceHealth: [],
    refreshing: false,
    pollRemaining: 15,
    pollTimer: null,
    lastPollAt: null,
    lastPriceChangedAt: null,
    lastSeenPrice: null,
    chartRange: 260,
    chartIndicators: { ma20: true, ma60: true, forecast: true },
    chartHover: null,
    chartPoints: [],
    tradeSide: "buy",
    newsFilter: "all",
    promptType: "daily",
    aiReportMode: "local",
    resizeTimer: null
  };

  function $(id) {
    return document.getElementById(id);
  }

  function fallbackQuote() {
    return {
      market: "CN-SGE",
      unit: "CNY/g",
      primaryContract: "AU9999",
      priceCnyGram: 895,
      previousCnyGram: 881.98,
      openCnyGram: 885,
      highCnyGram: 895,
      lowCnyGram: 884,
      changeCnyGram: 13.02,
      changePct: 1.48,
      volume: 0,
      turnover: 0,
      asOf: "2026-07-30T14:20:07.000Z",
      source: "内嵌 AU9999 国内行情快照",
      sourceUrl: "https://www.sge.com.cn/sjzx/yshqbg",
      dataTier: "snapshot",
      contracts: []
    };
  }

  function loadConfig() {
    try {
      var saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
      var config = Object.assign({}, DEFAULT_CONFIG, saved);
      if (!config.saveApiKey) config.aiApiKey = "";
      if (!["domestic", "manual", "snapshot"].includes(config.priceProvider)) {
        config.priceProvider = "domestic";
      }
      return config;
    } catch {
      return Object.assign({}, DEFAULT_CONFIG);
    }
  }

  function saveConfig() {
    var value = Object.assign({}, state.config);
    if (!value.saveApiKey) value.aiApiKey = "";
    localStorage.setItem(CONFIG_KEY, JSON.stringify(value));
  }

  function loadPortfolio() {
    var fallback = {
      cash: 100000,
      grams: 0,
      avgCost: 0,
      realized: 0,
      totalFees: 0,
      initialCash: 100000,
      trades: []
    };
    try {
      var saved = JSON.parse(localStorage.getItem(PORTFOLIO_KEY) || "{}");
      return Object.assign(fallback, saved, {
        trades: Array.isArray(saved.trades) ? saved.trades : []
      });
    } catch {
      return fallback;
    }
  }

  function savePortfolio() {
    localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(state.portfolio));
  }

  function normalizeQuote(raw) {
    var base = Object.assign({}, fallbackQuote(), raw || {});
    var price = number(base.priceCnyGram, number(base.latest, 0));
    var previous = number(base.previousCnyGram, number(base.previousClose, price));
    var change = number(base.changeCnyGram, price - previous);
    var pct = number(base.changePct, previous ? change / previous * 100 : 0);
    var international = base.internationalReference || {};
    var internationalCny = number(international.priceCnyGram, NaN);
    return Object.assign({}, base, {
      priceCnyGram: price,
      previousCnyGram: previous,
      openCnyGram: number(base.openCnyGram, number(base.open, price)),
      highCnyGram: number(base.highCnyGram, number(base.high, price)),
      lowCnyGram: number(base.lowCnyGram, number(base.low, price)),
      changeCnyGram: change,
      changePct: pct,
      volume: number(base.volume, 0),
      turnover: number(base.turnover, 0),
      asOf: validDate(base.asOf),
      fetchedAt: validDate(base.fetchedAt || new Date().toISOString()),
      source: String(base.source || "国内行情快照"),
      sourceUrl: String(base.sourceUrl || "https://www.sge.com.cn/sjzx/yshqbg"),
      dataTier: String(base.dataTier || "snapshot"),
      contracts: Array.isArray(base.contracts) ? base.contracts : [],
      internationalCnyGram: internationalCny,
      domesticPremiumPct: Number.isFinite(internationalCny) && internationalCny > 0
        ? (price / internationalCny - 1) * 100
        : NaN
    });
  }

  function normalizeHistory(raw) {
    var history = raw && typeof raw === "object" ? raw : {};
    return {
      source: history.source || "尚未加载历史数据",
      sourceUrl: history.sourceUrl || "https://www.sge.com.cn/sjzx/quotation_daily_new",
      generatedAt: validDate(history.generatedAt || new Date(0).toISOString()),
      daily: normalizePoints(history.daily),
      intraday: normalizePoints(history.intraday)
    };
  }

  function normalizePoints(points) {
    if (!Array.isArray(points)) return [];
    return points.map(function (point) {
      return {
        time: String(point.time || ""),
        open: number(point.open, NaN),
        close: number(point.close, NaN),
        high: number(point.high, NaN),
        low: number(point.low, NaN),
        volume: number(point.volume, 0),
        turnover: number(point.turnover, 0),
        changePct: number(point.changePct, 0)
      };
    }).filter(function (point) {
      return point.time && [point.open, point.close, point.high, point.low].every(Number.isFinite);
    });
  }

  function effectiveDaily() {
    var points = state.history.daily.slice();
    if (!points.length || !state.quote || state.quote.priceCnyGram <= 0) return points;
    var quoteDate = chinaDateKey(state.quote.asOf);
    var last = points[points.length - 1];
    var lastDate = String(last.time || "").slice(0, 10);
    if (quoteDate && quoteDate >= lastDate) {
      points.push({
        time: quoteDate + " LIVE",
        open: state.quote.openCnyGram,
        close: state.quote.priceCnyGram,
        high: state.quote.highCnyGram,
        low: state.quote.lowCnyGram,
        volume: state.quote.volume,
        turnover: state.quote.turnover,
        changePct: state.quote.changePct,
        live: true
      });
    }
    return points;
  }

  function normalizeNews(raw) {
    var items = raw && Array.isArray(raw.items) ? raw.items : [];
    return {
      generatedAt: validDate(raw && raw.generatedAt || new Date(0).toISOString()),
      items: items.map(function (item, index) {
        return {
          id: String(item.id || "news-" + index),
          source: String(item.source || "官方消息"),
          title: String(item.title || "未命名消息"),
          summary: String(item.summary || ""),
          url: safeUrl(item.url),
          publishedAt: validDate(item.publishedAt),
          impact: ["bullish", "bearish", "mixed", "neutral"].includes(item.impact) ? item.impact : "neutral",
          weight: clamp(number(item.weight, 42), 0, 100),
          category: inferNewsCategory(item)
        };
      })
    };
  }

  function inferNewsCategory(item) {
    var haystack = (String(item.source || "") + " " + String(item.title || "")).toLowerCase();
    if (/上海黄金|上金所|sge|中国|人民银行|外汇|人民币|国内/.test(haystack)) return "domestic";
    return "macro";
  }

  async function loadStaticData() {
    if (location.protocol === "file:") return;
    var stamp = Date.now();
    var settled = await Promise.allSettled([
      fetchJson("data/market-snapshot.json?_=" + stamp),
      fetchJson("data/market-history.json?_=" + stamp),
      fetchJson("data/news.json?_=" + stamp)
    ]);
    if (settled[0].status === "fulfilled") state.quote = normalizeQuote(settled[0].value);
    if (settled[1].status === "fulfilled") state.history = normalizeHistory(settled[1].value);
    if (settled[2].status === "fulfilled") state.news = normalizeNews(settled[2].value);
  }

  async function fetchJson(url) {
    var response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }

  async function refreshQuote(options) {
    options = options || {};
    if (state.refreshing) return;
    state.refreshing = true;
    state.pollRemaining = Math.max(10, number(state.config.refreshSeconds, 15));
    $("refreshBtn").classList.add("loading");
    state.sourceHealth = [];

    var previousPrice = state.quote.priceCnyGram;
    var nextQuote;
    try {
      if (state.config.priceProvider === "manual") {
        nextQuote = manualQuote();
        state.sourceHealth.push({ name: "手动校准", ok: true });
      } else if (state.config.priceProvider === "snapshot") {
        nextQuote = normalizeQuote(DATA.market || state.quote);
        nextQuote.fetchedAt = new Date().toISOString();
        state.sourceHealth.push({ name: "本地快照", ok: true });
      } else {
        nextQuote = await fetchDomesticQuote();
      }
      state.quote = normalizeQuote(nextQuote);
      state.lastPollAt = new Date();
      if (state.lastSeenPrice === null || Math.abs(state.quote.priceCnyGram - state.lastSeenPrice) > 0.0001) {
        state.lastPriceChangedAt = new Date(state.quote.asOf);
      }
      state.lastSeenPrice = state.quote.priceCnyGram;
      syncDynamicFactors();
      buildForecasts();
      renderAll({ animatePrice: true, previousPrice: previousPrice });
      if (options.manual) {
        showToast("行情刷新完成", quoteEventText(previousPrice, state.quote.priceCnyGram));
      }
    } catch (error) {
      state.sourceHealth.push({ name: "行情链路", ok: false, error: error.message });
      state.lastPollAt = new Date();
      renderStatus();
      showToast("行情刷新失败", error.message || "已保留上一笔有效行情", "error");
    } finally {
      state.refreshing = false;
      $("refreshBtn").classList.remove("loading");
    }
  }

  async function fetchDomesticQuote() {
    var attempts = [
      ["东方财富 AU9999", fetchEastmoneyLiveQuote],
      ["新浪 SGE_AU9999", fetchSinaLiveQuote],
      ["部署快照", fetchLatestSnapshot]
    ];
    var errors = [];
    for (var index = 0; index < attempts.length; index += 1) {
      try {
        var result = await attempts[index][1]();
        if (index < 2) result = validateBrowserQuote(result);
        state.sourceHealth.push({ name: attempts[index][0], ok: true });
        return result;
      } catch (error) {
        errors.push(attempts[index][0] + ": " + error.message);
        state.sourceHealth.push({ name: attempts[index][0], ok: false, error: error.message });
      }
    }
    var embedded = DATA.market || state.quote;
    if (embedded && number(embedded.priceCnyGram, 0) > 0) {
      var fallback = normalizeQuote(embedded);
      fallback.dataTier = "snapshot";
      fallback.fetchedAt = new Date().toISOString();
      fallback.delay = errors.join("；");
      state.sourceHealth.push({ name: "内嵌快照", ok: true });
      return fallback;
    }
    throw new Error(errors.join("；") || "没有可用国内行情");
  }

  function validateBrowserQuote(quote) {
    var baseline = normalizeQuote(DATA.market || {});
    if (!baseline.priceCnyGram || quoteAgeHours(baseline.asOf) > 36) return quote;
    var official = baseline.validation && number(baseline.validation.officialPriceCnyGram, NaN);
    var reference = Number.isFinite(official) ? official : baseline.priceCnyGram;
    var differencePct = reference ? (quote.priceCnyGram / reference - 1) * 100 : 0;
    if (Math.abs(differencePct) > 2.5) {
      throw new Error("与官方校验快照偏差 " + differencePct.toFixed(2) + "%");
    }
    quote.validation = {
      source: "上金所官方校验快照",
      officialPriceCnyGram: reference,
      differencePct: differencePct,
      checkedAt: baseline.validation && baseline.validation.checkedAt || baseline.fetchedAt
    };
    return quote;
  }

  async function fetchEastmoneyLiveQuote() {
    var settled = await Promise.allSettled([
      fetchEastmoneyContract("AU9999", "黄金9999"),
      fetchEastmoneyContract("AUTD", "黄金T+D")
    ]);
    var contracts = settled.filter(function (item) {
      return item.status === "fulfilled";
    }).map(function (item) {
      return item.value;
    });
    var main = contracts.find(function (item) {
      return normalizeSymbol(item.symbol) === "AU9999";
    });
    if (!main || !Number.isFinite(main.latest) || main.latest <= 0) {
      throw new Error("未返回有效 AU9999");
    }
    return quoteFromContract(main, contracts, {
      source: "东方财富 AU9999 国内公开行情",
      sourceUrl: "https://quote.eastmoney.com/q/118.AU9999.html",
      delay: "浏览器直连国内公开行情；非交易终端逐笔数据"
    });
  }

  async function fetchEastmoneyContract(symbol, fallbackName) {
    var fields = "f43,f44,f45,f46,f47,f48,f49,f50,f57,f58,f60,f86,f169,f170,f152";
    var url = "https://push2.eastmoney.com/api/qt/stock/get?secid=118." +
      encodeURIComponent(symbol) + "&fields=" + fields + "&_=" + Date.now();
    var payload = await loadJsonp(url, "cb", 6500);
    var data = payload && payload.data;
    if (!data) throw new Error(symbol + " 返回空数据");
    var scale = Math.pow(10, number(data.f152, 2));
    var latest = scaledValue(data.f43, scale);
    if (!Number.isFinite(latest) || latest <= 0) throw new Error(symbol + " 价格无效");
    return {
      symbol: String(data.f57 || symbol),
      name: String(data.f58 || fallbackName),
      exchangeName: symbol === "AU9999" ? "Au99.99" : "Au(T+D)",
      latest: latest,
      high: scaledValue(data.f44, scale),
      low: scaledValue(data.f45, scale),
      open: scaledValue(data.f46, scale),
      previousClose: scaledValue(data.f60, scale),
      change: scaledValue(data.f169, scale),
      changePct: scaledValue(data.f170, scale),
      volume: number(data.f47, 0),
      turnover: number(data.f48, 0),
      amplitudePct: scaledValue(data.f50, scale),
      asOf: eastmoneyTime(data.f86)
    };
  }

  async function fetchSinaLiveQuote() {
    var names = ["SGE_AU9999", "SGE_AUTD"];
    names.forEach(function (name) { delete window["hq_str_" + name]; });
    await loadScript(
      "https://hq.sinajs.cn/rn=" + Date.now() + "&list=" + names.join(","),
      6500,
      "GB18030"
    );
    var contracts = names.map(function (name) {
      var raw = window["hq_str_" + name];
      delete window["hq_str_" + name];
      return parseSinaContract(raw, name);
    }).filter(Boolean);
    var main = contracts.find(function (item) { return item.symbol === "AU9999"; });
    if (!main) throw new Error("SGE_AU9999 行情为空");
    return quoteFromContract(main, contracts, {
      source: "新浪 SGE_AU9999 国内公开行情",
      sourceUrl: "https://finance.sina.com.cn/futures/quotes/SGE_AU9999.shtml",
      delay: "国内公开行情备用源；非交易终端逐笔数据"
    });
  }

  function parseSinaContract(raw, requestSymbol) {
    if (!raw) return null;
    var parts = String(raw).split(",");
    var latest = number(parts[3], NaN);
    if (!Number.isFinite(latest) || latest <= 0) return null;
    var previous = number(parts[5], number(parts[6], latest));
    var pct = number(String(parts[17] || "").replace("%", ""), (latest - previous) / previous * 100);
    var symbol = requestSymbol === "SGE_AU9999" ? "AU9999" : "AUTD";
    return {
      symbol: symbol,
      name: symbol === "AU9999" ? "黄金9999" : "黄金T+D",
      exchangeName: parts[2] || symbol,
      latest: latest,
      high: number(parts[7], latest),
      low: number(parts[8], latest),
      open: number(parts[6], latest),
      previousClose: previous,
      change: latest - previous,
      changePct: pct,
      volume: number(parts[14], 0),
      turnover: number(parts[15], 0),
      amplitudePct: latest ? (number(parts[7], latest) - number(parts[8], latest)) / latest * 100 : 0,
      asOf: sinaTime(parts[16])
    };
  }

  function quoteFromContract(main, contracts, meta) {
    return {
      market: "CN-SGE",
      marketRegion: "CN",
      unit: "CNY/g",
      primaryContract: "AU9999",
      priceCnyGram: main.latest,
      previousCnyGram: main.previousClose || main.open || main.latest,
      openCnyGram: main.open,
      highCnyGram: main.high,
      lowCnyGram: main.low,
      changeCnyGram: Number.isFinite(main.change) ? main.change : main.latest - main.previousClose,
      changePct: main.changePct,
      volume: main.volume,
      turnover: main.turnover,
      asOf: main.asOf,
      fetchedAt: new Date().toISOString(),
      source: meta.source,
      sourceUrl: meta.sourceUrl,
      officialSource: "上海黄金交易所",
      officialUrl: "https://www.sge.com.cn/sjzx/yshqbg",
      delay: meta.delay,
      dataTier: "domestic-live",
      contracts: contracts,
      internationalReference: state.quote.internationalReference || DATA.market && DATA.market.internationalReference
    };
  }

  async function fetchLatestSnapshot() {
    if (location.protocol === "file:") throw new Error("本地文件模式使用内嵌快照");
    var raw = await fetchJson("data/market-snapshot.json?_=" + Date.now());
    var quote = normalizeQuote(raw);
    quote.fetchedAt = new Date().toISOString();
    return quote;
  }

  function manualQuote() {
    var price = number(state.config.manualPrice, 0);
    if (price <= 0) throw new Error("请先在设置中填写有效手动克价");
    return normalizeQuote({
      market: "CN-MANUAL",
      primaryContract: "MANUAL",
      priceCnyGram: price,
      previousCnyGram: state.quote.priceCnyGram || price,
      openCnyGram: price,
      highCnyGram: price,
      lowCnyGram: price,
      changeCnyGram: price - (state.quote.priceCnyGram || price),
      changePct: state.quote.priceCnyGram ? (price / state.quote.priceCnyGram - 1) * 100 : 0,
      asOf: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      source: "用户手动校准克价",
      sourceUrl: "https://www.sge.com.cn/sjzx/yshqbg",
      dataTier: "manual",
      contracts: []
    });
  }

  function loadJsonp(url, callbackParam, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var callbackName = "__aurum_cb_" + Date.now() + "_" + Math.random().toString(36).slice(2);
      var script = document.createElement("script");
      var done = false;
      var timer = setTimeout(function () {
        cleanup();
        reject(new Error("请求超时"));
      }, timeoutMs);
      var separator = url.includes("?") ? "&" : "?";
      window[callbackName] = function (payload) {
        cleanup();
        resolve(payload);
      };
      function cleanup() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      script.onerror = function () {
        cleanup();
        reject(new Error("脚本加载失败"));
      };
      script.src = url + separator + encodeURIComponent(callbackParam) + "=" + encodeURIComponent(callbackName);
      document.head.appendChild(script);
    });
  }

  function loadScript(url, timeoutMs, charset) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      var finished = false;
      var timer = setTimeout(function () {
        cleanup();
        reject(new Error("请求超时"));
      }, timeoutMs);
      function cleanup() {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      script.charset = charset || "UTF-8";
      script.onload = function () {
        cleanup();
        resolve();
      };
      script.onerror = function () {
        cleanup();
        reject(new Error("脚本加载失败"));
      };
      script.src = url;
      document.head.appendChild(script);
    });
  }

  function scaledValue(value, scale) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= -1000000000) return NaN;
    return parsed / scale;
  }

  function eastmoneyTime(value) {
    var seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return new Date().toISOString();
    return new Date(seconds * 1000).toISOString();
  }

  function sinaTime(value) {
    var match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) return new Date().toISOString();
    return new Date(
      match[1] + "-" + match[2] + "-" + match[3] + "T" +
      match[4] + ":" + match[5] + ":" + match[6] + "+08:00"
    ).toISOString();
  }

  function normalizeSymbol(symbol) {
    return String(symbol || "").replace(/[().+\-\s]/g, "").toUpperCase();
  }

  function syncDynamicFactors() {
    var history = effectiveDaily();
    if (history.length >= 21) {
      var last = history[history.length - 1].close;
      var prior = history[Math.max(0, history.length - 21)].close;
      var momentum = prior ? (last / prior - 1) * 100 : 0;
      setFactor("sgeMomentum", clamp(momentum * 5.2, -85, 85));
    }
    if (Number.isFinite(state.quote.domesticPremiumPct)) {
      setFactor("premium", clamp(-state.quote.domesticPremiumPct * 7, -80, 80));
    }
  }

  function setFactor(id, value) {
    var factor = state.factors.find(function (item) { return item.id === id; });
    if (factor) factor.value = Math.round(value);
  }

  function factorScore() {
    var weighted = state.factors.reduce(function (sum, item) {
      return sum + item.value * item.weight;
    }, 0);
    var totalWeight = state.factors.reduce(function (sum, item) { return sum + item.weight; }, 0);
    return clamp(weighted / totalWeight, -100, 100);
  }

  function buildForecasts() {
    var price = state.quote.priceCnyGram;
    var score = factorScore();
    var vol = Math.max(0.006, dailyVolatility());
    var horizons = [
      { label: "1 周", days: 7 },
      { label: "1 个月", days: 30 },
      { label: "6 个月", days: 180 },
      { label: "1 年", days: 365 },
      { label: "3 年", days: 1095 }
    ];
    var annualDrift = clamp(score / 100 * 0.18 + historyMomentum(60) * 0.32, -0.2, 0.24);
    state.forecasts = horizons.map(function (horizon, index) {
      var years = horizon.days / 365;
      var center = price * Math.exp(annualDrift * years);
      var uncertainty = clamp(vol * Math.sqrt(Math.min(horizon.days, 500)) * (1.45 + index * 0.09), 0.025, 0.42);
      var confidence = clamp(
        80 - index * 4 - uncertainty * 28 - (quoteAgeHours(state.quote.asOf) > 12 ? 8 : 0),
        46,
        82
      );
      return {
        label: horizon.label,
        days: horizon.days,
        center: center,
        low: center * (1 - uncertainty),
        high: center * (1 + uncertainty),
        confidence: confidence,
        stance: center > price * 1.025 ? "偏强" : center < price * 0.975 ? "偏弱" : "震荡"
      };
    });
  }

  function dailyVolatility() {
    var points = effectiveDaily().slice(-90);
    if (points.length < 10) return 0.012;
    var returns = [];
    for (var index = 1; index < points.length; index += 1) {
      if (points[index - 1].close > 0) {
        returns.push(Math.log(points[index].close / points[index - 1].close));
      }
    }
    var mean = average(returns);
    var variance = average(returns.map(function (value) { return Math.pow(value - mean, 2); }));
    return Math.sqrt(variance);
  }

  function annualVolatility() {
    return dailyVolatility() * Math.sqrt(252) * 100;
  }

  function historyMomentum(days) {
    var points = effectiveDaily();
    if (points.length < 2) return 0;
    var end = points[points.length - 1].close;
    var start = points[Math.max(0, points.length - 1 - days)].close;
    return start > 0 ? end / start - 1 : 0;
  }

  function computeRsi(days) {
    var points = effectiveDaily().slice(-(days + 1));
    if (points.length < 2) return 50;
    var gains = 0;
    var losses = 0;
    for (var index = 1; index < points.length; index += 1) {
      var change = points[index].close - points[index - 1].close;
      if (change >= 0) gains += change;
      else losses -= change;
    }
    if (losses === 0) return 100;
    var relativeStrength = (gains / days) / (losses / days);
    return 100 - 100 / (1 + relativeStrength);
  }

  function portfolioStats() {
    var portfolio = state.portfolio;
    var marketValue = portfolio.grams * state.quote.priceCnyGram;
    var unrealized = portfolio.grams * (state.quote.priceCnyGram - portfolio.avgCost);
    var equity = portfolio.cash + marketValue;
    var investedCost = portfolio.grams * portfolio.avgCost;
    return {
      marketValue: marketValue,
      unrealized: unrealized,
      equity: equity,
      investedCost: investedCost,
      pnlPct: investedCost ? unrealized / investedCost * 100 : 0,
      totalReturn: equity - portfolio.initialCash,
      allocation: equity > 0 ? marketValue / equity * 100 : 0
    };
  }

  function executionPrice(side) {
    var base = state.quote.priceCnyGram;
    var purity = clamp(number(state.config.purity, 1), 0.1, 1);
    var productPremium = number(state.config.productPremium, 0) / 100;
    var spread = Math.max(0, number($("tradeSpread") && $("tradeSpread").value, 0.1)) / 100;
    var adjusted = base * purity * (1 + productPremium);
    return side === "buy" ? adjusted * (1 + spread / 2) : adjusted * (1 - spread / 2);
  }

  function riskScore() {
    var stats = portfolioStats();
    var volatility = clamp((annualVolatility() - 8) * 1.55, 0, 45);
    var concentration = clamp(stats.allocation * 0.45, 0, 35);
    var stale = quoteAgeHours(state.quote.asOf) > 24 ? 18 : quoteAgeHours(state.quote.asOf) > 2 ? 7 : 0;
    var premium = Number.isFinite(state.quote.domesticPremiumPct)
      ? clamp(Math.abs(state.quote.domesticPremiumPct) * 1.4, 0, 18)
      : 4;
    return Math.round(clamp(10 + volatility + concentration + stale + premium, 5, 96));
  }

  function renderAll(options) {
    options = options || {};
    renderStatus();
    renderQuote(options);
    renderTicker();
    renderMarketPulse();
    renderHistoryMetrics();
    renderForecasts();
    renderFactors();
    renderPortfolio();
    renderOrderPreview();
    renderIntelligence();
    renderDecisionContext();
    if (state.aiReportMode !== "external") renderLocalAdvice();
    drawAllCharts();
  }

  function renderStatus() {
    var session = marketSession(new Date());
    $("sessionLabel").textContent = session.label;
    $("sessionDetail").textContent = session.detail;
    $("liveBeacon").className = "live-beacon " + (session.open ? "open" : "closed");
    $("quoteClock").textContent = formatTime(state.quote.asOf);
    $("sideSource").textContent = shortSource(state.quote.source);
    $("sideHealth").textContent = sourceHealthText();

    var age = quoteAgeHours(state.quote.asOf);
    var banner = $("statusBanner");
    var bannerText = $("statusBannerText");
    if (state.refreshing) {
      banner.classList.remove("hidden");
      bannerText.textContent = "正在轮询国内 AU9999 多源行情";
    } else if (age > 24) {
      banner.classList.remove("hidden");
      bannerText.textContent = "行情快照已超过 24 小时，请手动刷新或检查 GitHub Actions 数据任务";
    } else if (state.quote.dataTier === "snapshot" && age > 1) {
      banner.classList.remove("hidden");
      bannerText.textContent = "当前为部署快照或延时行情，页面功能正常，但不应视作逐笔实时成交";
    } else {
      banner.classList.add("hidden");
    }
    $("pollLabel").textContent = state.refreshing
      ? "正在刷新"
      : "下次轮询 " + Math.ceil(state.pollRemaining) + "s";
    var interval = Math.max(10, number(state.config.refreshSeconds, 15));
    $("pollProgress").style.transform = "scaleX(" + clamp(state.pollRemaining / interval, 0, 1) + ")";
  }

  function renderQuote(options) {
    var quote = state.quote;
    var previousDisplayed = number(options.previousPrice, quote.priceCnyGram);
    animatePrice($("mainPrice"), previousDisplayed, quote.priceCnyGram, !!options.animatePrice);
    setText("openPrice", money(quote.openCnyGram));
    setText("highPrice", money(quote.highCnyGram));
    setText("lowPrice", money(quote.lowCnyGram));
    setText("previousPrice", money(quote.previousCnyGram));
    setText("changeValue", signedPrice(quote.changeCnyGram));
    setText("changePercent", signedPercent(quote.changePct));
    setText("sourceName", shortSource(quote.source));
    setText("dataAge", "数据年龄 " + ageText(quote.asOf));
    $("sourceLink").href = safeUrl(quote.sourceUrl);
    $("dataTier").textContent = dataTierLabel(quote);
    $("dataTier").className = "data-tier " + (
      quote.dataTier === "domestic-live" && quoteAgeHours(quote.asOf) < 1 ? "live" :
      quoteAgeHours(quote.asOf) > 12 ? "stale" : ""
    );
    $("changeChip").className = "change-chip " + directionClass(quote.changePct);
    $("sourceDot").style.background = quoteAgeHours(quote.asOf) > 12 ? "var(--amber)" : "var(--green)";
    $("priceEvent").textContent = quoteEventText(options.previousPrice, quote.priceCnyGram);
    $("lastChanged").textContent = state.lastPriceChangedAt
      ? relativeTime(state.lastPriceChangedAt)
      : "行情 " + formatDateTime(quote.asOf);
    $("trustBadge").innerHTML =
      '<svg><use href="#i-shield"></use></svg><span>' +
      escapeHtml(
        quote.validation
          ? "上金所官方已交叉校验"
          : quote.dataTier === "domestic-live"
            ? "国内行情已连接"
            : "已启用可信回退"
      ) +
      "</span>";
  }

  function animatePrice(element, from, to, enabled) {
    cancelAnimationFrame(element.__animationFrame);
    if (!enabled || !Number.isFinite(from) || Math.abs(to - from) < 0.001) {
      element.textContent = toFixedPrice(to);
      return;
    }
    var start = performance.now();
    var duration = 560;
    var className = to > from ? "tick-up" : "tick-down";
    element.classList.add(className);
    function step(now) {
      var progress = clamp((now - start) / duration, 0, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = toFixedPrice(from + (to - from) * eased);
      if (progress < 1) {
        element.__animationFrame = requestAnimationFrame(step);
      } else {
        setTimeout(function () { element.classList.remove(className); }, 260);
      }
    }
    element.__animationFrame = requestAnimationFrame(step);
  }

  function renderTicker() {
    var quote = state.quote;
    var td = findContract("AUTD");
    var items = [
      ["AU9999", toFixedPrice(quote.priceCnyGram), signedPercent(quote.changePct), directionClass(quote.changePct)],
      ["Au(T+D)", td ? toFixedPrice(td.latest) : "--", td ? signedPercent(td.changePct) : "--", td ? directionClass(td.changePct) : ""],
      ["日内最高", toFixedPrice(quote.highCnyGram), "元/克", ""],
      ["日内最低", toFixedPrice(quote.lowCnyGram), "元/克", ""],
      ["人民币口径", "CNY / g", "国内主价", ""],
      ["国际折算", Number.isFinite(quote.internationalCnyGram) ? toFixedPrice(quote.internationalCnyGram) : "--", "仅对照", ""],
      ["国内溢价", Number.isFinite(quote.domesticPremiumPct) ? signedPercent(quote.domesticPremiumPct) : "--", "vs 国际折算", directionClass(quote.domesticPremiumPct)]
    ];
    var html = items.concat(items).map(function (item) {
      return '<span class="ticker-item ' + item[3] + '"><i></i><span>' +
        escapeHtml(item[0]) + '</span><b>' + escapeHtml(item[1]) +
        '</b><strong>' + escapeHtml(item[2]) + "</strong></span>";
    }).join("");
    $("tickerTrack").innerHTML = html;
  }

  function renderMarketPulse() {
    var quote = state.quote;
    var contracts = quote.contracts.length ? quote.contracts.slice(0, 2) : [
      {
        symbol: "AU9999",
        exchangeName: "Au99.99",
        latest: quote.priceCnyGram,
        changePct: quote.changePct
      }
    ];
    $("contractRibbon").innerHTML = contracts.map(function (contract) {
      var pct = number(contract.changePct, 0);
      return '<div class="contract-pill"><span><small>' +
        escapeHtml(contract.exchangeName || contract.name || contract.symbol) +
        '</small><strong>' + toFixedPrice(number(contract.latest, 0)) +
        ' <small>元/g</small></strong></span><b class="' +
        (pct >= 0 ? "up-text" : "down-text") + '">' + signedPercent(pct) + "</b></div>";
    }).join("");
    var amplitude = quote.priceCnyGram
      ? (quote.highCnyGram - quote.lowCnyGram) / quote.previousCnyGram * 100
      : 0;
    setText("amplitudeValue", amplitude.toFixed(2) + "%");
    setText("volumeValue", compactNumber(quote.volume));
    setText("turnoverValue", compactCurrency(quote.turnover));
    setText(
      "premiumValue",
      Number.isFinite(quote.domesticPremiumPct) ? signedPercent(quote.domesticPremiumPct) : "暂无对照"
    );
    setText("pulseLegend", state.history.intraday.length > 5 ? "AU9999 5 分钟线" : "AU9999 日内区间轮廓");
  }

  function renderHistoryMetrics() {
    var effective = effectiveDaily();
    var return20 = historyMomentum(20) * 100;
    var return60 = historyMomentum(60) * 100;
    var rsi = computeRsi(14);
    var ma20 = movingAverage(effective, effective.length - 1, 20);
    var ma60 = movingAverage(effective, effective.length - 1, 60);
    var last = effective.length
      ? effective[effective.length - 1].close
      : state.quote.priceCnyGram;
    setMetricClass("return20", signedPercent(return20), return20);
    setMetricClass("return60", signedPercent(return60), return60);
    setText("annualVol", annualVolatility().toFixed(1) + "%");
    setText("rsiValue", rsi.toFixed(1) + (rsi >= 70 ? " 偏热" : rsi <= 30 ? " 偏冷" : " 中性"));
    var trend = last > ma20 && ma20 > ma60 ? "多头排列" : last < ma20 && ma20 < ma60 ? "空头排列" : "区间整理";
    setText("trendState", trend);
    setText("historyQuality", state.history.daily.length
      ? state.history.source + " · " + state.history.daily.length + " 个官方日线点 + 当前盘中价"
      : "历史快照不可用，未绘制伪造历史");

    var score = Math.round(clamp(return20 * 3.4 + (last > ma20 ? 16 : -12), -100, 100));
    setText("momentumSignal", trend);
    setText("momentumExplain", "20 日 " + signedPercent(return20) + " · RSI " + rsi.toFixed(0));
    setText("momentumScore", signedNumber(score));
    $("momentumScore").className = "signal-score " + (score >= 0 ? "up-text" : "down-text");

    var premium = state.quote.domesticPremiumPct;
    var premiumScore = Number.isFinite(premium) ? Math.round(clamp(-premium * 8, -100, 100)) : 0;
    setText("premiumSignal", Number.isFinite(premium)
      ? (premium >= 0 ? "国内溢价 " : "国内折价 ") + Math.abs(premium).toFixed(2) + "%"
      : "暂无国际折算");
    setText("premiumExplain", Number.isFinite(premium) && Math.abs(premium) > 4 ? "偏离较大，注意回归风险" : "价差仅作对照，不生成国内主价");
    setText("premiumScore", signedNumber(premiumScore));
    $("premiumScore").className = "signal-score " + (premiumScore >= 0 ? "up-text" : "down-text");

    var risk = riskScore();
    setText("riskSignal", risk < 38 ? "风险偏低" : risk < 66 ? "风险中等" : "风险偏高");
    setText("riskExplain", "综合波动、数据年龄、价差与账户仓位");
    setText("riskScore", risk + "/100");
    $("riskScore").className = "signal-score " + (risk < 45 ? "up-text" : risk > 65 ? "down-text" : "");
  }

  function renderForecasts() {
    if (!state.forecasts.length) buildForecasts();
    $("forecastCards").innerHTML = state.forecasts.map(function (forecast, index) {
      return '<article class="forecast-card" style="--confidence:' +
        (forecast.confidence / 100).toFixed(2) + ";animation-delay:" + index * 55 + 'ms">' +
        '<div class="forecast-top"><span>' + escapeHtml(forecast.label) +
        '</span><b>' + escapeHtml(forecast.stance) + '</b></div>' +
        '<strong>' + toFixedPrice(forecast.center) + ' 元/g</strong>' +
        '<p>' + toFixedPrice(forecast.low) + " - " + toFixedPrice(forecast.high) + '</p>' +
        '<small>模型置信 ' + forecast.confidence.toFixed(0) + "% · 概率区间</small>" +
        "</article>";
    }).join("");

    var score = factorScore();
    var probabilities = scenarioProbabilities(score);
    setText("bullProbability", probabilities.bull + "%");
    setText("baseProbability", probabilities.base + "%");
    setText("bearProbability", probabilities.bear + "%");
    setText("factorTotal", signedNumber(Math.round(score)));
    var oneMonth = state.forecasts[1] || state.forecasts[0];
    var stance = score > 20 ? "偏强，等待回撤分批" : score < -20 ? "偏弱，优先控制仓位" : "震荡，执行网格与纪律";
    setText("stanceTitle", stance);
    setText("stanceSummary", forecastSummary(oneMonth, score));
    var confidence = Math.round(average(state.forecasts.slice(0, 3).map(function (item) {
      return item.confidence;
    })));
    $("confidenceRing").querySelector("b").textContent = confidence + "%";
    $("actionList").innerHTML = strategyActions().map(function (action) {
      return "<li>" + escapeHtml(action) + "</li>";
    }).join("");
  }

  function forecastSummary(forecast, score) {
    var direction = score > 15 ? "国内趋势与需求因子占优" : score < -15 ? "外部压力和技术动量偏弱" : "多空因子尚未形成一致方向";
    return direction + "；1 个月基准中枢 " + money(forecast.center) +
      "，概率区间 " + money(forecast.low) + " 至 " + money(forecast.high) + "。";
  }

  function strategyActions() {
    var forecast = state.forecasts[1] || { low: state.quote.priceCnyGram * 0.96, high: state.quote.priceCnyGram * 1.04 };
    var maxOrder = portfolioStats().equity * state.config.maxPosition / 100;
    return [
      "首次试仓不超过总权益的 " + state.config.maxPosition + "%，约 " + cny(maxOrder) + "。",
      "回落至 " + money((forecast.low + state.quote.priceCnyGram) / 2) + " 附近再分批，不追逐单次脉冲。",
      "持仓后以 " + state.config.stopLoss + "% 为止损参考、" + state.config.takeProfit + "% 为止盈参考。",
      "若行情源转为陈旧快照，暂停新增仓位，只保留观察和复盘。"
    ];
  }

  function renderFactors() {
    $("factorGrid").innerHTML = state.factors.map(function (factor) {
      return '<div class="factor-item"><div><label for="factor-' + factor.id + '">' +
        escapeHtml(factor.name) + '</label><output id="out-' + factor.id + '">' +
        signedNumber(factor.value) + '</output></div><input id="factor-' + factor.id +
        '" type="range" min="-100" max="100" step="1" value="' + factor.value +
        '" data-factor="' + factor.id + '"><small>' + escapeHtml(factor.note) + "</small></div>";
    }).join("");
    document.querySelectorAll("[data-factor]").forEach(function (input) {
      input.addEventListener("input", function () {
        var factor = state.factors.find(function (item) { return item.id === input.dataset.factor; });
        if (!factor) return;
        factor.value = number(input.value, 0);
        $("out-" + factor.id).textContent = signedNumber(factor.value);
        buildForecasts();
        renderForecasts();
        renderHistoryMetrics();
        renderDecisionContext();
        renderLocalAdvice();
        drawForecastChart();
        drawPriceChart();
      });
    });
  }

  function renderPortfolio() {
    var portfolio = state.portfolio;
    var stats = portfolioStats();
    setText("equityValue", cny(stats.equity));
    setMetricClass("equityDelta", signedCny(stats.totalReturn) + " 总收益", stats.totalReturn);
    setText("cashValue", cny(portfolio.cash));
    setText("cashRatio", stats.equity ? (portfolio.cash / stats.equity * 100).toFixed(1) + "% 可用" : "--");
    setText("holdingValue", portfolio.grams.toFixed(2) + " g");
    setText("holdingCost", portfolio.grams ? "成本 " + money(portfolio.avgCost) : "当前无持仓");
    setMetricClass("unrealizedValue", signedCny(stats.unrealized), stats.unrealized);
    setMetricClass("unrealizedPct", signedPercent(stats.pnlPct), stats.pnlPct);
    setMetricClass("realizedValue", signedCny(portfolio.realized), portfolio.realized);
    setText("goldAllocation", stats.allocation.toFixed(0) + "%");
    setText("positionUse", stats.allocation.toFixed(1) + "%");
    $("positionBar").style.width = clamp(stats.allocation, 0, 100) + "%";
    var risk = riskScore();
    $("riskGrade").textContent = risk < 38 ? "LOW" : risk < 66 ? "MEDIUM" : "HIGH";
    $("riskGrade").className = "risk-grade " + (risk < 38 ? "" : risk < 66 ? "medium" : "high");
    setText("maxOrderValue", cny(stats.equity * state.config.maxPosition / 100));
    setText("stopPrice", portfolio.avgCost ? money(portfolio.avgCost * (1 - state.config.stopLoss / 100)) : "--");
    setText("takePrice", portfolio.avgCost ? money(portfolio.avgCost * (1 + state.config.takeProfit / 100)) : "--");
    setText("breakEvenPrice", portfolio.avgCost ? money(portfolio.avgCost) : "--");
    setText("tradeCount", portfolio.trades.length + " 笔成交");

    $("tradeRows").innerHTML = portfolio.trades.length
      ? portfolio.trades.map(function (trade) {
        return "<tr><td>" + escapeHtml(formatDateTime(trade.createdAt)) +
          '</td><td><span class="trade-side ' + trade.side + '">' +
          (trade.side === "buy" ? "买入" : "卖出") + "</span></td><td>" +
          number(trade.grams, 0).toFixed(2) + " g</td><td>" +
          money(number(trade.price, 0)) + "</td><td>" + cny(number(trade.fee, 0)) +
          "</td><td>" + cny(number(trade.value, 0)) + "</td><td>" +
          escapeHtml(trade.note || "-") + "</td></tr>";
      }).join("")
      : '<tr class="empty-row"><td colspan="7">暂无模拟成交。可以先用 1g 或 5g 测试完整交易流程。</td></tr>';
  }

  function renderOrderPreview() {
    var grams = Math.max(0, number($("tradeGrams").value, 0));
    var rate = Math.max(0, number($("feeRate").value, 0)) / 100;
    var price = executionPrice(state.tradeSide);
    var value = grams * price;
    var fee = value * rate;
    var stats = portfolioStats();
    var projectedMarket = state.tradeSide === "buy"
      ? stats.marketValue + value
      : Math.max(0, stats.marketValue - value);
    var projectedEquity = Math.max(1, stats.equity - fee);
    var projectedAllocation = projectedMarket / projectedEquity * 100;
    setText("ticketPrice", money(price));
    setText("executionPrice", money(price));
    setText("estimatedFee", cnyPrecise(fee));
    setText("orderValue", cny(value + fee));
    setText("postPosition", projectedAllocation.toFixed(1) + "%");
    setText("tradeButtonAmount", cny(value + fee));
    var checks = orderRiskChecks(grams, value + fee);
    $("riskChecks").innerHTML = checks.map(function (check) {
      return '<div class="risk-check ' + (check.ok ? "" : "fail") +
        '"><span><i></i> ' + escapeHtml(check.label) +
        "</span><b>" + escapeHtml(check.value) + "</b></div>";
    }).join("");
  }

  function orderRiskChecks(grams, total) {
    var stats = portfolioStats();
    var maxOrder = stats.equity * state.config.maxPosition / 100;
    return [
      {
        ok: grams > 0,
        label: "克数校验",
        value: grams > 0 ? grams.toFixed(2) + "g" : "无效"
      },
      {
        ok: state.tradeSide === "sell" || total <= maxOrder,
        label: "单笔仓位上限",
        value: cny(maxOrder)
      },
      {
        ok: state.tradeSide === "buy" ? total <= state.portfolio.cash : grams <= state.portfolio.grams,
        label: state.tradeSide === "buy" ? "可用现金" : "可卖持仓",
        value: state.tradeSide === "buy" ? cny(state.portfolio.cash) : state.portfolio.grams.toFixed(2) + "g"
      }
    ];
  }

  function executeTrade() {
    var grams = number($("tradeGrams").value, 0);
    var feeRate = Math.max(0, number($("feeRate").value, 0)) / 100;
    var note = $("tradeNote").value.trim();
    var price = executionPrice(state.tradeSide);
    var value = grams * price;
    var fee = value * feeRate;
    var total = value + fee;
    var checks = orderRiskChecks(grams, total);
    var failed = checks.find(function (check) { return !check.ok; });
    if (failed) {
      $("tradeError").textContent = failed.label + "未通过，请调整订单。";
      return;
    }
    var portfolio = state.portfolio;
    if (state.tradeSide === "buy") {
      var previousCost = portfolio.grams * portfolio.avgCost;
      var nextGrams = portfolio.grams + grams;
      portfolio.cash -= total;
      portfolio.grams = nextGrams;
      portfolio.avgCost = (previousCost + total) / nextGrams;
    } else {
      portfolio.cash += value - fee;
      portfolio.realized += (price - portfolio.avgCost) * grams - fee;
      portfolio.grams -= grams;
      if (portfolio.grams <= 0.000001) {
        portfolio.grams = 0;
        portfolio.avgCost = 0;
      }
    }
    portfolio.totalFees += fee;
    portfolio.trades.unshift({
      id: Date.now() + "-" + Math.random().toString(36).slice(2),
      side: state.tradeSide,
      grams: grams,
      price: price,
      value: value,
      fee: fee,
      note: note,
      createdAt: new Date().toISOString()
    });
    portfolio.trades = portfolio.trades.slice(0, 200);
    savePortfolio();
    $("tradeNote").value = "";
    $("tradeError").textContent = "";
    renderPortfolio();
    renderOrderPreview();
    renderHistoryMetrics();
    renderDecisionContext();
    drawAllocationChart();
    showToast("模拟订单已成交", (state.tradeSide === "buy" ? "买入 " : "卖出 ") +
      grams.toFixed(2) + "g · " + money(price));
  }

  function renderIntelligence() {
    var items = mergedNews();
    var filtered = items.filter(function (item) {
      if (state.newsFilter === "all") return true;
      if (state.newsFilter === "high") return item.weight >= 60;
      return item.category === state.newsFilter;
    }).slice(0, 14);
    $("newsFreshness").textContent = "快照 " + relativeTime(new Date(state.news.generatedAt));
    $("newsList").innerHTML = filtered.length
      ? filtered.map(renderNewsItem).join("")
      : '<div class="empty-row">当前筛选下没有高相关消息。</div>';
    renderImpactMap(items);
    $("sourceGrid").innerHTML = SOURCES.map(function (source) {
      return '<a class="source-card" href="' + safeUrl(source.url) +
        '" target="_blank" rel="noreferrer"><div><span>' + escapeHtml(source.tier) +
        '</span><i></i></div><strong>' + escapeHtml(source.name) +
        '</strong><small>' + escapeHtml(source.description) + "</small></a>";
    }).join("");
  }

  function mergedNews() {
    var generated = marketObservationNews();
    var relevant = state.news.items.filter(function (item) {
      var text = (item.title + " " + item.summary).toLowerCase();
      return item.category === "domestic" ||
        /fomc|monetary|interest rate|inflation|cpi|ppi|gold|treasury|dollar|federal funds|economic projection|黄金|人民币|外汇|利率|通胀/.test(text);
    });
    var seen = new Set();
    return generated.concat(relevant).filter(function (item) {
      var key = item.url + "|" + item.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort(function (a, b) {
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });
  }

  function marketObservationNews() {
    var quote = state.quote;
    var momentum = historyMomentum(20) * 100;
    var premium = quote.domesticPremiumPct;
    return [
      {
        id: "market-au9999",
        source: "AURUM 盘面解析",
        title: "AU9999 当前 " + money(quote.priceCnyGram) + "，日内振幅 " +
          ((quote.highCnyGram - quote.lowCnyGram) / quote.previousCnyGram * 100).toFixed(2) + "%",
        summary: "依据国内公开行情生成的结构化盘面观察，不是交易所公告。",
        url: quote.sourceUrl,
        publishedAt: quote.asOf,
        impact: quote.changePct > 0.35 ? "bullish" : quote.changePct < -0.35 ? "bearish" : "neutral",
        weight: 82,
        category: "domestic"
      },
      {
        id: "market-momentum",
        source: "AURUM 技术解析",
        title: "真实日线 20 日动量 " + signedPercent(momentum),
        summary: "由上金所 Au99.99 每日历史快照计算，历史与预测已分开显示。",
        url: state.history.sourceUrl,
        publishedAt: state.history.generatedAt,
        impact: momentum > 2 ? "bullish" : momentum < -2 ? "bearish" : "mixed",
        weight: 72,
        category: "domestic"
      },
      {
        id: "market-premium",
        source: "AURUM 价差解析",
        title: Number.isFinite(premium)
          ? "国内相对国际折算 " + (premium >= 0 ? "溢价 " : "折价 ") + Math.abs(premium).toFixed(2) + "%"
          : "国际折算参考暂不可用",
        summary: "国际价格只用于价差对照，不参与国内 AU9999 主价格生成。",
        url: "https://www.sge.com.cn/sjzx/yshqbg",
        publishedAt: quote.asOf,
        impact: Number.isFinite(premium) && Math.abs(premium) > 5 ? "mixed" : "neutral",
        weight: 66,
        category: "domestic"
      }
    ];
  }

  function renderNewsItem(item) {
    var time = new Date(item.publishedAt);
    var label = {
      bullish: "利多",
      bearish: "利空",
      mixed: "双向",
      neutral: "中性"
    }[item.impact] || "中性";
    return '<a class="news-item" href="' + safeUrl(item.url) +
      '" target="_blank" rel="noreferrer"><time>' + escapeHtml(formatShortDate(time)) +
      "</time><div><strong>" + escapeHtml(item.title) + "</strong><p>" +
      escapeHtml(item.summary) + "</p></div><span class=\"news-meta\"><b class=\"impact-tag " +
      item.impact + '">' + label + "</b><svg><use href=\"#i-external\"></use></svg></span></a>";
  }

  function renderImpactMap(items) {
    var score = items.reduce(function (sum, item) {
      var direction = item.impact === "bullish" ? 1 : item.impact === "bearish" ? -1 : 0;
      return sum + direction * item.weight;
    }, 0) / Math.max(items.reduce(function (sum, item) { return sum + item.weight; }, 0), 1) * 100;
    score = clamp(score + factorScore() * 0.34, -100, 100);
    $("impactPointer").style.left = (50 + score / 2) + "%";
    $("impactDirection").textContent = score > 18 ? "利多占优" : score < -18 ? "利空占优" : "中性平衡";
    $("impactDirection").className = score > 18 ? "up-text" : score < -18 ? "down-text" : "";

    var impacts = [
      ["国内盘面", clamp(state.quote.changePct * 22, -100, 100)],
      ["趋势动量", clamp(historyMomentum(20) * 420, -100, 100)],
      ["人民币因子", getFactor("cny")],
      ["海外利率", getFactor("realRates")],
      ["避险需求", getFactor("risk")]
    ];
    $("impactList").innerHTML = impacts.map(function (item) {
      var width = Math.abs(item[1]);
      return '<div class="impact-item"><span>' + escapeHtml(item[0]) +
        '</span><i><em style="width:' + width + "%;background:" +
        (item[1] >= 0 ? "var(--green)" : "var(--red)") +
        '"></em></i><b>' + signedNumber(Math.round(item[1])) + "</b></div>";
    }).join("");
    $("watchTags").innerHTML = ["上金所夜盘", "人民币汇率", "央行购金", "实际利率", "地缘风险"]
      .map(function (tag) { return "<b>" + tag + "</b>"; }).join("");
  }

  function getFactor(id) {
    var factor = state.factors.find(function (item) { return item.id === id; });
    return factor ? factor.value : 0;
  }

  function renderDecisionContext() {
    var stats = portfolioStats();
    var forecast = state.forecasts[1] || {};
    var context = [
      ["国内主价", money(state.quote.priceCnyGram)],
      ["数据层级", dataTierLabel(state.quote)],
      ["真实历史", state.history.daily.length + " 日"],
      ["1 月中枢", forecast.center ? money(forecast.center) : "--"],
      ["账户仓位", stats.allocation.toFixed(1) + "%"],
      ["综合风险", riskScore() + "/100"]
    ];
    $("modelContextList").innerHTML = context.map(function (item) {
      return '<div class="context-line"><span>' + item[0] + "</span><b>" + item[1] + "</b></div>";
    }).join("");
    var rules = [
      ["单笔上限", state.config.maxPosition + "%"],
      ["止损阈值", state.config.stopLoss + "%"],
      ["止盈阈值", state.config.takeProfit + "%"],
      ["模型接口", state.config.aiApiKey ? state.config.aiProvider : "未启用"]
    ];
    $("ruleList").innerHTML = rules.map(function (item) {
      return '<div class="context-line"><span>' + escapeHtml(item[0]) +
        "</span><b>" + escapeHtml(String(item[1])) + "</b></div>";
    }).join("");
    $("modelStatus").innerHTML = '<i></i><b>' +
      escapeHtml(state.config.aiApiKey ? state.config.aiProvider + " · " + state.config.aiModel : "本地规则引擎") +
      "</b>";
  }

  function renderLocalAdvice() {
    state.aiReportMode = "local";
    var forecast = state.forecasts[1] || { low: 0, high: 0, center: 0 };
    var stats = portfolioStats();
    var actions = strategyActions();
    var stance = factorScore() > 20 ? "谨慎偏多" : factorScore() < -20 ? "防守偏空" : "中性震荡";
    $("aiHeadline").textContent = "本地规则报告 · " + stance;
    $("aiOutput").innerHTML =
      "<h3>核心判断</h3><p>当前 AU9999 为 <strong>" + money(state.quote.priceCnyGram) +
      "</strong>，综合因子为 <strong>" + signedNumber(Math.round(factorScore())) +
      "</strong>，策略倾向 <strong>" + stance + "</strong>。</p>" +
      '<div class="report-grid"><div><span>1 月中枢</span><strong>' + money(forecast.center) +
      '</strong></div><div><span>概率区间</span><strong>' + money(forecast.low) + " - " +
      money(forecast.high) + '</strong></div><div><span>当前仓位</span><strong>' +
      stats.allocation.toFixed(1) + "%</strong></div></div>" +
      "<h3>执行措施</h3><ol>" + actions.map(function (action) {
        return "<li>" + escapeHtml(action) + "</li>";
      }).join("") + "</ol>" +
      "<h3>风险提示</h3><p>公开行情可能延迟；预测是概率情景，不是收益承诺。真实交易前应复核交易终端报价、流动性与个人风险承受能力。</p>";
  }

  async function generateAdvice() {
    if (!state.config.aiApiKey.trim()) {
      state.aiReportMode = "local";
      renderTyping();
      setTimeout(function () {
        renderLocalAdvice();
        showToast("本地决策报告已更新", "未配置模型 API，行情和全部本地功能不受影响。");
      }, 720);
      return;
    }
    renderTyping();
    $("generateAdvice").disabled = true;
    try {
      var response = await fetch(state.config.aiEndpoint.trim(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + state.config.aiApiKey.trim()
        },
        body: JSON.stringify({
          model: state.config.aiModel.trim() || "gpt-5",
          messages: [
            {
              role: "system",
              content: "你是谨慎的国内黄金市场研究助手。必须优先使用 AU9999 人民币/克、真实历史、国内因素、数据年龄和用户模拟仓位。输出明确的概率、条件、风险和分步措施，不承诺收益。"
            },
            {
              role: "user",
              content: JSON.stringify(aiPayload(), null, 2)
            }
          ]
        })
      });
      if (!response.ok) {
        throw new Error("模型接口返回 " + response.status + ": " + (await response.text()).slice(0, 160));
      }
      var payload = await response.json();
      var text = payload && payload.choices && payload.choices[0] &&
        payload.choices[0].message && payload.choices[0].message.content;
      if (!text) throw new Error("模型返回内容为空");
      state.aiReportMode = "external";
      renderExternalAdvice(text);
      $("aiHeadline").textContent = state.config.aiProvider + " · 实时决策报告";
      showToast("AI 决策报告已生成", "模型只使用当前页面数据进行推理。");
    } catch (error) {
      state.aiReportMode = "local";
      renderLocalAdvice();
      showToast("模型调用失败，已回退本地规则", error.message, "error");
    } finally {
      $("generateAdvice").disabled = false;
    }
  }

  function aiPayload() {
    return {
      requestType: state.promptType,
      quote: state.quote,
      historyMetrics: {
        points: state.history.daily.length,
        momentum20Pct: historyMomentum(20) * 100,
        momentum60Pct: historyMomentum(60) * 100,
        annualVolatilityPct: annualVolatility(),
        rsi14: computeRsi(14)
      },
      forecasts: state.forecasts,
      factors: state.factors,
      portfolio: Object.assign({}, state.portfolio, portfolioStats()),
      riskRules: {
        maxPositionPct: state.config.maxPosition,
        stopLossPct: state.config.stopLoss,
        takeProfitPct: state.config.takeProfit
      },
      relevantNews: mergedNews().slice(0, 8)
    };
  }

  function renderTyping() {
    $("aiOutput").innerHTML =
      '<p>正在综合国内盘面、真实历史、预测情景与账户风控 ' +
      '<span class="typing-dots"><i></i><i></i><i></i></span></p>';
  }

  function renderExternalAdvice(text) {
    var safe = escapeHtml(String(text));
    var blocks = safe.split(/\n{2,}/).map(function (block) {
      var line = block.trim();
      if (!line) return "";
      if (/^#{1,3}\s/.test(line)) return "<h3>" + line.replace(/^#{1,3}\s*/, "") + "</h3>";
      return "<p>" + line.replace(/\n/g, "<br>") + "</p>";
    });
    $("aiOutput").innerHTML = blocks.join("");
  }

  function copyAdvice() {
    var text = $("aiOutput").innerText.trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(function () {
      showToast("报告已复制", "可以粘贴到研究笔记中。");
    }).catch(function () {
      showToast("复制失败", "浏览器未授予剪贴板权限。", "error");
    });
  }

  function drawAllCharts() {
    drawSparkChart();
    drawPriceChart();
    drawForecastChart();
    drawAllocationChart();
  }

  function setupCanvas(canvas, height) {
    var rect = canvas.getBoundingClientRect();
    var width = Math.max(280, rect.width || canvas.clientWidth || 600);
    var cssHeight = height || rect.height || canvas.clientHeight || 300;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    var context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, cssHeight);
    return { ctx: context, width: width, height: cssHeight, dpr: dpr };
  }

  function drawSparkChart() {
    var canvas = $("sparkCanvas");
    var setup = setupCanvas(canvas, 154);
    var ctx = setup.ctx;
    var width = setup.width;
    var height = setup.height;
    var values;
    if (state.history.intraday.length > 5) {
      values = state.history.intraday.slice(-120).map(function (point) { return point.close; });
    } else {
      var quote = state.quote;
      values = [
        quote.openCnyGram,
        (quote.openCnyGram + quote.lowCnyGram) / 2,
        quote.lowCnyGram,
        (quote.lowCnyGram + quote.highCnyGram) / 2,
        quote.highCnyGram,
        (quote.highCnyGram + quote.priceCnyGram) / 2,
        quote.priceCnyGram
      ];
    }
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var range = Math.max(max - min, 1);
    var pad = 12;
    var points = values.map(function (value, index) {
      return {
        x: pad + index / Math.max(values.length - 1, 1) * (width - pad * 2),
        y: pad + (max - value) / range * (height - pad * 2)
      };
    });
    var gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "rgba(232, 186, 93, .2)");
    gradient.addColorStop(1, "rgba(232, 186, 93, 0)");
    ctx.beginPath();
    ctx.moveTo(points[0].x, height);
    points.forEach(function (point) { ctx.lineTo(point.x, point.y); });
    ctx.lineTo(points[points.length - 1].x, height);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    drawSmoothLine(ctx, points, "#e8ba5d", 1.7);
    var last = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#f4d68b";
    ctx.shadowColor = "#e8ba5d";
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawPriceChart() {
    var canvas = $("priceCanvas");
    var wrap = $("priceChartWrap");
    var height = wrap.clientHeight || 390;
    var setup = setupCanvas(canvas, height);
    var ctx = setup.ctx;
    var width = setup.width;
    var allDaily = effectiveDaily();
    var daily = allDaily.slice(-state.chartRange);
    state.chartPoints = [];
    if (daily.length < 2) {
      drawEmptyCanvas(ctx, width, height, "真实历史数据暂不可用");
      return;
    }

    var pad = { top: 22, right: 58, bottom: 34, left: 16 };
    var showForecast = state.chartIndicators.forecast;
    var splitX = showForecast ? width * 0.79 : width - pad.right;
    var plotBottom = height - pad.bottom;
    var closes = daily.map(function (point) { return point.close; });
    var ma20 = daily.map(function (_, index) {
      var globalIndex = allDaily.length - daily.length + index;
      return movingAverage(allDaily, globalIndex, 20);
    });
    var ma60 = daily.map(function (_, index) {
      var globalIndex = allDaily.length - daily.length + index;
      return movingAverage(allDaily, globalIndex, 60);
    });
    var forecast = buildChartForecast(daily[daily.length - 1].close, 30);
    var values = closes.concat(
      state.chartIndicators.ma20 ? ma20.filter(Number.isFinite) : [],
      state.chartIndicators.ma60 ? ma60.filter(Number.isFinite) : [],
      showForecast ? forecast.flatMap(function (point) { return [point.low, point.high]; }) : []
    );
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var margin = Math.max((max - min) * 0.12, 3);
    min -= margin;
    max += margin;
    var y = function (value) {
      return pad.top + (max - value) / (max - min) * (plotBottom - pad.top);
    };
    var xHistory = function (index) {
      return pad.left + index / Math.max(daily.length - 1, 1) * (splitX - pad.left);
    };
    var xForecast = function (index) {
      return splitX + index / Math.max(forecast.length - 1, 1) * (width - pad.right - splitX);
    };

    drawGrid(ctx, width, height, pad, min, max, y);
    if (showForecast) {
      ctx.fillStyle = "rgba(232, 186, 93, .025)";
      ctx.fillRect(splitX, pad.top, width - pad.right - splitX, plotBottom - pad.top);
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = "rgba(232, 186, 93, .28)";
      ctx.beginPath();
      ctx.moveTo(splitX, pad.top);
      ctx.lineTo(splitX, plotBottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#84662f";
      ctx.font = "8px sans-serif";
      ctx.fillText("FORECAST", splitX + 8, pad.top + 12);
      drawForecastBand(ctx, forecast, xForecast, y);
    }

    var pricePoints = daily.map(function (point, index) {
      var chartPoint = { x: xHistory(index), y: y(point.close), data: point };
      state.chartPoints.push(chartPoint);
      return chartPoint;
    });
    var area = ctx.createLinearGradient(0, pad.top, 0, plotBottom);
    area.addColorStop(0, "rgba(232, 186, 93, .16)");
    area.addColorStop(1, "rgba(232, 186, 93, 0)");
    ctx.beginPath();
    ctx.moveTo(pricePoints[0].x, plotBottom);
    pricePoints.forEach(function (point) { ctx.lineTo(point.x, point.y); });
    ctx.lineTo(pricePoints[pricePoints.length - 1].x, plotBottom);
    ctx.closePath();
    ctx.fillStyle = area;
    ctx.fill();
    drawSmoothLine(ctx, pricePoints, "#e8ba5d", 1.65);

    if (state.chartIndicators.ma20) {
      drawSeriesLine(ctx, ma20, xHistory, y, "#51d3a2", 1.05);
    }
    if (state.chartIndicators.ma60) {
      drawSeriesLine(ctx, ma60, xHistory, y, "#f0a94c", 1.05);
    }

    var last = pricePoints[pricePoints.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#f4d68b";
    ctx.fill();
    drawChartHover(ctx, pad, plotBottom);
  }

  function drawGrid(ctx, width, height, pad, min, max, y) {
    ctx.font = "8px SFMono-Regular, Consolas, monospace";
    ctx.textAlign = "left";
    for (var index = 0; index <= 4; index += 1) {
      var value = min + (max - min) * (1 - index / 4);
      var lineY = y(value);
      ctx.strokeStyle = "rgba(146, 152, 139, .11)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, lineY);
      ctx.lineTo(width - pad.right, lineY);
      ctx.stroke();
      ctx.fillStyle = "#697064";
      ctx.fillText(value.toFixed(0), width - pad.right + 8, lineY + 3);
    }
  }

  function buildChartForecast(start, days) {
    var target = state.forecasts[1] ? state.forecasts[1].center : start;
    var vol = dailyVolatility();
    var points = [];
    for (var index = 0; index <= days; index += 1) {
      var progress = index / days;
      var center = start + (target - start) * progress;
      var uncertainty = start * vol * Math.sqrt(Math.max(index, 1)) * 1.25;
      points.push({
        center: center,
        low: center - uncertainty,
        high: center + uncertainty
      });
    }
    return points;
  }

  function drawForecastBand(ctx, forecast, x, y) {
    ctx.beginPath();
    forecast.forEach(function (point, index) {
      var px = x(index);
      var py = y(point.high);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    for (var index = forecast.length - 1; index >= 0; index -= 1) {
      ctx.lineTo(x(index), y(forecast[index].low));
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(232, 186, 93, .09)";
    ctx.fill();
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    forecast.forEach(function (point, index) {
      if (index === 0) ctx.moveTo(x(index), y(point.center));
      else ctx.lineTo(x(index), y(point.center));
    });
    ctx.strokeStyle = "rgba(244, 214, 139, .72)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawSeriesLine(ctx, values, x, y, color, width) {
    ctx.beginPath();
    var started = false;
    values.forEach(function (value, index) {
      if (!Number.isFinite(value)) return;
      if (!started) {
        ctx.moveTo(x(index), y(value));
        started = true;
      } else {
        ctx.lineTo(x(index), y(value));
      }
    });
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.82;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawChartHover(ctx, pad, plotBottom) {
    if (!state.chartHover || !state.chartPoints.length) return;
    var nearest = state.chartPoints.reduce(function (best, point) {
      return Math.abs(point.x - state.chartHover.x) < Math.abs(best.x - state.chartHover.x) ? point : best;
    }, state.chartPoints[0]);
    ctx.strokeStyle = "rgba(244, 241, 232, .22)";
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(nearest.x, pad.top);
    ctx.lineTo(nearest.x, plotBottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(nearest.x, nearest.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#080a08";
    ctx.fill();
    ctx.strokeStyle = "#f4d68b";
    ctx.lineWidth = 2;
    ctx.stroke();
    renderChartTooltip(nearest);
  }

  function renderChartTooltip(point) {
    var tooltip = $("chartTooltip");
    var data = point.data;
    tooltip.innerHTML = "<span>" + escapeHtml(data.time) + "</span><strong>" +
      money(data.close) + "</strong><small>开 " + toFixedPrice(data.open) +
      " · 高 " + toFixedPrice(data.high) + " · 低 " + toFixedPrice(data.low) + "</small>";
    tooltip.classList.add("visible");
    tooltip.setAttribute("aria-hidden", "false");
    var wrapWidth = $("priceChartWrap").clientWidth;
    var left = point.x + 12;
    if (left + 170 > wrapWidth) left = point.x - 170;
    tooltip.style.left = Math.max(6, left) + "px";
    tooltip.style.top = Math.max(8, point.y - 66) + "px";
  }

  function drawForecastChart() {
    var canvas = $("forecastCanvas");
    var setup = setupCanvas(canvas, 320);
    var ctx = setup.ctx;
    var width = setup.width;
    var height = setup.height;
    if (!state.forecasts.length) return;
    var pad = { top: 28, right: 48, bottom: 42, left: 44 };
    var points = [{ label: "当前", center: state.quote.priceCnyGram, low: state.quote.priceCnyGram, high: state.quote.priceCnyGram }]
      .concat(state.forecasts);
    var min = Math.min.apply(null, points.map(function (point) { return point.low; })) * 0.97;
    var max = Math.max.apply(null, points.map(function (point) { return point.high; })) * 1.03;
    var x = function (index) {
      return pad.left + index / (points.length - 1) * (width - pad.left - pad.right);
    };
    var y = function (value) {
      return pad.top + (max - value) / (max - min) * (height - pad.top - pad.bottom);
    };
    for (var grid = 0; grid <= 4; grid += 1) {
      var value = min + (max - min) * (1 - grid / 4);
      var gy = y(value);
      ctx.strokeStyle = "rgba(146, 152, 139, .1)";
      ctx.beginPath();
      ctx.moveTo(pad.left, gy);
      ctx.lineTo(width - pad.right, gy);
      ctx.stroke();
      ctx.fillStyle = "#697064";
      ctx.font = "8px SFMono-Regular, Consolas, monospace";
      ctx.textAlign = "right";
      ctx.fillText(value.toFixed(0), pad.left - 8, gy + 3);
    }
    ctx.beginPath();
    points.forEach(function (point, index) {
      if (index === 0) ctx.moveTo(x(index), y(point.high));
      else ctx.lineTo(x(index), y(point.high));
    });
    for (var index = points.length - 1; index >= 0; index -= 1) {
      ctx.lineTo(x(index), y(points[index].low));
    }
    ctx.closePath();
    var fill = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
    fill.addColorStop(0, "rgba(81, 211, 162, .12)");
    fill.addColorStop(0.55, "rgba(232, 186, 93, .08)");
    fill.addColorStop(1, "rgba(255, 114, 114, .1)");
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.beginPath();
    points.forEach(function (point, index) {
      if (index === 0) ctx.moveTo(x(index), y(point.center));
      else ctx.lineTo(x(index), y(point.center));
    });
    ctx.strokeStyle = "#e8ba5d";
    ctx.lineWidth = 1.7;
    ctx.stroke();
    points.forEach(function (point, index) {
      ctx.beginPath();
      ctx.arc(x(index), y(point.center), 3, 0, Math.PI * 2);
      ctx.fillStyle = index === 0 ? "#f4f1e8" : "#e8ba5d";
      ctx.fill();
      ctx.fillStyle = "#92988b";
      ctx.font = "8px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(point.label, x(index), height - 18);
    });
  }

  function drawAllocationChart() {
    var canvas = $("allocationCanvas");
    var setup = setupCanvas(canvas, 250);
    var ctx = setup.ctx;
    var width = setup.width;
    var height = setup.height;
    var stats = portfolioStats();
    var centerX = width / 2;
    var centerY = height / 2 + 4;
    var radius = Math.min(width, height) * 0.32;
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "#282d25";
    ctx.stroke();
    var fraction = clamp(stats.allocation / 100, 0, 1);
    if (fraction > 0) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fraction);
      ctx.strokeStyle = "#e8ba5d";
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(232, 186, 93, .25)";
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineCap = "butt";
    }
    ctx.fillStyle = "#697064";
    ctx.font = "8px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("现金 " + Math.max(0, 100 - stats.allocation).toFixed(0) + "%", centerX, centerY + radius + 32);
  }

  function drawSmoothLine(ctx, points, color, width) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (var index = 1; index < points.length - 1; index += 1) {
      var next = points[index + 1];
      var current = points[index];
      var midX = (current.x + next.x) / 2;
      var midY = (current.y + next.y) / 2;
      ctx.quadraticCurveTo(current.x, current.y, midX, midY);
    }
    var last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  function drawEmptyCanvas(ctx, width, height, message) {
    ctx.fillStyle = "#697064";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(message, width / 2, height / 2);
  }

  function bindEvents() {
    $("refreshBtn").addEventListener("click", function () {
      refreshQuote({ manual: true });
    });
    $("dismissBanner").addEventListener("click", function () {
      $("statusBanner").classList.add("hidden");
    });
    $("jumpTrade").addEventListener("click", function () {
      $("trading").scrollIntoView({ behavior: "smooth" });
    });
    document.querySelectorAll("#chartRanges button").forEach(function (button) {
      button.addEventListener("click", function () {
        document.querySelectorAll("#chartRanges button").forEach(function (item) {
          item.classList.remove("active");
        });
        button.classList.add("active");
        state.chartRange = number(button.dataset.range, 260);
        state.chartHover = null;
        $("chartTooltip").classList.remove("visible");
        drawPriceChart();
      });
    });
    document.querySelectorAll("[data-indicator]").forEach(function (input) {
      input.addEventListener("change", function () {
        state.chartIndicators[input.dataset.indicator] = input.checked;
        drawPriceChart();
      });
    });
    $("priceChartWrap").addEventListener("mousemove", function (event) {
      var rect = $("priceCanvas").getBoundingClientRect();
      state.chartHover = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      drawPriceChart();
    });
    $("priceChartWrap").addEventListener("mouseleave", function () {
      state.chartHover = null;
      $("chartTooltip").classList.remove("visible");
      $("chartTooltip").setAttribute("aria-hidden", "true");
      drawPriceChart();
    });
    document.querySelectorAll(".order-tabs button").forEach(function (button) {
      button.addEventListener("click", function () {
        setTradeSide(button.dataset.side);
      });
    });
    document.querySelectorAll("#quickAmounts button").forEach(function (button) {
      button.addEventListener("click", function () {
        $("tradeGrams").value = button.dataset.grams;
        document.querySelectorAll("#quickAmounts button").forEach(function (item) {
          item.classList.toggle("active", item === button);
        });
        renderOrderPreview();
      });
    });
    ["tradeGrams", "feeRate", "tradeSpread"].forEach(function (id) {
      $(id).addEventListener("input", renderOrderPreview);
    });
    $("tradeBtn").addEventListener("click", executeTrade);
    $("exportBtn").addEventListener("click", exportTrades);
    $("resetBtn").addEventListener("click", openResetModal);
    $("cancelReset").addEventListener("click", closeResetModal);
    $("confirmBackdrop").addEventListener("click", closeResetModal);
    $("confirmReset").addEventListener("click", resetPortfolio);
    document.querySelectorAll("#newsFilters button").forEach(function (button) {
      button.addEventListener("click", function () {
        state.newsFilter = button.dataset.filter;
        document.querySelectorAll("#newsFilters button").forEach(function (item) {
          item.classList.toggle("active", item === button);
        });
        renderIntelligence();
      });
    });
    document.querySelectorAll("#promptChips button").forEach(function (button) {
      button.addEventListener("click", function () {
        state.promptType = button.dataset.prompt;
        document.querySelectorAll("#promptChips button").forEach(function (item) {
          item.classList.toggle("active", item === button);
        });
        renderLocalAdvice();
      });
    });
    $("generateAdvice").addEventListener("click", generateAdvice);
    $("copyAdvice").addEventListener("click", copyAdvice);
    $("useStrategyBtn").addEventListener("click", function () {
      $("tradeGrams").value = suggestedGrams().toFixed(2);
      $("trading").scrollIntoView({ behavior: "smooth" });
      renderOrderPreview();
      showToast("策略参数已带入", "请在模拟订单中复核克数和费用后再确认。");
    });
    ["openSettings", "openSettingsMobile", "configureAI"].forEach(function (id) {
      $(id).addEventListener("click", openSettings);
    });
    $("closeSettings").addEventListener("click", closeSettings);
    $("drawerBackdrop").addEventListener("click", closeSettings);
    $("saveSettings").addEventListener("click", applySettings);
    $("restoreDefaults").addEventListener("click", restoreDefaults);
    window.addEventListener("resize", function () {
      clearTimeout(state.resizeTimer);
      state.resizeTimer = setTimeout(drawAllCharts, 120);
    });
    window.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeSettings();
        closeResetModal();
      }
      var tag = document.activeElement && document.activeElement.tagName;
      if ((event.key === "r" || event.key === "R") && !["INPUT", "TEXTAREA", "SELECT"].includes(tag)) {
        refreshQuote({ manual: true });
      }
    });
  }

  function setTradeSide(side) {
    state.tradeSide = side === "sell" ? "sell" : "buy";
    document.querySelectorAll(".order-tabs button").forEach(function (button) {
      button.classList.toggle("active", button.dataset.side === state.tradeSide);
    });
    $("tradeBtn").className = "execute-button " + state.tradeSide;
    $("tradeBtn").querySelector("span").textContent = state.tradeSide === "buy" ? "确认模拟买入" : "确认模拟卖出";
    renderOrderPreview();
  }

  function suggestedGrams() {
    var maxValue = portfolioStats().equity * state.config.maxPosition / 100;
    var divisor = Math.max(executionPrice("buy"), 1);
    return Math.max(0.01, Math.floor(maxValue / divisor * 100) / 100);
  }

  function openSettings() {
    syncSettingsForm();
    $("settingsDrawer").classList.add("open");
    $("settingsDrawer").setAttribute("aria-hidden", "false");
    $("drawerBackdrop").classList.add("open");
    document.body.classList.add("drawer-open");
  }

  function closeSettings() {
    $("settingsDrawer").classList.remove("open");
    $("settingsDrawer").setAttribute("aria-hidden", "true");
    $("drawerBackdrop").classList.remove("open");
    document.body.classList.remove("drawer-open");
  }

  function syncSettingsForm() {
    var config = state.config;
    $("priceProvider").value = config.priceProvider;
    $("manualPrice").value = config.manualPrice || "";
    $("refreshSeconds").value = config.refreshSeconds;
    $("purity").value = String(config.purity);
    $("productPremium").value = config.productPremium;
    $("maxPosition").value = config.maxPosition;
    $("stopLoss").value = config.stopLoss;
    $("takeProfit").value = config.takeProfit;
    $("alertLower").value = config.alertLower || "";
    $("alertUpper").value = config.alertUpper || "";
    $("aiEndpoint").value = config.aiEndpoint;
    $("aiModel").value = config.aiModel;
    $("aiProvider").value = config.aiProvider;
    $("aiApiKey").value = config.aiApiKey;
    $("saveApiKey").checked = !!config.saveApiKey;
  }

  function applySettings() {
    state.config = {
      priceProvider: $("priceProvider").value,
      manualPrice: Math.max(0, number($("manualPrice").value, 0)),
      refreshSeconds: clamp(number($("refreshSeconds").value, 15), 10, 3600),
      purity: clamp(number($("purity").value, 1), 0.1, 1),
      productPremium: clamp(number($("productPremium").value, 0), -50, 200),
      maxPosition: clamp(number($("maxPosition").value, 15), 1, 100),
      stopLoss: clamp(number($("stopLoss").value, 4), 0.1, 100),
      takeProfit: clamp(number($("takeProfit").value, 8), 0.1, 500),
      alertLower: Math.max(0, number($("alertLower").value, 0)),
      alertUpper: Math.max(0, number($("alertUpper").value, 0)),
      aiEndpoint: $("aiEndpoint").value.trim() || DEFAULT_CONFIG.aiEndpoint,
      aiModel: $("aiModel").value.trim() || DEFAULT_CONFIG.aiModel,
      aiProvider: $("aiProvider").value.trim() || DEFAULT_CONFIG.aiProvider,
      aiApiKey: $("aiApiKey").value.trim(),
      saveApiKey: $("saveApiKey").checked
    };
    saveConfig();
    closeSettings();
    startPolling();
    renderAll();
    refreshQuote({ manual: true });
    showToast("设置已应用", "行情、预测和风控参数已重新计算。");
  }

  function restoreDefaults() {
    state.config = Object.assign({}, DEFAULT_CONFIG);
    saveConfig();
    syncSettingsForm();
    showToast("已恢复默认参数", "点击“保存并应用”后生效。");
  }

  function openResetModal() {
    $("confirmBackdrop").classList.add("open");
    $("confirmModal").classList.add("open");
    document.body.classList.add("modal-open");
  }

  function closeResetModal() {
    $("confirmBackdrop").classList.remove("open");
    $("confirmModal").classList.remove("open");
    document.body.classList.remove("modal-open");
  }

  function resetPortfolio() {
    state.portfolio = {
      cash: 100000,
      grams: 0,
      avgCost: 0,
      realized: 0,
      totalFees: 0,
      initialCash: 100000,
      trades: []
    };
    savePortfolio();
    closeResetModal();
    renderPortfolio();
    renderOrderPreview();
    renderHistoryMetrics();
    renderDecisionContext();
    drawAllocationChart();
    showToast("模拟账户已重置", "虚拟资金恢复为 ¥100,000。");
  }

  function exportTrades() {
    var rows = [["时间", "方向", "克数", "成交价_元每克", "手续费", "成交金额", "备注"]]
      .concat(state.portfolio.trades.map(function (trade) {
        return [
          trade.createdAt,
          trade.side === "buy" ? "买入" : "卖出",
          trade.grams,
          trade.price,
          trade.fee,
          trade.value,
          trade.note || ""
        ];
      }));
    var csv = "\ufeff" + rows.map(function (row) {
      return row.map(function (cell) {
        return '"' + String(cell).replace(/"/g, '""') + '"';
      }).join(",");
    }).join("\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "aurum-simulated-trades-" + new Date().toISOString().slice(0, 10) + ".csv";
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("模拟账单已导出", state.portfolio.trades.length + " 笔成交记录。");
  }

  function startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    var interval = Math.max(10, number(state.config.refreshSeconds, 15));
    state.pollRemaining = interval;
    state.pollTimer = setInterval(function () {
      state.pollRemaining -= 1;
      if (state.pollRemaining <= 0) {
        state.pollRemaining = interval;
        refreshQuote();
      }
      renderStatus();
      renderAlerts();
    }, 1000);
  }

  function renderAlerts() {
    var price = state.quote.priceCnyGram;
    var upper = number(state.config.alertUpper, 0);
    var lower = number(state.config.alertLower, 0);
    if (upper > 0 && price >= upper && !state.__upperAlerted) {
      state.__upperAlerted = true;
      showToast("价格预警已触发", "AU9999 已达到上方预警 " + money(upper));
    }
    if (lower > 0 && price <= lower && !state.__lowerAlerted) {
      state.__lowerAlerted = true;
      showToast("价格预警已触发", "AU9999 已达到下方预警 " + money(lower));
    }
    if (upper <= 0 || price < upper) state.__upperAlerted = false;
    if (lower <= 0 || price > lower) state.__lowerAlerted = false;
  }

  function setupObservers() {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    document.querySelectorAll(".reveal").forEach(function (element) {
      revealObserver.observe(element);
    });

    var sectionObserver = new IntersectionObserver(function (entries) {
      var visible = entries.filter(function (entry) { return entry.isIntersecting; })
        .sort(function (a, b) { return b.intersectionRatio - a.intersectionRatio; })[0];
      if (!visible) return;
      setActiveNav(visible.target.id);
    }, { rootMargin: "-20% 0px -58% 0px", threshold: [0.05, 0.2, 0.5] });
    document.querySelectorAll("[data-observe]").forEach(function (section) {
      sectionObserver.observe(section);
    });
  }

  function setActiveNav(id) {
    document.querySelectorAll(".nav-item").forEach(function (item) {
      item.classList.toggle("active", item.dataset.section === id);
    });
    document.querySelectorAll(".mobile-nav a").forEach(function (item) {
      item.classList.toggle("active", item.getAttribute("href") === "#" + id);
    });
  }

  function showToast(title, message, type) {
    var toast = document.createElement("div");
    toast.className = "toast " + (type || "");
    toast.innerHTML = "<i></i><div><strong>" + escapeHtml(title) +
      "</strong><span>" + escapeHtml(message || "") + "</span></div>";
    $("toastRegion").appendChild(toast);
    setTimeout(function () {
      toast.classList.add("out");
      setTimeout(function () { toast.remove(); }, 280);
    }, 4300);
  }

  function scenarioProbabilities(score) {
    var bull = Math.round(clamp(33 + score * 0.18, 12, 68));
    var bear = Math.round(clamp(33 - score * 0.18, 12, 68));
    var base = 100 - bull - bear;
    return { bull: bull, base: base, bear: bear };
  }

  function movingAverage(points, index, windowSize) {
    if (index < windowSize - 1) return NaN;
    var slice = points.slice(index - windowSize + 1, index + 1);
    return average(slice.map(function (point) { return point.close; }));
  }

  function findContract(symbol) {
    return state.quote.contracts.find(function (contract) {
      return normalizeSymbol(contract.symbol) === normalizeSymbol(symbol);
    });
  }

  function marketSession(date) {
    var parts = chinaParts(date);
    var minutes = parts.hour * 60 + parts.minute;
    var weekday = parts.weekday;
    var dayOpen = weekday >= 1 && weekday <= 5 &&
      ((minutes >= 9 * 60 && minutes <= 11 * 60 + 30) ||
      (minutes >= 13 * 60 + 30 && minutes <= 15 * 60 + 30));
    var nightOpen = (weekday >= 1 && weekday <= 5 && minutes >= 20 * 60) ||
      (weekday >= 2 && weekday <= 6 && minutes <= 2 * 60 + 30);
    if (dayOpen) return { open: true, label: "日盘交易中", detail: "上海黄金交易所 · AU9999" };
    if (nightOpen) return { open: true, label: "夜盘交易中", detail: "上海黄金交易所 · AU9999" };
    return { open: false, label: "当前休市", detail: "行情不变可能是休市或暂无新成交" };
  }

  function chinaParts(date) {
    var formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    var values = {};
    formatter.formatToParts(date).forEach(function (part) {
      values[part.type] = part.value;
    });
    var weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      weekday: weekdayMap[values.weekday],
      hour: number(values.hour, 0),
      minute: number(values.minute, 0)
    };
  }

  function dataTierLabel(quote) {
    if (quote.dataTier === "domestic-live") return "国内公开刷新";
    if (quote.dataTier === "official-delayed") return "上金所官方延时";
    if (quote.dataTier === "manual") return "手动校准";
    return "部署快照";
  }

  function sourceHealthText() {
    if (!state.sourceHealth.length) return "多源自动切换";
    var success = state.sourceHealth.find(function (item) { return item.ok; });
    return success ? success.name + " 已连接" : "保留上一笔有效行情";
  }

  function quoteEventText(previous, current) {
    if (!Number.isFinite(Number(previous))) return "已接收第一笔有效行情";
    if (Math.abs(Number(current) - Number(previous)) < 0.001) {
      return "轮询成功，价格暂无变化";
    }
    return Number(current) > Number(previous) ? "检测到价格上行更新" : "检测到价格下行更新";
  }

  function shortSource(source) {
    return String(source || "国内行情").replace(/浏览器直连/g, "").replace(/国内公开行情/g, "").trim();
  }

  function quoteAgeHours(value) {
    var timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return Infinity;
    return Math.max(0, (Date.now() - timestamp) / 3600000);
  }

  function ageText(value) {
    var hours = quoteAgeHours(value);
    if (!Number.isFinite(hours)) return "未知";
    if (hours < 1 / 60) return "刚刚";
    if (hours < 1) return Math.floor(hours * 60) + " 分钟";
    if (hours < 48) return hours.toFixed(1) + " 小时";
    return (hours / 24).toFixed(1) + " 天";
  }

  function relativeTime(date) {
    var delta = Math.max(0, Date.now() - new Date(date).getTime());
    if (!Number.isFinite(delta)) return "--";
    if (delta < 5000) return "刚刚";
    if (delta < 60000) return Math.floor(delta / 1000) + " 秒前";
    if (delta < 3600000) return Math.floor(delta / 60000) + " 分钟前";
    if (delta < 86400000) return Math.floor(delta / 3600000) + " 小时前";
    return Math.floor(delta / 86400000) + " 天前";
  }

  function formatDateTime(value) {
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }).format(new Date(value));
    } catch {
      return "--";
    }
  }

  function formatTime(value) {
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }).format(new Date(value));
    } catch {
      return "--:--:--";
    }
  }

  function formatShortDate(date) {
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      }).format(date);
    } catch {
      return "--";
    }
  }

  function chinaDateKey(value) {
    try {
      var parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(new Date(value));
      var map = {};
      parts.forEach(function (part) { map[part.type] = part.value; });
      return map.year + "-" + map.month + "-" + map.day;
    } catch {
      return "";
    }
  }

  function validDate(value) {
    var date = new Date(value || 0);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  function number(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function average(values) {
    if (!values.length) return 0;
    return values.reduce(function (sum, value) { return sum + value; }, 0) / values.length;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function directionClass(value) {
    var parsed = number(value, 0);
    if (parsed > 0.0001) return "up";
    if (parsed < -0.0001) return "down";
    return "neutral";
  }

  function toFixedPrice(value) {
    var parsed = number(value, NaN);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : "--";
  }

  function money(value) {
    return toFixedPrice(value) + " 元/g";
  }

  function signedPrice(value) {
    var parsed = number(value, 0);
    return (parsed > 0 ? "+" : "") + parsed.toFixed(2);
  }

  function signedPercent(value) {
    var parsed = number(value, 0);
    return (parsed > 0 ? "+" : "") + parsed.toFixed(2) + "%";
  }

  function signedNumber(value) {
    var parsed = number(value, 0);
    return (parsed > 0 ? "+" : "") + parsed.toFixed(0);
  }

  function cny(value) {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: "CNY",
      maximumFractionDigits: 0
    }).format(number(value, 0));
  }

  function cnyPrecise(value) {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: "CNY",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(number(value, 0));
  }

  function signedCny(value) {
    var parsed = number(value, 0);
    return (parsed > 0 ? "+" : "") + cny(parsed);
  }

  function compactNumber(value) {
    var parsed = number(value, 0);
    if (parsed >= 100000000) return (parsed / 100000000).toFixed(2) + " 亿";
    if (parsed >= 10000) return (parsed / 10000).toFixed(2) + " 万";
    return parsed > 0 ? parsed.toFixed(0) : "--";
  }

  function compactCurrency(value) {
    var parsed = number(value, 0);
    if (parsed >= 100000000) return "¥" + (parsed / 100000000).toFixed(2) + " 亿";
    if (parsed >= 10000) return "¥" + (parsed / 10000).toFixed(1) + " 万";
    return parsed > 0 ? cny(parsed) : "--";
  }

  function setText(id, value) {
    var element = $(id);
    if (element) element.textContent = value;
  }

  function setMetricClass(id, value, direction) {
    var element = $(id);
    if (!element) return;
    element.textContent = value;
    element.classList.remove("up-text", "down-text");
    if (number(direction, 0) > 0) element.classList.add("up-text");
    if (number(direction, 0) < 0) element.classList.add("down-text");
  }

  function safeUrl(value) {
    try {
      var url = new URL(String(value || ""), location.href);
      if (!["http:", "https:"].includes(url.protocol)) return "#";
      return url.href;
    } catch {
      return "#";
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[character];
    });
  }

  async function init() {
    bindEvents();
    setupObservers();
    syncDynamicFactors();
    buildForecasts();
    renderAll();
    startPolling();
    await loadStaticData();
    syncDynamicFactors();
    buildForecasts();
    renderAll();
    refreshQuote();
  }

  init();
})();
