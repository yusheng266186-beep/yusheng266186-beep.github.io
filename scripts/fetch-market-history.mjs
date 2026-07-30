import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const outputPath = path.resolve("data/market-history.json");
const sourceUrl = "https://quote.eastmoney.com/q/118.AU9999.html";

try {
  const dailyResult = await fetchDailyHistory();
  const daily = dailyResult.points;
  const intraday = await fetchKlinesWithRetry({ interval: 5, limit: 576 }).catch((error) => {
    console.warn(`Intraday history unavailable: ${error.message}`);
    return [];
  });

  if (daily.length < 30) {
    throw new Error(`daily history only returned ${daily.length} points`);
  }

  const payload = {
    market: "CN-SGE",
    symbol: "AU9999",
    name: "黄金9999",
    unit: "CNY/g",
    generatedAt: new Date().toISOString(),
    source: dailyResult.source,
    sourceUrl: dailyResult.sourceUrl,
    historyType: "public-market-snapshot",
    daily,
    intraday
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Updated ${outputPath}: ${daily.length} daily and ${intraday.length} intraday points.`);
} catch (error) {
  const current = await readExisting();
  if (current?.daily?.length >= 30) {
    console.warn(`History refresh failed; keeping existing snapshot: ${error.message}`);
  } else {
    throw error;
  }
}

async function fetchKlines({ interval, limit }) {
  const params = new URLSearchParams({
    secid: "118.AU9999",
    klt: String(interval),
    fqt: "1",
    lmt: String(limit),
    end: "20500101",
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
  });
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      Referer: "https://quote.eastmoney.com/",
      "User-Agent": "Mozilla/5.0 AurumGoldDashboard/3.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Eastmoney history returned ${response.status}`);
  }

  const payload = await response.json();
  const rows = payload?.data?.klines;
  if (!Array.isArray(rows)) {
    throw new Error("Eastmoney history returned no kline array");
  }

  return rows.map(parseKline).filter(Boolean);
}

async function fetchKlinesWithRetry(options) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetchKlines(options);
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 900));
      }
    }
  }
  throw lastError;
}

async function fetchDailyHistory() {
  try {
    const points = await fetchKlinesWithRetry({ interval: 101, limit: 420 });
    return {
      points,
      source: "东方财富 AU9999 历史行情（上金所）",
      sourceUrl
    };
  } catch (error) {
    console.warn(`Eastmoney daily history unavailable; using SGE official history: ${error.message}`);
    return {
      points: await fetchSgeDailyHistory(390),
      source: "上海黄金交易所 Au99.99 每日行情",
      sourceUrl: "https://www.sge.com.cn/sjzx/quotation_daily_new"
    };
  }
}

async function fetchSgeDailyHistory(calendarDays) {
  const end = chinaDateOffset(-1);
  const start = chinaDateOffset(-calendarDays);
  const ranges = dateRanges(start, end, 29);
  const batches = [];
  for (let index = 0; index < ranges.length; index += 3) {
    batches.push(ranges.slice(index, index + 3));
  }

  const points = [];
  for (const batch of batches) {
    const rows = await Promise.all(batch.map(fetchSgeRange));
    points.push(...rows.flat());
  }

  const unique = new Map(points.map((point) => [point.time, point]));
  return [...unique.values()].sort((a, b) => a.time.localeCompare(b.time));
}

async function fetchSgeRange([start, end]) {
  const base = new URL("https://www.sge.com.cn/sjzx/quotation_daily_new");
  base.searchParams.set("start_date", start);
  base.searchParams.set("end_date", end);
  base.searchParams.set("inst_ids", "Au99.99");
  base.searchParams.set("p", "1");
  const first = await fetchSgePage(base);
  const totalPages = Math.max(1, Number(first.match(/var totalPage=(\d+)/)?.[1] || 1));
  const pages = [first];
  for (let page = 2; page <= totalPages; page += 1) {
    base.searchParams.set("p", String(page));
    pages.push(await fetchSgePage(base));
  }
  return pages.flatMap(parseSgeDailyRows);
}

async function fetchSgePage(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "Mozilla/5.0 AurumGoldDashboard/3.0" }
      });
      if (!response.ok) throw new Error(`SGE history returned ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 700));
    }
  }
  throw lastError;
}

function parseSgeDailyRows(html) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  return rows.map((row) => {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((cell) => cleanHtml(cell[1]));
    const contractIndex = cells.indexOf("Au99.99");
    if (contractIndex < 1) return null;
    const dateIndex = contractIndex - 1;
    const open = number(cells[contractIndex + 1]);
    const high = number(cells[contractIndex + 2]);
    const low = number(cells[contractIndex + 3]);
    const close = number(cells[contractIndex + 4]);
    if (![open, high, low, close].every(Number.isFinite)) return null;
    return {
      time: cells[dateIndex],
      open,
      close,
      high,
      low,
      change: number(cells[contractIndex + 5]),
      changePct: number(String(cells[contractIndex + 6]).replace("%", "")),
      weightedAverage: number(cells[contractIndex + 7]),
      volume: number(cells[contractIndex + 8]),
      turnover: number(cells[contractIndex + 9]),
      amplitudePct: close ? ((high - low) / close) * 100 : null,
      turnoverRate: null
    };
  }).filter(Boolean);
}

function dateRanges(start, end, spanDays) {
  const ranges = [];
  let cursor = new Date(`${start}T00:00:00Z`);
  const final = new Date(`${end}T00:00:00Z`);
  while (cursor <= final) {
    const rangeStart = formatDate(cursor);
    const rangeEndDate = new Date(Math.min(
      cursor.getTime() + spanDays * 86400000,
      final.getTime()
    ));
    ranges.push([rangeStart, formatDate(rangeEndDate)]);
    cursor = new Date(rangeEndDate.getTime() + 86400000);
  }
  return ranges;
}

function chinaDateOffset(offsetDays) {
  const chinaNow = new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000);
  return [
    chinaNow.getUTCFullYear(),
    String(chinaNow.getUTCMonth() + 1).padStart(2, "0"),
    String(chinaNow.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function cleanHtml(value) {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseKline(row) {
  const fields = String(row).split(",");
  if (fields.length < 11) return null;
  const point = {
    time: fields[0],
    open: number(fields[1]),
    close: number(fields[2]),
    high: number(fields[3]),
    low: number(fields[4]),
    volume: number(fields[5]),
    turnover: number(fields[6]),
    amplitudePct: number(fields[7]),
    changePct: number(fields[8]),
    change: number(fields[9]),
    turnoverRate: number(fields[10])
  };
  if (![point.open, point.close, point.high, point.low].every(Number.isFinite)) return null;
  return point;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readExisting() {
  try {
    return JSON.parse(await readFile(outputPath, "utf8"));
  } catch {
    return null;
  }
}
