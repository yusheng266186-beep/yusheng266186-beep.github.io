import Site from '../assets/site-data.js';
import {hash} from './forecast-study-io.mjs';

function compactProfile(publication) {
  const profile = publication?.defaultProfile;
  if (!profile?.ready || profile.asOf !== publication.origin) return null;
  const context = profile.context;
  const ai = context?.aiNews;
  const light = {ready: true, count: profile.count, asOf: profile.asOf, fit: profile.fit,
    evaluations: profile.evaluations.map(({records, ...entry}) => ({...entry,
      ...(records?.length ? {auditSpan: [records[0].origin, records.at(-1).target]} : {})})),
    context: context ? {...context, aiNews: ai ? {...ai, events: [],
      features: (ai.features || []).map(f => ({...f, evidenceIds: (f.evidenceIds || []).slice(0, 6)}))} : null} : null};
  return {methodHash: publication.methodHash, origin: publication.origin, anchor: publication.anchor,
    generatedAt: publication.generatedAt, profile: light};
}

export function buildSiteSnapshot(payload, bytes) {
  const versions = {
    news: payload.news?.items,
    research: payload.research?.snapshots,
    ledger: payload.ledger?.entries
  };
  const resources = Object.fromEntries(Object.keys(Site.files).filter(key => bytes[key] && payload[key]).map(key => {
    const sha256 = hash(bytes[key]);
    return [key, {sha256, version: versions[key] ? hash(versions[key]) : sha256}];
  }));
  const {daily = [], intraday = [], ...history} = payload.history || {};
  const {items: _newsItems, ...newsStatus} = payload.news || {};
  const row = point => Object.fromEntries(['time', 'open', 'high', 'low', 'close', 'observedAt'].filter(key => point[key] !== undefined).map(key => [key, point[key]]));
  const index = {schema: 1, generatedAt: payload.health?.generatedAt || new Date().toISOString(),
    market: payload.market, health: payload.health, history: {...history, daily: daily.slice(-91).map(row), intraday: intraday.slice(-120).map(row)},
    newsStatus, forecast: compactProfile(payload.publication), resources};
  if (!Site.valid(index) || Buffer.byteLength(JSON.stringify(index)) > 160 * 1024) throw Error('Public overview did not meet its structural or 160 KiB size budget');
  return index;
}
