import {hash} from './forecast-study-io.mjs';

export function profileKey(methodHash, daily, evidence) {
  const cutoff = Date.parse(daily.at(-1).time + 'T15:30:00+08:00');
  const knows = value => Date.parse(value) <= cutoff;
  const news = evidence.news.flatMap(item => {
    if (!item.versions?.length) return knows(item.firstSeenAt) && knows(item.publishedAt) ? [item] : [];
    const versions = item.versions.filter(entry => knows(entry.firstSeenAt));
    return versions.length ? [{...item, versions}] : [];
  });
  const snapshots = evidence.snapshots.filter(row => knows(row.capturedAt));
  const current = evidence.aiNews;
  const aiNews = current?.schema === 1 ? knows(current.generatedAt)
    ? {...current, events: (current.events || []).filter(row => knows(row.knownAt) && knows(row.publishedAt))}
    : {schema: 1, available: false} : null;
  // These are the historical price fields read by the numeric kernels. Capture
  // receipts are kept in the publication hash, but do not require a new fit.
  const prices = daily.map(row => [row.time, row.open, row.high, row.low, row.close, row.volume, row.volumeSource]);
  return hash({methodHash, prices, news, snapshots, aiNews});
}
