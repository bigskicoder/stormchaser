import { describe, expect, it } from "vitest";
import { hashPin, ipTag, makeSessionToken, pinMatches, verifySessionToken, type PinSecret } from "@/lib/admin/pin";

const stored: PinSecret = { kind: "hash", ...hashPin("246810") };
const env: PinSecret = { kind: "env", pin: "1357" };

describe("admin PIN", () => {
  it("checks a guess against the salted hash", () => {
    expect(pinMatches(stored, "246810")).toBe(true);
    expect(pinMatches(stored, " 246810 ")).toBe(true);
    expect(pinMatches(stored, "246811")).toBe(false);
    expect(pinMatches(stored, "")).toBe(false);
  });

  it("salts each hash differently", () => {
    expect(hashPin("246810").hash).not.toBe(hashPin("246810").hash);
  });

  it("checks a guess against the Vercel PIN", () => {
    expect(pinMatches(env, "1357")).toBe(true);
    expect(pinMatches(env, "13570")).toBe(false);
  });

  it("accepts its own session cookie until it expires", () => {
    const now = Date.UTC(2026, 10, 13);
    const { token } = makeSessionToken(stored, now);
    expect(verifySessionToken(stored, token, now + 1000)).toBe(true);
    expect(verifySessionToken(stored, token, now + 13 * 3600_000)).toBe(false);
  });

  it("rejects forged, tampered or other-PIN cookies", () => {
    const now = Date.UTC(2026, 10, 13);
    const { token } = makeSessionToken(stored, now);
    const [exp, mac] = token.split(".");
    expect(verifySessionToken(stored, `${Number(exp) + 3600_000}.${mac}`, now)).toBe(false);
    expect(verifySessionToken(env, token, now)).toBe(false);
    expect(verifySessionToken({ kind: "hash", ...hashPin("246810") }, token, now)).toBe(false);
    expect(verifySessionToken(stored, undefined, now)).toBe(false);
    expect(verifySessionToken(stored, "garbage", now)).toBe(false);
  });

  it("never logs the IP itself", () => {
    expect(ipTag("203.0.113.9")).not.toContain("203");
    expect(ipTag("203.0.113.9")).toBe(ipTag("203.0.113.9"));
  });
});
