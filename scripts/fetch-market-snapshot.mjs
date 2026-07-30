import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const outputPath = path.resolve("data/market-snapshot.json");
const usdCny = Number(process.env.USD_CNY || 7.18);

let domestic = await fetchEastmoneyDomestic().catch(async (eastmoneyError) => {
  console.warn(`Eastmoney domestic quote failed: ${eastmoneyError.message}`);
  return fetchSinaDomestic(eastmoneyError).catch(async (sinaError) => {
    console.warn(`Sina domestic quote failed: ${sinaError.message}`);
    return fetchSgeOfficialDelayed().catch(async (sgeError) => {
      console.warn(`SGE official quote failed: ${sgeError.message}`);
      const existing = await readExistingSnapshot();
      if (existing) {
        console.log("Keeping existing domestic market snapshot.");
        return existing;
      }
      return fallbackSnapshot();
    });
  });
});

if (domestic.dataTier !== "official-delayed") {
  const officialCheck = await fetchSgeOfficialDelayed().catch((error) => {
    console.warn(`SGE cross-check failed: ${error.message}`);
    return null;
  });
  if (officialCheck) domestic = crossCheckDomestic(domestic, officialCheck);
}

const international = await fetchYahooGoldFuture().catch((error) => {
  console.warn(`International reference failed: ${error.message}`);
  return domestic.internationalReference || null;
});

const snapshot = {
  ...domestic,
  usdCny,
  internationalReference: international
};

function crossCheckDomestic(publicQuote, officialQuote) {
  const differencePct = officialQuote.priceCnyGram
    ? (publicQuote.priceCnyGram / officialQuote.priceCnyGram - 1) * 100
    : null;
  const validation = {
    source: "上海黄金交易所官方延时行情",
    checkedAt: new Date().toISOString(),
    officialPriceCnyGram: officialQuote.priceCnyGram,
    differencePct
  };
  if (Number.isFinite(differencePct) && Math.abs(differencePct) > 2.5) {
    return {
      ...officialQuote,
      delay: `公开行情与上金所官方延时价偏差 ${differencePct.toFixed(2)}%，已采用官方延时价`,
      validation
    };
  }
  return {
    ...publicQuote,
    delay: `${publicQuote.delay}；已用上金所官方延时价交叉校验`,
    validation
  };
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(snapshot, null, 2));
console.log(`Updated ${outputPath}: ${snapshot.priceCnyGram} CNY per gram from ${snapshot.primaryContract}`);

async function fetchEastmoneyDomestic() {
  const results = await Promise.all([
    fetchEastmoneyContract("AU9999", "黄金9999").then((value) => ({ value })).catch((error) => ({ error, symbol: "AU9999" })),
    fetchEastmoneyContract("AUTD", "黄金T+D").then((value) => ({ value })).catch((error) => ({ error, symbol: "AUTD" }))
  ]);
  const contracts = results.map((item) => item.value).filter(Boolean);
  const failed = results.filter((item) => item.error).map((item) => item.symbol);
  const main = contracts.find((item) => item.symbol === "AU9999");
  if (!main || !Number.isFinite(main.latest) || main.latest <= 0) {
    throw new Error("Eastmoney did not return a valid AU9999 quote");
  }
  return {
    market: "CN-SGE",
    marketRegion: "CN",
    unit: "CNY/g",
    primaryContract: main.symbol,
    priceCnyGram: main.latest,
    previousCnyGram: main.previousClose || main.open || main.latest,
    openCnyGram: main.open,
    highCnyGram: main.high,
    lowCnyGram: main.low,
    changeCnyGram: main.change,
    changePct: main.changePct,
    volume: main.volume,
    turnover: main.turnover,
    asOf: main.asOf,
    source: `东方财富 ${main.symbol} 国内行情（上金所）`,
    sourceUrl: "https://quote.eastmoney.com/q/118.AU9999.html",
    officialSource: "上海黄金交易所延时行情",
    officialUrl: "https://www.sge.com.cn/sjzx/yshqbg",
    delay: failed.length ? `国内公开行情刷新；副合约 ${failed.join("/")} 暂未返回` : "国内公开行情刷新；非交易终端逐笔行情",
    dataTier: "domestic-live",
    contracts
  };
}

async function fetchSinaDomestic(previousError) {
  const contracts = await fetchSinaContracts();
  const main = contracts.find((item) => item.symbol === "AU9999");
  if (!main || !Number.isFinite(main.latest) || main.latest <= 0) {
    throw new Error("Sina did not return a valid SGE_AU9999 quote");
  }
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
    changeCnyGram: main.change,
    changePct: main.changePct,
    volume: main.volume,
    turnover: main.turnover,
    asOf: main.asOf,
    source: "新浪财经 SGE_AU9999 国内行情（上金所）",
    sourceUrl: "https://finance.sina.com.cn/futures/quotes/SGE_AU9999.shtml",
    officialSource: "上海黄金交易所延时行情",
    officialUrl: "https://www.sge.com.cn/sjzx/yshqbg",
    delay: `东方财富 AU9999 失败后启用新浪上金所公开行情；${previousError.message}`,
    dataTier: "domestic-live",
    contracts
  };
}

async function fetchSinaContracts() {
  const symbols = ["SGE_AU9999", "SGE_AUTD"];
  const url = `https://hq.sinajs.cn/rn=${Date.now()}&list=${symbols.join(",")}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: {
      Referer: "https://finance.sina.com.cn/",
      "User-Agent": "Mozilla/5.0 AurumGoldDashboard/2.0"
    }
  });
  if (!res.ok) throw new Error(`Sina returned ${res.status}`);
  const text = new TextDecoder("gb18030").decode(await res.arrayBuffer());
  const contracts = symbols.map((symbol) => {
    const match = text.match(new RegExp(`var hq_str_${symbol}="([^"]*)";`));
    return parseSinaSge(match?.[1] || "", symbol);
  }).filter(Boolean);
  if (!contracts.length) throw new Error("Sina returned empty SGE quotes");
  return contracts;
}

function parseSinaSge(raw, requestSymbol) {
  if (!raw) return null;
  const parts = String(raw).split(",");
  const latest = Number(parts[3]);
  if (!Number.isFinite(latest) || latest <= 0) return null;
  const previousClose = Number(parts[5]) || Number(parts[6]) || latest;
  const changePct = Number(String(parts[17] || "").replace("%", ""));
  const symbol = requestSymbol === "SGE_AU9999" ? "AU9999" : "AUTD";
  return {
    symbol,
    name: symbol === "AU9999" ? "黄金9999" : "黄金T+D",
    exchangeName: parts[2] || symbol,
    latest,
    high: Number(parts[7]) || null,
    low: Number(parts[8]) || null,
    open: Number(parts[6]) || null,
    previousClose,
    change: latest - previousClose,
    changePct: Number.isFinite(changePct) ? changePct : (latest - previousClose) / previousClose * 100,
    volume: Number(parts[14]) || 0,
    turnover: Number(parts[15]) || 0,
    asOf: timestampFromSina(parts[16])
  };
}

async function fetchEastmoneyContract(symbol, fallbackName) {
  const fields = "f43,f44,f45,f46,f47,f48,f49,f50,f57,f58,f60,f86,f169,f170,f152";
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=118.${symbol}&fields=${fields}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: {
      Referer: "https://quote.eastmoney.com/",
      "User-Agent": "Mozilla/5.0 AurumGoldDashboard/2.0"
    }
  });
  if (!res.ok) throw new Error(`${symbol} returned ${res.status}`);
  const payload = await res.json();
  const data = payload?.data;
  if (!data) throw new Error(`${symbol} returned empty data`);
  const scale = 10 ** Number(data.f152 || 2);
  const latest = scaled(data.f43, scale);
  return {
    symbol: String(data.f57 || symbol),
    name: String(data.f58 || fallbackName),
    latest,
    high: scaled(data.f44, scale),
    low: scaled(data.f45, scale),
    open: scaled(data.f46, scale),
    previousClose: scaled(data.f60, scale),
    change: scaled(data.f169, scale),
    changePct: scaled(data.f170, scale),
    volume: Number(data.f47 || 0),
    turnover: Number(data.f48 || 0),
    insideVolume: Number(data.f49 || 0),
    amplitudePct: scaled(data.f50, scale),
    asOf: timestampFromEastmoney(data.f86)
  };
}

async function fetchSgeOfficialDelayed() {
  const url = "https://www.sge.com.cn/sjzx/yshqbg";
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: { "User-Agent": "Mozilla/5.0 AurumGoldDashboard/2.0" }
  });
  if (!res.ok) throw new Error(`SGE returned ${res.status}`);
  const html = await res.text();
  const rows = parseSgeRows(html);
  const main = rows.find((item) => item.symbol === "Au99.99") || rows.find((item) => item.symbol === "Au(T+D)");
  if (!main || !Number.isFinite(main.latest) || main.latest <= 0) {
    throw new Error("SGE page did not include a valid Au99.99 quote");
  }
  const date = html.match(/上海黄金交易所(\d{4}年\d{2}月\d{2}日)延时行情/)?.[1] || "";
  return {
    market: "CN-SGE",
    marketRegion: "CN",
    unit: "CNY/g",
    primaryContract: main.symbol,
    priceCnyGram: main.latest,
    previousCnyGram: main.open || main.latest,
    openCnyGram: main.open,
    highCnyGram: main.high,
    lowCnyGram: main.low,
    changeCnyGram: main.latest - (main.open || main.latest),
    changePct: main.open ? (main.latest - main.open) / main.open * 100 : 0,
    volume: null,
    turnover: null,
    asOf: date ? parseChineseDate(date) : new Date().toISOString(),
    source: "上海黄金交易所官方延时行情",
    sourceUrl: url,
    officialSource: "上海黄金交易所延时行情",
    officialUrl: url,
    delay: "官方延时行情",
    dataTier: "official-delayed",
    contracts: rows
  };
}

function parseSgeRows(html) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  return rows.map((row) => {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => strip(cell[1]));
    if (cells.length < 5) return null;
    const [symbol, latest, high, low, open] = cells;
    return {
      symbol,
      name: symbol,
      latest: Number(latest),
      high: Number(high),
      low: Number(low),
      open: Number(open),
      previousClose: Number(open),
      change: Number(latest) - Number(open),
      changePct: Number(open) ? (Number(latest) - Number(open)) / Number(open) * 100 : 0
    };
  }).filter((item) => item && item.symbol && Number.isFinite(item.latest));
}

async function fetchYahooGoldFuture() {
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?range=5d&interval=1d";
  const res = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { "User-Agent": "AurumGoldDashboard/2.0" } });
  if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const closes = (quote?.close || []).filter((value) => Number.isFinite(value));
  if (!closes.length) throw new Error("Yahoo response did not include close prices");
  const close = closes.at(-1);
  const previous = closes.length > 1 ? closes.at(-2) : close;
  const timestamp = result.timestamp?.at(-1);
  return {
    market: "COMEX",
    symbol: "GC=F",
    priceUsdOz: close,
    previousUsdOz: previous,
    priceCnyGram: close / 31.1034768 * usdCny,
    asOf: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
    source: "Yahoo Finance GC=F delayed futures reference",
    delay: "international delayed reference"
  };
}

function fallbackSnapshot() {
  return {
    market: "CN-SGE",
    marketRegion: "CN",
    unit: "CNY/g",
    primaryContract: "AU9999",
    priceCnyGram: 895,
    previousCnyGram: 881.98,
    openCnyGram: 885,
    highCnyGram: 895,
    lowCnyGram: 884,
    changeCnyGram: 13.02,
    changePct: 1.48,
    volume: null,
    turnover: null,
    asOf: new Date().toISOString(),
    source: "内嵌国内黄金快照",
    sourceUrl: "https://www.sge.com.cn/sjzx/yshqbg",
    officialSource: "上海黄金交易所延时行情",
    officialUrl: "https://www.sge.com.cn/sjzx/yshqbg",
    delay: "fallback domestic snapshot",
    dataTier: "fallback",
    contracts: [
      { symbol: "AU9999", name: "黄金9999", latest: 895, high: 895, low: 884, open: 885, previousClose: 881.98, change: 13.02, changePct: 1.48 },
      { symbol: "AUTD", name: "黄金T+D", latest: 888.1, high: 894, low: 884.15, open: 886, previousClose: 879.67, change: 8.43, changePct: 0.96 }
    ]
  };
}

function scaled(value, scale) {
  const number = Number(value);
  return Number.isFinite(number) ? number / scale : null;
}

function strip(value) {
  return value.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function timestampFromEastmoney(value) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 946684800) return new Date(seconds * 1000).toISOString();
  return new Date().toISOString();
}

function timestampFromSina(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return new Date().toISOString();
  return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`).toISOString();
}

function parseChineseDate(value) {
  const match = value.match(/(\d{4})年(\d{2})月(\d{2})日/);
  if (!match) return new Date().toISOString();
  return new Date(`${match[1]}-${match[2]}-${match[3]}T15:30:00+08:00`).toISOString();
}

async function readExistingSnapshot() {
  try {
    return JSON.parse(await readFile(outputPath, "utf8"));
  } catch {
    return null;
  }
}
