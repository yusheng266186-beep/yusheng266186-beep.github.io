export function mergeFeedResults(previous, results, sourceNames, now = new Date().toISOString()) {
  const valid = x => x && typeof x.title === 'string' && /^https:\/\//.test(x.url || '') &&
    Number.isFinite(Date.parse(x.publishedAt)) && Date.parse(x.publishedAt) <= Date.parse(now) + 300000;
  const succeeded = results.map((r, i) => r.status === 'fulfilled' && r.value.some(valid) ? i : -1).filter(i => i >= 0);
  if (!succeeded.length) throw new Error('All official feeds failed; retained the existing news snapshot.');
  const failed = sourceNames.filter((_, i) => !succeeded.includes(i));
  const retained = (previous.items || []).filter(x => failed.includes(x.source));
  const incoming = succeeded.flatMap(i => results[i].value.filter(valid));
  const byURL = new Map([...retained, ...incoming].filter(valid).map(x => [x.url, x]));
  return { generatedAt: now, failedSources: failed, items: [...byURL.values()].sort((a,b) => Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,50) };
}
