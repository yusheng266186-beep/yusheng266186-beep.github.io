(function () {
  "use strict";

  var Core = window.AurumCore;
  var portfolioSignature = null;
  var storageNotice = "";
  var portfolioReadFailed = false;
  var DATA = window.__AURUM_DATA__ || {};
  var CONFIG_KEY = "aurum-os-config-v5";
  var PORTFOLIO_KEY = "aurum-os-portfolio-v3";
  var DEFAULT_CONFIG = {
    priceProvider: "domestic",
    manualPrice: 0,
    refreshSeconds: 60,
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
    { id: "cnDemand", name: "国内实物需求", value: 0, weight: 1.25, note: "节庆、金饰、金条与 ETF 需求" },
    { id: "cny", name: "人民币强弱", value: 0, weight: 1.15, note: "人民币走弱通常抬高国内克价" },
    { id: "sgeMomentum", name: "沪金趋势动量", value: 0, weight: 1.35, note: "真实日线与均线结构动态计算" },
    { id: "premium", name: "内外盘溢价", value: 0, weight: 1.05, note: "国内相对国际折算价的偏离" },
    { id: "centralBanks", name: "央行购金", value: 0, weight: 0.95, note: "中长期结构性需求" },
    { id: "realRates", name: "海外实际利率", value: 0, weight: 0.85, note: "实际利率上行通常压制金价" },
    { id: "usd", name: "美元方向", value: 0, weight: 0.72, note: "国际金价的外部定价条件" },
    { id: "risk", name: "避险情绪", value: 0, weight: 0.92, note: "地缘、金融与流动性风险" },
    { id: "positioning", name: "市场拥挤度", value: 0, weight: 0.68, note: "过度拥挤会放大回撤" }
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
    quote: normalizeQuote(Object.assign({}, DATA.market || fallbackQuote(), { dataTier: "snapshot" })),
    history: normalizeHistory(DATA.history),
    news: normalizeNews(DATA.news),
    factors: DEFAULT_FACTORS.map(function (item) { return Object.assign({}, item); }),
    forecasts: [],
    forecastHorizon: 1,
    factorGroup: "market",
    factorOverrides: {},
    sourceHealth: [],
    refreshing: false,
    quoteGeneration: 0,
    pollRemaining: 60,
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
    aiReportKey: null,
    resizeTimer: null
  };

  function $(id) {
    return document.getElementById(id);
  }

  function fallbackQuote() {
    return { priceCnyGram: 0, previousCnyGram: 0, asOf: null, source: "暂无有效行情", dataTier: "snapshot", contracts: [] };
  }

  function loadConfig() {
    try {
      var saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
      var config = Object.assign({}, DEFAULT_CONFIG, saved);
      config.refreshSeconds = clamp(number(config.refreshSeconds,60),30,3600);
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
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(value)); }
    catch (error) { showToast("设置仅在本次页面生效", "浏览器无法写入本机存储。", "error"); }
  }

  function loadPortfolio() {
    try {
      portfolioSignature = localStorage.getItem(PORTFOLIO_KEY);
      return portfolioSignature ? Core.validatePortfolio(JSON.parse(portfolioSignature)) : Core.emptyPortfolio();
    } catch (error) {
      portfolioReadFailed = true;
      storageNotice = "本机账户读取失败，原记录未覆盖。请先备份浏览器数据，再恢复有效账户。";
      return Core.emptyPortfolio();
    }
  }

  function savePortfolio(next, replaceInvalid) {
    if (portfolioReadFailed && !replaceInvalid) throw new Error("原账户未通过校验，请先保存原始备份，再恢复或重置账户。");
    var current = localStorage.getItem(PORTFOLIO_KEY);
    if (current !== portfolioSignature) throw new Error("另一个页面更新了账户，请刷新后重试。");
    var serialized = JSON.stringify(next || state.portfolio);
    localStorage.setItem(PORTFOLIO_KEY, serialized);
    portfolioSignature = serialized;
    portfolioReadFailed = false;
  }

  function normalizeQuote(raw) { return Core.normalizeQuote(raw);
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

  function normalizePoints(points) { return Core.normalizePoints(points);
  }

  function effectiveDaily() { return Core.chartHistory(state.history.daily, state.quote);
  }

  function normalizeNews(raw) {
    var items = raw && Array.isArray(raw.items) ? raw.items : [];
    return {
      generatedAt: validDate(raw && raw.generatedAt || new Date(0).toISOString()),
      failedSources: raw && Array.isArray(raw.failedSources) ? raw.failedSources.map(String) : [],
      items: items.map(function (item, index) {
        return {
          id: String(item.id || "news-" + index),
          source: String(item.source || "官方消息"),
          title: String(item.title || "未命名消息"),
          summary: String(item.summary || ""),
          url: safeUrl(item.url),
          publishedAt: Core.timestamp(item.publishedAt),
          impact: ["bullish", "bearish", "mixed", "neutral"].includes(item.impact) ? item.impact : "neutral",
          weight: clamp(number(item.weight, 42), 0, 100),
          category: inferNewsCategory(item)
        };
      }).filter(function(item){ return item.publishedAt && Core.ageHours(item.publishedAt) !== Infinity; }).sort(function(a,b){ return Date.parse(b.publishedAt)-Date.parse(a.publishedAt); })
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
    if (settled[0].status === "fulfilled") state.quote = normalizeQuote(Object.assign({}, settled[0].value, { dataTier: "snapshot" }));
    if (settled[1].status === "fulfilled") state.history = normalizeHistory(settled[1].value);
    if (settled[2].status === "fulfilled") state.news = normalizeNews(settled[2].value);
  }

  async function fetchJson(url) {
    var response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }

  async function refreshQuote(options) {
    options = options || {};
    if (state.refreshing) return;
    state.refreshing = true;
    var generation = ++state.quoteGeneration;
    state.pollRemaining = Math.max(30, number(state.config.refreshSeconds, 60));
    $("refreshBtn").classList.add("loading");
    state.sourceHealth = [];

    var previousPrice = state.quote.priceCnyGram;
    var nextQuote;
    try {
      if (state.config.priceProvider === "manual") {
        nextQuote = manualQuote();
        state.sourceHealth.push({ name: "手动校准", ok: true });
      } else if (state.config.priceProvider === "snapshot") {
        nextQuote = normalizeQuote(Object.assign({}, DATA.market || state.quote, { dataTier: "snapshot" }));
        nextQuote.fetchedAt = new Date().toISOString();
        state.sourceHealth.push({ name: "本地快照", ok: true });
      } else {
        nextQuote = await fetchDomesticQuote(generation);
      }
      if (generation !== state.quoteGeneration) return;
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
      if (generation !== state.quoteGeneration) return;
      state.sourceHealth.push({ name: "行情链路", ok: false, error: error.message });
      state.lastPollAt = new Date();
      renderStatus();
      showToast("行情刷新失败", error.message || "已保留上一笔有效行情", "error");
    } finally {
      if (generation !== state.quoteGeneration) return;
      state.refreshing = false;
      $("refreshBtn").classList.remove("loading");
    }
  }

  async function fetchDomesticQuote(generation) {
    var attempts = [
      ["东方财富 AU9999", fetchEastmoneyLiveQuote],
      ["新浪 SGE_AU9999", fetchSinaLiveQuote],
      ["部署快照", fetchLatestSnapshot]
    ];
    var errors = [];
    for (var index = 0; index < attempts.length; index += 1) {
      try {
        var result = await attempts[index][1]();
        if (index < 2) {
          result = validateBrowserQuote(result);
          if (Core.ageHours(result.asOf) > 36) throw new Error("行情时间过期或无效");
        }
        if (generation !== state.quoteGeneration) throw new Error("行情设置已改变");
        state.sourceHealth.push({ name: attempts[index][0], ok: true });
        return result;
      } catch (error) {
        if (generation !== state.quoteGeneration) throw error;
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
    if (!(quote.priceCnyGram > 0) || !Core.timestamp(quote.asOf) || Core.ageHours(quote.asOf) === Infinity) throw new Error("报价或时间无效");
    var baseline = DATA.market || {}, check = baseline.validation;
    if (!check || Core.ageHours(check.checkedAt) > 12 || Core.ageHours(baseline.asOf) > 12) return quote;
    if (Math.abs(Date.parse(quote.asOf) - Date.parse(baseline.asOf)) > 8 * 3600000) return quote;
    var official = Core.numeric(check.officialPriceCnyGram);
    if (!(official > 0)) return quote;
    var difference = (quote.priceCnyGram / official - 1) * 100;
    if (Math.abs(difference) > 2.5) throw new Error("与同时间窗口官方校验价偏差较大");
    quote.validation = Object.assign({}, check, { differencePct: difference });
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
      usdCny: state.quote.usdCny, fxAsOf: state.quote.fxAsOf,
      internationalReference: state.quote.internationalReference || DATA.market && DATA.market.internationalReference
    };
  }

  async function fetchLatestSnapshot() {
    if (location.protocol === "file:") throw new Error("本地文件模式使用内嵌快照");
    var raw = await fetchJson("data/market-snapshot.json?_=" + Date.now());
    var quote = normalizeQuote(raw);
    quote.fetchedAt = new Date().toISOString();
    quote.dataTier = "snapshot";
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
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return new Date(seconds * 1000).toISOString();
  }

  function sinaTime(value) {
    var match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) return null;
    return new Date(
      match[1] + "-" + match[2] + "-" + match[3] + "T" +
      match[4] + ":" + match[5] + ":" + match[6] + "+08:00"
    ).toISOString();
  }

  function normalizeSymbol(symbol) {
    return String(symbol || "").replace(/[().+\-\s]/g, "").toUpperCase();
  }

  function syncDynamicFactors() {
    var history = state.history.daily;
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
    if (factor && !state.factorOverrides[id]) factor.value = Math.round(value);
  }

  function factorScore() {
    var weighted = state.factors.reduce(function (sum, item) {
      return sum + item.value * item.weight;
    }, 0);
    var totalWeight = state.factors.reduce(function (sum, item) { return sum + item.weight; }, 0);
    return clamp(weighted / totalWeight, -100, 100);
  }

  function buildForecasts() {
    state.scenarioModel = Core.scenarioModel(state.quote.priceCnyGram, state.history.daily, factorScore());
    state.forecasts = state.scenarioModel.points;
  }

  function dailyVolatility() { return Core.volatility(state.history.daily);
  }

  function annualVolatility() {
    return dailyVolatility() * Math.sqrt(252) * 100;
  }

  function historyMomentum(days) { return Core.momentum(state.history.daily, days);
  }

  function computeRsi(days) {
    var points = state.history.daily.slice(-(days + 1));
    if (points.length < days + 1) return NaN;
    var gains = 0;
    var losses = 0;
    for (var index = 1; index < points.length; index += 1) {
      var change = points[index].close - points[index - 1].close;
      if (change >= 0) gains += change;
      else losses -= change;
    }
    if (losses === 0) return gains === 0 ? 50 : 100;
    var relativeStrength = (gains / days) / (losses / days);
    return 100 - 100 / (1 + relativeStrength);
  }

  function portfolioStats() { return Core.portfolioStats(state.portfolio, state.quote.priceCnyGram);
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
    var stats = portfolioStats(), vol = annualVolatility();
    var volatility = Number.isFinite(vol) ? clamp((vol - 8) * 1.55, 0, 45) : 18;
    return Math.round(clamp(10 + volatility + clamp(stats.allocation * .45, 0, 35) + (Core.quoteState(state.quote).stale ? 18 : 0), 5, 96));
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
    syncAdviceContext();
    drawAllCharts();
    window.AurumJournal?.render();
  }

  function renderStatus() {
    var session = marketSession(new Date()), quality = Core.quoteState(state.quote);
    setText("sessionLabel", session.label); setText("sessionDetail", "常规时段估计 · 节假日以交易所公告为准");
    $("liveBeacon").className = "live-beacon " + (quality.key === "live" ? "open" : "closed");
    setText("quoteClock", state.quote.asOf ? formatDateTime(state.quote.asOf) : "时间未知");
    setText("sideSource", shortSource(state.quote.source)); setText("sideHealth", sourceHealthText());
    var banner = $("statusBanner");
    banner.classList.toggle("hidden", !quality.stale && !state.refreshing && quality.key === "live");
    setText("statusBannerText", quality.stale
      ? (state.quote.asOf ? "数据截至 " + formatDateTime(state.quote.asOf) + "，已过去 " + ageText(state.quote.asOf) + "。当前仅供历史观察。" : "尚无可核实的报价时点，请检查数据来源。")
      : state.refreshing ? "正在核对公开行情；报价时间决定数据是否更新。" : "当前为延时行情或部署快照，报价时点见上方。");
    setText("pollLabel", state.refreshing ? "正在刷新" : "下次核对 " + Math.ceil(state.pollRemaining) + "s");
    $("pollProgress").style.transform = "scaleX(" + clamp(state.pollRemaining / Math.max(30, state.config.refreshSeconds), 0, 1) + ")";
    setText("practiceContext", quality.label + (state.quote.asOf ? " · " + formatDateTime(state.quote.asOf) : ""));
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
    var quality = Core.quoteState(quote);
    $("trustBadge").innerHTML = '<svg><use href="#i-clock"></use></svg><span>' + escapeHtml(quality.label) + '</span>';
    $("priceEvent").textContent = quality.stale ? "保留原报价时点" : quoteEventText(options.previousPrice, quote.priceCnyGram);
    $("lastChanged").textContent = quote.asOf ? formatDateTime(quote.asOf) : "时间未知";
  }

  function animatePrice(element, from, to, enabled) {
    cancelAnimationFrame(element.__animationFrame);
    element.textContent = to > 0 ? toFixedPrice(to) : "—";
    if (enabled && Number.isFinite(from) && Math.abs(to-from) > .001) window.AurumUI.animate(element,[{opacity:.4,transform:"translateY(3px)"},{opacity:1,transform:"translateY(0)"}],240);
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
    var html = items.map(function (item) {
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
    $("sparkCanvas").setAttribute("aria-label", state.history.intraday.length > 5 ? "有效五分钟行情" : "最近二十个交易日的真实收盘价");
    setText("pulseLegend", state.history.intraday.length > 5 ? "5 分钟线 · 截至 " + state.history.intraday[state.history.intraday.length - 1].time : state.history.daily.length > 5 ? "近 20 个交易日收盘 · 截至 " + state.history.daily[state.history.daily.length - 1].time : "暂无有效短周期数据");
  }

  function renderHistoryMetrics() {
    var effective = state.history.daily;
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
      ? state.history.source + " · " + state.history.daily.length + " 个日线点 · 截至 " + state.history.daily[state.history.daily.length - 1].time
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
      : "暂不作跨时点比较");
    setText("premiumExplain", Number.isFinite(premium) && Math.abs(premium) > 4 ? "偏离较大，注意回归风险" : state.quote.premiumNote);
    setText("premiumScore", Number.isFinite(premium) ? signedNumber(premiumScore) : "—");
    $("premiumScore").className = "signal-score " + (premiumScore >= 0 ? "up-text" : "down-text");

    var risk = riskScore();
    setText("riskSignal", risk < 38 ? "风险偏低" : risk < 66 ? "风险中等" : "风险偏高");
    setText("riskExplain", "规则评分：波动、数据年龄与模拟仓位");
    setText("riskScore", risk + "/100");
    $("riskScore").className = "signal-score " + (risk < 45 ? "up-text" : risk > 65 ? "down-text" : "");
  }

  function renderForecasts() {
    var container = $("forecastCards"), buttons = container.querySelectorAll("[data-horizon]");
    if (state.forecasts.length && buttons.length !== state.forecasts.length) {
      container.innerHTML = state.forecasts.map(function (_, index) {
        return '<button type="button" class="forecast-card" data-horizon="'+index+'"><span class="forecast-top"><span></span><b></b></span><strong></strong><span class="forecast-range"><span></span><span></span></span><span class="forecast-rail" aria-hidden="true"><i></i></span><small></small></button>';
      }).join("");
      buttons = container.querySelectorAll("[data-horizon]");
    }
    function updateText(el, value) { if (el.textContent !== value) el.textContent = value; }
    state.forecasts.forEach(function (f, index) {
      var button = buttons[index], selected = index === state.forecastHorizon;
      button.classList.toggle("selected", selected); button.setAttribute("aria-pressed", String(selected));
      updateText(button.querySelector(".forecast-top>span"), f.label);
      updateText(button.querySelector(".forecast-top>b"), f.stance);
      updateText(button.querySelector(":scope>strong"), toFixedPrice(f.center));
      var range = button.querySelectorAll(".forecast-range>span");
      updateText(range[0], toFixedPrice(f.low)); updateText(range[1], toFixedPrice(f.high));
      button.querySelector(".forecast-rail>i").style.left = clamp((f.center-f.low)/Math.max(.01,f.high-f.low)*100,0,100) + "%";
      updateText(button.querySelector(":scope>small"), selected ? "当前观察周期" : "查看这一周期");
    });
    if (!state.forecasts.length && !container.querySelector(".forecast-empty")) container.innerHTML = '<div class="panel forecast-empty">有效日线不足 30 个，暂不推演情景。</div>';
    var focus = state.forecasts[state.forecastHorizon];
    $("captureScenario").disabled = !focus || !state.quote.asOf;
    $("scenarioFocus").innerHTML = focus ? '<div><span>当前观察 · '+focus.label+'</span><strong>'+toFixedPrice(focus.center)+'<small>元 / 克</small></strong></div><p>波动情景带 <b>'+toFixedPrice(focus.low)+' — '+toFixedPrice(focus.high)+'</b><small>假设区间 · 未经概率校准</small></p>' : '';
    setText("bullProbability", "上界"); setText("baseProbability", "路径"); setText("bearProbability", "下界");
    var score = factorScore(); setText("factorTotal", signedNumber(Math.round(score)));
    var nonNeutral = state.factors.filter(function (f) { return f.id !== "sgeMomentum" && f.value !== 0; }).length;
    setText("factorOverview", (state.factorOverrides.sgeMomentum ? "动量假设 " : "历史动量 ") + signedNumber(getFactor("sgeMomentum")) + " · " + (nonNeutral ? "另有 " + nonNeutral + " 项非中性假设" : "其余驱动保持中性"));
    setText("stanceTitle", score > 20 ? "偏强假设，观察条件变化" : score < -20 ? "偏弱假设，关注承受范围" : "保持中性，比较不同路径");
    setText("stanceSummary", focus ? forecastSummary(focus, score) : "补齐有效历史与报价后再作推演。");
    $("confidenceRing").querySelector("b").textContent = "未校准";
    $("actionList").innerHTML = strategyActions().map(function (a) { return '<li>' + escapeHtml(a) + '</li>'; }).join("");
    $("useStrategyBtn").disabled = !state.forecasts.length;
  }

  function forecastSummary(forecast, score) {
    return "在当前假设下，" + forecast.label + "基准路径为 " + money(forecast.center) + "，波动情景带为 " + money(forecast.low) + " 至 " + money(forecast.high) + "。它不代表命中概率。";
  }

  function strategyActions() {
    var quality = Core.quoteState(state.quote);
    return [
      quality.stale ? "先核实报价时间；当前是历史输入，情景也以该时点为起点。" : "先核对来源与报价时点，再比较趋势和波动。",
      "改变一项因子，观察各周期区间怎样变化；宏观因子默认中性。",
      "模拟单笔上限设为权益的 " + state.config.maxPosition + "%，费用、价差与仓位一并计算。",
      "记录假设与复盘条件；止损 " + state.config.stopLoss + "% 与止盈 " + state.config.takeProfit + "% 是自设提醒，不会自动成交。"
    ];
  }

  function renderFactors() {
    var groups = { sgeMomentum: "market", risk: "market", positioning: "market", cnDemand: "domestic", cny: "domestic", premium: "domestic", centralBanks: "macro", realRates: "macro", usd: "macro" };
    if ($("factorGrid").children.length === state.factors.length) {
      state.factors.forEach(function (factor) {
        var input = $("factor-" + factor.id);
        if (document.activeElement !== input) input.value = factor.value;
        input.style.setProperty("--factor-fill", (factor.value+100)/2 + "%");
        $("out-" + factor.id).textContent = signedNumber(factor.value);
        $("note-" + factor.id).textContent = (state.factorOverrides[factor.id] ? "手动假设 · " : "") + factor.note;
      });
      return;
    }
    $("factorGrid").innerHTML = state.factors.map(function (factor) {
      return '<div class="factor-item" data-group="' + groups[factor.id] + '"' + (groups[factor.id] !== state.factorGroup ? ' hidden' : '') + '><div class="factor-label"><label for="factor-' + factor.id + '">' +
        escapeHtml(factor.name) + '</label><small id="note-' + factor.id + '">' + escapeHtml(factor.note) + '</small></div><input id="factor-' + factor.id +
        '" type="range" min="-100" max="100" step="1" value="' + factor.value +
        '" data-factor="' + factor.id + '" aria-describedby="note-' + factor.id + '" style="--factor-fill:' + (factor.value+100)/2 + '%"><output for="factor-' + factor.id + '" id="out-' + factor.id + '">' + signedNumber(factor.value) + '</output></div>';
    }).join("");
    document.querySelectorAll("[data-factor]").forEach(function (input) {
      input.addEventListener("input", function () {
        var factor = state.factors.find(function (item) { return item.id === input.dataset.factor; });
        if (!factor) return;
        factor.value = number(input.value, 0);
        state.factorOverrides[factor.id] = true;
        input.style.setProperty("--factor-fill", (factor.value+100)/2 + "%");
        $("out-" + factor.id).textContent = signedNumber(factor.value);
        if (state.factorFrame) return;
        state.factorFrame = requestAnimationFrame(function () {
          state.factorFrame = 0;
          buildForecasts();
          renderForecasts();
          renderHistoryMetrics();
          renderDecisionContext();
          syncAdviceContext();
          drawForecastChart();
          drawPriceChart();
        });
      });
    });
  }

  function selectFactorGroup(group, focus) {
    if (!["market", "domestic", "macro"].includes(group)) return;
    state.factorGroup = group;
    document.querySelectorAll("[data-factor-group]").forEach(function (button) {
      var selected = button.dataset.factorGroup === group;
      button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus({preventScroll:true});
    });
    $("factorGrid").setAttribute("aria-labelledby", "factor-tab-" + group);
    document.querySelectorAll("#factorGrid [data-group]").forEach(function (row) { row.hidden = row.dataset.group !== group; });
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
    $("equityAllocationBar").style.width = clamp(stats.allocation,0,100) + "%";
    setText("equityComposition", "现金 " + Math.max(0,100-stats.allocation).toFixed(1) + "% · 黄金 " + stats.allocation.toFixed(1) + "%");
    setText("allocationNote", portfolio.grams ? "当前持仓 " + portfolio.grams.toFixed(2) + "g，参考成本 " + money(portfolio.avgCost) + "。" : "目前全部为现金。设置数量后，可先查看订单将怎样改变仓位。");
    setText("positionUse", stats.allocation.toFixed(1) + "%");
    $("positionBar").style.width = clamp(stats.allocation, 0, 100) + "%";
    var risk = riskScore();
    $("riskGrade").textContent = risk < 38 ? "LOW" : risk < 66 ? "MEDIUM" : "HIGH";
    $("riskGrade").className = "risk-grade " + (risk < 38 ? "" : risk < 66 ? "medium" : "high");
    setText("maxOrderValue", cny(stats.equity * state.config.maxPosition / 100));
    setText("stopPrice", portfolio.avgCost ? money(portfolio.avgCost * (1 - state.config.stopLoss / 100)) : "--");
    setText("takePrice", portfolio.avgCost ? money(portfolio.avgCost * (1 + state.config.takeProfit / 100)) : "--");
    var sellRatio = state.quote.priceCnyGram ? executionPrice("sell") / state.quote.priceCnyGram : 0;
    var netRatio = sellRatio * (1 - Math.max(0, number($("feeRate").value,0))/100);
    setText("breakEvenPrice", portfolio.avgCost && netRatio > 0 ? money(portfolio.avgCost / netRatio) : "--");
    setText("tradeCount", portfolio.trades.length + " 笔成交");

    $("tradeRows").innerHTML = portfolio.trades.length ? portfolio.trades.slice(0,200).map(function(t) {
      var mode=t.dataMode === "historical-practice" ? "历史练习" : t.dataMode === "manual" ? "假设价格" : t.dataMode ? "行情练习" : "旧版记录";
      return "<tr><td>"+escapeHtml(formatDateTime(t.createdAt))+"</td><td><span class='trade-side "+t.side+"'>"+(t.side==="buy"?"买入":"卖出")+"</span></td><td>"+number(t.grams,0).toFixed(2)+"g</td><td>"+money(t.price)+"</td><td>"+cnyPrecise(t.fee)+"</td><td>"+cnyPrecise(t.value)+"</td><td>"+escapeHtml(t.note||"—")+"</td><td>"+escapeHtml(t.quoteAsOf?formatDateTime(t.quoteAsOf):"旧版未记录")+"</td><td>"+mode+"</td></tr>";
    }).join("") : '<tr class="empty-row"><td colspan="9"><div class="ledger-empty"><span class="empty-mark" aria-hidden="true">↗</span><strong>第一笔记录，从一个清晰假设开始。</strong><p>设置数量、核对费用与仓位，每次练习都会保留价格时点。</p><a href="#orderTicket" class="text-link">回到模拟委托 ↗</a></div></td></tr>';
    if(portfolio.trades.length>200)setText("tradeCount",portfolio.trades.length+" 笔成交 · 展示最近 200 笔，导出保留全部");
  }

  function renderOrderPreview() {
    var o = currentOrder();
    $("orderValue").previousElementSibling.textContent = state.tradeSide === "buy" ? "预计支付" : "预计净收款";
    setText("ticketPrice", money(o.price)); setText("executionPrice", money(o.price));
    setText("estimatedFee", cnyPrecise(o.fee)); setText("orderValue", cnyPrecise(o.total));
    setText("postPosition", o.valid && Number.isFinite(o.projectedAllocation) ? o.projectedAllocation.toFixed(1) + "%" : "--");
    setText("tradeButtonAmount", cnyPrecise(o.total));
    $("riskChecks").innerHTML = o.checks.map(function (c) { return '<div class="risk-check ' + (c.ok ? '' : 'fail') + '"><span><i></i> ' + escapeHtml(c.label) + '</span><b>' + escapeHtml(c.value) + '</b></div>'; }).join("");
    $("tradeBtn").disabled = !o.valid;
    setText("tradeError", o.valid ? (o.historical ? "历史价格练习；成交将保留原报价时点。" : "") : (o.checks.find(function(c) { return !c.ok; }).label + "：" + o.checks.find(function(c) { return !c.ok; }).value));
  }

  function orderInput() {
    return { side: state.tradeSide, grams: $("tradeGrams").value, feePct: $("feeRate").value, spreadPct: $("tradeSpread").value, note: $("tradeNote").value, historical: $("historicalPractice").checked };
  }

  function currentOrder() {
    return Core.order(state.portfolio, state.quote, state.config, orderInput());
  }

  function orderRiskChecks() { return currentOrder().checks;
  }

  function executeTrade() {
    try {
      var next = Core.execute(state.portfolio, state.quote, state.config, orderInput());
      savePortfolio(next); state.portfolio = next;
      $("tradeNote").value = "";
      renderPortfolio(); renderOrderPreview(); renderHistoryMetrics(); renderDecisionContext(); drawAllocationChart();
      showToast("练习已记录", "成交、费用与报价时点已保存到本机。");
    } catch (error) { setText("tradeError", error.message); showToast("订单未保存", error.message, "error"); }
  }

  function renderIntelligence() {
    var items = mergedNews();
    var filtered = items.filter(function (item) {
      if (state.newsFilter === "all") return true;
      if (state.newsFilter === "high") return item.weight >= 60;
      return item.category === state.newsFilter;
    }).slice(0, 14);
    $("newsFreshness").textContent = "官方资讯截至 " + (state.news.items.length ? formatDateTime(state.news.items[0].publishedAt) : "暂无有效条目") + (state.news.failedSources.length ? " · 部分源暂不可用" : "");
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
    var relevant = state.news.items;
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
        title: "AU9999 报价记录 " + money(quote.priceCnyGram) + "，日内振幅 " +
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
    ].filter(function (item) { return item.publishedAt && Core.ageHours(item.publishedAt) !== Infinity; });
  }

  function renderNewsItem(item) {
    var time = new Date(item.publishedAt);
    var label = {
      bullish: "规则偏多",
      bearish: "规则偏空",
      mixed: "待核实",
      neutral: "中性"
    }[item.impact] || "中性";
    return '<a class="news-item" href="' + safeUrl(item.url) +
      '" target="_blank" rel="noreferrer"><time>' + escapeHtml(formatShortDate(time)) +
      "</time><div><strong>" + escapeHtml(item.title) + "</strong><p>" +
      escapeHtml(item.source + " · " + item.summary) + "</p></div><span class=\"news-meta\"><b class=\"impact-tag " +
      item.impact + '">' + label + "</b><svg><use href=\"#i-external\"></use></svg></span></a>";
  }

  function renderImpactMap(items) {
    items = items.filter(function(item){ return Core.ageHours(item.publishedAt) <= 14 * 24; });
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
    var forecast = state.forecasts[state.forecastHorizon] || {};
    var context = [
      ["国内主价", money(state.quote.priceCnyGram)],
      ["数据层级", dataTierLabel(state.quote)],
      ["真实历史", state.history.daily.length + " 日"],
      [(forecast.label || "所选周期") + "中枢", forecast.center ? money(forecast.center) : "--"],
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

  function reportContextKey() {
    return JSON.stringify({ price: state.quote.priceCnyGram, asOf: state.quote.asOf,
      horizon: state.forecastHorizon, factors: state.factors.map(function(f){return [f.id,f.value];}),
      cash: state.portfolio.cash, grams: state.portfolio.grams, cost: state.portfolio.avgCost,
      risk: [state.config.maxPosition,state.config.stopLoss,state.config.takeProfit],
      history: [state.history.daily.length,state.history.daily.slice(-1)[0]], prompt: state.promptType,
      news: mergedNews().slice(0,8).map(function(n){return [n.title,n.publishedAt];}) });
  }
  function syncAdviceContext() {
    if (state.aiReportMode === "external") {
      $("aiHeadline").textContent = state.aiReportKey === reportContextKey() ? state.aiReportHeadline : "已生成的研究报告 · 输入已变化，请重新生成";
      return;
    }
    renderLocalAdvice();
  }

  function renderLocalAdvice() {
    state.aiReportMode = "local";
    if (!state.forecasts.length) { $("aiHeadline").textContent="有效输入不足"; $("aiOutput").innerHTML="<h3>先补齐研究依据</h3><p>需要有效报价和至少 30 个日线点，才能生成情景摘要。</p>"; return; }
    var forecast = state.forecasts[state.forecastHorizon];
    var stats = portfolioStats();
    var actions = strategyActions();
    var stance = factorScore() > 20 ? "谨慎偏多" : factorScore() < -20 ? "防守偏空" : "中性震荡";
    $("aiHeadline").textContent = "本地研究笔记 · " + stance;
    $("aiOutput").innerHTML =
      "<h3>输入与假设</h3><p>报价时点 " + escapeHtml(state.quote.asOf ? formatDateTime(state.quote.asOf) : "未知") + "，AU9999 为 <strong>" + money(state.quote.priceCnyGram) +
      "</strong>，综合因子为 <strong>" + signedNumber(Math.round(factorScore())) +
      "</strong>，假设倾向 <strong>" + stance + "</strong>。</p>" +
      '<div class="report-grid"><div><span>' + escapeHtml(forecast.label) + '中枢</span><strong>' + money(forecast.center) +
      '</strong></div><div><span>波动情景带</span><strong>' + money(forecast.low) + " - " +
      money(forecast.high) + '</strong></div><div><span>当前仓位</span><strong>' +
      stats.allocation.toFixed(1) + "%</strong></div></div>" +
      "<h3>观察与练习</h3><ol>" + actions.map(function (action) {
        return "<li>" + escapeHtml(action) + "</li>";
      }).join("") + "</ol>" +
      "<h3>风险提示</h3><p>公开行情可能延迟；预测是假设情景，不是收益承诺。真实交易前应复核交易终端报价、流动性与个人风险承受能力。</p>";
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
      var inputContext = aiPayload(), inputKey = reportContextKey(), inputProvider = state.config.aiProvider + " · " + state.config.aiModel;
      var response = await fetch(state.config.aiEndpoint.trim(), {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + state.config.aiApiKey.trim()
        },
        body: JSON.stringify({
          model: state.config.aiModel.trim() || "gpt-5",
          messages: [
            {
              role: "system",
              content: "你是谨慎的国内黄金市场研究助手。必须优先使用 AU9999 人民币/克、真实历史、国内因素、数据年龄和用户模拟仓位。禁止编造概率、置信度、实时宏观值或买卖指令。区分已知事实与手动假设，引用输入时间，输出待核实事项与复盘条件。"
            },
            {
              role: "user",
              content: JSON.stringify(inputContext, null, 2)
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
      state.aiReportMode = "external"; state.aiReportKey = inputKey;
      renderExternalAdvice(text);
      state.aiReportHeadline = inputProvider + " · 输入截至 " + formatDateTime(inputContext.quote.asOf);
      $("aiHeadline").textContent = state.aiReportHeadline;
      syncAdviceContext();
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
      selectedHorizon: state.forecasts[state.forecastHorizon],
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
    var pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(cssHeight * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    var context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, cssHeight);
    return { ctx: context, width: width, height: cssHeight, dpr: dpr };
  }

  function drawSparkChart() {
    if ($( "sparkCanvas" ).closest("[hidden]")) return;
    var canvas = $("sparkCanvas");
    var setup = setupCanvas(canvas, 154);
    var ctx = setup.ctx;
    var width = setup.width;
    var height = setup.height;
    var values;
    if (state.history.intraday.length > 5) {
      values = state.history.intraday.slice(-120).map(function (point) { return point.close; });
    } else if (state.history.daily.length > 5) {
      values = state.history.daily.slice(-20).map(function(point){ return point.close; });
    } else {
      drawEmptyCanvas(ctx, width, height, "暂无有效短周期数据");
      return;
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
    drawSmoothLine(ctx, points, "#dcc080", 1.7);
    var last = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#ecd398";
    ctx.shadowColor = "#dcc080";
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawPriceChart() {
    if ($( "priceCanvas" ).closest("[hidden]")) return;
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
    var showForecast = state.chartIndicators.forecast && state.scenarioModel && state.scenarioModel.ready;
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
      ctx.fillStyle = "#ccb57d";
      ctx.font = "11px Noto Sans SC, sans-serif";
      ctx.fillText("SCENARIO", splitX + 8, pad.top + 12);
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
    drawSmoothLine(ctx, pricePoints, "#dcc080", 1.65);

    if (state.chartIndicators.ma20) {
      drawSeriesLine(ctx, ma20, xHistory, y, "#9cb7a7", 1.05);
    }
    if (state.chartIndicators.ma60) {
      drawSeriesLine(ctx, ma60, xHistory, y, "#baa3c5", 1.05);
    }

    var last = pricePoints[pricePoints.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#ecd398";
    ctx.fill();
    drawChartHover(ctx, pad, plotBottom);
  }

  function drawGrid(ctx, width, height, pad, min, max, y) {
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "left";
    for (var index = 0; index <= 4; index += 1) {
      var value = min + (max - min) * (1 - index / 4);
      var lineY = y(value);
      ctx.strokeStyle = "rgba(194, 193, 158, .12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, lineY);
      ctx.lineTo(width - pad.right, lineY);
      ctx.stroke();
      ctx.fillStyle = "#a7b29b";
      ctx.fillText(value.toFixed(0), width - pad.right + 8, lineY + 3);
    }
  }

  function buildChartForecast(start, days) {
    var m = state.scenarioModel;
    if (!m || !m.ready) return [];
    return Array.from({ length: days + 1 }, function (_, i) { return Core.scenarioAt(start, i, m.vol, m.drift); });
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
    ctx.strokeStyle = "rgba(223, 194, 130, .8)";
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
    ctx.strokeStyle = "#ecd398";
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
    if ($( "forecastCanvas" ).closest("[hidden]")) return;
    var canvas = $("forecastCanvas");
    var setup = setupCanvas(canvas, 320);
    var ctx = setup.ctx;
    var width = setup.width;
    var height = setup.height;
    if (!state.forecasts.length) { drawEmptyCanvas(ctx, width, height, "有效输入不足，暂不推演"); return; }
    var pad = { top: 28, right: 48, bottom: 42, left: 44 };
    var points = [{ label: "起点", days: 0, center: state.quote.priceCnyGram, low: state.quote.priceCnyGram, high: state.quote.priceCnyGram }]
      .concat(state.forecasts);
    var min = Math.min.apply(null, points.map(function (point) { return point.low; })) * 0.97;
    var max = Math.max.apply(null, points.map(function (point) { return point.high; })) * 1.03;
    var x = function (index) {
      return pad.left + Math.sqrt(points[index].days / 1095) * (width - pad.left - pad.right);
    };
    var y = function (value) {
      return pad.top + (max - value) / (max - min) * (height - pad.top - pad.bottom);
    };
    for (var grid = 0; grid <= 4; grid += 1) {
      var value = min + (max - min) * (1 - grid / 4);
      var gy = y(value);
      ctx.strokeStyle = "rgba(194, 193, 158, .12)";
      ctx.beginPath();
      ctx.moveTo(pad.left, gy);
      ctx.lineTo(width - pad.right, gy);
      ctx.stroke();
      ctx.fillStyle = "#a7b29b";
      ctx.font = "11px Inter, sans-serif";
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
    ctx.strokeStyle = "#dcc080";
    ctx.lineWidth = 1.7;
    ctx.stroke();
    var selectedIndex = state.forecastHorizon + 1;
    var selectedPoint = points[selectedIndex];
    if (selectedPoint) {
      var sx = x(selectedIndex), highY = y(selectedPoint.high), lowY = y(selectedPoint.low);
      ctx.fillStyle = "rgba(217,190,127,.07)";
      ctx.fillRect(sx-12,pad.top,24,height-pad.top-pad.bottom);
      ctx.strokeStyle = "rgba(229,203,148,.6)";
      ctx.lineWidth = 1;ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(sx,pad.top);ctx.lineTo(sx,height-pad.bottom);ctx.stroke();ctx.setLineDash([]);
      ctx.lineWidth = 2;ctx.strokeStyle = "#dcc080";ctx.beginPath();ctx.moveTo(sx,highY);ctx.lineTo(sx,lowY);ctx.stroke();
      [highY,lowY].forEach(function(py){ctx.beginPath();ctx.moveTo(sx-4,py);ctx.lineTo(sx+4,py);ctx.stroke();});
      ctx.beginPath();ctx.arc(sx,y(selectedPoint.center),5,0,Math.PI*2);ctx.fillStyle="#e9d2a0";ctx.fill();
    }
    var labelBounds = [];
    ctx.font = "11px Noto Sans SC, sans-serif";
    var labelOrder = [selectedIndex,points.length-1,0].concat(points.map(function(_,i){return i;}));
    var visibleLabels = new Set();
    labelOrder.forEach(function(index){
      if (visibleLabels.has(index)) return;
      var point=points[index];if(!point)return;
      var half=ctx.measureText(point.label).width/2, left=x(index)-half, right=x(index)+half;
      if(labelBounds.some(function(b){return left<b.right+9&&right>b.left-9;}))return;
      labelBounds.push({left:left,right:right});visibleLabels.add(index);
    });
    points.forEach(function (point, index) {
      ctx.beginPath();
      ctx.arc(x(index), y(point.center), 3, 0, Math.PI * 2);
      ctx.fillStyle = index === 0 ? "#b8cbb1" : "#dcc080";
      ctx.fill();
      ctx.fillStyle = index === selectedIndex ? "#ecd7a6" : "#b2b99f";
      ctx.font = "11px Noto Sans SC, sans-serif";
      ctx.textAlign = "center";
      if(visibleLabels.has(index))ctx.fillText(point.label, x(index), height - 18);
    });
  }

  function drawAllocationChart() {
    if ($( "allocationCanvas" ).closest("[hidden]")) return;
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
    ctx.strokeStyle = "#283020";
    ctx.stroke();
    var fraction = clamp(stats.allocation / 100, 0, 1);
    if (fraction > 0) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fraction);
      ctx.strokeStyle = "#dcc080";
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(232, 186, 93, .25)";
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineCap = "butt";
    }
    ctx.fillStyle = "#a7b29b";
    ctx.font = "11px Noto Sans SC, sans-serif";
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
    ctx.fillStyle = "#a7b29b";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(message, width / 2, height / 2);
  }

  function bindEvents() {
    $("resetAssumptions").addEventListener("click", function () {
      state.factorOverrides = {}; state.factors.forEach(function (factor) { factor.value = 0; });
      syncDynamicFactors(); buildForecasts(); renderAll();
      showToast("已恢复数据基线", "历史信号重新计算，其他研究假设归零。");
    });
    var factorGroups = ["market", "domestic", "macro"];
    document.querySelectorAll("[data-factor-group]").forEach(function (button) {
      button.addEventListener("click", function () { selectFactorGroup(button.dataset.factorGroup, false); });
      button.addEventListener("keydown", function (event) {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        var index = factorGroups.indexOf(state.factorGroup);
        var next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : -1) + 3) % 3;
        selectFactorGroup(factorGroups[next], true);
      });
    });
    $("forecastCards").addEventListener("keydown", function(event) {
      if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
      var buttons = Array.from($("forecastCards").querySelectorAll("[data-horizon]"));
      var index = buttons.indexOf(event.target.closest("[data-horizon]"));
      if (index < 0) return;
      event.preventDefault();
      var next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length-1 : (index+(event.key==="ArrowRight"?1:-1)+buttons.length)%buttons.length;
      buttons[next].click();
      var selected = $("forecastCards").querySelector('[data-horizon="'+next+'"]');
      selected.focus({preventScroll:true});
      var container = $("forecastCards");
      if (container.scrollWidth > container.clientWidth) container.scrollTo({left:selected.offsetLeft-container.offsetLeft-8,behavior:"auto"});
    });
    $("forecastCards").addEventListener("click", function(event) {
      var button = event.target.closest("[data-horizon]");
      if (!button) return;
      var index = Number(button.dataset.horizon);
      if (!state.forecasts[index] || index === state.forecastHorizon) return;
      state.forecastHorizon = index;
      renderForecasts(); drawForecastChart(); renderDecisionContext();
      syncAdviceContext();
      $("forecastCards").querySelector('[data-horizon="'+index+'"]').focus({preventScroll:true});
      window.dispatchEvent(new CustomEvent("aurum:horizon"));
    });
    $("historicalPractice").addEventListener("change", renderOrderPreview);
    $("backupAccount").onclick = function () { download("aurum-account-" + new Date().toISOString().slice(0,10) + ".json", JSON.stringify({app:"AURUM",version:1,exportedAt:new Date().toISOString(),portfolio:state.portfolio, unverifiedOriginal:portfolioReadFailed ? portfolioSignature : undefined}, null, 2), "application/json"); };
    $("restoreAccount").onclick = function () { $("accountFile").click(); };
    $("accountFile").onchange = async function (e) {
      var file = e.target.files[0]; if (!file) return;
      try {
        if (file.size > 20 * 1024 * 1024) throw new Error("账户文件超过 20MB");
        var data = JSON.parse(await file.text()), next = Core.validatePortfolio(data.portfolio || data);
        if (!window.confirm("用备份替换本机模拟账户？现有记录将被替换，请确认已备份。")) return;
        savePortfolio(next, true); state.portfolio = next; renderAll(); showToast("账户已恢复", next.trades.length + " 笔练习记录。");
      } catch (error) { showToast("恢复失败", error.message, "error"); }
      finally { e.target.value = ""; }
    };
    document.addEventListener("keydown", function(e) {
      var dialog = document.querySelector(".settings-drawer.open,.confirm-modal.open");
      if (!dialog || e.key !== "Tab") return;
      var all = Array.from(dialog.querySelectorAll("button,input,select,a[href]")).filter(function(el) { return !el.disabled && el.getClientRects().length; });
      var first = all[0], last = all[all.length-1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    $("refreshBtn").addEventListener("click", function () {
      refreshQuote({ manual: true });
    });
    $("dismissBanner").addEventListener("click", function () {
      $("statusBanner").classList.add("hidden");
    });
    $("jumpTrade").addEventListener("click", function () {
      window.AurumUI.go("trading");
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
      if (!state.hoverFrame) state.hoverFrame = requestAnimationFrame(function () { state.hoverFrame = 0; drawPriceChart(); });
    });
    $("priceChartWrap").addEventListener("mouseleave", function () {
      if (state.hoverFrame) cancelAnimationFrame(state.hoverFrame);
      state.hoverFrame = 0;
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
        syncAdviceContext();
      });
    });
    $("generateAdvice").addEventListener("click", generateAdvice);
    $("copyAdvice").addEventListener("click", copyAdvice);
    $("useStrategyBtn").addEventListener("click", function () {
      $("tradeGrams").value = suggestedGrams().toFixed(2);
      window.AurumUI.go("trading");
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
    var chartViewportKey = window.innerWidth + ":" + window.devicePixelRatio;
    window.addEventListener("resize", function () {
      var nextKey = window.innerWidth + ":" + window.devicePixelRatio;
      if (nextKey === chartViewportKey) return;
      chartViewportKey = nextKey;
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
    var budget = Math.min(portfolioStats().equity * state.config.maxPosition / 100, state.portfolio.cash);
    var fee = Math.max(0, number($("feeRate").value, 0)) / 100;
    return Math.max(0, Math.floor((budget - .02) / Math.max(executionPrice("buy") * (1 + fee), 1) * 100) / 100);
  }

  var dialogFocus = null;

  function lockSurface(dialog, opening) {
    if (opening) { dialogFocus = document.activeElement; $("surface").inert = true; dialog.inert = false; dialog.setAttribute("aria-hidden", "false"); }
    else { dialog.inert = true; dialog.setAttribute("aria-hidden", "true"); if (!document.querySelector(".settings-drawer.open,.confirm-modal.open")) { $("surface").inert = false; if (dialogFocus && dialogFocus.isConnected) dialogFocus.focus({preventScroll:true}); } }
  }

  function openSettings() {
    syncSettingsForm();
    lockSurface($("settingsDrawer"), true);
    $("settingsDrawer").classList.add("open");
    $("settingsDrawer").setAttribute("aria-hidden", "false");
    $("drawerBackdrop").classList.add("open");
    document.body.classList.add("drawer-open");
    requestAnimationFrame(function(){ $("closeSettings").focus({preventScroll:true}); });
  }

  function closeSettings() {
    if (!$("settingsDrawer").classList.contains("open")) return;
    $("settingsDrawer").classList.remove("open");
    $("settingsDrawer").setAttribute("aria-hidden", "true");
    $("drawerBackdrop").classList.remove("open");
    document.body.classList.remove("drawer-open");
    lockSurface($("settingsDrawer"), false);
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
    if ($( "priceProvider" ).value === "manual" && !(Core.numeric($("manualPrice").value)>0)) { showToast("请输入手动价格", "手动假设需大于零。", "error"); return; }
    try { var url=new URL($("aiEndpoint").value.trim()||DEFAULT_CONFIG.aiEndpoint); if(url.protocol!=="https:" && !(url.protocol==="http:" && ["localhost","127.0.0.1","[::1]"].includes(url.hostname))) throw new Error("protocol"); }
    catch(error) { showToast("接口地址无效", "请使用 HTTPS 地址或本机开发接口。", "error"); return; }
    var lower=Core.numeric($("alertLower").value,0),upper=Core.numeric($("alertUpper").value,0);
    if(lower>0 && upper>0 && lower>=upper){showToast("预警范围无效","下方预警需小于上方预警。","error");return;}
    state.config = {
      priceProvider: $("priceProvider").value,
      manualPrice: Math.max(0, number($("manualPrice").value, 0)),
      refreshSeconds: clamp(number($("refreshSeconds").value, 60), 30, 3600),
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
    ++state.quoteGeneration;
    state.refreshing = false;
    closeSettings();
    startPolling();
    renderAll();
    refreshQuote({ manual: true });
    showToast("设置已应用", "行情、预测和风控参数已重新计算。");
  }

  function restoreDefaults() {
    var before = state.config; state.config = Object.assign({}, DEFAULT_CONFIG); syncSettingsForm(); state.config = before;
    showToast("已填入默认参数", "保存并应用后生效。");
  }

  function openResetModal() {
    lockSurface($("confirmModal"), true);
    $("confirmBackdrop").classList.add("open");
    $("confirmModal").classList.add("open");
    document.body.classList.add("modal-open");
    requestAnimationFrame(function(){ $("cancelReset").focus({preventScroll:true}); });
  }

  function closeResetModal() {
    if (!$("confirmModal").classList.contains("open")) return;
    $("confirmBackdrop").classList.remove("open");
    $("confirmModal").classList.remove("open");
    document.body.classList.remove("modal-open");
    lockSurface($("confirmModal"), false);
  }

  function resetPortfolio() {
    var next = Core.emptyPortfolio();
    try { savePortfolio(next, true); state.portfolio = next; }
    catch (error) { showToast("重置未保存", error.message, "error"); return; }
    closeResetModal();
    renderPortfolio();
    renderOrderPreview();
    renderHistoryMetrics();
    renderDecisionContext();
    drawAllocationChart();
    showToast("模拟账户已重置", "虚拟资金恢复为 ¥100,000。");
  }

  function exportTrades() {
    var rows = [["时间", "方向", "克数", "成交价_元每克", "手续费", "成交金额", "备注", "报价时点", "数据模式"]].concat(state.portfolio.trades.map(function (t) {
      return [t.createdAt, t.side === "buy" ? "买入" : "卖出", t.grams, t.price, t.fee, t.value, t.note || "", t.quoteAsOf || "旧版未记录", t.dataMode || "旧版记录"];
    }));
    download("aurum-practice-" + new Date().toISOString().slice(0,10) + ".csv", "\ufeff" + rows.map(function (row) { return row.map(Core.csvCell).join(","); }).join("\n"), "text/csv;charset=utf-8");
  }

  function download(name, content, type) {
    var url = URL.createObjectURL(new Blob([content], {type:type})), a = document.createElement("a");
    a.href = url; a.download = name; a.click(); setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }

  function startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    var interval = Math.max(30, number(state.config.refreshSeconds, 60));
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
    if (Core.quoteState(state.quote).stale) return;
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
    window.addEventListener("aurum:chapter", function () { requestAnimationFrame(drawAllCharts); });
    document.fonts && document.fonts.ready.then(drawAllCharts);
    window.addEventListener("storage", function (event) {
      if (event.key !== PORTFOLIO_KEY) return;
      try { state.portfolio = event.newValue ? Core.validatePortfolio(JSON.parse(event.newValue)) : Core.emptyPortfolio(); portfolioSignature = event.newValue; renderAll(); showToast("账户已同步", "已读取另一个页面保存的记录。"); }
      catch (error) { showToast("账户同步失败", "其他页面写入了无效账户，当前页面不会覆盖它。", "error"); }
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
    if (dayOpen) return { open: true, label: "常规日盘时段", detail: "上海黄金交易所 · AU9999" };
    if (nightOpen) return { open: true, label: "常规夜盘时段", detail: "上海黄金交易所 · AU9999" };
    return { open: false, label: "常规非交易时段", detail: "行情不变可能是休市或暂无新成交" };
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

  function dataTierLabel(quote) { return Core.quoteState(quote).label;
  }

  function sourceHealthText() {
    var source = state.sourceHealth.find(function (item) { return item.ok; });
    return (source && source.name !== Core.quoteState(state.quote).label ? source.name + " · " : "") + Core.quoteState(state.quote).label;
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

  function quoteAgeHours(value) { return Core.ageHours(value);
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
    if (!Core.timestamp(value)) return "时间未知";
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
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
        year: "numeric",
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
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
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
    window.AurumJournal?.init({
      notify: showToast, navigate: function (id) { window.AurumUI.go(id); },
      applySnapshot: function (item) {
        state.factorOverrides = {};
        item.factors.forEach(function (saved) {
          var factor = state.factors.find(function (f) { return f.id === saved.id; });
          if (factor) { factor.value = saved.value; state.factorOverrides[factor.id] = true; }
        });
        syncDynamicFactors(); buildForecasts();
        var horizon = state.forecasts.findIndex(function (f) { return f.days === item.days; });
        state.forecastHorizon = horizon < 0 ? 1 : horizon;
        renderAll(); window.AurumUI.go("forecast");
        showToast("已载入这组研究假设", "按当前报价重新计算，原手记仍保留当时的数值。");
      },
      getQuote: function () { return {price:state.quote.priceCnyGram, asOf:state.quote.asOf}; },
      getSnapshot: function () {
        var f = state.forecasts[state.forecastHorizon];
        if (!f) throw Error("有效历史与报价不足，暂时无法记录情景。");
        return {price:state.quote.priceCnyGram, quoteAsOf:state.quote.asOf, source:state.quote.source, dataTier:state.quote.dataTier,
          horizon:f.label, days:f.days, center:f.center, low:f.low, high:f.high,
          factors:state.factors.map(function (factor) { return {id:factor.id,name:factor.name,value:factor.value,
            origin:state.factorOverrides[factor.id] ? "manual" : factor.id === "sgeMomentum" ? "history" : "assumption"}; })};
      }
    });
    bindEvents();
    setupObservers();
    syncDynamicFactors();
    buildForecasts();
    renderAll();
    startPolling();
    if (storageNotice) showToast("账户读取提示", storageNotice, "error");
    await loadStaticData();
    syncDynamicFactors();
    buildForecasts();
    renderAll();
    refreshQuote();
  }

  init();
})();

