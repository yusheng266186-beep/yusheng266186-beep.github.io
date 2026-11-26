import {execFileSync} from 'node:child_process';
import Quant from '../assets/quant.js';
import Policy from '../assets/publication-policy.js';
import {candidateIds, closeTime, featurePanel, horizons, interval, normalizedCloses, ridgeForecast, studyId} from './forecast-study-model.mjs';
import {maxIssueDelay, summarizeStudy, updateStudyLedger} from './forecast-study-ledger.mjs';
import {hash, readJson, studyRevision, writeJson} from './forecast-study-io.mjs';

const ledgerPath = 'data/forecast-study-ledger.json';
const reportPath = 'data/forecast-study-evaluation.json';
const sourceSha = process.env.AURUM_SOURCE_SHA;
const now = new Date().toISOString();
const [history, previous, evaluation, revision] = await Promise.all([
  readJson('data/market-history.json'), readJson(ledgerPath).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return {schema: 1, studyId, entries: [], receipts: {}, outcomes: {}};
  }), readJson(reportPath), studyRevision()
]);
const daily = normalizedCloses(history);
const last = daily.at(-1);
if (!last || evaluation.studyId !== studyId) throw Error('Forecast study inputs unavailable');
const time = Date.parse(now);
const delay = time - closeTime(last.time);
let issued;
let status = 'already-frozen';
if (!previous.entries.some(entry => entry.origin === last.time)) {
  status = 'outside-issue-window';
  if (delay >= 0 && delay <= maxIssueDelay && evaluation.revision === revision) {
    const publication = await readJson('data/forecast-publication.json');
    status = 'waiting-for-coherent-publication';
    if (Policy.valid(publication, publication.methodHash, time) && publication.origin === last.time && publication.anchor === last.close
      && publication.inputs.historyAsOf === history.generatedAt && Date.parse(publication.generatedAt) <= time) {
      const [seed, vintages] = await Promise.all([readJson('data/forecast-input-history.json'), readJson('data/observation-vintages.json')]);
      const features = featurePanel(daily, seed, {vintages, currentCutoff: time});
      const forecasts = horizons.map(({days, steps}) => {
        const official = Quant.at(last.close, days, publication.defaultProfile);
        const arms = {production: {center: official.center, low: official.low, high: official.high},
          flat: {center: last.close, low: last.close * official.low / official.center, high: last.close * official.high / official.center}};
        for (const id of candidateIds) {
          const fit = ridgeForecast(daily, features, daily.length - 1, steps, id);
          if (!fit) continue;
          const errors = evaluation.horizons.find(row => row.days === days)?.calibration[id] || [];
          arms[id] = {...interval(fit.center, fit.sigma, errors), trainCount: fit.trainCount};
        }
        return {days, steps, arms};
      });
      const inputs = {historyAsOf: history.generatedAt, publicationAt: publication.generatedAt, publicationInput: publication.inputs.hash,
        priceKernel: evaluation.inputsSha256, seedSha256: hash(seed), newsFactorKey: publication.inputs.newsFactorKey || null,
        features: features.latest, featureHash: hash(features.features.at(-1)), trainingSha256: hash({daily, features: features.features})};
      issued = {id: studyId + '|' + last.time, origin: last.time, issuedAt: now, anchor: last.close, revision,
        productionMethod: publication.methodHash, sourceSha: sourceSha || null, inputHash: hash(inputs), inputs, forecasts};
      status = 'frozen';
    }
  }
}

let observedEntries = [];
if (/^[a-f0-9]{40}$/.test(sourceSha || '') && previous.entries.some(entry => !previous.receipts[entry.id] && time - closeTime(entry.origin) <= maxIssueDelay)) {
  const bytes = execFileSync('git', ['show', sourceSha + ':' + ledgerPath], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore']});
  observedEntries = JSON.parse(bytes).entries;
}
const ledger = updateStudyLedger(previous, {daily, issued, observedEntries, sourceSha, now, historyAsOf: history.generatedAt});
await writeJson(ledgerPath, ledger);
const summary = summarizeStudy(ledger, revision);
await writeJson('data/forecast-study-status.json', {schema: 1, ...summary});
console.log(JSON.stringify({status, origin: last.time, frozen: summary.frozen, published: summary.publicReceipts, horizons: summary.horizons.map(({days, count}) => ({days, count}))}));
