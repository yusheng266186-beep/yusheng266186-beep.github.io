import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import Site from '../assets/site-data.js';
import Quant from '../assets/quant.js';
import {parseTreasuryCsv} from '../scripts/build-forecast-input-history.mjs';
import {featurePanel, ridgeForecast, studyId} from '../scripts/forecast-study-model.mjs';
import {summarizeStudy, updateStudyLedger} from '../scripts/forecast-study-ledger.mjs';
import {profileKey} from '../scripts/forecast-profile-cache.mjs';
import {readJson, hash} from '../scripts/forecast-study-io.mjs';
import {buildSiteSnapshot} from '../scripts/site-snapshot.mjs';

test('Treasury parser accepts zero and negative real yields, rejects conflicts and invalid dates', () => {
  const header = 'Date,"5 YR","10 YR"\n';
  assert.deepEqual(parseTreasuryCsv(header + '1/2/2020,0.1,-0.02\n02/30/2020,0.1,2\n1/3/2020,0.1,0\n1/4/2020,0.1,\n'),
    [['2020-01-02', -.02], ['2020-01-03', 0]]);
  assert.throws(() => parseTreasuryCsv(header + '1/2/2020,0.1,1\n1/2/2020,0.1,2\n'), /Conflicting/);
});

test('future releases, revisions and target prices cannot change a past candidate', async () => {
  const frozen = await readJson('docs/validation/5.4.0/frozen-inputs.json');
  const daily = frozen.closed.slice(0, 500);
  const origin = 460;
  const previous = featurePanel(daily, frozen.seed);
  const forecast = ridgeForecast(daily, previous, origin, 5, 'gold-fx-rates');
  assert.ok(forecast && forecast.trainCount >= 120);
  const seed = structuredClone(frozen.seed);
  seed.series.realRates.rows.push([daily[origin - 1].time, 29, daily[origin + 2].time + 'T15:00:00Z']);
  const revised = daily.map((row, i) => i <= origin ? row : {...row, close: row.close * 1.5});
  const after = featurePanel(revised, seed);
  assert.deepEqual(after.features.slice(0, origin + 1), previous.features.slice(0, origin + 1));
  assert.deepEqual(ridgeForecast(revised, after, origin, 5, 'gold-fx-rates'), forecast);
});

test('a study result uses only closes after public Git evidence and keeps original bytes on retries', () => {
  const empty = {schema: 1, studyId, entries: [], receipts: {}, outcomes: {}};
  const day = (time, close) => ({time, close, observedAt: time + 'T08:00:00Z'});
  const origin = day('2026-11-24', 100), next = day('2026-11-25', 110), later = day('2026-11-26', 120);
  const forecast = {center: 105, low: 90, high: 120};
  const issued = {id: 'fixture', origin: origin.time, issuedAt: '2026-11-24T08:05:00Z', anchor: 100, revision: 'fixture', forecasts: [{days: 7, steps: 1,
    arms: {flat: forecast, production: forecast, 'price-ridge': forecast, 'gold-fx': forecast, 'gold-fx-rates': forecast}}]};
  const frozen = updateStudyLedger(empty, {daily: [origin], issued, now: issued.issuedAt});
  assert.equal(frozen.entries.length, 1);
  const noProof = updateStudyLedger(frozen, {daily: [origin, next], now: '2026-11-25T09:00:00Z'});
  assert.equal(Object.keys(noProof.outcomes).length, 0);
  const confirmed = updateStudyLedger(frozen, {daily: [origin], observedEntries: [issued], sourceSha: '1'.repeat(40), now: '2026-11-24T08:10:00Z'});
  assert.equal(confirmed.receipts.fixture.observedAt, '2026-11-24T08:10:00Z');
  const resolved = updateStudyLedger(confirmed, {daily: [origin, next, later], now: '2026-11-26T09:00:00Z'});
  assert.equal(resolved.outcomes['fixture|7'].target, next.time);
  assert.equal(summarizeStudy(resolved, 'fixture').horizons[0].count, 1);
  assert.deepEqual(updateStudyLedger(resolved, {daily: [origin, {...next, close: 119}, later], now: '2026-11-26T10:00:00Z'}), resolved);
});

test('a receipt outside the preset issue window never counts', () => {
  const entry = {id: 'a', origin: '2026-11-24', issuedAt: '2026-11-24T08:00:00Z', forecasts: []};
  const past = {schema: 1, studyId, entries: [entry], receipts: {}, outcomes: {}};
  const result = updateStudyLedger(past, {daily: [], observedEntries: [entry], now: '2026-11-24T15:31:00Z', sourceSha: '1'.repeat(40)});
  assert.deepEqual(result, past);
});

test('price fit cache reuses only evidence eligible at historical close', () => {
  const rows = [{time: '2026-11-26', open: 99, high: 105, low: 98, close: 101, volume: 1}];
  const before = {firstSeenAt: '2026-11-26T06:10:00Z', publishedAt: '2026-11-26T05:00:00Z', title: 'known'};
  const after = {firstSeenAt: '2026-11-26T08:10:00Z', publishedAt: '2026-11-26T08:00:00Z', title: 'later'};
  const evidence = {news: [before], snapshots: [], aiNews: {schema: 1, generatedAt: '2026-11-26T08:00:00Z', events: []}};
  const initial = profileKey('fixture', rows, evidence);
  assert.equal(profileKey('fixture', rows, {...evidence, news: [before, after], snapshots: [{capturedAt: after.firstSeenAt}]}), initial);
  assert.notEqual(profileKey('fixture', rows, {...evidence, news: [{...before, title: 'an eligible correction'}]}), initial);
  assert.notEqual(profileKey('fixture', [{...rows[0], close: 102}], evidence), initial);
});

test('the lean snapshot preserves prices and intervals while heavy files remain opt-in', async () => {
  const paths = {market: 'market-snapshot.json', health: 'pipeline-health.json', history: Site.files.history,
    publication: Site.files.publication, news: Site.files.news, research: Site.files.research};
  const pairs = await Promise.all(Object.entries(paths).map(async ([key, file]) => [key, await readFile('data/' + file)]));
  const payload = Object.fromEntries(pairs.map(([key, bytes]) => [key, JSON.parse(bytes)]));
  const snapshot = buildSiteSnapshot(payload, Object.fromEntries(pairs));
  assert.equal(Site.valid(snapshot), true);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 160 * 1024);
  assert.deepEqual(Site.forChapter('overview'), []);
  assert.deepEqual(Site.forChapter('history'), ['history']);
  assert.ok(Site.forChapter('forecast', {study: true}).includes('studyStatus'));
  assert.ok(!Site.forChapter('forecast').includes('analysisDesk'));
  const publication = payload.publication;
  assert.ok(Site.validProfile(snapshot.forecast, publication.methodHash));
  for (const days of [7, 30, 180, 365, 1095]) {
    const full = Quant.at(publication.anchor, days, publication.defaultProfile);
    const small = Quant.at(publication.anchor, days, snapshot.forecast.profile);
    for (const key of ['center', 'low', 'high']) assert.equal(small[key], full[key]);
  }
  const bytes = Buffer.from('{"confirmed":true}');
  assert.deepEqual(await Site.decodeResource(bytes, hash(bytes), webcrypto.subtle), {confirmed: true});
  await assert.rejects(Site.decodeResource(bytes, '0'.repeat(64), webcrypto.subtle), /changed during publication/);
});
