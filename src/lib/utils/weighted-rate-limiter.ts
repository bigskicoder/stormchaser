/**
 * Client-side pacer for Open-Meteo's free tier, shared by every parallel
 * worker in scripts/run-local-model.ts. Open-Meteo counts a request as
 * several "calls" when it covers more than two weeks or more than ten
 * variables (open-meteo.com/en/pricing), and enforces per-minute, per-hour
 * and per-day caps. Running resorts in parallel without pacing just trips
 * the per-minute cap and makes every worker sit out the 429 penalty, so
 * workers reserve an estimated weight here before each request instead.
 * The 429 handling in the driver stays as the backstop for when the
 * estimate is off.
 */

export interface RateWindow {
  ms: number;
  max: number;
}

/** Open-Meteo's documented weighting: one call per 2 weeks of data, scaled by variables beyond 10. */
export function openMeteoCallWeight(days: number, variables: number, requests = 1): number {
  return requests * Math.max(1, days / 14) * Math.max(1, variables / 10);
}

export class WeightedRateLimiter {
  private log: Array<{ at: number; weight: number }> = [];
  private pausedUntil = 0;

  constructor(
    private readonly windows: RateWindow[],
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
  ) {}

  /** Blocks every caller until `ms` from now, e.g. after the API answers 429. */
  pauseFor(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
  }

  /** How long a request of `weight` must wait right now; 0 means it can go. */
  waitMs(weight: number): number {
    const t = this.now();
    if (t < this.pausedUntil) return this.pausedUntil - t;
    const longest = Math.max(...this.windows.map((w) => w.ms));
    this.log = this.log.filter((e) => t - e.at < longest);
    let wait = 0;
    for (const w of this.windows) {
      const inWindow = this.log.filter((e) => t - e.at < w.ms);
      let used = inWindow.reduce((sum, e) => sum + e.weight, 0);
      // An empty window always admits one request, even one heavier than the cap.
      if (used === 0 || used + weight <= w.max) continue;
      // Wait until enough of the oldest entries age out to make room.
      for (const e of inWindow) {
        used -= e.weight;
        if (used + weight <= w.max) {
          wait = Math.max(wait, e.at + w.ms - t);
          break;
        }
      }
    }
    return wait;
  }

  async acquire(weight: number): Promise<void> {
    for (;;) {
      const wait = this.waitMs(weight);
      if (wait <= 0) {
        this.log.push({ at: this.now(), weight });
        return;
      }
      await this.sleep(wait);
    }
  }
}
