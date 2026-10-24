(function () {
  "use strict";

  var Core = window.AurumCore;
  var Quant = window.AurumQuant;
  var Evidence = window.AurumEvidence;
  var RELEASE_VERSION = "4.5.2";
  var FORECAST_METHOD = "3bda3f4cf30262c03074783cb38c1bfa1ddb7b6a5f39385555a38b4632cb0fb4";
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
    { id: "cny", name: "人民币汇率影响", value: 0, weight: 1.15, note: "人民币走弱通常抬高国内克价" },
    { id: "sgeMomentum", name: "沪金趋势动量", value: 0, weight: 1.35, note: "真实日线与均线结构动态计算" },
    { id: "premium", name: "内外盘溢价", value: 0, weight: 1.05, note: "国内相对国际折算价的偏离" },
    { id: "centralBanks", name: "央行购金", value: 0, weight: 0.95, note: "中长期结构性需求" },
    { id: "realRates", name: "实际利率影响", value: 0, weight: 0.85, note: "实际利率上行通常压制金价" },
    { id: "usd", name: "美元定价影响", value: 0, weight: 0.72, note: "国际金价的外部定价条件" },
    { id: "risk", name: "避险情绪", value: 0, weight: 0.92, note: "地缘、金融与流动性风险" },
    { id: "positioning", name: "拥挤与回撤影响", value: 0, weight: 0.68, note: "过度拥挤会放大回撤" }
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
      name: "美联储官方发布",
      tier: "官方",
      description: "货币政策声明、会议纪要与经济预测原文",
      url: "https://www.federalreserve.gov/newsevents/pressreleases.htm"
    },
    {
      name: "中国人民银行",
      tier: "官方",
      description: "货币政策、外汇储备与宏观流动性观察",
      url: "https://www.pbc.gov.cn/"
    },
    {name:"ECB 参考汇率",tier:"自动因子",description:"人民币/美元与美元/欧元代理，按观测日期和首次抓取归档",url:"https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml"},
    {name:"美国财政部实际收益率",tier:"自动因子",description:"10 年实际收益率的水平与近 20 个参考日变动",url:"https://home.treasury.gov/treasury-daily-interest-rate-xml-feed"},
    {name:"Cboe VIX",tier:"自动因子",description:"权益波动与风险情绪代理，不等同于黄金波动率",url:"https://www.cboe.com/tradable_products/vix/vix_historical_data/"},
    {name:"BEA / BLS / ECB",tier:"官方资讯",description:"经济发布、通胀、就业及政策声明；不可用来源显式保留失败状态",url:"https://www.bea.gov/news"},
    {name:"BBC World / CNBC Economy",tier:"新闻发布者",description:"补充地缘与经济事件，保留发布者原文与首次见到的版本",url:"https://feeds.bbci.co.uk/news/world/rss.xml"},
    {name:"新浪财经滚动",tier:"中文财经",description:"黄金、汇率、利率与地缘快讯，标明实际提供方及原文时间",url:"https://finance.sina.com.cn/roll/"},
    {name:"CNBC / WSJ / MarketWatch",tier:"财经发布者",description:"补充市场与大宗商品报道；过滤无关金额和科技新闻",url:"https://www.cnbc.com/rss-feeds/"}
  ];

  var state = {
    config: loadConfig(),
    portfolio: loadPortfolio(),
    quote: normalizeQuote(Object.assign({}, DATA.market || fallbackQuote(), { dataTier: "snapshot" })),
    history: normalizeHistory(DATA.history),
    news: normalizeNews(DATA.news),
    research: DATA.research || {snapshots:[]},
    ledger: DATA.ledger || {entries:[]},
    pipelineHealth: DATA.health || null,
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
    chartIndicators: { ma20: true, ma60: true, forecast: false },
    chartHover: null,
    historySelectedTime: null,
    chartView: null,
    chartPoints: [],
    tradeSide: "buy",
    newsFilter: "all",
    newsQuery: "",
    newsLimit: 5,
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
    var verified=Core.closedDaily(history.daily,history.generatedAt);
    var unconfirmed=Array.from(new Set((Array.isArray(history.excludedUnclosedDays)?history.excludedUnclosedDays:[]).concat(verified.pending.map(function(p){return p.time;}))));
    return {
      source: history.source || "尚未加载历史数据",
      sourceUrl: history.sourceUrl || "https://www.sge.com.cn/sjzx/quotation_daily_new",
      generatedAt: validDate(history.generatedAt || new Date(0).toISOString()),
      daily: verified.closed,
      excludedUnclosedDays:unconfirmed,
      intraday: normalizePoints(history.intraday)
    };
  }

  function normalizePoints(points) { return Core.normalizePoints(points);
  }

  function normalizeNews(raw) {
    var items = raw && Array.isArray(raw.items) ? raw.items : [];
    return {
      generatedAt: validDate(raw && raw.generatedAt || new Date(0).toISOString()),
      checkedAt: Core.timestamp(raw && (raw.checkedAt||raw.generatedAt)),
      failedSources: raw && Array.isArray(raw.failedSources) ? raw.failedSources.map(String) : [],
      sourceStatus: raw && Array.isArray(raw.sourceStatus) ? raw.sourceStatus : [],
      items: items.filter(function(item){return item && typeof item === "object";}).map(function (item, index) {
        return {
          id: String(item.id || "news-" + index),
          source: String(item.source || "消息原文"),
          publisher: String(item.publisher || item.source || "消息原文"),
          title: String(item.title || "未命名消息"),
          summary: String(item.summary || ""),
          url: safeUrl(item.url),
          publishedAt: Core.timestamp(item.publishedAt),
          timePrecision: item.timePrecision==="date-only"?"date-only":"timestamp",
          firstSeenAt: Core.timestamp(item.firstSeenAt),
          versions: Array.isArray(item.versions)?item.versions:[],
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
      fetchJson("data/research-bundle.json?_=" + stamp)
    ]);
    if (settled[0].status === "fulfilled" && state.config.priceProvider === "domestic") {
      var picked=Core.selectQuote([{...settled[0].value,dataTier:"snapshot"}],state.quote);if(picked.quote)state.quote=picked.quote;
    }
    if (settled[1].status === "fulfilled") {try{adoptResearchBundle(settled[1].value);}catch(error){state.researchFailures=[0,1,2,3];}}
    state.lastResearchAt=Date.now();
  }

  async function refreshResearchData(force) {
    var delay=Math.min(300000,60000*Math.pow(2,Math.min(3,state.researchFailureCount||0)));
    if(state.researchRefreshing || document.hidden || navigator.onLine===false || (!force && Date.now()-(state.lastResearchAt||0)<delay))return;
    state.researchRefreshing=true;state.lastResearchAt=Date.now();
    renderResearchHealth();
    try {
      var results=await Promise.allSettled(["data/research-bundle.json","data/pipeline-health.json"].map(async function(url){
        var response=await fetch(url,{cache:"no-cache",signal:AbortSignal.timeout(12000)});
        if(!response.ok)throw Error("HTTP "+response.status);return response.json();
      }));
      state.researchFailures=results[0].status==='rejected'?[0,1,2,3]:[];
      var changed=results[0].status==='fulfilled'?adoptResearchBundle(results[0].value):false;
      if(results[0].status==='rejected')state.researchFailureCount=(state.researchFailureCount||0)+1;
      else{state.researchFailureCount=0;state.lastResearchCheckedAt=new Date().toISOString();}
      if(results[1].status==='fulfilled')adoptPipelineHealth(results[1].value);
      if(changed) {syncDynamicFactors();buildForecasts();renderAll();}
      renderIntelligence();
    } catch(error) {state.researchFailures=[0,1,2,3];state.researchFailureCount=(state.researchFailureCount||0)+1;renderIntelligence();}
    finally {state.researchRefreshing=false;renderResearchHealth();}
  }
  function adoptPipelineHealth(value){
    if(value?.schema===1&&Core.ageHours(value.generatedAt)!==Infinity&&Date.parse(value.generatedAt)>=(Date.parse(state.pipelineHealth?.generatedAt)||0))state.pipelineHealth=value;
  }
  function adoptResearchBundle(bundle){
    if(bundle?.schema!==1||!Array.isArray(bundle.history?.daily)||!Array.isArray(bundle.news?.items)||!Array.isArray(bundle.research?.snapshots)||!Array.isArray(bundle.ledger?.entries))throw Error("研究快照未通过结构校验");
    var changed=false;
    if(Core.ageHours(bundle.history.generatedAt)!==Infinity&&Date.parse(bundle.history.generatedAt)>Date.parse(state.history.generatedAt)&&bundle.history.daily.length>=30){state.history=normalizeHistory(bundle.history);changed=true;}
    if(Core.ageHours(bundle.news.checkedAt||bundle.news.generatedAt)!==Infinity&&Date.parse(bundle.news.checkedAt||bundle.news.generatedAt)>(Date.parse(state.news.checkedAt||state.news.generatedAt)||0)){
      var news=normalizeNews(bundle.news);if(JSON.stringify(news.items)===JSON.stringify(state.news.items))news.items=state.news.items;state.news=news;changed=true;
    }
    if(Core.ageHours(bundle.research.generatedAt)!==Infinity&&Date.parse(bundle.research.generatedAt)>(Date.parse(state.research.generatedAt)||0)){
      var research=bundle.research;if(JSON.stringify(research.snapshots)===JSON.stringify(state.research.snapshots))research={...research,snapshots:state.research.snapshots};state.research=research;changed=true;
    }
    if(Core.ageHours(bundle.ledger.generatedAt)!==Infinity&&Date.parse(bundle.ledger.generatedAt)>(Date.parse(state.ledger.generatedAt)||0)){state.ledger=bundle.ledger;changed=true;}
    adoptPipelineHealth(bundle.health);return changed;
  }

  async function fetchJson(url) {
    var response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }

  async function refreshQuote(options) {
    options = options || {};
    if (options.manual)refreshResearchData(true);
    if (state.refreshing) return;
    if (state.config.priceProvider === "domestic" && navigator.onLine === false) {
      renderStatus(); if (options.manual) showToast("当前离线", "保留本机行情与记录，联网后再核对报价。"); return;
    }
    state.refreshing = true;
    var generation = ++state.quoteGeneration;
    state.pollRemaining = Core.refreshDelay(state.config.refreshSeconds,state.feedFailures);
    $("refreshBtn").classList.add("loading");
    renderStatus();
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
        showToast(state.feedFailures ? "已保留可用报价" : "来源核对完成", state.feedFailures ? "公开链路暂不可用，原报价时点保留，可稍后重试。" : quoteEventText(previousPrice, state.quote.priceCnyGram));
      }
    } catch (error) {
      if (generation !== state.quoteGeneration) return;
      state.sourceHealth.push({ name: "行情链路", ok: false, error: error.message });
      state.lastPollAt = new Date();
      renderStatus();
      if (options.manual) showToast("行情刷新失败", error.message || "已保留上一笔有效行情", "error");
    } finally {
      if (generation !== state.quoteGeneration) return;
      state.refreshing = false;
      state.pollRemaining = Core.refreshDelay(state.config.refreshSeconds,state.feedFailures);
      $("refreshBtn").classList.remove("loading");
      renderStatus();
    }
  }

  async function fetchDomesticQuote(generation) {
    var providers = [["东方财富 AU9999", fetchEastmoneyLiveQuote],["新浪 SGE_AU9999", fetchSinaLiveQuote]];
    var settled = await Promise.allSettled(providers.map(async function(provider) {
      var started = performance.now(), q = validateBrowserQuote(await provider[1]());
      if (Core.ageHours(q.asOf) > 36) throw Error("行情时间过期或无效");
      return {quote:q,latency:Math.round(performance.now()-started)};
    }));
    if (generation !== state.quoteGeneration) throw Error("行情设置已改变");
    var candidates=[];
    settled.forEach(function(result,index) {
      var ok=result.status==="fulfilled";
      state.sourceHealth.push({name:providers[index][0],ok:ok,error:ok?"":result.reason.message,latency:ok?result.value.latency:null});
      if(ok)candidates.push(result.value.quote);
    });
    var result=Core.selectQuote(candidates,state.quote);
    if(candidates.length && result.quote) {
      state.feedFailures=0;
      return result.quote;
    }
    state.feedFailures=(state.feedFailures||0)+1;
    try {
      var snapshot=await fetchLatestSnapshot();candidates.push(snapshot);
      state.sourceHealth.push({name:"部署快照",ok:true});
    } catch(error) {state.sourceHealth.push({name:"部署快照",ok:false,error:error.message});}
    if(DATA.market)candidates.push({...DATA.market,dataTier:"snapshot"});
    result=Core.selectQuote(candidates,state.quote);
    if(!result.quote)throw Error("没有有效报价，保留原始时点");
    return result.quote;
  }

  function validateBrowserQuote(quote) {
    if (!(quote.priceCnyGram > 0) || !Core.timestamp(quote.asOf) || Core.ageHours(quote.asOf) === Infinity) throw new Error("报价或时间无效");
    var baseline = DATA.market || {}, check = baseline.validation;
    if (!check || Core.ageHours(check.checkedAt) > 12 || Core.ageHours(baseline.asOf) > 12) return quote;
    if (!Core.timestamp(check.officialAsOf) || Math.abs(Date.parse(quote.asOf) - Date.parse(check.officialAsOf)) > 120000) return quote;
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
      volume: Core.numeric(data.f47),
      turnover: Core.numeric(data.f48),
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
    var previous = Core.numeric(parts[5]);
    var pct = number(String(parts[17] || "").replace("%", ""), (latest - previous) / previous * 100);
    var symbol = requestSymbol === "SGE_AU9999" ? "AU9999" : "AUTD";
    return {
      symbol: symbol,
      name: symbol === "AU9999" ? "黄金9999" : "黄金T+D",
      exchangeName: parts[2] || symbol,
      latest: latest,
      high: Core.numeric(parts[7]),
      low: Core.numeric(parts[8]),
      open: Core.numeric(parts[6]),
      previousClose: previous,
      change: latest - previous,
      changePct: pct,
      volume: Core.numeric(parts[14]),
      turnover: Core.numeric(parts[15]),
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
      observed:Core.contractObserved(main),
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
      officialReference:state.quote.officialReference || DATA.market && DATA.market.officialReference,
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
      observed:{previous:false,open:false,range:false,change:false,changeAmount:false,volume:false,turnover:false},
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
    var parsed = Core.numeric(value);
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
    dataBaselineFactors().forEach(function(factor) { setFactor(factor.id, factor.value); });
  }

  function dataBaselineFactors() {
    var context=Evidence.context(evidenceData());
    return DEFAULT_FACTORS.map(function (factor) {
      var value = 0;
      if (factor.id === "sgeMomentum" && state.history.daily.length >= 21) value = clamp(historyMomentum(20) * 100 * 5.2, -85, 85);
      if (factor.id === "premium" && Number.isFinite(state.quote.domesticPremiumPct)) value = clamp(-state.quote.domesticPremiumPct * 7, -80, 80);
      var driver=context.drivers.find(function(d){return d.id===factor.id;});if(driver)value=driver.value*100;
      if(factor.id==="centralBanks"||factor.id==="cnDemand"){var events=context.events.filter(function(e){return e.dimension==="demand"||e.dimension==="flows";});if(events.length)value=clamp(events.reduce(function(s,e){return s+e.value;},0)*100,-100,100);}
      return Object.assign({}, factor, {value:Math.round(value)});
    });
  }

  function setFactor(id, value) {
    var factor = state.factors.find(function (item) { return item.id === id; });
    if (factor && !state.factorOverrides[id]) factor.value = Math.round(value);
  }

  function factorScore(factors) {
    factors = factors || state.factors;
    var weighted = factors.reduce(function (sum, item) {
      return sum + item.value * item.weight;
    }, 0);
    var totalWeight = factors.reduce(function (sum, item) { return sum + item.weight; }, 0);
    return clamp(weighted / totalWeight, -100, 100);
  }

  function buildForecasts() {
    if (state.profileHistory !== state.history.daily || state.profileNews!==state.news.items || state.profileResearch!==state.research.snapshots) {
      state.profileHistory = state.history.daily;state.profileNews=state.news.items;state.profileResearch=state.research.snapshots;
      var worker=predictionWorker();
      if(worker){state.profileRequest=(state.profileRequest||0)+1;state.quantProfile=state.quantProfile||Quant.profile([]);state.profilePending=true;worker.postMessage({type:"profile",id:state.profileRequest,daily:state.history.daily,evidence:evidenceData()});}
      else state.quantProfile=Quant.profile(state.history.daily,evidenceData());
    }
    state.quantProfile.context=Evidence.context(evidenceData());
    var baselineFactors=dataBaselineFactors();
    var adjustedFactors=baselineFactors.map(function(f){return state.factorOverrides[f.id]?state.factors.find(function(x){return x.id===f.id;}):f;});
    var delta = factorScore(adjustedFactors)-factorScore(baselineFactors);
    state.scenarioModel = Quant.scenarioModel(state.quote.priceCnyGram, state.quantProfile, delta);
    state.forecasts = state.scenarioModel.points;
    state.baselineForecasts = Quant.scenarioModel(state.quote.priceCnyGram, {...state.quantProfile,context:null}, 0).points;
  }
  function evidenceData(){return {news:state.news.items,snapshots:state.research.snapshots||[]};}
  function predictionWorker(){
    if(state.workerUnavailable||typeof Worker!=="function"||location.protocol==="file:")return null;
    if(state.predictionWorker)return state.predictionWorker;
    try{
      var worker=new Worker("assets/prediction-worker.js?v=4.5.2");
      worker.onmessage=function(event){var data=event.data;if(data.type==="profile"&&data.id===state.profileRequest){
        state.profilePending=false;if(data.error){worker.onerror();return;}state.quantProfile=data.result;buildForecasts();renderAll();
      }else if(data.type==="replay"&&data.id===state.replayRequest){$("runReplay").disabled=false;if(data.error)setText("replayStatus","回放计算未完成，请重新核对输入。");else renderReplayResult(data.result);}};
      worker.onerror=function(){worker.terminate();state.predictionWorker=null;state.workerUnavailable=true;state.profilePending=false;state.quantProfile=Quant.profile(state.history.daily,evidenceData());buildForecasts();renderAll();$("runReplay").disabled=false;};
      state.predictionWorker=worker;return worker;
    }catch(error){state.workerUnavailable=true;return null;}
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
    return Core.order(state.portfolio,state.quote,state.config,{side:side,grams:1,feePct:$("feeRate").value,spreadPct:$("tradeSpread").value}).price;
  }

  function renderProductEstimate() {
    var draft=$("settingsDrawer").classList.contains("open"),purity=number(draft?$("purity").value:state.config.purity,1),premium=number(draft?$("productPremium").value:state.config.productPremium,0);
    setText("productEstimate",state.quote.priceCnyGram>0?money(state.quote.priceCnyGram*purity*(1+premium/100)):"等待有效主价");
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
    renderResearchHealth();
    var session = marketSession(new Date()), quality = Core.quoteState(state.quote);
    var offline = navigator.onLine === false;
    $("refreshBtn").disabled = state.refreshing;
    $("refreshBtn").setAttribute("aria-busy",String(state.refreshing));
    $("refreshBtn").setAttribute("aria-label",state.refreshing?"正在核对行情":"刷新行情");
    setText("sessionLabel", session.label); setText("sessionDetail", "常规时段估计 · 节假日以交易所公告为准");
    $("liveBeacon").className = "live-beacon " + (quality.key === "live" ? "open" : "closed");
    setText("quoteClock", state.quote.asOf ? formatDateTime(state.quote.asOf) : "时间未知");
    setText("sideSource", shortSource(state.quote.source)); setText("sideHealth", sourceHealthText());
    var banner = $("statusBanner");
    banner.classList.toggle("hidden", !state.feedFailures && !state.quote.sourceConflict && !offline && !quality.stale && !state.refreshing && quality.key === "live");
    setText("statusBannerText", state.quote.sourceConflict ? "同时间窗口的来源报价分歧较大，暂停模拟成交，请先核验来源。" : offline ? "当前离线，保留本机行情和记录。联网后重新核对来源与报价时点。" : quality.stale
      ? (state.quote.asOf ? "数据截至 " + formatDateTime(state.quote.asOf) + "，已过去 " + ageText(state.quote.asOf) + "。当前仅供历史观察。" : "尚无可核实的报价时点，请检查数据来源。")
      : state.refreshing ? "正在核对公开行情；报价时间决定数据是否更新。" : state.feedFailures ? "公开链路暂不可用，保留最近报价并延后核对；时点见上方。" : "当前为延时行情或部署快照，报价时点见上方。");
    setText("pollLabel", state.refreshing ? "正在刷新" : offline ? "离线 · 本机记录" : state.config.priceProvider !== "domestic" ? "按需核对" : (state.feedFailures ? "备用状态 · " : "") + "下次核对 " + Math.ceil(state.pollRemaining) + "s");
    $("pollProgress").style.transform = "scaleX(" + clamp(state.pollRemaining / Core.refreshDelay(state.config.refreshSeconds,state.feedFailures), 0, 1) + ")";
    setText("practiceContext", quality.label + (state.quote.asOf ? " · " + formatDateTime(state.quote.asOf) : ""));
  }

  function renderQuote(options) {
    var quote = state.quote, observed=quote.observed || {};
    var previousDisplayed = number(options.previousPrice, quote.priceCnyGram);
    animatePrice($("mainPrice"), previousDisplayed, quote.priceCnyGram, !!options.animatePrice);
    setText("openPrice", observed.open?money(quote.openCnyGram):"—");
    setText("highPrice", observed.range?money(quote.highCnyGram):"—");
    setText("lowPrice", observed.range?money(quote.lowCnyGram):"—");
    setText("previousPrice", observed.previous?money(quote.previousCnyGram):"—");
    setText("changeValue",observed.changeAmount?signedPrice(quote.changeCnyGram):"—");
    setText("changePercent",observed.change?signedPercent(quote.changePct):"—");
    setText("sourceName", shortSource(quote.source));
    setText("dataAge", "数据年龄 " + ageText(quote.asOf));
    $("sourceLink").href = safeUrl(quote.sourceUrl);
    $("dataTier").textContent = dataTierLabel(quote);
    $("dataTier").className = "data-tier " + (
      quote.dataTier === "domestic-live" && quoteAgeHours(quote.asOf) < 1 ? "live" :
      quoteAgeHours(quote.asOf) > 12 ? "stale" : ""
    );
    $("changeChip").className = "change-chip " + (observed.change?directionClass(quote.changePct):"neutral");
    $("sourceDot").style.background = quoteAgeHours(quote.asOf) > 12 ? "var(--amber)" : "var(--green)";
    $("priceEvent").textContent = quoteEventText(options.previousPrice, quote.priceCnyGram);
    $("lastChanged").textContent = state.lastPriceChangedAt
      ? relativeTime(state.lastPriceChangedAt)
      : "行情 " + formatDateTime(quote.asOf);
    var quality = Core.quoteState(quote);
    $("trustBadge").innerHTML = '<svg><use href="#i-clock"></use></svg><span>' + escapeHtml(quality.label) + '</span>';
    $("priceEvent").textContent = quality.stale ? "保留原报价时点" : quoteEventText(options.previousPrice, quote.priceCnyGram);
    $("lastChanged").textContent = quote.asOf ? formatDateTime(quote.asOf) : "时间未知";
    renderProductEstimate();
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
    var known=quote.observed || {},amplitude=known.range&&known.previous?(quote.highCnyGram-quote.lowCnyGram)/quote.previousCnyGram*100:NaN;
    setText("amplitudeValue",Number.isFinite(amplitude)?amplitude.toFixed(2)+"%":"—");
    setText("volumeValue",known.volume?compactNumber(quote.volume):"—");
    setText("turnoverValue",known.turnover?compactCurrency(quote.turnover):"—");
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
    setMetricClass("return20", Number.isFinite(return20)?signedPercent(return20):"—", return20);
    setMetricClass("return60", Number.isFinite(return60)?signedPercent(return60):"—", return60);
    var vol=annualVolatility();setText("annualVol",Number.isFinite(vol)?vol.toFixed(1)+"%":"—");
    setText("rsiValue", Number.isFinite(rsi)?rsi.toFixed(1) + (rsi >= 70 ? " 偏热" : rsi <= 30 ? " 偏冷" : " 中性"):"—");
    var trend = !Number.isFinite(ma60)?"样本不足":last > ma20 && ma20 > ma60 ? "多头排列" : last < ma20 && ma20 < ma60 ? "空头排列" : "区间整理";
    setText("trendState", trend);
    setText("historyQuality", state.history.daily.length
      ? state.history.source + " · " + state.history.daily.length + " 个日线点 · 截至 " + state.history.daily[state.history.daily.length - 1].time + (state.history.excludedUnclosedDays.length?" · "+state.history.excludedUnclosedDays.length+" 条未确认收盘记录未计入":"")
      : "历史快照不可用，未绘制伪造历史");

    var score = Math.round(clamp(return20 * 3.4 + (last > ma20 ? 16 : -12), -100, 100));
    setText("momentumSignal", trend);
    setText("momentumExplain", Number.isFinite(return20)&&Number.isFinite(rsi)?"20 日 " + signedPercent(return20) + " · RSI " + rsi.toFixed(0):"有效日线不足，暂不评分");
    setText("momentumScore", Number.isFinite(score)?signedNumber(score):"—");
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
        return '<button type="button" class="forecast-card" data-horizon="'+index+'"><span class="forecast-top"><span></span><b></b></span><span class="forecast-bounds"><span class="forecast-bound"><span>假设下界</span><b data-bound="low"></b></span><span class="forecast-bound"><span>假设上界</span><b data-bound="high"></b></span></span><span class="forecast-center"><span>路径中枢</span><b></b></span><small class="forecast-status"></small></button>';
      }).join("");
      buttons = container.querySelectorAll("[data-horizon]");
    }
    function updateText(el, value) { if (el.textContent !== value) el.textContent = value; }
    state.forecasts.forEach(function (f, index) {
      var button = buttons[index], selected = index === state.forecastHorizon;
      button.classList.toggle("selected", selected); button.setAttribute("aria-pressed", String(selected));
      updateText(button.querySelector(".forecast-top>span"), f.label);
      var audit = state.quantProfile.evaluations.find(function(e){return e.days===f.days;});
      var manual = Math.abs(state.scenarioModel.scoreDelta)>.0001;
      var modelLabel = manual ? "手动假设" : state.quantProfile.context?.active ? "量价 + 多因子" : "量价集成";
      updateText(button.querySelector(".forecast-top>b"), modelLabel);
      updateText(button.querySelector('[data-bound="low"]'), toFixedPrice(f.low));
      updateText(button.querySelector('[data-bound="high"]'), toFixedPrice(f.high));
      updateText(button.querySelector(".forecast-center>b"), toFixedPrice(f.center));
      updateText(button.querySelector(".forecast-status"), (selected ? "当前周期" : "查看周期") + " · " + (audit?.count>=6 ? "历史检验 "+audit.count+" 次" : "尚无充分检验"));
      button.setAttribute("aria-label", f.label+"，"+modelLabel+"，假设下界 "+toFixedPrice(f.low)+"，上界 "+toFixedPrice(f.high)+"，路径中枢 "+toFixedPrice(f.center)+" 元每克");
    });
    if (!state.forecasts.length) {var empty=state.profilePending?"正在后台训练各周期预测，页面可以继续浏览。":"有效日线不足 30 个，暂不推演情景。";if(container.textContent!==empty)container.innerHTML='<div class="panel forecast-empty">'+empty+'</div>';}
    var sameCenter=state.forecasts.length>1 && state.forecasts.every(function(f){return Math.abs(f.center-state.forecasts[0].center)<.005;});
    setText("forecastBasisNote", "中枢由各周期独立训练的正则化收益模型与衰减趋势组成；可用的汇率、实际利率、风险情绪和明确事件作有上限的时效修正。"+(sameCenter?"当前输入接近平稳，模型未强制制造方向差异。":"")+"6 个月以上含长期外推。展开‘预测依据’查看输入与贡献。"+(Math.abs(state.scenarioModel.scoreDelta)>.0001?"手动假设会平移路径，不能沿用原历史覆盖率。":""));
    var focus = state.forecasts[state.forecastHorizon];
    $("captureScenario").disabled = !focus || !state.quote.asOf;
    $("scenarioFocus").innerHTML = focus ? '<div><span>当前观察 · '+focus.label+'</span><strong>'+toFixedPrice(focus.center)+'<small>元 / 克</small></strong></div><p>波动情景带 <b>'+toFixedPrice(focus.low)+' — '+toFixedPrice(focus.high)+'</b><small>历史波动与误差刻度 · 不保证未来覆盖</small></p>' : '';
    var baseline = state.baselineForecasts[state.forecastHorizon];
    $("scenarioComparison").hidden = !baseline || !focus;
    if (baseline && focus) {
      var delta = focus.center - baseline.center;
      $("scenarioComparison").innerHTML = '<span>同周期量价基线 <b>'+toFixedPrice(baseline.center)+'</b></span><span>'+(Math.abs(delta)<.005 ? '暂无有效外部修正' : '事件 / 因子 / 手动修正 <b>'+(delta>0?'+':'')+delta.toFixed(2)+' 元/克</b>')+'</span>';
    }
    setText("bullProbability", "上界"); setText("baseProbability", "路径"); setText("bearProbability", "下界");
    var score = factorScore(); setText("factorTotal", signedNumber(Math.round(score)));
    var nonNeutral = state.factors.filter(function (f) { return f.id !== "sgeMomentum" && f.value !== 0; }).length;
    setText("factorOverview", (state.factorOverrides.sgeMomentum ? "动量假设 " : "历史动量 ") + signedNumber(getFactor("sgeMomentum")) + " · " + (nonNeutral ? "另有 " + nonNeutral + " 项非中性假设" : "其余驱动保持中性"));
    var change=focus&&state.quote.priceCnyGram>0?(focus.center/state.quote.priceCnyGram-1)*100:0;
    setText("stanceTitle", change>.3?"模型偏强 · "+signedPercent(change):change<-.3?"模型偏弱 · "+signedPercent(change):"模型判断接近平稳");
    setText("stanceSummary", focus ? forecastSummary(focus, score) : "补齐有效历史与报价后再作推演。");
    $("confidenceRing").querySelector("b").textContent = "先检验";
    renderModelAudit();
    renderValidation();
    renderPredictionEvidence();
    $("actionList").innerHTML = strategyActions().map(function (a) { return '<li>' + escapeHtml(a) + '</li>'; }).join("");
    $("useStrategyBtn").disabled = !state.forecasts.length;
  }

  function selectedAudit() {
    var f=state.forecasts[state.forecastHorizon];
    return f && state.quantProfile.evaluations.find(function(e){return e.days===f.days;});
  }
  function renderModelAudit() {
    var e=selectedAudit(),f=state.forecasts[state.forecastHorizon];
    setText("modelAuditTitle", f ? f.label+" · 把模型放回历史里" : "等待有效历史");
    var model=e?.model==="trend"?"收缩趋势":"正则化量价集成";
    setText("forecastModel",state.profilePending?"预测引擎 · 后台重算中":"预测引擎 · "+model);
    setText("auditModel",model);
    setText("auditSample",e ? e.count+" 次" : "—");
    setText("auditError",e?.count ? e.mae.toFixed(2)+"%" : "样本不足");
    setText("auditBaseline",e?.count ? e.naiveMae.toFixed(2)+"%" : "—");
    setText("auditCoverage",e?.count>=6 ? e.coverage.toFixed(0)+"%" : "样本不足");
    setText("auditDirection",e?.count>=6?e.direction.toFixed(1)+"%":"样本不足");
    setText("auditEvidence",e?e.augmentedCount+" / "+e.count:"—");
    var archived=(state.ledger.entries||[]).filter(function(entry){return entry.methodHash===FORECAST_METHOD;}).flatMap(function(entry){return (entry.forecasts||[]).filter(function(x){return x.days===f?.days;}).map(function(x){return {entry,forecast:x};});});
    var verified=archived.filter(function(x){return x.forecast.result;}),lastArchived=archived.at(-1);
    setText("prospectiveAudit", "同算法建档后核验："+verified.length+" / "+archived.length+" 个已建档起点完成当前周期。"+(verified.length?"已核验平均价格误差 "+(verified.reduce(function(s,x){return s+x.forecast.result.error;},0)/verified.length).toFixed(2)+"%。":"尚未积累真实后续结果，不报告前瞻准确率。")+(lastArchived?"最近建档 "+formatDateTime(lastArchived.entry.createdAt)+"，起点收盘 "+lastArchived.entry.origin+"，当时预测中枢 "+toFixedPrice(lastArchived.forecast.center)+" 元/克；之后不随模型更新重写。":""));
    var changed=Math.abs(state.scenarioModel.scoreDelta)>.0001;
    var enough=e?.count>=6;
    var improvement=e?.naiveMae>1e-8?(1-e.mae/e.naiveMae)*100:0;
    var message=!enough ? "这个周期没有足够的向前历史检验，暂不能据此评价预测能力。长期结果仅作敏感性观察。" :
      improvement>0 ? "逐次向前检验中，平均误差比始终持平基准低 "+improvement.toFixed(1)+"%；这只是所示历史窗口的结果。" :
      "逐次向前检验中，模型尚未优于始终持平基准；请保留基准对照，降低方向判断的权重。";
    if(enough && e.count<20)message+=" 目前只有 "+e.count+" 次检验，结果容易随新增样本变化。";
    if(e?.recentCount)message+=" 最近 "+e.recentCount+" 次模型误差 "+e.recentMae.toFixed(2)+"%，同期持平基准 "+e.recentNaiveMae.toFixed(2)+"%。";
    message+=" 方向命中率只统计涨跌符号，不是价格准确率。外部事件修正仅在有当时存档时参加检验；尚无存档的旧日期只检验量价模型。";
    if(state.quantProfile.context?.active && !(e?.augmentedCount>=6))message+=" 当前外部修正尚无充分前瞻检验，不能据此声称提高了准确率。";
    if(changed)message+=" 当前有手动假设，历史覆盖率不适用于人为平移。";
    setText("auditConclusion",message);
    $("exportBacktest").disabled=!e?.count;
    setText("auditWindow", e?.count ? e.records[0].origin+" — "+e.records.at(-1).target+" · "+e.steps+" 个记录交易日/期" : "每年按 252 个交易日近似换算；至少 120 日训练，另需 8 次已结束预测进行初始校准。");
  }
  function renderValidation(){
    var report=DATA.validation,days=state.forecasts[state.forecastHorizon]?.days||30,h=report?.horizons?.find(function(h){return h.days===days;});
    if(!h||report.methodHash!==FORECAST_METHOD){setText("validationTitle","多时点记录暂不可用");setText("validationDecision","当前实验记录缺失或对应其他算法；当前预测仍可独立使用历史回放检验。");$("exportValidation").disabled=true;return;}
    $("exportValidation").disabled=false;
    if(state.validationDays!==days){state.validationDays=days;state.validationLimit=4;}
    var validationKey=days+"|"+$("validationPhase").value+"|"+(state.validationLimit||4)+"|"+report.generatedAt;if(state.validationRenderKey===validationKey)return;state.validationRenderKey=validationKey;
    setText("validationIdentity",report.cutoffs+" 个固定截止日 · "+report.forecasts+" 次日期 / 周期组合 · 2026-10-24 固定实验");
    setText("validationTitle",h.label+" · 同一标准，比较不同阶段");
    var long=days>=180;
    setText("validationDecision",long?"本轮保留现有参数。长期候选虽在部分区间改善，但独立目标太少，没有达到调参所需的样本门槛。长期路径继续作为外推观察。":"本轮保留现有参数。加强正则化、降低回归权重和延长直接拟合窗口三个候选，均未同时通过开发段、验证段的预设门槛；未在看到尾段后继续调参。");
    var names={development:"开发段",validation:"验证段",holdout:"本轮保留尾段"};
    $("validationPhases").innerHTML=Object.keys(names).map(function(key){var m=h.phases[key].primary,period=report.phases[key];return '<article class="validation-phase"><span>'+names[key]+'</span><small>'+period.first+' — '+period.last+'</small><dl><div><dt>模型误差 MAPE</dt><dd>'+(m.count?m.mape.toFixed(2)+'%':'—')+'</dd></div><div><dt>持平基准 MAPE</dt><dd>'+(m.count?m.naiveMape.toFixed(2)+'%':'—')+'</dd></div></dl><p>'+m.count+' 个非重叠目标'+(m.count<12?' · 样本不足以采用新参数':m.mape>m.naiveMape?' · 此段尚未优于持平基准':' · 仅描述此段历史结果')+'</p></article>';}).join("");
    setText("validationProtocol","每隔 21 个记录交易日固定取样，起点至少已有 253 条日线；跨分段的目标不参与选型。候选须在开发、验证段各相对降低至少 1% 的平均误差，同时限制大误差、方向和分行情退化。尾段仅在选择锁定后查看。该历史曾用于旧版回测，属于本轮保留段，不能称为从未见过的数据。数据冻结至 "+report.data.last+"，之后不随实时消息重写。");
    var phase=$("validationPhase").value,records=h.records.filter(function(r){return phase==='all'||r.phase===phase;}),visible=records.slice(0,state.validationLimit||4);
    $("validationRecords").innerHTML=visible.length?visible.map(function(r){return '<li><div><strong>'+r.origin+' → '+r.target+'</strong><small>起点 '+toFixedPrice(r.start)+' · '+({rising:'此前 60 日上涨',falling:'此前 60 日下跌',sideways:'此前 60 日震荡'})[r.regime]+'</small></div><div><strong>'+toFixedPrice(r.center)+' <small>预测 / 实际 '+toFixedPrice(r.actual)+' 元/克</small></strong><small>误差 '+r.error.toFixed(2)+'% · 持平 '+r.naiveError.toFixed(2)+'%</small></div><a href="#replayLab" data-validation-date="'+r.origin+'" data-validation-days="'+days+'">单独回放 ↗</a></li>';}).join(""):'<li><div><strong>此分段没有完整走完的目标</strong><small>可选“全时段诊断”查看其他历史起点。不要把未到期结果当成预测成功。</small></div></li>';
    setText("validationRecordCount","已显示 "+visible.length+" / "+records.length+" 个固定起点。全时段共有 "+h.all.primary.count+" 个非重叠目标 / "+h.all.diagnostic.count+" 条诊断记录。");$("moreValidation").hidden=visible.length>=records.length;
  }
  function exportValidation(){
    var h=DATA.validation?.horizons?.find(function(h){return h.days===(state.forecasts[state.forecastHorizon]?.days||30);});if(!h)return;
    var rows=[["实验","周期自然日","分段","训练截止","核验日期","起点收盘","预测中枢","实际收盘","下界","上界","MAPE","持平误差","此前60日行情","外部存档输入","区间已具备初始校准"]];
    h.records.forEach(function(r){rows.push([DATA.validation.id,h.days,r.phase,r.origin,r.target,r.start,r.center,r.actual,r.low,r.high,r.error,r.naiveError,r.regime,r.evidenceCount,r.intervalCalibrated?"是":"否"]);});
    download("aurum-multi-origin-"+h.days+"d.csv","\ufeff"+rows.map(function(row){return row.map(Core.csvCell).join(",");}).join("\n"),"text/csv;charset=utf-8");
  }
  function exportBacktest() {
    var e=selectedAudit();if(!e?.count)return;
    var rows=[["训练截至","核验交易日","模型","预测中枢","实际收盘","下界","上界","绝对百分比误差","持平基准误差","是否落入区间","涨跌方向命中","当时外部输入数"]];
    e.records.forEach(function(r){rows.push([r.origin,r.target,r.model,r.center,r.actual,r.low,r.high,r.error,r.naiveError,r.hit?"是":"否",r.directionHit?"是":"否",r.evidenceCount]);});
    download("aurum-walk-forward-"+e.days+"d.csv","\ufeff"+rows.map(row=>row.map(Core.csvCell).join(",")).join("\n"),"text/csv;charset=utf-8");
  }
  function renderPredictionEvidence(){
    var ctx=state.quantProfile.context,e=selectedAudit(),contributions=e?.contributions||[];
    setText("evidenceSummary",(ctx?.drivers.length||0)+" 项市场输入 · "+(ctx?.events.length||0)+" 条明确事件 · 可追溯时点");
    setText("evidenceClock","资讯核对 "+formatDateTime(state.news.generatedAt)+" · 市场因子核对 "+formatDateTime(state.research.generatedAt)+"。已收录 "+state.news.items.length+" 条原文；本次资讯渠道 "+state.news.sourceStatus.filter(function(s){return s.ok;}).length+" / "+state.news.sourceStatus.length+" 可用。"+(state.news.failedSources.length?"未获取："+state.news.failedSources.join("、")+"。":"")+"后台目标每 5 分钟采集，前台每 1 分钟核对；调度及源站可能延迟，非逐笔实时资讯。没有明确方向的消息不会强行打分。");
    var rows=contributions.map(function(c){return '<div class="evidence-row"><span>'+escapeHtml(c.label)+'</span><b>'+signedPercent(Math.expm1(c.move)*100)+'</b><small>量价模型 · 对数贡献换算</small></div>';});
    rows=rows.concat((ctx?.drivers||[]).map(function(d){return '<a class="evidence-row" href="'+safeUrl(d.url)+'" target="_blank" rel="noreferrer"><span>'+escapeHtml(d.label)+'</span><b>'+signedNumber(Math.round(d.value*100))+'</b><small>'+escapeHtml(d.detail+' · 观测 '+d.observedAt.slice(0,10))+'</small></a>';}));
    rows=rows.concat((ctx?.events||[]).slice(0,8).map(function(event){return '<a class="evidence-row" href="'+safeUrl(event.url)+'" target="_blank" rel="noreferrer"><span>'+escapeHtml(event.label)+'</span><b>'+signedNumber(Math.round(event.value*100))+'</b><small>'+escapeHtml(event.source+' · '+formatDateTime(event.publishedAt))+'</small></a>';}));
    var html=rows.join("");if(state.evidenceHTML!==html){$("evidenceRows").innerHTML=html;state.evidenceHTML=html;}
    var failed=(state.research.status||[]).filter(function(s){return !s.ok;}).map(function(s){return s.id;});
    setText("evidenceLimits","价格贡献单位为收益百分比；预测幅度根据此前已结束的误差收缩，当前保留 "+((e?.shrink||.5)*100).toFixed(0)+"%。外部输入为 −100 至 +100 的方向分，合计修正封顶 ±4%，随时间衰减。外部系数是预设规则，未冒充训练结果。"+(failed.length?"本次市场来源不可用："+failed.join("、")+"；旧观测超过 7 日退出。":"")+"央行储备、ETF 资金流只有明确事件时参与；未取得的数据不补零冒充观测。消息首次见到和发布均须早于计算时点。");
    var daily=state.history.daily;
    if(daily.length>=120){$("replayDate").min=daily[119].time;$("replayDate").max=daily.at(-1).time;if(!$("replayDate").value)$("replayDate").value=daily[Math.max(119,daily.length-64)].time;}
    $("runReplay").disabled=daily.length<120;
  }
  function runReplay(){
    var date=$("replayDate").value,days=Number($("replayHorizon").value);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>$("replayDate").max||date<$("replayDate").min){setText("replayStatus","请选择有效历史范围内的日期。");return;}
    var worker=predictionWorker();
    if(worker){state.replayRequest=(state.replayRequest||0)+1;$("runReplay").disabled=true;setText("replayStatus","正在独立计算所选历史时点…");worker.postMessage({type:"replay",id:state.replayRequest,daily:state.history.daily,date,days,evidence:evidenceData()});}
    else renderReplayResult(Quant.replay(state.history.daily,date,days,evidenceData()));
  }
  function renderReplayResult(r){
    if(!r.ready){setText("replayStatus",r.reason);return;}
    var values=[["训练截至",r.origin],["起点收盘",money(r.start)],["当时预测中枢",money(r.center)],["当时预测区间",toFixedPrice(r.low)+" — "+toFixedPrice(r.high)],["核验日期",r.target||"尚未走完该周期"],["实际收盘",r.actual?money(r.actual):"等待后续日线"],["模型绝对百分比误差",r.error===null?"待核验":r.error.toFixed(2)+"%"],["持平基准误差",r.baselineError===null?"待核验":r.baselineError.toFixed(2)+"%"],["涨跌方向",r.directionHit===null?"待核验":r.directionHit?"命中":"未命中"]];
    $("replayResults").innerHTML=values.map(function(v){return '<div><dt>'+v[0]+'</dt><dd>'+escapeHtml(v[1])+'</dd></div>';}).join("");
    setText("replayStatus","仅用截至 "+r.origin+" 的 "+r.trainCount+" 条收盘训练，不读取之后的价格作特征；后续收盘只用于核验。"+(r.evidenceCount?"当时有 "+r.evidenceCount+" 项外部存档可用。":"此日期没有当时已见的外部存档，本次仅回放量价模型。")+"休市日回退到此前末次记录；后续目标按记录交易日换算。原始价格为当前历史快照，未具备历史修订版本。单次结果不能代表总体准确率。");
  }
  function renderRiskLab() {
    var input=orderInput(),size=Quant.riskSize(state.portfolio,state.quote,state.config,input,$("riskBudgetPct").value);
    $("fillRiskSize").disabled=!size || size.grams<.01 || state.tradeSide!=="buy";
    setText("riskSizeResult",state.tradeSide!=="buy"?"风险预算用于试算新增买入数量；卖出请核对可卖持仓。":!size?"请填写 0.1—5% 的风险预算，并核对费用与止损阈值。":
      "可试算 "+size.grams.toFixed(2)+"g · 阈值 "+size.stopPct+"% · 本笔测算损失 "+cny(size.estimatedLoss)+" / 预算 "+cny(size.budgetCny)+(size.limitedBy==="cash-or-order"?" · 同时受现金或单笔上限约束":""));
    var rows=Quant.stress(state.portfolio,state.quote,state.config,input,Number($("stressMove").value));
    var html=rows?rows.map(function(r){return '<div><span>'+(r.change<0?'下跌 '+(-r.change)+'%':r.change>0?'上涨 '+r.change+'%':'价格不变')+'</span><strong>'+cny(r.equity)+'</strong><small>'+signedCny(r.delta)+' · '+(Math.abs(r.returnPct)>0&&Math.abs(r.returnPct)<.01?'变动 <0.01%':signedPercent(r.returnPct))+'</small></div>';}).join(""):'<p class="lab-empty">先补齐一笔有效模拟委托，再查看下单后的压力结果。</p>';
    if(html!==state.stressHTML){$("stressResults").innerHTML=html;state.stressHTML=html;}
  }
  function forecastSummary(forecast, score) {
    return "在当前假设下，" + forecast.label + "基准路径为 " + money(forecast.center) + "，波动情景带为 " + money(forecast.low) + " 至 " + money(forecast.high) + "。它不代表命中概率。";
  }

  function strategyActions() {
    var quality = Core.quoteState(state.quote);
    var audit=selectedAudit();
    return [
      audit?.count>=6 && audit.mae>=audit.naiveMae ? "历史检验尚未优于持平基准，先比较误差再讨论方向。" : "先查看所选周期的向前历史检验；样本不足时不判断模型优劣。",
      quality.stale ? "先核实报价时间；当前是历史输入，情景也以该时点为起点。" : "先核对来源与报价时点，再比较趋势和波动。",
      "展开预测依据，检查自动因子的时点、来源与事件修正；再用历史日期回放验证判断。",
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
        $("note-"+factor.id).textContent = "手动假设 · "+factor.note;
        input.style.setProperty("--factor-fill", (factor.value+100)/2 + "%");
        $("out-" + factor.id).textContent = signedNumber(factor.value);
        if (state.factorFrame) return;
        state.factorFrame = requestAnimationFrame(function () {
          state.factorFrame = 0;
          buildForecasts();
          renderForecasts();
          renderHistoryMetrics();
          renderDecisionContext();
          renderMarketObservations();
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
      return "<tr><td>"+escapeHtml(formatDateTime(t.createdAt))+"</td><td><span class='trade-side "+t.side+"'>"+(t.side==="buy"?"买入":"卖出")+"</span></td><td>"+number(t.grams,0).toFixed(2)+"g</td><td>"+money(t.price)+"</td><td>"+cnyPrecise(t.fee)+"</td><td>"+cnyPrecise(t.value)+"</td><td>"+escapeHtml(t.note||"—")+(t.scenarioBasis ? '<small class="ledger-basis">情景依据 · '+escapeHtml(String(t.scenarioBasis))+'</small>' : '')+"</td><td>"+escapeHtml(t.quoteAsOf?formatDateTime(t.quoteAsOf):"旧版未记录")+"</td><td>"+mode+"</td></tr>";
    }).join("") : '<tr class="empty-row"><td colspan="9"><div class="ledger-empty"><span class="empty-mark" aria-hidden="true">↗</span><strong>第一笔记录，从一个清晰假设开始。</strong><p>设置数量、核对费用与仓位，每次练习都会保留价格时点。</p><a href="#orderTicket" class="text-link">回到模拟委托 ↗</a></div></td></tr>';
    if(portfolio.trades.length>200)setText("tradeCount",portfolio.trades.length+" 笔成交 · 展示最近 200 笔，导出保留全部");
    if (portfolio.grams>0 && !(state.quote.priceCnyGram>0)) {
      ["equityValue","equityDelta","unrealizedValue","unrealizedPct","maxOrderValue","stopPrice","takePrice","breakEvenPrice"].forEach(function(id){setText(id,"—");});
      setText("goldAllocation","待估值");setText("positionUse","等待报价");setText("equityComposition","持仓等待有效报价估值");
      setText("cashRatio","总权益等待估值");
      setText("allocationNote","持仓克数和成本继续保留；有效主价恢复后再计算市值与仓位。");setText("riskGrade","待估值");
    }
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
    renderRiskLab();
    document.querySelectorAll("#quickAmounts [data-grams]").forEach(function(button) {
      var selected = Number(button.dataset.grams) === Number($("tradeGrams").value);
      button.classList.toggle("active",selected); button.setAttribute("aria-pressed",String(selected));
    });
    setText("fillOrderCapacity",state.tradeSide === "buy" ? "按单笔上限填写 ↗" : "填入全部可卖持仓 ↗");
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
      if (state.practiceBasis) next.trades[0].scenarioBasis = state.practiceBasis;
      savePortfolio(next); state.portfolio = next;
      $("tradeNote").value = ""; state.practiceBasis = null; $("practiceScenario").hidden = true;
      renderPortfolio(); renderOrderPreview(); renderHistoryMetrics(); renderDecisionContext(); syncAdviceContext(); drawAllocationChart();
      showToast("练习已记录", "成交、费用与报价时点已保存到本机。");
    } catch (error) { setText("tradeError", error.message); showToast("订单未保存", error.message, "error"); }
  }

  function renderIntelligence() {
    renderResearchHealth();
    var query = state.newsQuery.trim().toLocaleLowerCase();
    var filtered = state.news.items.filter(function (item) {
      var category = state.newsFilter === "all" || (state.newsFilter === "high" ? item.weight >= 60 : item.category === state.newsFilter);
      return category && (!query || (item.title+" "+item.source).toLocaleLowerCase().includes(query));
    });
    $("newsFreshness").textContent = state.news.items.length ? "原文最新 · "+formatDateTime(state.news.items[0].publishedAt) : "暂无有效发布";
    $("newsSourceState").textContent = ((state.researchFailures||[]).includes(1)?"本次资讯快照核对暂不可用，保留原记录。 ":"") + (state.news.failedSources.length ? "部分来源暂不可用，保留已发布记录。" : "按原文发布时间排列。") + " 明确政策与供需事件经时效、去重后参与预测；通用主题不直接判断利好利坏。";
    var html = filtered.length ? filtered.slice(0,state.newsLimit).map(renderNewsItem).join("") : '<div class="news-empty"><strong>暂时没有匹配的原文。</strong><p>试试其他关键词，或切换资讯类别。</p></div>';
    if (state.newsHTML !== html) { $("newsList").innerHTML = html; state.newsHTML = html; }
    setText("newsResultCount", "已显示 "+Math.min(state.newsLimit,filtered.length)+" / "+filtered.length+" 条");
    $("moreNews").hidden = filtered.length <= state.newsLimit;
    renderMarketObservations();
    $("sourceGrid").innerHTML = SOURCES.map(function (source) {
      return '<a class="source-card" href="' + safeUrl(source.url) +
        '" target="_blank" rel="noreferrer"><div><span>' + escapeHtml(source.tier) +
        '</span><i></i></div><strong>' + escapeHtml(source.name) +
        '</strong><small>' + escapeHtml(source.description) + "</small></a>";
    }).join("");
  }
  function renderResearchHealth(){
    var health=state.pipelineHealth?.news&&state.pipelineHealth?.factors?state.pipelineHealth:null,age=Core.ageHours(health?.generatedAt),delayed=age>25/60,offline=navigator.onLine===false;
    var partial=health?.status==='partial'||(health?.news?.available<health?.news?.total)||(health?.factors?.available<health?.factors?.total);
    var label=offline?"离线 · 保留最近记录":!health?"等待采集回执":delayed?"采集回执已延迟":health.status==='failed'?"采集异常 · 保留有效输入":partial?"更新运行中 · 部分渠道降级":"自动更新运行正常";
    setText("researchPipelineStatus",label);$("researchUpdateBar").dataset.state=offline||delayed||health?.status==='failed'?'warning':partial?'partial':'ok';
    setText("researchPipelineDetail",(health?"资讯渠道 "+health.news.available+" / "+health.news.total+" 可用，市场来源 "+health.factors.available+" / "+health.factors.total+"。":"")+(delayed&&health?"已 "+Math.floor(age*60)+" 分钟没有新回执，后台补抓会重试；旧数据保留原时点。":"后台目标每 5 分钟采集，页面每 1 分钟核对已发布快照；源站和调度可能延迟。")+((state.researchFailures||[]).length?" 本次页面核对失败，将退避重试。":"")+(state.lastResearchCheckedAt?" 本页核对 "+formatDateTime(state.lastResearchCheckedAt)+"。":""));
    setText("researchPipelineClock",health?.generatedAt?formatDateTime(health.generatedAt):"尚无回执");
    setText("researchPublishedClock",state.news.items[0]?.publishedAt?formatDateTime(state.news.items[0].publishedAt):"暂无原文");
    setText("researchDailyClock",state.history.daily.at(-1)?.time||"暂无收盘");
    $("refreshResearchBtn").disabled=state.researchRefreshing||offline;setText("refreshResearchBtn",state.researchRefreshing?"正在核对…":"核对最新快照 ↻");
    $("researchRunLink").hidden=!health?.runUrl;$("researchRunLink").href=safeUrl(health?.runUrl);
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
    var label = item.category === "domestic" ? "国内发布" : "宏观发布";
    return '<a class="news-item" href="' + safeUrl(item.url) +
      '" target="_blank" rel="noreferrer"><time>' + escapeHtml(item.timePrecision==="date-only"?formatShortDate(time).slice(0,10)+" · 仅日期":formatShortDate(time)) +
      "</time><div><strong>" + escapeHtml(item.title) + "</strong><p>" +
      escapeHtml(item.source + (item.publisher&&item.publisher!==item.source?" / "+item.publisher:"") + " · " + item.summary) + "</p></div><span class=\"news-meta\"><b class=\"impact-tag " +
      'neutral\">' + label + "</b><svg><use href=\"#i-external\"></use></svg></span></a>";
  }

  function renderMarketObservations() {
    setText("impactDirection", dataTierLabel(state.quote));
    var validHistory = state.history.daily.length >= 21, premium = state.quote.domesticPremiumPct;
    var items = [
      ["01", "AU9999 主价", state.quote.priceCnyGram>0 ? money(state.quote.priceCnyGram) : "暂无有效主价", state.quote.asOf ? "报价截至 "+formatDateTime(state.quote.asOf) : "暂无有效报价时间", "#marketDetails"],
      ["02", "20 日动量", validHistory ? signedPercent(historyMomentum(20)*100) : "有效历史不足", "仅按已记录收盘价计算", "#history"],
      ["03", "内外盘比较", Number.isFinite(premium) ? signedPercent(premium) : "等待有效参照", Number.isFinite(premium) ? "国内相对同期国际折算价" : "国际报价与汇率需处于有效时间窗口", "#researchSources"]
    ];
    var official=state.quote.officialReference;
    if(official?.timePrecision==="date-only" && official.priceCnyGram>0)items.push(["04","官方日级对照",money(official.priceCnyGram),official.referenceDate+" · 不含精确时刻，不作同步比价",safeUrl(official.sourceUrl)]);
    var html = items.map(function(item) {
      return '<a class="observation-row" href="'+item[4]+'"><span class="observation-index">'+item[0]+'</span><div><span>'+escapeHtml(item[1])+'</span><strong>'+escapeHtml(item[2])+'</strong><small>'+escapeHtml(item[3])+'</small></div><b aria-hidden="true">↗</b></a>';
    }).join("");
    if (state.observationHTML !== html) { $("impactList").innerHTML = html; state.observationHTML = html; }
    setText("researchFactorSummary", "当前假设方向分 "+signedNumber(Math.round(factorScore()))+" · "+Object.keys(state.factorOverrides).length+" 项手动设定");
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
      quoteFields:[state.quote.previousCnyGram,state.quote.openCnyGram,state.quote.highCnyGram,state.quote.lowCnyGram,state.quote.domesticPremiumPct,state.quote.dataTier,state.quote.source,state.quote.observed,state.quote.officialReference],
      horizon: state.forecastHorizon, factors: state.factors.map(function(f){return [f.id,f.value];}),
      cash: state.portfolio.cash, grams: state.portfolio.grams, cost: state.portfolio.avgCost,
      accountSummary:[state.portfolio.realized,state.portfolio.totalFees,state.portfolio.trades.length],
      risk: [state.config.maxPosition,state.config.stopLoss,state.config.takeProfit],
      history: [state.history.daily.length,state.history.daily.slice(-1)[0]], prompt: state.promptType,
      news: mergedNews().slice(0,8).map(function(n){return [n.title,n.publishedAt];}) });
  }
  function syncAdviceContext() {
    if (state.aiReportMode === "loading") return;
    if (state.aiReportMode === "external") {
      $("aiHeadline").textContent = state.aiReportKey === reportContextKey() ? state.aiReportHeadline : "已生成的研究报告 · 输入已变化，请重新生成";
      return;
    }
    renderLocalAdvice();
  }

  function renderLocalAdvice() {
    state.aiReportMode = "local";
    if (!state.forecasts.length) { $("aiHeadline").textContent="有效输入不足"; $("aiOutput").innerHTML="<h3>先补齐研究依据</h3><p>需要有效报价和至少 30 个日线点，才能生成情景摘要。</p>"; return; }
    var f = state.forecasts[state.forecastHorizon], baseline = state.baselineForecasts[state.forecastHorizon], stats = portfolioStats();
    var priceDelta = f.center-baseline.center, audit=selectedAudit();
    var titles = {daily:"盘面摘要",risk:"持仓风控",forecast:"情景推演",news:"消息线索"};
    $("aiHeadline").textContent = "本地研究笔记 · "+titles[state.promptType];
    var quoteTime = state.quote.asOf ? formatDateTime(state.quote.asOf) : "未知";
    var intro = '<p>报价截至 '+escapeHtml(quoteTime)+' · '+escapeHtml(dataTierLabel(state.quote))+'。以下为页面数据的规则整理。</p>';
    var html;
    if (state.promptType === "risk") {
      html = '<h3>先看账户，再看边界</h3><div class="report-grid"><div><span>账户权益</span><strong>'+cny(stats.equity)+'</strong></div><div><span>黄金仓位</span><strong>'+stats.allocation.toFixed(1)+'%</strong></div><div><span>浮动盈亏</span><strong>'+signedCny(stats.unrealized)+'</strong></div></div>'+
        '<p>'+(state.portfolio.grams ? '当前持仓 '+state.portfolio.grams.toFixed(2)+'g，平均成本 '+money(state.portfolio.avgCost)+'。' : '当前全部为现金，尚无持仓成本或盈亏触发条件。')+'</p>'+
        '<h3>自设条件</h3><p>单笔上限为权益的 '+escapeHtml(String(state.config.maxPosition))+'%；止损 '+escapeHtml(String(state.config.stopLoss))+'%、止盈 '+escapeHtml(String(state.config.takeProfit))+'% 仅作参考，不会自动下单。实际模拟委托另行计算价差、手续费与可用现金。</p>';
    } else if (state.promptType === "forecast") {
      html = '<h3>'+escapeHtml(f.label)+' · 假设的影响</h3><div class="report-grid"><div><span>数据基线中枢</span><strong>'+money(baseline.center)+'</strong></div><div><span>当前假设中枢</span><strong>'+money(f.center)+'</strong></div><div><span>假设带来的变化</span><strong>'+(priceDelta>0?'+':'')+priceDelta.toFixed(2)+' 元/克</strong></div></div>'+
        '<p>当前情景带 '+money(f.low)+' — '+money(f.high)+'。数据基线来自量价集成模型，外部因子使用有时效的存档修正；手动因子只表达相对基线的变化。改变假设不会改变已记录的市场价格。</p><h3>下一次回看</h3><p>先保存此刻的情景和理由，再比较之后的有效报价。短期数据基线可查看逐次历史检验；手动假设与长期外推不沿用历史覆盖率。</p>';
    } else if (state.promptType === "news") {
      html = '<h3>回到原文核实</h3><p>'+(state.news.failedSources.length ? '部分来源暂不可用，以下保留原发布时间，不代表刚刚发生。' : '下面按发布者原文时间整理，不从关键词直接推断金价方向。')+'</p>'+
        (state.news.items.length ? '<ol class="report-reading">'+state.news.items.slice(0,5).map(function(item){return '<li><a href="'+safeUrl(item.url)+'" target="_blank" rel="noreferrer">'+escapeHtml(item.title)+' ↗</a><small>'+escapeHtml(item.source+' · '+formatDateTime(item.publishedAt))+'</small></li>';}).join('')+'</ol>' : '<p>暂无有效官方条目，请从来源目录核验。</p>')+
        '<h3>阅读时分开三件事</h3><p>原文确认了什么、哪些传导仍是假设、还需要观察什么数据。资讯的主题相关程度不等于价格影响方向。</p>';
    } else {
      html = '<h3>此刻的市场输入</h3><div class="report-grid"><div><span>AU9999 主价</span><strong>'+money(state.quote.priceCnyGram)+'</strong></div><div><span>20 日变化</span><strong>'+(state.history.daily.length>=21?signedPercent(historyMomentum(20)*100):'历史不足')+'</strong></div><div><span>历史样本</span><strong>'+state.history.daily.length+' 日</strong></div></div>'+
        '<p>当前观察 '+escapeHtml(f.label)+'，情景中枢 '+money(f.center)+'。综合假设方向分 '+signedNumber(Math.round(factorScore()))+'，它是模型输入，不代表市场预测概率。</p><h3>观察与练习</h3><ol>'+strategyActions().map(function(action){return '<li>'+escapeHtml(action)+'</li>';}).join('')+'</ol>';
    }
    var auditText=audit?.count ? "所选周期历史检验 "+audit.count+" 次，平均绝对百分比误差 "+audit.mae.toFixed(2)+"%，持平基准 "+audit.naiveMae.toFixed(2)+"%。历史覆盖率 "+audit.coverage.toFixed(0)+"%，不适用于手动平移或未来保证。" : "所选周期尚无足够向前历史检验，不据此宣称预测能力。";
    $("aiOutput").innerHTML = intro+html+'<p class="report-boundary">'+escapeHtml(auditText)+'</p>'+'<p class="report-boundary">公开行情可能延迟。以上用于研究与虚拟练习；历史检验只描述过去，不能保证未来表现；手动与长期情景另行判断。</p>';
  }

  async function generateAdvice() {
    if (!state.config.aiApiKey.trim()) {
      state.aiReportMode = "local";
      renderLocalAdvice();
      showToast("本地研究笔记已更新", "已按所选主题整理当前页面数据。");
      return;
    }
    state.aiReportMode = "loading";
    renderTyping(); $("aiHeadline").textContent = "正在生成本次研究笔记";
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
      modelAudit: selectedAudit() ? {model:selectedAudit().model,days:selectedAudit().days,count:selectedAudit().count,
        maePct:selectedAudit().mae,naiveMaePct:selectedAudit().naiveMae,coveragePct:selectedAudit().coverage,
        directionPct:selectedAudit().direction,externalArchiveTests:selectedAudit().augmentedCount,
        historicalOnly:true,manualShift:Math.abs(state.scenarioModel.scoreDelta)>.0001,method:"point-in-time-ridge-ensemble-v2"} : null,
      predictionEvidence:{calculatedAt:state.quantProfile.context?.asOf,drivers:state.quantProfile.context?.drivers||[],events:state.quantProfile.context?.events||[],externalCoefficients:"fixed-prior-not-fitted"},
      selectedHorizon: state.forecasts[state.forecastHorizon],
      forecasts: state.forecasts,
      factors: state.factors,
      portfolio: Object.assign({cash:state.portfolio.cash,grams:state.portfolio.grams,avgCost:state.portfolio.avgCost,realized:state.portfolio.realized,totalFees:state.portfolio.totalFees,initialCash:state.portfolio.initialCash,tradeCount:state.portfolio.trades.length}, portfolioStats()),
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

  async function copyAdvice() {
    var text = $("aiOutput").innerText.trim(); if (!text) return;
    try { if (!navigator.clipboard?.writeText) throw Error("unavailable"); await navigator.clipboard.writeText(text); showToast("报告已复制", "可以粘贴到研究笔记中。"); }
    catch { showToast("暂时无法复制", "可使用“保存笔记”导出文本，或直接选择报告内容。", "error"); }
  }

  function drawAllCharts() {
    drawSparkChart();
    drawPriceChart();
    drawForecastChart();
    drawAllocationChart();
  }

  function setupCanvas(canvas, height) {
    var rect = canvas.getBoundingClientRect();
    var width = Math.max(1, rect.width || canvas.clientWidth || 600);
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
    var allDaily = state.history.daily;
    var view = Core.historyWindow(allDaily,state.chartRange), daily = view.points;
    renderHistoryWindow(view);
    document.querySelectorAll("[data-history-legend]").forEach(function(el){el.hidden=!state.chartIndicators[el.dataset.historyLegend];});
    canvas.setAttribute("aria-label","AU9999 记录收盘与均线图；逐日数值可通过下方滑杆读取。");
    state.chartPoints = [];
    if (daily.length < 1) {
      drawEmptyCanvas(ctx, width, height, "真实历史数据暂不可用");
      state.chartView = null; setupCanvas($("priceOverlay"),height); renderHistoryInspection(); return;
    }

    var pad = { top: 22, right: 58, bottom: 34, left: 16 };
    var reference = Core.quoteReference(state.quote,view.last.time);
    var showForecast = state.chartIndicators.forecast && state.scenarioModel && state.scenarioModel.ready;
    var plotRight = width-pad.right;
    var projectionWidth = showForecast ? Math.min(110,Math.max(54,(plotRight-pad.left)*.22)) : 0;
    var splitX = plotRight-projectionWidth;
    var historyEnd = splitX - (reference ? 22 : 0);
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
      showForecast ? forecast.flatMap(function (point) { return [point.low, point.high]; }) : [],
      reference ? [reference.price] : []
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
      return pad.left + index / Math.max(daily.length - 1, 1) * (historyEnd - pad.left);
    };
    var xForecast = function (index) {
      return historyEnd + index / Math.max(forecast.length - 1, 1) * (width - pad.right - historyEnd);
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
      ctx.fillText(projectionWidth>=76 ? "30 日假设" : "30 日", splitX + 6, pad.top + 12);
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
    drawSeriesLine(ctx, closes, xHistory, y, "#dcc080", 1.65);

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
    if (reference) {
      ctx.setLineDash([3,4]);ctx.strokeStyle="rgba(213,192,141,.6)";ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(splitX,y(reference.price));ctx.stroke();ctx.setLineDash([]);
      ctx.beginPath();ctx.arc(splitX,y(reference.price),4,0,Math.PI*2);ctx.fillStyle="#0b120d";ctx.fill();ctx.strokeStyle="#edcf90";ctx.stroke();
    }
    ctx.font="10px Inter,sans-serif";ctx.fillStyle="#aab59d";
    var dateLabels=[];
    [0,daily.length-1,Math.floor((daily.length-1)/2)].forEach(function(i) {
      var label=width<480?daily[i].time.slice(5,10):daily[i].time.slice(0,10), half=ctx.measureText(label).width/2;
      var cx=clamp(xHistory(i),pad.left+half,historyEnd-half);
      if (dateLabels.some(function(b){return cx-half<b.right+12&&cx+half>b.left-12;})) return;
      dateLabels.push({left:cx-half,right:cx+half});ctx.textAlign="center";ctx.fillText(label,cx,height-12);
    });
    state.chartView={view:view,pad:pad,plotBottom:plotBottom,height:height};
    setText("historyReferenceNote",reference ? "空心点为独立参考报价 "+money(reference.price)+" · "+formatDateTime(reference.asOf)+" · "+shortSource(reference.source)+"；不计入正式收盘、均线或回撤。" : "图表保留已记录收盘；当前没有时间匹配的有效参考报价点。");
    drawHistoryInspection();
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
    return Quant.path(start,days,state.quantProfile,m.scoreDelta);
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

  function renderHistoryWindow(view) {
    var labels={20:"近一个月",60:"近三个月",120:"近六个月",260:"近一年"};
    setText("historyWindowLabel",labels[state.chartRange]+" · "+view.count+" 个记录交易日");
    setMetricClass("historyWindowChange",Number.isFinite(view.changePct)?signedPercent(view.changePct):"—",view.changePct);
    setText("historyWindowDates",view.first ? view.first.time+" — "+view.last.time : "等待有效日线");
    setText("historyWindowExtremes",view.first?toFixedPrice(view.minClose)+" — "+toFixedPrice(view.maxClose):"—");
    setText("historyWindowDrawdown",Number.isFinite(view.maxDrawdownPct)?(view.maxDrawdownPct>0?"−":"")+view.maxDrawdownPct.toFixed(2)+"%":"—");
    $("exportHistory").disabled=!view.count;
  }
  function inspectionIndex() {
    if (!state.chartPoints.length) return -1;
    if (state.chartHover) {
      var best=0;state.chartPoints.forEach(function(p,i){if(Math.abs(p.x-state.chartHover.x)<Math.abs(state.chartPoints[best].x-state.chartHover.x))best=i;});return best;
    }
    var index=state.chartPoints.findIndex(function(p){return p.data.time===state.historySelectedTime;});
    return index<0?state.chartPoints.length-1:index;
  }
  function renderHistoryInspection() {
    var index=inspectionIndex(),point=state.chartPoints[index],input=$("historyCursor"),ready=!!point;
    input.disabled=!ready; input.max=Math.max(0,state.chartPoints.length-1);input.value=Math.max(0,index);
    $("inspectPrev").disabled=!ready||index===0;$("inspectNext").disabled=!ready||index===state.chartPoints.length-1;
    ["inspectOpen","inspectHigh","inspectLow","inspectClose","inspectChange"].forEach(function(id){if(!ready)setText(id,"—");});
    if(!ready){setText("inspectDate","等待有效日线");input.removeAttribute("aria-valuetext");setText("historyReferenceNote","有效日线不足，暂不显示历史参考。");return;}
    var p=point.data,source=state.history.daily,indexAll=source.findIndex(function(row){return row.time===p.time;});
    var previous=source[indexAll-1],change=previous?(p.close/previous.close-1)*100:NaN;
    setText("inspectDate",p.time);$("inspectDate").dateTime=p.time;
    setText("inspectClose",money(p.close));setText("inspectOpen",toFixedPrice(p.open));setText("inspectHigh",toFixedPrice(p.high));setText("inspectLow",toFixedPrice(p.low));
    setMetricClass("inspectChange",Number.isFinite(change)?signedPercent(change):"—",change);
    input.setAttribute("aria-valuetext",p.time+"，收盘 "+toFixedPrice(p.close)+" 元每克");
    input.style.setProperty("--cursor-fill",(state.chartPoints.length>1?index/(state.chartPoints.length-1)*100:0)+"%");
  }
  function drawHistoryInspection() {
    if(!state.chartView){renderHistoryInspection();return;}
    var setup=setupCanvas($("priceOverlay"),state.chartView.height),ctx=setup.ctx,index=inspectionIndex(),point=state.chartPoints[index];
    if(point){
      ctx.strokeStyle="rgba(232,215,177,.32)";ctx.lineWidth=1;ctx.setLineDash([3,5]);
      ctx.beginPath();ctx.moveTo(point.x,state.chartView.pad.top);ctx.lineTo(point.x,state.chartView.plotBottom);ctx.stroke();ctx.setLineDash([]);
      ctx.beginPath();ctx.arc(point.x,point.y,4,0,Math.PI*2);ctx.fillStyle="#0c130e";ctx.fill();ctx.strokeStyle="#f0d59b";ctx.lineWidth=2;ctx.stroke();
    }
    renderHistoryInspection();
  }
  function chooseHistoryIndex(index) {
    if(!state.chartPoints.length)return;
    index=clamp(Math.round(index),0,state.chartPoints.length-1);state.chartHover=null;state.historySelectedTime=state.chartPoints[index].data.time;drawHistoryInspection();
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
    if(state.portfolio.grams>0 && !(state.quote.priceCnyGram>0)) {canvas.setAttribute("aria-label","等待有效报价，暂不计算账户占比。");return;}
    canvas.setAttribute("aria-label","模拟账户黄金与现金占比");
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
    $("fillOrderCapacity").addEventListener("click", function() {
      $("tradeGrams").value = (state.tradeSide === "buy" ? suggestedGrams() : Core.orderCapacity(state.portfolio,state.quote,state.config,{side:"sell"})).toFixed(2);
      renderOrderPreview(); $("tradeGrams").focus({preventScroll:true});
    });
    $("clearPracticeScenario").addEventListener("click", function() { $("practiceScenario").hidden = true; state.practiceBasis = null; });
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
        document.querySelectorAll("#chartRanges button").forEach(function(item){item.classList.toggle("active",item===button);item.setAttribute("aria-pressed",String(item===button));});
        state.chartRange=number(button.dataset.range,260);state.chartHover=null;drawPriceChart();
      });
    });
    document.querySelectorAll("[data-indicator]").forEach(function(input){input.addEventListener("change",function(){state.chartIndicators[input.dataset.indicator]=input.checked;drawPriceChart();});});
    $("priceChartWrap").addEventListener("pointermove",function(event){
      if(event.pointerType==="touch")return;
      var rect=$("priceCanvas").getBoundingClientRect();state.chartHover={x:event.clientX-rect.left};
      if(!state.hoverFrame)state.hoverFrame=requestAnimationFrame(function(){state.hoverFrame=0;drawHistoryInspection();});
    },{passive:true});
    $("priceChartWrap").addEventListener("pointerleave",function(){
      if(state.hoverFrame)cancelAnimationFrame(state.hoverFrame);state.hoverFrame=0;state.chartHover=null;drawHistoryInspection();
    });
    $("priceChartWrap").addEventListener("click",function(event){
      var rect=$("priceCanvas").getBoundingClientRect();state.chartHover={x:event.clientX-rect.left};chooseHistoryIndex(inspectionIndex());
    });
    $("historyCursor").addEventListener("input",function(){chooseHistoryIndex(Number(this.value));});
    $("inspectPrev").addEventListener("click",function(){chooseHistoryIndex(inspectionIndex()-1);});
    $("inspectNext").addEventListener("click",function(){chooseHistoryIndex(inspectionIndex()+1);});
    $("exportHistory").addEventListener("click",function(){
      var rows=Core.historyWindow(state.history.daily,state.chartRange).points;if(!rows.length)return;
      var csv=[["日期","开盘_元每克","最高_元每克","最低_元每克","收盘_元每克","成交量","成交额"]].concat(rows.map(function(p){return[p.time,p.open,p.high,p.low,p.close,p.volume,p.turnover];}));
      download("aurum-daily-"+rows[0].time+"-"+rows[rows.length-1].time+".csv","\ufeff"+csv.map(function(row){return row.map(Core.csvCell).join(",");}).join("\n"),"text/csv;charset=utf-8");
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
      $(id).addEventListener("input", function(){renderOrderPreview();if(id!=="tradeGrams")renderPortfolio();});
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
        state.newsLimit = 5;
        document.querySelectorAll("#newsFilters button").forEach(function (item) {
          item.classList.toggle("active", item === button);
          item.setAttribute("aria-pressed",String(item === button));
        });
        renderIntelligence();
      });
    });
    $("newsSearch").addEventListener("input", function() {
      state.newsQuery = $("newsSearch").value; state.newsLimit = 5;
      clearTimeout(state.newsSearchTimer); state.newsSearchTimer = setTimeout(renderIntelligence,160);
    });
    $("moreNews").addEventListener("click", function() { state.newsLimit += 5; renderIntelligence(); });
    document.querySelectorAll("#promptChips button").forEach(function (button) {
      button.classList.toggle("active",button.dataset.prompt === state.promptType);
      button.setAttribute("aria-pressed",String(button.dataset.prompt === state.promptType));
      button.addEventListener("click", function () {
        state.promptType = button.dataset.prompt;
        document.querySelectorAll("#promptChips button").forEach(function (item) {
          item.classList.toggle("active", item === button);
          item.setAttribute("aria-pressed",String(item === button));
        });
        syncAdviceContext();
      });
    });
    $("generateAdvice").addEventListener("click", generateAdvice);
    $("copyAdvice").addEventListener("click", copyAdvice);
    $("saveAdvice").addEventListener("click",function(){
      if(state.aiReportMode === "loading"){showToast("笔记仍在生成", "请等待本次生成结束后保存。");return;}
      var text=$("aiOutput").innerText.trim();if(!text)return;
      download("aurum-research-"+new Date().toISOString().slice(0,10)+".txt","AURUM · "+$("aiHeadline").textContent+"\n\n"+text,"text/plain;charset=utf-8");
    });
    $("useStrategyBtn").addEventListener("click", function () {
      var f = state.forecasts[state.forecastHorizon]; if (!f) return;
      setTradeSide("buy");
      $("tradeGrams").value = suggestedGrams().toFixed(2);
      var basis = f.label+"情景 · 中枢 "+toFixedPrice(f.center)+" · 区间 "+toFixedPrice(f.low)+"—"+toFixedPrice(f.high)+" · 报价截至 "+(state.quote.asOf ? formatDateTime(state.quote.asOf) : "未知");
      state.practiceBasis = basis;
      setText("practiceScenarioText",basis); $("practiceScenario").hidden = false;
      if (!$("tradeNote").value.trim()) $("tradeNote").value = basis;
      window.AurumUI.go("trading");
      renderOrderPreview();
      $("tradeGrams").focus({preventScroll:true});
      showToast("情景依据已带入", "按单笔上限填写数量，可自行调整；请复核报价与费用。");
    });
    ["openSettings", "openSettingsMobile", "configureAI"].forEach(function (id) {
      $(id).addEventListener("click", openSettings);
    });
    $("closeSettings").addEventListener("click", closeSettings);
    $("drawerBackdrop").addEventListener("click", closeSettings);
    $("saveSettings").addEventListener("click", applySettings);
    $("restoreDefaults").addEventListener("click", restoreDefaults);
    ["purity","productPremium"].forEach(function(id){$(id).addEventListener("input",renderProductEstimate);});
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
      button.setAttribute("aria-pressed",String(button.dataset.side === state.tradeSide));
    });
    $("tradeBtn").className = "execute-button " + state.tradeSide;
    $("tradeBtn").querySelector("span").textContent = state.tradeSide === "buy" ? "确认模拟买入" : "确认模拟卖出";
    renderOrderPreview();
  }

  function suggestedGrams() {
    return Core.orderCapacity(state.portfolio,state.quote,state.config,{side:"buy",feePct:$("feeRate").value,spreadPct:$("tradeSpread").value});
  }

  var dialogFocus = null;

  function lockSurface(dialog, opening) {
    if (opening) { dialogFocus = document.activeElement; $("surface").inert = true; dialog.inert = false; dialog.setAttribute("aria-hidden", "false"); }
    else { dialog.inert = true; dialog.setAttribute("aria-hidden", "true"); if (!document.querySelector(".settings-drawer.open,.confirm-modal.open")) { $("surface").inert = false; if (dialogFocus && dialogFocus.isConnected) dialogFocus.focus({preventScroll:true}); } }
  }

  function openSettings() {
    syncSettingsForm();
    lockSurface($("settingsDrawer"), true);
    $("settingsDrawer").classList.add("open"); renderProductEstimate();
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
    var before = state.config; state.config = Object.assign({}, DEFAULT_CONFIG); syncSettingsForm(); state.config = before; renderProductEstimate();
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
    var rows = [["时间", "方向", "克数", "成交价_元每克", "手续费", "成交金额", "备注", "报价时点", "数据模式", "情景依据", "报价来源", "参考克价", "手续费率_%", "模拟价差_%"]].concat(state.portfolio.trades.map(function (t) {
      return [t.createdAt, t.side === "buy" ? "买入" : "卖出", t.grams, t.price, t.fee, t.value, t.note || "", t.quoteAsOf || "旧版未记录", t.dataMode || "旧版记录", t.scenarioBasis || "",t.quoteSource || "旧版未记录",t.quotePriceCnyGram ?? "",t.feePct ?? "",t.spreadPct ?? ""];
    }));
    download("aurum-practice-" + new Date().toISOString().slice(0,10) + ".csv", "\ufeff" + rows.map(function (row) { return row.map(Core.csvCell).join(","); }).join("\n"), "text/csv;charset=utf-8");
  }

  function download(name, content, type) {
    var url = URL.createObjectURL(new Blob([content], {type:type})), a = document.createElement("a");
    a.href = url; a.download = name; a.click(); setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }

  function startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    var interval = Core.refreshDelay(state.config.refreshSeconds,state.feedFailures);
    state.pollRemaining = interval;
    state.pollTimer = setInterval(function () {
      if (document.hidden) return;
      refreshResearchData(false);
      if (navigator.onLine === false || state.config.priceProvider !== "domestic") {renderStatus();return;}
      state.pollRemaining -= 1;
      if (state.pollRemaining <= 0) {
        state.pollRemaining = Core.refreshDelay(state.config.refreshSeconds,state.feedFailures);
        refreshQuote();
      }
      renderStatus();
      renderAlerts();
    }, 1000);
  }

  function renderAlerts() {
    if (state.quote.sourceConflict || Core.quoteState(state.quote).stale) return;
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
    window.addEventListener("offline",renderStatus);
    window.addEventListener("online",function(){if(!document.hidden)refreshResearchData(true);!document.hidden && state.config.priceProvider === "domestic"?refreshQuote():renderStatus();});
    document.addEventListener("visibilitychange",function(){
      if(document.hidden)return;
      refreshResearchData(false);
      if(state.config.priceProvider === "domestic" && (!state.lastPollAt || Date.now()-state.lastPollAt.getTime()>state.config.refreshSeconds*1000))refreshQuote();
      else renderStatus();
    });
    window.addEventListener("storage", function (event) {
      if (event.key !== PORTFOLIO_KEY) return;
      try { state.portfolio = event.newValue ? Core.validatePortfolio(JSON.parse(event.newValue)) : Core.emptyPortfolio(); portfolioSignature = event.newValue; portfolioReadFailed = false; storageNotice = ""; renderAll(); showToast("账户已同步", "已读取另一个页面保存的记录。"); }
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
    var healthy=state.sourceHealth.filter(function(item){return item.ok;}).length;
    return shortSource(state.quote.source)+" · "+(state.sourceHealth.length?healthy+"/"+state.sourceHealth.length+" 链路可用 · ":"")+Core.quoteState(state.quote).label;
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
    return parsed >= 0 ? parsed.toFixed(0) : "--";
  }

  function compactCurrency(value) {
    var parsed = number(value, 0);
    if (parsed >= 100000000) return "¥" + (parsed / 100000000).toFixed(2) + " 亿";
    if (parsed >= 10000) return "¥" + (parsed / 10000).toFixed(1) + " 万";
    return parsed >= 0 ? cny(parsed) : "--";
  }

  function setText(id, value) {
    var element = $(id);
    if (element && element.textContent !== String(value)) element.textContent = value;
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
      getQuote: function () { return {price:state.quote.priceCnyGram, asOf:state.quote.asOf, dataTier:state.quote.dataTier}; },
      getSnapshot: function () {
        var f = state.forecasts[state.forecastHorizon];
        if (!f) throw Error("有效历史与报价不足，暂时无法记录情景。");
        return {price:state.quote.priceCnyGram, quoteAsOf:state.quote.asOf, source:state.quote.source, dataTier:state.quote.dataTier,
          horizon:f.label, days:f.days, center:f.center, low:f.low, high:f.high, method:"AURUM Quant v2 · 正则化集成 / 时点事件 / EWMA",
          factors:state.factors.map(function (factor) { return {id:factor.id,name:factor.name,value:factor.value,
            origin:state.factorOverrides[factor.id] ? "manual" : factor.id === "sgeMomentum" ? "history" : "assumption"}; })};
      }
    });
    bindEvents();
    $("exportBacktest").addEventListener("click",exportBacktest);
    $("validationPhase").addEventListener("change",function(){state.validationLimit=4;renderValidation();});
    $("moreValidation").addEventListener("click",function(){state.validationLimit=(state.validationLimit||4)+4;renderValidation();});
    $("exportValidation").addEventListener("click",exportValidation);
    $("validationRecords").addEventListener("click",function(event){var link=event.target.closest("[data-validation-date]");if(!link)return;$("replayDate").value=link.dataset.validationDate;$("replayHorizon").value=link.dataset.validationDays;$("replayLab").open=true;runReplay();});
    $("runReplay").addEventListener("click",runReplay);
    $("refreshResearchBtn").addEventListener("click",function(){refreshResearchData(true);});
    $("riskBudgetPct").addEventListener("input",renderRiskLab);
    $("stressMove").addEventListener("change",renderRiskLab);
    $("fillRiskSize").addEventListener("click",function(){
      var size=Quant.riskSize(state.portfolio,state.quote,state.config,orderInput(),$("riskBudgetPct").value);
      if(!size || size.grams<.01)return;
      $("tradeGrams").value=size.grams.toFixed(2);renderOrderPreview();$("tradeGrams").focus({preventScroll:true});
    });
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

