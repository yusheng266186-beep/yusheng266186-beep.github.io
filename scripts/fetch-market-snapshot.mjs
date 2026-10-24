import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const outputPath = path.resolve("data/market-snapshot.json");
import Core from "../assets/core.js";
import {collectQuotes,parseOfficialReference} from "./quote-collector.mjs";
const configuredFx = Core.numeric(process.env.USD_CNY);
const fxAsOf = Core.timestamp(process.env.USD_CNY_ASOF);
const usdCny = configuredFx > 0 && Core.ageHours(fxAsOf) <= 72 ? configuredFx : null;

let previous={};
try {previous=JSON.parse(await readFile(outputPath,"utf8"));} catch {}
const providers=[["Eastmoney AU9999",fetchEastmoneyDomestic],["Sina AU9999",fetchSinaDomestic],["SGE delayed",fetchSgeOfficialDelayed]];
const started=Date.now();
const [collected,international] = await Promise.all([
  collectQuotes({providers,previous}),
  fetchYahooGoldFuture().catch(error=>{console.warn(`International reference failed: ${error.message}`);return null;})
]);
const domestic=collected.quote,sourceHealth=collected.sourceHealth;

const snapshot = {
  ...domestic,
  sourceHealth,
  officialReference:collected.references[0] || null,
  collectionMs: Date.now()-started,
  usdCny,
  fxAsOf: usdCny ? fxAsOf : null,
  fxSource: usdCny ? "Explicit USD_CNY environment setting" : null,
  internationalReference: international
};

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
    observed:Core.contractObserved(main),
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

async function fetchSinaDomestic() {
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
    observed:Core.contractObserved(main),
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
    delay: "新浪上金所公开行情；与其他来源并发核对，按报价时点选择",
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
  const previousClose = Core.numeric(parts[5]);
  const changePct = Core.numeric(String(parts[17] || "").replace("%", ""));
  const symbol = requestSymbol === "SGE_AU9999" ? "AU9999" : "AUTD";
  return {
    symbol,
    name: symbol === "AU9999" ? "黄金9999" : "黄金T+D",
    exchangeName: parts[2] || symbol,
    latest,
    high: Core.numeric(parts[7]),
    low: Core.numeric(parts[8]),
    open: Core.numeric(parts[6]),
    previousClose,
    change: latest - previousClose,
    changePct: Number.isFinite(changePct) ? changePct : (latest - previousClose) / previousClose * 100,
    volume: Core.numeric(parts[14]),
    turnover: Core.numeric(parts[15]),
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
  const scale = 10 ** Core.numeric(data.f152,2);
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
    volume: Core.numeric(data.f47),
    turnover: Core.numeric(data.f48),
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
  return parseOfficialReference(await res.text());
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
    priceCnyGram: usdCny ? close / 31.1034768 * usdCny : null,
    asOf: timestamp ? new Date(timestamp * 1000).toISOString() : null,
    source: "Yahoo Finance GC=F delayed futures reference",
    delay: "international delayed reference"
  };
}

function scaled(value, scale) {
  const number = Core.numeric(value);
  return Number.isFinite(number) && number > -1000000000 ? number / scale : null;
}

function strip(value) {
  return value.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function timestampFromEastmoney(value) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 946684800) return new Date(seconds * 1000).toISOString();
  return null;
}

function timestampFromSina(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`).toISOString();
}


async function readExistingSnapshot() {
  try {
    return JSON.parse(await readFile(outputPath, "utf8"));
  } catch {
    return null;
  }
}

