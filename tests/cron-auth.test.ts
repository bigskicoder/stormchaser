import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";

function reqWithAuthHeader(value: string | null): NextRequest {
  return { headers: { get: (key: string) => (key === "authorization" ? value : null) } } as unknown as NextRequest;
}

describe("verifyCronRequest", () => {
  const originalSecret = process.env.CRON_SECRET;

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  it("allows the request through when no CRON_SECRET is configured (local dev)", () => {
    delete process.env.CRON_SECRET;
    expect(verifyCronRequest(reqWithAuthHeader(null))).toBeNull();
  });

  describe("with CRON_SECRET set", () => {
    beforeEach(() => {
      process.env.CRON_SECRET = "test-secret-123";
    });

    it("allows the request through with the correct bearer token", () => {
      expect(verifyCronRequest(reqWithAuthHeader("Bearer test-secret-123"))).toBeNull();
    });

    it("rejects a missing authorization header with 401", async () => {
      const result = verifyCronRequest(reqWithAuthHeader(null));
      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
    });

    it("rejects an incorrect bearer token with 401", () => {
      const result = verifyCronRequest(reqWithAuthHeader("Bearer wrong-secret"));
      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
    });

    it("rejects a header missing the 'Bearer ' prefix", () => {
      const result = verifyCronRequest(reqWithAuthHeader("test-secret-123"));
      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
    });
  });
});
