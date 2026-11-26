import Core from '../assets/core.js';
import Quant from '../assets/quant.js';

export const horizons = [{days: 7, steps: 5}, {days: 30, steps: 21}];
export const candidateIds = ['price-ridge', 'gold-fx', 'gold-fx-rates'];
export const studyId = 'au9999-short-horizon-1';
export const closeTime = date => Date.parse(date + 'T15:30:00+08:00');
export const dayMs = 86_400_000;
const gramsPerTroyOunce = 31.1034768;
const names = ['goldUsdOz', 'usdCny', 'realRates'];
const scaleFloor = 1e-6;
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const clip = (value, cap) => Math.max(-cap, Math.min(cap, value));
const dimensions = {'price-ridge': 3, 'gold-fx': 8, 'gold-fx-rates': 10};

function feed(seed, vintages, name) {
  const historical = seed.series[name].rows.map(([date, value, availableAt]) => ({
    date, value, availableAt, capturedAt: seed.capturedAt, source: seed.series[name].source, quality: seed.series[name].quality
  }));
  const captured = (vintages?.records || []).filter(row => {
    if (name === 'goldUsdOz') return row.series === name && row.source === 'sina-xau';
    if (name === 'usdCny') return row.series === name && row.source === 'ecb-fx';
    return row.series === 'macro:DFII10' || row.series === 'factor:realRates' && row.source === 'treasury';
  }).map(row => ({...row, capturedAt: row.firstSeenAt, quality: row.availability === 'official-vintage' ? 'initial-release' : 'recorded'}));
  return [...historical, ...captured].filter(row => Number.isFinite(row.value) && Number.isFinite(Date.parse(row.availableAt))
    && Date.parse(row.date) <= Date.parse(row.availableAt) && (name === 'realRates' || row.value > 0));
}

function historyViews(rows, feedRows, currentCutoff) {
  const ordered = [...feedRows].sort((a, b) => a.availableAt.localeCompare(b.availableAt));
  let index = 0, latest;
  const picked = rows.map(row => {
    const cutoff = closeTime(row.time);
    while (index < ordered.length && Date.parse(ordered[index].availableAt) <= cutoff) {
      const candidate = ordered[index++];
      if (!latest || candidate.date >= latest.date) latest = candidate;
    }
    return latest && cutoff - Date.parse(latest.date) <= dayMs * 8 ? latest : null;
  });
  if (currentCutoff !== undefined) {
    let last;
    for (const row of ordered) {
      if (Date.parse(row.availableAt) > currentCutoff) break;
      if (row.quality !== 'initial-release' && !(Date.parse(row.capturedAt) <= currentCutoff)) continue;
      // Use the same latest source session as in the historical recipe. A release
      // received after the origin close can first inform the following origin.
      if (Date.parse(row.availableAt) > closeTime(rows.at(-1).time)) break;
      if (!last || row.date >= last.date) last = row;
    }
    picked[picked.length - 1] = last && closeTime(rows.at(-1).time) - Date.parse(last.date) <= 8 * dayMs ? last : null;
  }
  return picked;
}

export function featurePanel(daily, seed, {vintages, currentCutoff} = {}) {
  const feeds = names.map(name => historyViews(daily, feed(seed, vintages, name), currentCutoff));
  const value = (series, index) => feeds[series][index]?.value;
  const logMove = (end, start) => end > 0 && start > 0 ? Math.log(end / start) : null;
  const basis = daily.map((row, i) => logMove(row.close * gramsPerTroyOunce, value(0, i) * value(1, i)));
  const features = daily.map((row, i) => {
    if (i < 60) return [];
    const price = [5, 20, 60].map(lag => logMove(row.close, daily[i - lag].close));
    const international = [0, 1].flatMap(series => [5, 20].map(lag => logMove(value(series, i), value(series, i - lag))));
    const former = basis.slice(i - 20, i);
    const premium = basis[i] !== null && former.every(Number.isFinite) ? basis[i] - mean(former) : null;
    const realRates = [5, 20].map(lag => Number.isFinite(value(2, i)) && Number.isFinite(value(2, i - lag))
      ? value(2, i) - value(2, i - lag) : null);
    return [...price, ...international, premium, ...realRates];
  });
  const latest = Object.fromEntries(names.map((name, i) => {
    const row = feeds[i].at(-1);
    const record = row ? Object.fromEntries(['date', 'value', 'availableAt', 'capturedAt', 'source', 'quality'].map(key => [key, row[key]])) : null;
    return [name, record];
  }));
  return {features, latest};
}

function solve(matrix, output) {
  const width = output.length;
  const augmented = matrix.map((row, index) => [...row, output[index]]);
  for (let j = 0; j < width; j++) {
    const divisor = augmented[j][j];
    if (!(divisor > 0)) throw Error('Non-positive ridge pivot');
    for (let k = j; k <= width; k++) augmented[j][k] /= divisor;
    for (let i = 0; i < width; i++) {
      if (i === j) continue;
      const weight = augmented[i][j];
      for (let k = j; k <= width; k++) augmented[i][k] -= weight * augmented[j][k];
    }
  }
  return augmented.map(row => row[width]);
}

export function ridgeForecast(daily, panel, origin, steps, id) {
  const width = dimensions[id];
  if (!width || panel.features[origin].length < width) return null;
  const current = panel.features[origin].slice(0, width);
  if (!current.every(Number.isFinite)) return null;
  const samples = [];
  for (let i = Math.max(60, origin - 504); i + steps <= origin; i++) {
    const x = panel.features[i].slice(0, width);
    if (x.length !== width || !x.every(Number.isFinite)) continue;
    samples.push({x, y: Math.log(daily[i + steps].close / daily[i].close), w: Math.exp(-Math.LN2 * (origin - i - steps) / 126)});
  }
  if (samples.length < 120) return null;
  const total = samples.reduce((sum, row) => sum + row.w, 0);
  const means = current.map((_, j) => samples.reduce((sum, row) => sum + row.w * row.x[j], 0) / total);
  const scales = means.map((center, j) => Math.max(scaleFloor, Math.sqrt(samples.reduce((sum, row) => sum + row.w * (row.x[j] - center) ** 2, 0) / total)));
  const standardize = row => [1, ...row.map((value, j) => clip((value - means[j]) / scales[j], 3))];
  const matrix = Array.from({length: width + 1}, (_, i) => Array.from({length: width + 1}, (_, j) => i === j ? (i ? 40 : 10) : 0));
  const target = Array(width + 1).fill(0);
  for (const sample of samples) {
    const x = standardize(sample.x);
    for (let i = 0; i <= width; i++) {
      const weighted = x[i] * sample.w;
      target[i] += weighted * sample.y;
      for (let j = 0; j <= width; j++) matrix[i][j] += weighted * x[j];
    }
  }
  const beta = solve(matrix, target);
  const raw = standardize(current).reduce((sum, value, index) => sum + value * beta[index], 0);
  const sigma = Quant.fit(daily.slice(Math.max(0, origin - 90), origin + 1)).sigma * Math.sqrt(steps);
  const center = daily[origin].close * Math.exp(clip(raw * .5, Math.min(.25, 2 * sigma)));
  return {center, sigma, trainCount: samples.length};
}

export function interval(center, sigma, errors = []) {
  const sample = errors.slice(-100).sort((a, b) => a - b);
  // Finite sample correction for an 80% interval.
  const ready = sample.length >= 20;
  const multiplier = ready ? Math.max(.05, sample[Math.min(sample.length - 1, Math.ceil(.8 * (sample.length + 1)) - 1)]) : 1.2815515655;
  return {center, low: center * Math.exp(-multiplier * sigma), high: center * Math.exp(multiplier * sigma), calibrationCount: sample.length, calibrated: ready};
}

export function score(forecast, start, actual) {
  const {center, low, high} = forecast;
  const outside = Math.max(0, low - actual, actual - high);
  const actualDirection = Math.sign(actual - start);
  return {mape: Math.abs(center / actual - 1) * 100, absLogError: Math.abs(Math.log(center / actual)) * 100,
    direction: Math.sign(center - start) === actualDirection ? 1 : 0, up: actualDirection > 0 ? 1 : 0,
    coverage: outside ? 0 : 1, intervalScore: (high - low + 10 * outside) / start * 100};
}

export function studyRoll(daily, seed) {
  const panel = featurePanel(daily, seed);
  const indices = new Map(daily.map((row, index) => [row.time, index]));
  const profiles = Quant.profile(daily, {}).evaluations.slice(0, 2);
  return profiles.map(profile => {
    const errors = Object.fromEntries(candidateIds.map(id => [id, []]));
    const records = profile.records.map(record => {
      const index = indices.get(record.origin);
      const arms = {
        flat: {center: record.start, low: record.start * record.low / record.center, high: record.start * record.high / record.center},
        incumbent: {center: record.center, low: record.low, high: record.high}
      };
      for (const id of candidateIds) {
        const fitted = ridgeForecast(daily, panel, index, profile.steps, id);
        if (!fitted) continue;
        arms[id] = interval(fitted.center, fitted.sigma, errors[id]);
        errors[id].push(Math.abs(Math.log(record.actual / fitted.center)) / fitted.sigma);
      }
      return {origin: record.origin, target: record.target, start: record.start, actual: record.actual, arms};
    });
    return {days: profile.days, steps: profile.steps, records, errors: Object.fromEntries(candidateIds.map(id => [id, errors[id].slice(-100)]))};
  });
}

export function normalizedCloses(history) {
  return Core.closedDaily(history.daily, history.generatedAt, Date.parse(history.generatedAt)).closed;
}
