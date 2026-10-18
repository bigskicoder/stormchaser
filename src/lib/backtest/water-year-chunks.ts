/**
 * [start, end] pairs, newest first: the current water year so far, then
 * `years` full water years (Oct 1 - Sep 30, the snow season's own year),
 * each overlapping the next by one day (see scripts/run-local-model.ts header on the SNOTEL overlap rule). ERA5 lags real
 * time by about a week, so no chunk ends later than 7 days ago.
 *
 * Fixed calendar boundaries matter for resuming: chunk dates are part of
 * each progress key, and the earlier "365 days back from today" chunks
 * shifted every day, so a run on a new day matched none of the previous
 * day's keys and started over. A finished water year now keeps the same
 * key forever; only the current, still-growing one re-runs each day, and
 * it's small. Whole water years also keep each winter in one chunk, which
 * the base-depth model will want.
 */
export function waterYearChunksNewestFirst(years: number, today: Date = new Date()): Array<[string, string]> {
  const latest = new Date(today.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const currentWaterYear = today.getUTCMonth() >= 9 ? today.getUTCFullYear() + 1 : today.getUTCFullYear();
  const chunks: Array<[string, string]> = [];
  for (let wy = currentWaterYear; wy >= currentWaterYear - years; wy--) {
    const start = `${wy - 1}-09-30`;
    const fullEnd = `${wy}-09-30`;
    const end = fullEnd < latest ? fullEnd : latest;
    if (end > start) chunks.push([start, end]);
  }
  return chunks;
}
