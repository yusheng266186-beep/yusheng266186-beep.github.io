import {candidateIds, closeTime, horizons, score, studyId} from './forecast-study-model.mjs';
import {hash} from './forecast-study-io.mjs';

export const forecastIds = ['flat', 'production', ...candidateIds];
export const maxIssueDelay = 8 * 60 * 60 * 1000;

export function updateStudyLedger(previous, {daily, issued, observedEntries = [], sourceSha, now, historyAsOf}) {
  if (previous?.schema !== 1 || previous?.studyId !== studyId) throw Error('Unrecognized forecast ledger schema');
  const time = Date.parse(now);
  if (!Number.isFinite(time)) throw Error('Invalid ledger reference time');
  const entries = [...previous.entries];
  const receipts = {...previous.receipts};
  const outcomes = {...previous.outcomes};
  const verified = new Map(observedEntries.map(entry => [entry.id, hash(entry)]));
  for (const entry of entries) {
    if (!receipts[entry.id] && /^[a-f0-9]{40}$/.test(sourceSha || '') && verified.get(entry.id) === hash(entry)
      && time >= Date.parse(entry.issuedAt) && time - closeTime(entry.origin) <= maxIssueDelay) {
      receipts[entry.id] = {observedAt: now, sourceSha};
    }
    if (!receipts[entry.id]) continue;
    const publicAt = Math.max(Date.parse(entry.issuedAt), Date.parse(receipts[entry.id].observedAt));
    const startIndex = daily.findIndex(row => closeTime(row.time) > publicAt);
    if (startIndex < 0) continue;
    for (const forecast of entry.forecasts) {
      const key = entry.id + '|' + forecast.days;
      const actual = daily[startIndex + forecast.steps - 1];
      if (outcomes[key] || !actual) continue;
      const captured = Date.parse(actual.observedAt || historyAsOf);
      if (!(closeTime(actual.time) > publicAt && captured >= closeTime(actual.time) && captured <= time)) continue;
      outcomes[key] = {target: actual.time, actual: actual.close, capturedAt: new Date(captured).toISOString(), verifiedAt: now, historyAsOf};
    }
  }
  if (issued && !entries.some(entry => entry.origin === issued.origin) && Date.parse(issued.issuedAt) === time
    && issued.origin === daily.at(-1)?.time && time >= closeTime(issued.origin) && time - closeTime(issued.origin) <= maxIssueDelay) {
    entries.push(issued);
  }
  return {schema: 1, studyId, entries, receipts, outcomes};
}

export function summarizeStudy(ledger, revision) {
  const active = ledger.entries.filter(entry => entry.revision === revision);
  const published = active.filter(entry => ledger.receipts[entry.id]);
  return {studyId, revision, frozen: active.length, publicReceipts: published.length, latest: published.at(-1)?.origin || null,
    horizons: horizons.map(({days}) => {
      const resolved = published.flatMap(entry => {
        const forecast = entry.forecasts.find(row => row.days === days);
        const actual = ledger.outcomes[entry.id + '|' + days];
        return forecast && actual ? [{entry, forecast, actual}] : [];
      });
      const ready = resolved.filter(({forecast}) => forecastIds.every(id => forecast.arms[id]));
      const common = [];
      let previousTarget = -Infinity;
      for (const record of ready.sort((a, b) => a.entry.issuedAt.localeCompare(b.entry.issuedAt))) {
        const observedAt = Date.parse(ledger.receipts[record.entry.id].observedAt);
        if (observedAt < previousTarget) continue;
        common.push(record);
        previousTarget = closeTime(record.actual.target);
      }
      const metrics = Object.fromEntries(forecastIds.map(id => {
        if (!common.length) return [id, null];
        const losses = common.map(({entry, forecast, actual}) => score(forecast.arms[id], entry.anchor, actual.actual));
        return [id, Object.fromEntries(Object.keys(losses[0]).map(key => [key, losses.reduce((sum, row) => sum + row[key], 0) / losses.length]))];
      }));
      return {days, resolved: resolved.length, count: common.length, metrics, minimum: 32, status: common.length >= 32 ? 'review-eligible' : 'collecting'};
    })};
}
