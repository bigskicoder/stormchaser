import { describe, expect, it } from "vitest";
import { WeightedRateLimiter, openMeteoCallWeight } from "@/lib/utils/weighted-rate-limiter";
import { mapWithConcurrency } from "@/lib/utils/concurrency";

describe("openMeteoCallWeight", () => {
  it("counts one call per two weeks and scales past ten variables", () => {
    expect(openMeteoCallWeight(7, 2)).toBe(1);
    expect(openMeteoCallWeight(28, 2)).toBe(2);
    expect(openMeteoCallWeight(28, 20, 3)).toBe(12);
  });
});

describe("WeightedRateLimiter", () => {
  function fakeClock() {
    let t = 0;
    return {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
      get t() {
        return t;
      },
    };
  }

  it("admits requests until the window is full, then waits for the oldest to expire", async () => {
    const clock = fakeClock();
    const limiter = new WeightedRateLimiter([{ ms: 60_000, max: 100 }], clock.now, clock.sleep);
    await limiter.acquire(60);
    expect(clock.t).toBe(0);
    await limiter.acquire(60);
    expect(clock.t).toBe(60_000);
  });

  it("always admits one request into an empty window even if it exceeds the cap", async () => {
    const clock = fakeClock();
    const limiter = new WeightedRateLimiter([{ ms: 60_000, max: 10 }], clock.now, clock.sleep);
    await limiter.acquire(50);
    expect(clock.t).toBe(0);
  });

  it("holds every caller during a pause", async () => {
    const clock = fakeClock();
    const limiter = new WeightedRateLimiter([{ ms: 60_000, max: 100 }], clock.now, clock.sleep);
    limiter.pauseFor(70_000);
    await limiter.acquire(1);
    expect(clock.t).toBe(70_000);
  });

  it("respects the tightest of several windows", () => {
    const clock = fakeClock();
    const limiter = new WeightedRateLimiter(
      [
        { ms: 60_000, max: 1000 },
        { ms: 3_600_000, max: 100 },
      ],
      clock.now,
      clock.sleep
    );
    void limiter.acquire(80);
    expect(limiter.waitMs(30)).toBe(3_600_000);
    expect(limiter.waitMs(20)).toBe(0);
  });
});

describe("mapWithConcurrency", () => {
  it("keeps input order and never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithConcurrency([5, 1, 3, 2, 4], 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, n));
      inFlight -= 1;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20, 40]);
    expect(peak).toBe(2);
  });
});
