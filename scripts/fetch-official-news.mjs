import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mergeFeedResults } from "./news-utils.mjs";
import Evidence from "../assets/evidence.js";

const sources = [
  ["fed-all", "Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml"],
  ["fed-monetary", "Fed Monetary Policy", "https://www.federalreserve.gov/feeds/press_monetary.xml"],
  ["bls-cpi", "BLS CPI", "https://www.bls.gov/feed/cpi.rss"],
  ["bls-ppi", "BLS PPI", "https://www.bls.gov/feed/ppi.rss"],
  ["bls-jobs", "BLS Employment", "https://www.bls.gov/feed/empsit.rss"],
  ["fed-speeches", "Fed Speeches", "https://www.federalreserve.gov/feeds/speeches.xml"],
  ["ecb", "European Central Bank", "https://www.ecb.europa.eu/rss/press.html"],
  ["bea", "BEA Economic Releases", "https://apps.bea.gov/rss/rss.xml"],
  ["bbc-world", "BBC World", "https://feeds.bbci.co.uk/news/world/rss.xml"],
  ["cnbc-economy", "CNBC Economy", "https://www.cnbc.com/id/20910258/device/rss/rss.html"]
];

const outputPath = path.resolve("data/news.json");
const settled = await Promise.allSettled([
  ...sources.map(fetchSource),
  fetchSgeNotices()
]);
let previous = {};
try { previous = JSON.parse(await readFile(outputPath,"utf8")); } catch {}
const nextPayload = mergeFeedResults(previous, settled, [...sources.map(s => s[1]), "上海黄金交易所"]);
const items = nextPayload.items;
await mkdir(path.dirname(outputPath), { recursive: true });
const next = JSON.stringify(nextPayload, null, 2);
const current = JSON.stringify(previous);

if (normalize(current) !== normalize(next) || previous.generatedAt !== nextPayload.generatedAt) {
  await writeFile(outputPath, next);
  console.log(`Updated ${outputPath} with ${items.length} official news items.`);
} else {
  console.log("Official news snapshot is already current.");
}

async function fetchSource([id, name, url]) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: { "User-Agent": "AurumGoldDashboard/3.0" }
  });
  if (!res.ok) throw new Error(`${name} returned ${res.status}`);
  const xml = await res.text();
  const items = parseItems(xml, { id, name, url })
    .filter((item) => !["fed-all","bbc-world","cnbc-economy"].includes(id) || isGoldRelevant(item))
    .slice(0, 10);
  if (!items.length) throw new Error(`${name} returned no dated items`);
  await Promise.all(items.filter(item=>["fed-monetary","ecb"].includes(id)&&/FOMC statement|monetary policy decisions/i.test(item.title)&&Date.now()-Date.parse(item.publishedAt)<7*86400000).slice(0,3).map(async item=>{
    try{
      const article=await fetch(item.url,{signal:AbortSignal.timeout(8000)});if(!article.ok)return;
      const text=clean((await article.text()).replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi," "));
      const sentences=text.split(/(?<=[.!?])\s+/).filter(s=>s.length<700&&Evidence.classifyNews({title:s}).score);
      if(sentences.length){item.summary=sentences.slice(0,2).join(" ").slice(0,1000);item.impact=Evidence.classifyNews(item).score>0?"bullish":"bearish";}
    }catch{/* RSS item remains usable when the linked decision is unavailable. */}
  }));
  return items;
}

async function fetchSgeNotices() {
  const baseUrl = "https://www.sge.com.cn";
  const res = await fetch(baseUrl, {
    signal: AbortSignal.timeout(12000),
    headers: { "User-Agent": "Mozilla/5.0 AurumGoldDashboard/3.0" }
  });
  if (!res.ok) throw new Error(`SGE notices returned ${res.status}`);
  const html = await res.text();
  const candidates = [...html.matchAll(/href="([^"]*\/jjsnotice\/\d+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match, index) => {
      const text = clean(match[2]).replace(/\bnew\b/gi, "").trim();
      const dateMatch = text.match(/(\d{2})-(\d{2})-(\d{2})\s*$/);
      const title = text.replace(/\d{2}-\d{2}-\d{2}\s*$/, "").trim();
      const url = new URL(match[1], baseUrl).href;
      if (!title || !dateMatch) return null;
      const publishedAt = dateMatch
        ? new Date(`20${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T23:59:59+08:00`).toISOString()
        : new Date().toISOString();
      return {
        id: `sge-notice-${publishedAt.slice(0, 10)}-${index}`,
        source: "上海黄金交易所",
        title,
        url,
        publishedAt,
        timePrecision: "date-only",
        summary: "上海黄金交易所官方公告",
        impact: "neutral",
        weight: inferSgeWeight(title),
        category: "domestic"
      };
    })
    .filter(Boolean);
  const longestByUrl = new Map();
  for (const item of candidates) {
    const current = longestByUrl.get(item.url);
    if (!current || item.title.length > current.title.length) longestByUrl.set(item.url, item);
  }
  const items = [...longestByUrl.values()].slice(0, 8);
  if (!items.length) throw new Error("SGE returned no dated notices");
  return items;
}

function parseItems(xml, source) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return blocks.map((raw, index) => {
    const title = clean(readTag(raw, "title") || `${source.name} update`);
    const summary = clean(readTag(raw, "description") || title);
    const url = clean(readTag(raw, "link") || source.url);
    const publishedAt = safeDate(clean(readTag(raw, "pubDate")));
    if (!publishedAt) return null;
    return {
      id: `${source.id}-${publishedAt.slice(0, 10)}-${index}`,
      source: source.name,
      title,
      url,
      publishedAt,
      summary,
      impact: ({1:"bullish",[-1]:"bearish"})[Math.sign(Evidence.classifyNews({title,summary}).score)] || "neutral",
      weight: inferWeight(`${title} ${summary}`),
      category: "macro"
    };
  }).filter(Boolean);
}

function isGoldRelevant(item) {
  return /fomc|monetary|federal funds|interest rate|inflation|economic projection|discount rate|treasury|dollar|gold|ceasefire|armed conflict|banking crisis|war|iran|ukraine/i
    .test(`${item.title} ${item.summary}`);
}

function inferSgeImpact(text) {
  if (/风险控制|暂停|调整保证金|交易异常|灾备/.test(text)) return "mixed";
  if (/降低.*费|免收.*费|吸收.*入会|新增/.test(text)) return "bullish";
  return "neutral";
}

function inferSgeWeight(text) {
  if (/风险控制|保证金|交易时间|手续费|交割结算|休市/.test(text)) return 82;
  if (/会员|仓库|系统/.test(text)) return 58;
  return 46;
}

function readTag(raw, tag) {
  return raw.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "";
}

function clean(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[\uE000-\uF8FF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function inferImpact(text) {
  const lower = text.toLowerCase();
  const bullish = ["cut", "lower", "slowdown", "recession", "war", "risk", "inflation", "crisis", "stress"];
  const bearish = ["hike", "higher rates", "strong dollar", "resilient", "tightening", "disinflation", "growth"];
  const bullHits = bullish.filter((w) => lower.includes(w)).length;
  const bearHits = bearish.filter((w) => lower.includes(w)).length;
  if (bullHits > bearHits + 1) return "bullish";
  if (bearHits > bullHits + 1) return "bearish";
  if (bullHits || bearHits) return "mixed";
  return "neutral";
}

function inferWeight(text) {
  const lower = text.toLowerCase();
  const high = ["fomc", "federal funds", "rate", "inflation", "cpi", "ppi", "treasury", "dollar"];
  return Math.min(95, 42 + high.filter((w) => lower.includes(w)).length * 12);
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.url}|${item.title}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalize(value) {
  try {
    return JSON.stringify({ items: JSON.parse(value).items || [] });
  } catch {
    return value.trim();
  }
}

