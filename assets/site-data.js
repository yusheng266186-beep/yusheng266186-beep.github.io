(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AurumSiteData = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const files = {
    history: 'market-history.json', news: 'news.json', research: 'research-factors.json',
    ledger: 'forecast-ledger.json', publication: 'forecast-publication.json', analysisDesk: 'analysis-desk.json',
    validation: 'model-validation.json', modelResearch: 'model-research.json', systemValidation: 'system-validation.json',
    studyEvaluation: 'forecast-study-evaluation.json', studyStatus: 'forecast-study-status.json'
  };
  const archive = ['validation', 'modelResearch', 'systemValidation'];
  const plans = {
    overview: [], history: ['history'], trading: ['history'],
    forecast: ['history', 'news', 'research', 'publication', 'ledger'],
    intelligence: ['history', 'news', 'research', 'publication', 'ledger', 'analysisDesk']
  };

  function forChapter(chapter, {reports = false, study = false} = {}) {
    return [...new Set([...(plans[chapter] || []), ...(reports ? archive : []), ...(study ? ['studyEvaluation', 'studyStatus'] : [])])];
  }

  function valid(index, now = Date.now()) {
    const time = Date.parse(index?.generatedAt);
    return index?.schema === 1 && Number.isFinite(time) && time <= now + 300_000
      && index.market?.priceCnyGram > 0 && Number.isFinite(Date.parse(index.market.asOf))
      && Array.isArray(index.history?.daily) && index.history.daily.length > 0 && index.history.daily.length <= 91
      && Array.isArray(index.history?.intraday) && index.history.intraday.length <= 120
      && index.resources && Object.entries(index.resources).every(([name, item]) => Object.hasOwn(files, name)
        && /^[a-f0-9]{64}$/.test(item?.sha256) && /^[a-f0-9]{64}$/.test(item?.version));
  }

  function validProfile(lean, method) {
    return lean?.methodHash === method && /^\d{4}-\d{2}-\d{2}$/.test(lean.origin) && lean.anchor > 0 && lean.profile?.ready
      && lean.profile.asOf === lean.origin && lean.profile.fit?.sigma > 0
      && Array.isArray(lean.profile.evaluations) && [7, 30, 180, 365, 1095].every(days => lean.profile.evaluations.some(row => row.days === days && Number.isFinite(row.move) && row.steps > 0));
  }

  async function decodeResource(bytes, expected, digest = crypto.subtle) {
    const computed = Array.from(new Uint8Array(await digest.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (computed !== expected) throw Error('Data changed during publication');
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  return {files: Object.freeze(files), forChapter, valid, validProfile, decodeResource};
});
