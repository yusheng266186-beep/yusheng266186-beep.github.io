import {readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {candidateIds, score, normalizedCloses, studyRoll, studyId} from './forecast-study-model.mjs';
import {readJson, writeJson, hash, studyRevision} from './forecast-study-io.mjs';

const frozenPath = 'docs/validation/5.4.0/frozen-inputs.json';
const reportPath = 'data/forecast-study-evaluation.json';
const phases = {development: ['2019-01-01', '2022-12-31'], validation: ['2023-01-01', '2024-12-31'], historical: ['2025-01-01', '9999-12-31']};
const ids = ['flat', 'incumbent', ...candidateIds];

function evaluate(records) {
  const phaseResults = {};
  for (const [phase, [start, end]] of Object.entries(phases)) {
    const eligible = records.filter(row => row.origin >= start && row.target <= end);
    const common = eligible.filter(row => ids.every(id => row.arms[id]));
    const metrics = {};
    for (const id of ids) {
      const scores = common.map(row => score(row.arms[id], row.start, row.actual));
      metrics[id] = scores.length ? Object.fromEntries(Object.keys(scores[0]).map(key => [key, scores.reduce((sum, row) => sum + row[key], 0) / scores.length])) : null;
    }
    phaseResults[phase] = {eligible: eligible.length, count: common.length, first: common[0]?.origin || null, lastTarget: common.at(-1)?.target || null, metrics};
  }
  return phaseResults;
}

function screen(phases) {
  return Object.fromEntries(candidateIds.map(id => {
    const reasons = [];
    for (const [phase, result] of Object.entries(phases)) {
      const {count, metrics: m} = result;
      if (count < 20) reasons.push(phase + ':sample');
      if (phase === 'development' || !count) continue;
      if (!(m[id].mape <= .98 * Math.min(m.incumbent.mape, m.flat.mape))) reasons.push(phase + ':mape');
      if (m[id].direction < m.incumbent.direction - .03) reasons.push(phase + ':direction');
      if (m[id].intervalScore > m.incumbent.intervalScore) reasons.push(phase + ':interval');
      if (id !== 'price-ridge' && !(m[id].mape < m['price-ridge'].mape)) reasons.push(phase + ':incremental');
    }
    return [id, {qualified: !reasons.length, reasons}];
  }));
}

const mode = process.argv[2];
if (!['--freeze', '--reproduce'].includes(mode)) throw Error('Select --freeze or --reproduce');
const revision = await studyRevision();
let frozen;
if (mode === '--freeze') {
  const [sourceCommit, asOf] = process.argv.slice(3);
  if (!/^[a-f0-9]{40}$/.test(sourceCommit || '') || !Number.isFinite(Date.parse(asOf))) throw Error('A Git source commit and ISO UTC time are required');
  const load = path => execFileSync('git', ['show', sourceCommit + ':' + path], {encoding: 'utf8', maxBuffer: 20 * 1024 * 1024});
  const history = load('data/market-history.json');
  const archive = load('data/observation-vintages.json');
  const seed = await readJson('data/forecast-input-history.json');
  const closed = normalizedCloses(JSON.parse(history)).map(({time, open, high, low, close, volume, volumeSource}) => ({time, open, high, low, close, volume, volumeSource}));
  frozen = {schema: 1, studyId, revision, asOf, sourceCommit, historySha256: hash(history), archiveSha256: hash(archive),
    incumbentKernel: hash(await Promise.all(['assets/core.js', 'assets/quant.js', 'assets/evidence.js', 'assets/news-factors.js'].map(path => readFile(path, 'utf8')))),
    closed, seed};
  await writeFile(frozenPath, JSON.stringify(frozen) + '\n', {flag: 'wx'});
} else frozen = await readJson(frozenPath);

const kernel = hash(await Promise.all(['assets/core.js', 'assets/quant.js', 'assets/evidence.js', 'assets/news-factors.js'].map(path => readFile(path, 'utf8'))));
if (frozen.revision !== revision || frozen.incumbentKernel !== kernel) throw Error('Frozen experiment kernel has changed');
const runs = studyRoll(frozen.closed, frozen.seed);
if (runs.some(run => !run.records.length)) throw Error('Insufficient valid closed-price records in the experiment snapshot');
const report = {schema: 1, studyId, revision, evaluatedAt: frozen.asOf, sourceCommit: frozen.sourceCommit, inputsSha256: hash(frozen),
  history: {count: frozen.closed.length, first: frozen.closed[0].time, last: frozen.closed.at(-1).time},
  sources: Object.fromEntries(Object.entries(frozen.seed.series).map(([key, s]) => [key, {count: s.rows.length, from: s.rows[0][0], to: s.rows.at(-1)[0], source: s.source, url: s.url, quality: s.quality}])),
  horizons: runs.map(run => {
    const metrics = evaluate(run.records);
    return {days: run.days, steps: run.steps, phases: metrics, gate: screen(metrics), recordsSha256: hash(run.records), calibration: run.errors};
  })};
if (mode === '--freeze') await writeJson(reportPath, report);
else if (hash(await readJson(reportPath)) !== hash(report)) throw Error('Reproduction disagrees with the frozen report');
for (const {days, phases, gate} of report.horizons) {
  console.log(JSON.stringify({days, phases: Object.fromEntries(Object.entries(phases).map(([key, phase]) => [key, {
    count: phase.count, eligible: phase.eligible, mape: Object.fromEntries(ids.map(id => [id, phase.metrics[id]?.mape]))
  }])), gate}));
}
