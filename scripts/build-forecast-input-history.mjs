import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {fetchText} from './fetch-utils.mjs';
import Vintage from '../assets/vintage-store.js';
import {readJson, writeJson, hash} from './forecast-study-io.mjs';

const start = '2019-01-01';
const treasuryUrl = year => `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_real_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
const treasuryInfo = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_real_yield_curve_rates';

export function parseTreasuryCsv(text) {
  const [heading, ...lines] = text.trim().split(/\r?\n/);
  const columns = heading.replace(/^\uFEFF/, '').split(',').map(cell => cell.replaceAll('"', '').trim());
  const dateColumn = columns.indexOf('Date');
  const rateColumn = columns.indexOf('10 YR');
  if (dateColumn < 0 || rateColumn < 0) throw Error('Treasury CSV is missing the dated 10 YR column');
  const rows = new Map();
  for (const line of lines) {
    const cells = line.split(',');
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(cells[dateColumn]?.replaceAll('"', '').trim() || '');
    const raw = cells[rateColumn]?.replaceAll('"', '').trim();
    if (!match || !raw || !/^-?\d+(?:\.\d+)?$/.test(raw)) continue;
    const date = [match[3], match[1].padStart(2, '0'), match[2].padStart(2, '0')].join('-');
    const value = Number(raw);
    if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || Math.abs(value) > 30) continue;
    if (rows.has(date) && rows.get(date) !== value) throw Error('Conflicting Treasury rows for ' + date);
    rows.set(date, value);
  }
  return [...rows].sort(([a], [b]) => a.localeCompare(b));
}

function recordSeries(rows, provenance, capturedAt) {
  const days = rows.filter(([date]) => date >= start && Vintage.readyAt(date) <= capturedAt);
  if (days.length < 1000) throw Error('Historical coverage is incomplete for ' + provenance.source);
  return {...provenance, rows: days.map(([date, value]) => [date, value, Vintage.readyAt(date)])};
}

export async function buildInputHistory({archive, capturedAt, loadRates = year => fetchText(treasuryUrl(year), {timeoutMs: 18000, maxChars: 150_000, retries: 2})}) {
  const year = Number(capturedAt.slice(0, 4));
  const rates = [], rateFiles = [];
  for (let y = Number(start.slice(0, 4)); y <= year; y++) {
    const body = await loadRates(y);
    const observations = parseTreasuryCsv(body).filter(([date]) => date.startsWith(String(y)));
    if (y < year && observations.length < 200) throw Error('Incomplete Treasury history for ' + y);
    rates.push(...observations);
    rateFiles.push({year: y, url: treasuryUrl(y), sha256: hash(body), rows: observations.length});
  }
  function market(id, source, expectedSource) {
    const byDay = new Map();
    for (const row of Vintage.select(archive, id, capturedAt, {source: expectedSource})) {
      if (row.value > 0) byDay.set(row.date, row.value);
    }
    const url = archive.records.find(row => row.series === id && row.source === expectedSource)?.url;
    return recordSeries([...byDay], {source, url, quality: 'lagged-snapshot'}, capturedAt);
  }
  return {schema: 1, capturedAt, cutoffPolicy: '次日 UTC 08:00 才用于历史重建；当前快照的修订史无法从本文件还原', series: {
    goldUsdOz: market('goldUsdOz', '新浪国际黄金现货日线 XAU', 'sina-xau'),
    usdCny: market('usdCny', 'ECB 欧元参考汇率交叉折算', 'ecb-fx'),
    realRates: recordSeries(rates, {source: '美国财政部 10 年期实际收益率', url: treasuryInfo, quality: 'lagged-snapshot', files: rateFiles}, capturedAt)
  }};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const folder = process.argv[2];
  const out = await buildInputHistory({archive: await readJson('data/observation-vintages.json'), capturedAt: new Date().toISOString(),
    ...(folder ? {loadRates: year => readFile(`${folder}/treasury-${year}.csv`, 'utf8')} : {})});
  await writeJson('data/forecast-input-history.json', out);
  console.log(Object.fromEntries(Object.entries(out.series).map(([name, series]) => [name, {count: series.rows.length, first: series.rows[0][0], last: series.rows.at(-1)[0]}])));
}
